// =============================================================================
// Vercel Serverless Function — LINE Webhook Engine (/api/line-webhook)
// =============================================================================

import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  verifyLineSignature,
  sendLineReply,
  getLineConfig,
  LineEvent,
  LineMessage,
} from './utils/lineService';
import {
  getVolunteerByLineId,
  saveGroupStatus,
  applySlotFill,
} from './utils/firebaseAdmin';
import {
  getUpcomingSunday,
  findTeamVacanciesForVolunteer,
  formatWeeklyTeamRoster,
  sendAdminNotificationEmail,
} from './utils/schedulerHelper';

/** 取得解析後的 Request Body 與字串 */
function getPayload(req: VercelRequest): { rawBody: string; payload: any } {
  try {
    if (req.body) {
      if (typeof req.body === 'string') {
        try {
          return { rawBody: req.body, payload: JSON.parse(req.body) };
        } catch (e) {
          return { rawBody: req.body, payload: {} };
        }
      } else if (Buffer.isBuffer(req.body)) {
        const str = req.body.toString('utf8');
        try {
          return { rawBody: str, payload: JSON.parse(str) };
        } catch (e) {
          return { rawBody: str, payload: {} };
        }
      } else if (typeof req.body === 'object') {
        return { rawBody: JSON.stringify(req.body), payload: req.body };
      }
    }
  } catch (err) {
    console.error('[getPayload Error]:', err);
  }
  return { rawBody: '', payload: {} };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // GET 請求用於健康檢查
  if (req.method === 'GET') {
    return res.status(200).json({
      success: true,
      message: 'BOL Production LINE Webhook API is running on Vercel Serverless!',
      timestamp: new Date().toISOString(),
    });
  }

  if (req.method !== 'POST') {
    return res.status(200).send('OK');
  }

  try {
    const { rawBody, payload } = getPayload(req);
    const signature = (req.headers['x-line-signature'] || req.headers['X-Line-Signature']) as string | undefined;

    // 🔒 嚴格驗證 LINE 簽名 (HMAC-SHA256)
    if (!verifyLineSignature(rawBody, signature)) {
      console.warn('[Security Warning]: LINE Webhook signature verification failed');
      return res.status(403).json({ error: 'Invalid signature' });
    }

    const events: LineEvent[] = payload.events || [];

    // 處理每個事件 (非同步循序執行)
    for (const event of events) {
      await handleSingleEvent(event);
    }

    // LINE 要求必須立即回傳 HTTP 200
    return res.status(200).send('OK');
  } catch (err: any) {
    console.error('[line-webhook Top Error]:', err);
    // 即使內部處理有錯誤，仍回應 200 避免 LINE 伺服器連續重試失敗
    return res.status(200).send('OK');
  }
}

/** 處理單一 LINE 事件 */
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

/** 處理 Postback 補位動作 */
async function handlePostbackEvent(event: LineEvent) {
  const replyToken = event.replyToken!;
  const dataStr = event.postback!.data;
  const params = new URLSearchParams(dataStr);
  const action = params.get('action');

  if (action === 'fill_slot') {
    const cycle = params.get('cycle') || '';
    const team = params.get('team') || 'video';
    const date = params.get('date') || '';
    const loc = params.get('loc') || '';
    const role = params.get('role') || '';
    const userId = event.source.userId || '';

    // 尋找此 userId 對應的義工姓名
    const vol = await getVolunteerByLineId(userId);
    const volunteerName = vol?.name || '熱心同工';

    const result = await applySlotFill(cycle, team, date, loc, role, volunteerName);

    if (result.success) {
      // 寄送管理員通知
      await sendAdminNotificationEmail({
        volunteerName,
        date,
        location: loc,
        role,
        team,
      });

      const confirmMsg: LineMessage = {
        type: 'text',
        text: `🎉 太棒了！${result.message}\n系統已即時同步線上排班表，並已發送信件通知管理員。非常感謝您的擺上與配搭！🙏`,
      };
      await sendLineReply(replyToken, [confirmMsg]);
    } else {
      const failMsg: LineMessage = {
        type: 'text',
        text: `⚠️ 補位未完成：${result.message}`,
      };
      await sendLineReply(replyToken, [failMsg]);
    }
  }
}

/** 處理使用者文字訊息 */
async function handleTextMessageEvent(event: LineEvent) {
  const replyToken = event.replyToken!;
  const userText = (event.message?.text || '').trim();
  const userId = event.source.userId || '';
  const isGroup = event.source.type === 'group' || event.source.type === 'room';
  const { systemUrl } = getLineConfig();

  // 若在群組收到訊息，確保群組有被標記為 active
  if (isGroup && event.source.groupId) {
    saveGroupStatus(event.source.groupId, 'group', 'active').catch(() => {});
  }

  // 1. 查詢班表關鍵字：「本週服事」、「本週排班」、「本週班表」
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
    const vol = userId ? await getVolunteerByLineId(userId) : null;
    const vacancies = vol ? await findTeamVacanciesForVolunteer(vol) : [];

    if (vacancies.length > 0) {
      const { sundayStr, cycleKey } = getUpcomingSunday();
      const topVacancies = vacancies.slice(0, 5);
      const vacancyListText = topVacancies
        .map((v) => `  • ${v.location}【${v.role}】`)
        .join('\n');

      const quickReplyItems: any[] = topVacancies.map((slot) => ({
        type: 'action',
        action: {
          type: 'postback',
          label: `${sundayStr} 幫忙${slot.role}`.substring(0, 20),
          data: `action=fill_slot&cycle=${cycleKey}&team=${slot.team}&date=${sundayStr}&loc=${encodeURIComponent(
            slot.location
          )}&role=${encodeURIComponent(slot.role)}`,
          displayText: `${sundayStr} 我可以幫忙 ${slot.location}【${slot.role}】！`,
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
          `平安${vol?.name ? ' ' + vol.name + ' 同工' : ''}！本週日 (${sundayStr}) 尚有以下空缺需要支援：\n\n` +
          `${vacancyListText}\n\n` +
          `若您方便參與服事，可直接點選下方按鈕即時補位喔！👇`,
        quickReply: {
          items: quickReplyItems,
        },
      };

      await sendLineReply(replyToken, [replyWithQuickReply]);
      return;
    } else {
      const { sundayStr } = getUpcomingSunday();
      const noVacancyReply: LineMessage = {
        type: 'text',
        text:
          `平安！本週日 (${sundayStr}) 目前各崗位同工皆已安排就緒，暫無待補空缺。\n` +
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
