// =============================================================================
// Firebase Cloud Functions (2nd Gen) — LINE Webhook & Scheduled Automations
// =============================================================================

import { onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import {
  verifyLineSignature,
  sendLineReply,
  sendLinePush,
  createBirthdayFlexMessage,
  getLineConfig,
  LineEvent,
  LineMessage,
} from './lineService';
import {
  getAllVolunteers,
  getVolunteerByLineId,
  getVolunteerAuthRecordByLineId,
  saveGroupStatus,
  getActiveGroups,
  parseSundaySchedule,
  formatWeeklyTeamRoster,
  applySlotFillToMatrix,
  canVolunteerFillVacancy,
} from './schedulerHelper';
import {
  createBindingInvite, redeemBindingInvite, createGroupBindingRequest,
  listGroupBindingCandidates, completeGroupBindingRequest, type BindingActor,
} from './bindingService';

async function verifyLineIdToken(idToken: string): Promise<string> {
  const { lineLoginChannelId } = getLineConfig();
  if (!idToken || !lineLoginChannelId) throw new Error('LINE Login is not configured');
  const verifyResponse = await fetch('https://api.line.me/oauth2/v2.1/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ id_token: idToken, client_id: lineLoginChannelId }).toString(),
  });
  if (!verifyResponse.ok) throw new Error('Invalid LINE token');
  const verified = await verifyResponse.json() as { sub?: string };
  if (!verified.sub) throw new Error('LINE token has no subject');
  return verified.sub;
}

async function authenticateFirebaseRequest(req: { headers: { authorization?: string | string[] } }): Promise<BindingActor> {
  const header = typeof req.headers.authorization === 'string' ? req.headers.authorization : '';
  const match = header.match(/^Bearer (.+)$/);
  if (!match) throw new Error('Unauthorized');
  const decoded = await (await import('firebase-admin')).auth().verifyIdToken(match[1]);
  const role = typeof decoded.role === 'string' ? decoded.role : 'volunteer';
  const managedTeams = Array.isArray(decoded.managedTeams)
    ? decoded.managedTeams.filter((team): team is string => typeof team === 'string') : [];
  const volunteerId = typeof decoded.volunteerId === 'string' ? decoded.volunteerId : decoded.uid;
  return { volunteerId, role, managedTeams };
}

/**
 * 以 LINE Login ID token 換取 Firebase Custom Token。
 * LINE profile / localStorage 不再是權限資料來源；只有已綁定且有效名冊成員可取得 token。
 */
export const issueFirebaseToken = onRequest(
  {
    cors: true,
    region: 'asia-east1',
    secrets: ['LINE_LOGIN_CHANNEL_ID'],
  },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    const idToken = typeof req.body?.idToken === 'string' ? req.body.idToken : '';
    if (!idToken || !getLineConfig().lineLoginChannelId) {
      res.status(400).json({ error: 'LINE Login is not configured' });
      return;
    }

    let stage: 'line_verification' | 'roster_lookup' | 'token_creation' = 'line_verification';
    try {
      const lineId = await verifyLineIdToken(idToken);
      stage = 'roster_lookup';
      const volunteer = await getVolunteerAuthRecordByLineId(lineId);
      if (!volunteer || !volunteer.isActive) {
        res.status(403).json({ error: 'LINE account is not bound to an active roster member' });
        return;
      }

      const role = volunteer.userLevel === 'admin' && volunteer.managedTeams.length === 0
        ? 'super_admin'
        : volunteer.managedTeams.length > 0 ? 'team_lead' : 'volunteer';
      stage = 'token_creation';
      const firebaseToken = await (await import('firebase-admin')).auth().createCustomToken(volunteer.volunteerId, {
        role,
        managedTeams: volunteer.managedTeams,
        volunteerId: volunteer.volunteerId,
      });
      res.status(200).json({ firebaseToken, volunteerId: volunteer.volunteerId, role });
    } catch (err) {
      console.error('[issueFirebaseToken Error]:', err);
      // 回傳可供支援判讀的安全分類；原始例外只保留在 Cloud Logging。
      const code = stage === 'line_verification'
        ? 'LINE_TOKEN_VERIFICATION_FAILED'
        : stage === 'roster_lookup'
          ? 'ROSTER_LOOKUP_FAILED'
          : 'FIREBASE_TOKEN_CREATION_FAILED';
      res.status(500).json({ error: 'Unable to issue Firebase token', code });
    }
  },
);

