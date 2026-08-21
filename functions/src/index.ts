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
  saveGroupStatus,
  getActiveGroups,
  parseSundaySchedule,
  formatWeeklyTeamRoster,
  applySlotFillToMatrix,
  canVolunteerFillVacancy,
} from './schedulerHelper';

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
      const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
      const signature = (req.headers['x-line-signature'] || req.headers['X-Line-Signature']) as string | undefined;

      // 🔒 驗證 LINE 簽名 (HMAC-SHA256)
      if (signature && !verifyLineSignature(rawBody, signature)) {
        console.warn('[Security Warning]: LINE Webhook signature mismatch');
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
        '本帳號將提供：\n' +
        '1. 📅 每週六下午 16:00 週日服事貼心提醒\n' +
        '2. 📝 每期服事意願表單催填通知\n' +
        '3. ⚡ 即時空缺補位與班表查詢\n' +
        '4. 🎂 專屬生日祝福\n\n' +
        '隨時輸入「本週服事」即可快速查詢名單！\n' +
        `排班系統網址：${systemUrl}`;

      await sendLineReply(event.replyToken, [{ type: 'text', text: welcomeText }]);
      return;
    }

    // 2. 加入群組 (join / memberJoined)
    if ((event.type === 'join' || event.type === 'memberJoined') && event.replyToken) {
      const groupId = event.source.groupId || event.source.roomId;
      if (groupId) {
        await saveGroupStatus(groupId, event.source.type || 'group', 'active');
      }

      const groupWelcome =
        '平安！感謝邀請【義工排班官方小幫手】加入群組 🤝\n\n' +
        '小幫手將會在：\n' +
        '⏰ 每週六下午 16:00 自動公佈【本週日服事同工完整名單】\n' +
        '📢 週期意願表單開放 (15號) 與截止 (20號) 時提醒大家填報！\n\n' +
        '隨時輸入「本週服事」即可快速查詢本週服事同工名單！';

      await sendLineReply(event.replyToken, [{ type: 'text', text: groupWelcome }]);
      return;
    }

    // 3. 離開群組 (leave / memberLeft)
    if (event.type === 'leave' || event.type === 'memberLeft') {
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
    const volunteerName = vol?.name || '熱心同工';

    if (!docId || rowIndex < 0 || colIndex < 0) {
      await sendLineReply(replyToken, [{ type: 'text', text: '⚠️ 補位參數有誤，請進入系統手動調整。' }]);
      return;
    }

    const result = await applySlotFillToMatrix(docId, rowIndex, colIndex, volunteerName);

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

  // 1. 查詢「本週服事」
  if (userText.includes('本週服事') || userText.includes('本周服事') || userText.includes('服事名單') || userText === '排班') {
    const rosterText = await formatWeeklyTeamRoster();
    await sendLineReply(replyToken, [{ type: 'text', text: rosterText }]);
    return;
  }

  // 2. 1 對 1 私訊時：依據同工的 UID / 技能樹偵測該同工可以補位的空缺 (已排除備用席位)
  if (!isGroup) {
    const userId = event.source.userId || '';
    const vol = await getVolunteerByLineId(userId);
    const { vacancies, targetSundayStr } = await parseSundaySchedule();

    const matchingVacancies = vol
      ? vacancies.filter((v) => canVolunteerFillVacancy(vol, v.role, v.team))
      : vacancies;

    if (matchingVacancies.length > 0) {
      const topVacancies = matchingVacancies.slice(0, 3);
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
          label: '查看本週名冊',
          text: '本週服事',
        },
      });

      const replyWithQuickReply: LineMessage = {
        type: 'text',
        text:
          `平安 ${vol?.name ? vol.name + ' 同工' : ''}！本週日 (${targetSundayStr}) 您的團隊尚有以下空缺需要支援：\n\n` +
          `${vacancyListText}\n\n` +
          `若您本週方便參與服事，可直接點選下方快捷按鈕即時補位喔！👇`,
        quickReply: {
          items: quickReplyItems,
        },
      };

      await sendLineReply(replyToken, [replyWithQuickReply]);
      return;
    }

    // 若本週無空缺，給予標準引導訊息
    const reply: LineMessage = {
      type: 'text',
      text:
        `平安！本週日 (${targetSundayStr}) 目前各崗位同工皆已安排就緒 👍\n\n` +
        `您可以輸入「本週服事」查詢當週服事同工名單，或進入系統查看最新排班：\n${systemUrl}`,
      quickReply: {
        items: [
          {
            type: 'action',
            action: {
              type: 'message',
              label: '查詢本週服事',
              text: '本週服事',
            },
          },
        ],
      },
    };
    await sendLineReply(replyToken, [reply]);
  }
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

/** 雙月 15 號與 20 號 09:00 表單催填通知 */
export const cycleFormReminder = onSchedule(
  {
    schedule: '0 9 15,20 2,4,6,8,10,12 *',
    timeZone: 'Asia/Taipei',
    region: 'asia-east1',
    secrets: ['LINE_CHANNEL_SECRET', 'LINE_CHANNEL_ACCESS_TOKEN'],
  },
  async () => {
    const { systemUrl } = getLineConfig();
    const now = new Date();
    const utc = now.getTime() + now.getTimezoneOffset() * 60000;
    const twDate = new Date(utc + 8 * 3600000);

    const month = twDate.getMonth() + 1;
    const date = twDate.getDate();

    const nextCycleStart = month === 12 ? 1 : month + 1;
    const nextCycleEnd = nextCycleStart + 1;
    const nextCycleName = `${nextCycleStart}-${nextCycleEnd}月`;

    let pushMessageText = '';
    if (date === 15) {
      pushMessageText =
        `📢【${nextCycleName} 服事意願表單開放填報】\n\n` +
        `各位同工平安！\n` +
        `新一期（${nextCycleName}）的服事意願登記已正式開放！\n\n` +
        `請各位同工撥空點選下方連結完成填報：\n` +
        `🔗 ${systemUrl}\n\n` +
        `⏰ 表單將於本月 20 號截止，感謝大家的忠心擺上！🙏`;
    } else {
      pushMessageText =
        `⚠️【即將截止！${nextCycleName} 服事意願最後催填提醒】\n\n` +
        `各位同工平安！\n` +
        `新一期（${nextCycleName}）服事意願登記將於【今日截止】！\n\n` +
        `尚未填寫的同工請盡速完成登記，以利排班作業：\n` +
        `🔗 ${systemUrl}\n\n` +
        `感謝大家的配搭與付出！✨`;
    }

    const msg: LineMessage = {
      type: 'text',
      text: pushMessageText,
    };

    const volunteers = await getAllVolunteers();
    const activeGroups = await getActiveGroups();

    for (const vol of volunteers) {
      if (vol.lineId) await sendLinePush(vol.lineId, [msg]);
    }
    for (const groupId of activeGroups) {
      await sendLinePush(groupId, [msg]);
    }
  }
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
      const reg = /(\d{1,2})[\/\-\.月](\d{1,2})/;
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