/** 由已登入的總管理員／團隊幹部產生一次性邀請連結。 */
export const createLineBindingInvite = onRequest({ cors: true, region: 'asia-east1' }, async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  try {
    const actor = await authenticateFirebaseRequest(req);
    const volunteerId = typeof req.body?.volunteerId === 'string' ? req.body.volunteerId : '';
    const invitation = await createBindingInvite(actor, volunteerId);
    const { systemUrl } = getLineConfig();
    res.status(201).json({
      url: `${systemUrl}/?bindingInvite=${encodeURIComponent(invitation.token)}`,
      expiresAt: invitation.expiresAt.toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unable to create binding invite';
    res.status(message === 'Unauthorized' ? 401 : 403).json({ error: message });
  }
});

/** 同工開啟邀請連結後以自己的 LINE ID token 兌換，綁定採 transaction 保證單次使用。 */
export const redeemLineBindingInvite = onRequest(
  { cors: true, region: 'asia-east1', secrets: ['LINE_LOGIN_CHANNEL_ID'] },
  async (req, res) => {
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
    try {
      const token = typeof req.body?.token === 'string' ? req.body.token : '';
      const idToken = typeof req.body?.idToken === 'string' ? req.body.idToken : '';
      const lineId = await verifyLineIdToken(idToken);
      const result = await redeemBindingInvite(token, lineId);
      res.status(200).json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to redeem binding invite';
      res.status(400).json({ error: message });
    }
  },
);

/** 只有發出群組指令的已登入幹部可讀取可選名冊。 */
export const groupBindingCandidates = onRequest({ cors: true, region: 'asia-east1' }, async (req, res) => {
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }
  try {
    const actor = await authenticateFirebaseRequest(req);
    const requestId = typeof req.query.requestId === 'string' ? req.query.requestId : '';
    const candidates = await listGroupBindingCandidates(actor, requestId);
    res.status(200).json({ candidates });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unable to read candidates';
    res.status(403).json({ error: message });
  }
});

export const completeGroupLineBinding = onRequest({ cors: true, region: 'asia-east1' }, async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  try {
    const actor = await authenticateFirebaseRequest(req);
    const requestId = typeof req.body?.requestId === 'string' ? req.body.requestId : '';
    const volunteerId = typeof req.body?.volunteerId === 'string' ? req.body.volunteerId : '';
    await completeGroupBindingRequest(actor, requestId, volunteerId);
    res.status(200).json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unable to complete binding';
    res.status(403).json({ error: message });
  }
});

// 暫時保留部署過程中建立的備援端點，避免非互動部署自動刪除線上資源。
// 前端只使用未加 V2 的正式名稱；完成上線驗收後再集中移除這些相容端點。
export const createLineBindingInviteV2 = createLineBindingInvite;
export const redeemLineBindingInviteV2 = redeemLineBindingInvite;
export const groupBindingCandidatesV2 = groupBindingCandidates;
export const completeGroupLineBindingV2 = completeGroupLineBinding;

// =============================================================================
// 1. LINE Webhook HTTPS Endpoint
// =============================================================================

export const lineWebhook = onRequest(
  {
    cors: true,
    region: 'asia-east1',
    secrets: ['LINE_CHANNEL_SECRET', 'LINE_CHANNEL_ACCESS_TOKEN'],
  },
  async (req, res) => {
    // GET 請求用於健康檢查
    if (req.method === 'GET') {
      res.status(200).json({
        success: true,
        message: 'BOL Production LINE Webhook API is running on Firebase Cloud Functions (2nd Gen)!',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    if (req.method !== 'POST') {
      res.status(200).send('OK');
      return;
    }

    try {
      // LINE 簽名必須以未解析的 request body 驗證；JSON 重新序列化會改變位元組內容。
      const rawBody = req.rawBody instanceof Buffer
        ? req.rawBody.toString('utf8')
        : typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
      const signature = (req.headers['x-line-signature'] || req.headers['X-Line-Signature']) as string | undefined;

      // 沒有簽名或驗證失敗都不可處理事件，否則任何人都能偽造補位或群組狀態。
      if (!signature || !verifyLineSignature(rawBody, signature)) {
        console.warn('[Security Warning]: rejected LINE Webhook with invalid signature');
        res.status(401).send('Unauthorized');
        return;
      }

      const payload = typeof req.body === 'object' ? req.body : JSON.parse(rawBody || '{}');
      const events: LineEvent[] = payload.events || [];

      for (const event of events) {
        await handleSingleEvent(event);
      }

      res.status(200).send('OK');
    } catch (err: any) {
      console.error('[lineWebhook Error]:', err);
      res.status(200).send('OK');
    }
  }
);

async function handleSingleEvent(event: LineEvent) {
  const { systemUrl } = getLineConfig();

  try {
    // 1. 加入好友 (follow)
    if (event.type === 'follow' && event.replyToken) {
      const welcomeText =
        '平安！歡迎加入【義工排班官方小幫手】🎉\n\n' +
        '您可以輸入以下指令：\n' +
        '👉「本週服事」/「本週排班」/「本週班表」：查詢本週主日服事同工名單\n' +
        '👉「補位」/「我可以幫忙」：查看即時空缺並進行補位登記\n' +
        '👉「功能」：查看功能指令選單\n\n' +
        `排班系統網址：\n${systemUrl}`;

      await sendLineReply(event.replyToken, [{ type: 'text', text: welcomeText }]);
      return;
    }

    // 2. Bot 加入群組
    if (event.type === 'join' && event.replyToken) {
      const groupId = event.source.groupId || event.source.roomId;
      if (groupId) {
        await saveGroupStatus(groupId, event.source.type || 'group', 'active');
      }

      const groupWelcome =
        '平安！感謝邀請【義工排班官方小幫手】加入群組 🤝\n\n' +
        '小幫手會在每週排班完成後，提供【本週日服事同工完整名單】。\n' +
        '意願表單可隨時填寫，重送時以同一週期的最新版本為準。\n\n' +
        '隨時輸入「本週服事」即可快速查詢本週服事同工名單！';

      await sendLineReply(event.replyToken, [{ type: 'text', text: groupWelcome }]);
      return;
    }

    // 3. 只有 Bot 自己離開群組才停用群組；成員離開不影響群組公告。
    if (event.type === 'leave') {
      const groupId = event.source.groupId || event.source.roomId;
      if (groupId) {
        await saveGroupStatus(groupId, event.source.type || 'group', 'left');
      }
      return;
    }

    // 4. 即時補位點擊 (postback)
    if (event.type === 'postback' && event.postback && event.replyToken) {
      await handlePostbackEvent(event);
      return;
    }

    // 5. 文字訊息互動 (message)
    if (event.type === 'message' && event.message?.type === 'text' && event.replyToken) {
      await handleTextMessageEvent(event);
      return;
    }
  } catch (err) {
    console.error('[handleSingleEvent Error]:', err);
  }
}

/** 處理 Postback 補位點擊動作 */
async function handlePostbackEvent(event: LineEvent) {
  const replyToken = event.replyToken!;
  const dataStr = event.postback!.data;
  const params = new URLSearchParams(dataStr);
  const action = params.get('action');

  if (action === 'fill_slot') {
    const docId = params.get('docId') || '';
    const rowIndex = parseInt(params.get('row') || '-1', 10);
    const colIndex = parseInt(params.get('col') || '-1', 10);
    const date = params.get('date') || '';
    const loc = params.get('loc') || '';
    const role = params.get('role') || '';
    const userId = event.source.userId || '';

    const vol = await getVolunteerByLineId(userId);
    const volunteerName = vol?.name || '';

    if (!docId || rowIndex < 0 || colIndex < 0) {
      await sendLineReply(replyToken, [{ type: 'text', text: '⚠️ 補位參數有誤，請進入系統手動調整。' }]);
      return;
    }

    if (!vol || (role === '網路導播' && (loc !== '山莊' || !canVolunteerFillVacancy(vol, role, 'video')))) {
      await sendLineReply(replyToken, [{ type: 'text', text: '⚠️ 此職位目前不符合您的補位資格。' }]);
      return;
    }
    const currentSchedule = await parseSundaySchedule();
    const offeredSlot = currentSchedule.vacancies.some(slot =>
      slot.docId === docId && slot.rowIndex === rowIndex && slot.colIndex === colIndex &&
      slot.role === role && slot.location === loc);
    if (!offeredSlot) {
      await sendLineReply(replyToken, [{ type: 'text', text: '⚠️ 此補位已不在本週空缺，請重新查詢班表。' }]);
      return;
    }
    if (currentSchedule.assignmentsByVolunteer[volunteerName]?.length) {
      await sendLineReply(replyToken, [{ type: 'text', text: '⚠️ 您當日已有服事安排，請洽排班幹部協調。' }]);
      return;
    }

    const result = await applySlotFillToMatrix(
      docId,
      rowIndex,
      colIndex,
      volunteerName,
      loc,
      date,
      role
    );

    if (result.success) {
      const confirmMsg: LineMessage = {
        type: 'text',
        text:
          `🎉 感謝您的熱心擺上與及時支援！\n\n` +
          `已成功為您登記補位：\n` +
          `📅 日期：${date} (週日)\n` +
          `📍 地點：${loc}\n` +
          `🎯 職位：${role}\n` +
          `👤 同工：${volunteerName}\n\n` +
          `線上班表已即時更新完成，願神祝福您的服事！✨`,
      };
      await sendLineReply(replyToken, [confirmMsg]);
    } else {
      const failMsg: LineMessage = {
        type: 'text',
        text: `⚠️ 補位未完成：${result.message}\n請洽詢團隊管理員。`,
      };
      await sendLineReply(replyToken, [failMsg]);
    }
  }
}

/** 處理使用者文字訊息 */
async function handleTextMessageEvent(event: LineEvent) {
  const replyToken = event.replyToken!;
  const userText = (event.message?.text || '').trim();
  const isGroup = event.source.type === 'group' || event.source.type === 'room';
  const { systemUrl } = getLineConfig();

  if (isGroup && event.source.groupId) {
    saveGroupStatus(event.source.groupId, 'group', 'active').catch(() => {});
  }

  const isBindingCommand = /^綁定\s+.+\s+進系統$/.test(userText);
  if (isBindingCommand) {
    const mentionedUserId = event.message?.mention?.mentionees
      .map(mention => mention.userId)
      .find((id): id is string => Boolean(id));
    const requesterLineId = event.source.userId || '';
    const requester = requesterLineId ? await getVolunteerAuthRecordByLineId(requesterLineId) : null;
    if (!isGroup || !mentionedUserId) {
      await sendLineReply(replyToken, [{ type: 'text', text: '請在工作群組使用「綁定 @新同工 進系統」，並以 LINE 的實際標記選取同工。' }]);
      return;
    }
    if (!requester || !requester.isActive || (requester.userLevel !== 'admin' && requester.managedTeams.length === 0)) {
      await sendLineReply(replyToken, [{ type: 'text', text: '只有已綁定且具管理權限的幹部可以執行綁定。' }]);
      return;
    }
    try {
      const actor: BindingActor = {
        volunteerId: requester.volunteerId,
        role: requester.userLevel === 'admin' && requester.managedTeams.length === 0 ? 'super_admin' : 'team_lead',
        managedTeams: requester.managedTeams,
      };
      const request = await createGroupBindingRequest(actor, mentionedUserId);
      const url = `${systemUrl}/?bindingRequest=${encodeURIComponent(request.requestId)}`;
      await sendLinePush(requesterLineId, [{ type: 'text', text: `請在 20 分鐘內開啟此連結，從您管理範圍內選擇名冊成員完成綁定：\n${url}` }]);
      await sendLineReply(replyToken, [{ type: 'text', text: '已將受保護的名冊選擇連結私訊給發起幹部。' }]);
    } catch (err) {
      const message = err instanceof Error ? err.message : '無法建立綁定操作';
      await sendLineReply(replyToken, [{ type: 'text', text: message }]);
    }
    return;
  }

  // 1. 查詢班表關鍵字：「本週服事」、「本週排班」、「本週班表」（相容簡體/異體字）
  const isScheduleQuery =
    userText.includes('本週服事') ||
    userText.includes('本周服事') ||
    userText.includes('本週排班') ||
    userText.includes('本周排班') ||
    userText.includes('本週班表') ||
    userText.includes('本周班表');

  if (isScheduleQuery) {
    const rosterText = await formatWeeklyTeamRoster();
    await sendLineReply(replyToken, [{ type: 'text', text: rosterText }]);
    return;
  }

  // 2. 互動按鈕關鍵字：「補位」、「我可以幫忙」
  const isBackfillQuery = userText.includes('補位') || userText.includes('我可以幫忙');

  if (isBackfillQuery) {
    const userId = event.source.userId || '';
    const vol = userId ? await getVolunteerByLineId(userId) : null;
    const { vacancies, targetSundayStr } = await parseSundaySchedule();

    // 私訊時依技能比對，群組時列出全體空缺
    const matchingVacancies = (!isGroup && vol)
      ? vacancies.filter((v) => canVolunteerFillVacancy(vol, v.role, v.team))
      : vacancies;

    if (matchingVacancies.length > 0) {
      const topVacancies = matchingVacancies.slice(0, 5);
      const vacancyListText = topVacancies
        .map((v) => `  • ${v.location}【${v.role}】`)
        .join('\n');

      const quickReplyItems: any[] = topVacancies.map((slot) => ({
        type: 'action',
        action: {
          type: 'postback',
          label: `${slot.date} 幫忙${slot.role}`.substring(0, 20),
          data: `action=fill_slot&docId=${encodeURIComponent(slot.docId)}&row=${slot.rowIndex}&col=${slot.colIndex}&date=${encodeURIComponent(
            slot.date
          )}&loc=${encodeURIComponent(slot.location)}&role=${encodeURIComponent(slot.role)}`,
          displayText: `${slot.date} 我可以幫忙 ${slot.location}【${slot.role}】！`,
        },
      }));

      quickReplyItems.push({
        type: 'action',
        action: {
          type: 'message',
          label: '查詢本週服事',
          text: '本週服事',
        },
      });

      const replyWithQuickReply: LineMessage = {
        type: 'text',
        text:
          `平安${vol?.name ? ' ' + vol.name + ' 同工' : ''}！本週日 (${targetSundayStr}) 尚有以下空缺需要支援：\n\n` +
          `${vacancyListText}\n\n` +
          `若您方便參與服事，可直接點選下方按鈕即時補位喔！👇`,
        quickReply: {
          items: quickReplyItems,
        },
      };

      await sendLineReply(replyToken, [replyWithQuickReply]);
      return;
    } else {
      const noVacancyReply: LineMessage = {
        type: 'text',
        text:
          `平安！本週日 (${targetSundayStr}) 目前各崗位同工皆已安排就緒，暫無待補空缺。\n` +
          `非常感謝您的熱心擺上與願意服事的心！🙏\n\n` +
          `您可以隨時輸入「本週服事」查詢完整名冊。`,
      };
      await sendLineReply(replyToken, [noVacancyReply]);
      return;
    }
  }

  // 3. 功能選單指令：「功能」、「說明」、「指令」、「help」
  const isHelpQuery =
    userText === '功能' ||
    userText === '說明' ||
    userText === '指令' ||
    userText.toLowerCase() === 'help';

  if (isHelpQuery) {
    const reply: LineMessage = {
      type: 'text',
      text:
        '平安！我是【義工排班官方小幫手】🤖\n\n' +
        '您可以輸入以下指令：\n' +
        '👉「本週服事」/「本週排班」/「本週班表」：查詢本週主日服事同工名單\n' +
        '👉「補位」/「我可以幫忙」：查看即時空缺並進行補位登記\n\n' +
        `排班系統網址：\n${systemUrl}`,
    };
    await sendLineReply(replyToken, [reply]);
    return;
  }

  // 4. 其他任意文字：群組與私訊皆保持完全安靜，絕不干擾任何對話
  return;
}

// =============================================================================
// 2. 定時排程任務 (onSchedule)
// =============================================================================

/** 每週六 16:00 週日服事提醒 (個別通知 vs 群組全員名冊) */
export const saturdayReminder = onSchedule(
  {
    schedule: '0 16 * * 6',
    timeZone: 'Asia/Taipei',
    region: 'asia-east1',
    secrets: ['LINE_CHANNEL_SECRET', 'LINE_CHANNEL_ACCESS_TOKEN'],
  },
  async () => {
    const { assignmentsByVolunteer, targetSundayStr } = await parseSundaySchedule();
    const volunteers = await getAllVolunteers();
    const activeGroups = await getActiveGroups();

    console.log(`[saturdayReminder] 準備發送 ${targetSundayStr} 服事提醒...`);

    // 1. 個別通知 (1-on-1 Push Notification)
    let individualCount = 0;
    for (const vol of volunteers) {
      if (!vol.lineId) continue;

      const myAssignments = assignmentsByVolunteer[vol.name];
      if (myAssignments && myAssignments.length > 0) {
        const details = myAssignments
          .map((a) => `📍 地點：${a.location}\n🎯 職位：${a.role}`)
          .join('\n\n');

        const indMsg: LineMessage = {
          type: 'text',
          text:
            `【主日服事提醒 🔔】\n` +
            `平安，${vol.name} 同工！\n\n` +
            `提醒您明天（${targetSundayStr} 週日）有服事安排：\n` +
            `${details}\n\n` +
            `⏰ 請留意出勤時間並提早預備心，願神大大賜福您的擺上與服事！🙏`,
        };

        const ok = await sendLinePush(vol.lineId, [indMsg]);
        if (ok) individualCount++;
      }
    }

    // 2. 群組通知 (Group Broadcast)
    const rosterText = await formatWeeklyTeamRoster();
    const groupMsg: LineMessage = {
      type: 'text',
      text: `📢【每週六主日服事提醒】\n\n${rosterText}`,
    };

    let groupCount = 0;
    for (const groupId of activeGroups) {
      const ok = await sendLinePush(groupId, [groupMsg]);
      if (ok) groupCount++;
    }

    console.log(`[saturdayReminder] 完成！個別通知: ${individualCount} 人，群組廣播: ${groupCount} 個。`);
  }
);

/** 雙月 15、20 號提醒填寫或更新意願；表單不會因提醒而關閉。 */
export const cycleFormReminder = onSchedule(
  {
    schedule: '0 9 15,20 2,4,6,8,10,12 *',
    timeZone: 'Asia/Taipei',
    region: 'asia-east1',
    secrets: ['LINE_CHANNEL_SECRET', 'LINE_CHANNEL_ACCESS_TOKEN'],
  },
  async () => {
    const { systemUrl } = getLineConfig();
    const volunteers = await getAllVolunteers();
    const activeGroups = await getActiveGroups();
    const message: LineMessage = {
      type: 'text',
      text:
        '📝【服事意願提醒】\n\n' +
        '各位同工平安！您可隨時填寫或更新下一期的服事意願。\n' +
        '若需要修改，直接重新送出即可，系統會以該週期最新一份資料為準；表單不會關閉。\n\n' +
        `🔗 ${systemUrl}`,
    };
    for (const volunteer of volunteers) {
      if (volunteer.lineId) await sendLinePush(volunteer.lineId, [message]);
    }
    for (const groupId of activeGroups) {
      await sendLinePush(groupId, [message]);
    }
  },
);

/** 每日 09:00 生日祝福 Flex Message (支援多種日期格式相容) */
export const dailyBirthdayReminder = onSchedule(
  {
    schedule: '0 9 * * *',
    timeZone: 'Asia/Taipei',
    region: 'asia-east1',
    secrets: ['LINE_CHANNEL_SECRET', 'LINE_CHANNEL_ACCESS_TOKEN'],
  },
  async () => {
    const now = new Date();
    const utc = now.getTime() + now.getTimezoneOffset() * 60000;
    const twDate = new Date(utc + 8 * 3600000);

    const m = twDate.getMonth() + 1;
    const d = twDate.getDate();

    const volunteers = await getAllVolunteers();
    const celebrants: string[] = [];

    for (const vol of volunteers) {
      if (!vol.birthday) continue;

      const raw = vol.birthday.trim();
      let match = false;

      // 支援格式：YYYY-MM-DD, YYYY/MM/DD, MM-DD, MM/DD, M-D, M/D, X月X日
      const reg = /(\d{1,2})[-/.月](\d{1,2})/;
      const found = raw.match(reg);
      if (found) {
        const bm = parseInt(found[1], 10);
        const bd = parseInt(found[2], 10);
        if (bm === m && bd === d) {
          match = true;
        }
      }

      if (match) {
        celebrants.push(vol.name);
        if (vol.lineId) {
          const flexMsg = createBirthdayFlexMessage(vol.name, `${m}月${d}日`);
          await sendLinePush(vol.lineId, [flexMsg]);
        }
      }
    }

    console.log(`[dailyBirthdayReminder] 今日 (${m}/${d}) 壽星名單: ${celebrants.join(', ') || '無'}`);
  }
);

/** 
 * 🔔 每週二、四晚上 20:00 空缺急召自動推播
 * 依據使用者的 UID / 技能樹精確比對可補位職位（已排除備用位置）
 */
export const vacancyAlertReminder = onSchedule(
  {
    schedule: '0 20 * * 2,4',
    timeZone: 'Asia/Taipei',
    region: 'asia-east1',
    secrets: ['LINE_CHANNEL_SECRET', 'LINE_CHANNEL_ACCESS_TOKEN'],
  },
  async () => {
    const { vacancies, assignmentsByVolunteer, targetSundayStr } = await parseSundaySchedule();
    const { systemUrl } = getLineConfig();

    if (vacancies.length === 0) {
      console.log(`[vacancyAlertReminder] 本週日 (${targetSundayStr}) 目前各崗位均已排滿，無需推播。`);
      return;
    }

    console.log(`[vacancyAlertReminder] 本週日 (${targetSundayStr}) 偵測到 ${vacancies.length} 個正式空缺（已排除備用），準備依照各同工 UID / 技能樹分派推播...`);

    const volunteers = await getAllVolunteers();
    const activeGroups = await getActiveGroups();

    let userCount = 0;
    let groupCount = 0;

    // 1. 個別同工精準推播：依據每位同工的 UID (lineId) 偵測其團隊與可補位能力
    for (const vol of volunteers) {
      if (!vol.lineId) continue;

      // 若該同工在目標週日已經有服事安排，略過不推播
      const myAssignments = assignmentsByVolunteer[vol.name];
      if (myAssignments && myAssignments.length > 0) {
        continue;
      }

      // 篩選出該同工有能力且所屬團隊之可補位空缺
      const myVacancies = vacancies.filter((v) => canVolunteerFillVacancy(vol, v.role, v.team));
      if (myVacancies.length === 0) continue;

      // 整理該同工專屬的空缺地點摘要
      const locMap: Record<string, string[]> = {};
      for (const v of myVacancies) {
        if (!locMap[v.location]) locMap[v.location] = [];
        locMap[v.location].push(v.role);
      }
      const locSummary = Object.entries(locMap)
        .map(([loc, roles]) => `📍 ${loc}：${roles.map((r) => `【${r}】`).join('、')}`)
        .join('\n');

      // 建立該同工專屬的 Quick Reply 按鈕陣列 (最多 10 個職位 + 開啟排班系統)
      const quickReplyItems: any[] = myVacancies.slice(0, 10).map((slot) => {
        const shortRole = slot.role.length > 5 ? slot.role.substring(0, 5) : slot.role;
        const label = `${slot.date} 幫忙${shortRole}`;

        return {
          type: 'action',
          action: {
            type: 'postback',
            label: label.substring(0, 20),
            data: `action=fill_slot&docId=${encodeURIComponent(slot.docId)}&row=${slot.rowIndex}&col=${slot.colIndex}&date=${encodeURIComponent(
              slot.date
            )}&loc=${encodeURIComponent(slot.location)}&role=${encodeURIComponent(slot.role)}`,
            displayText: `${slot.date} 我可以幫忙 ${slot.location}【${slot.role}】！`,
          },
        };
      });

      if (systemUrl) {
        quickReplyItems.push({
          type: 'action',
          action: {
            type: 'uri',
            label: '開啟排班系統',
            uri: systemUrl,
          },
        });
      }

      const alertMsg: LineMessage = {
        type: 'text',
        text:
          `📢【服事空缺急召提醒】\n\n` +
          `平安 ${vol.name} 同工！\n` +
          `本週日 (${targetSundayStr}) 您的團隊尚有以下服事空缺需要支援：\n\n` +
          `${locSummary}\n\n` +
          `點選下方按鈕即可一秒完成登記補位：`,
        quickReply: {
          items: quickReplyItems,
        },
      };

      const ok = await sendLinePush(vol.lineId, [alertMsg]);
      if (ok) userCount++;
    }

    // 2. 群組推播 (公佈全團隊空缺與可點選按鈕)
    if (activeGroups.length > 0) {
      const locMap: Record<string, string[]> = {};
      for (const v of vacancies) {
        if (!locMap[v.location]) locMap[v.location] = [];
        locMap[v.location].push(v.role);
      }
      const locSummary = Object.entries(locMap)
        .map(([loc, roles]) => `📍 ${loc}：${roles.map((r) => `【${r}】`).join('、')}`)
        .join('\n');

      const groupQuickReply: any[] = vacancies.slice(0, 10).map((slot) => ({
        type: 'action',
        action: {
          type: 'postback',
          label: `${slot.date} 幫忙${slot.role}`.substring(0, 20),
          data: `action=fill_slot&docId=${encodeURIComponent(slot.docId)}&row=${slot.rowIndex}&col=${slot.colIndex}&date=${encodeURIComponent(
            slot.date
          )}&loc=${encodeURIComponent(slot.location)}&role=${encodeURIComponent(slot.role)}`,
          displayText: `${slot.date} 我可以幫忙 ${slot.location}【${slot.role}】！`,
        },
      }));

      if (systemUrl) {
        groupQuickReply.push({
          type: 'action',
          action: { type: 'uri', label: '開啟排班系統', uri: systemUrl },
        });
      }

      const groupAlertMsg: LineMessage = {
        type: 'text',
        text:
          `📢【服事空缺急召公告】\n\n` +
          `各位同工平安！\n` +
          `本週日 (${targetSundayStr}) 目前尚有以下服事空缺需要支援：\n\n` +
          `${locSummary}\n\n` +
          `若有同工方便支援，可點選下方按鈕一秒補位！`,
        quickReply: {
          items: groupQuickReply,
        },
      };

      for (const groupId of activeGroups) {
        const ok = await sendLinePush(groupId, [groupAlertMsg]);
        if (ok) groupCount++;
      }
    }

    console.log(`[vacancyAlertReminder] 依 UID / 技能樹空缺急召推播完成！個別同工: ${userCount} 人，群組: ${groupCount} 個。`);
  }
);
