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
  getSchedule,
  applySlotFill,
  getUpcomingSunday,
  findTeamVacanciesForVolunteer,
  formatWeeklyTeamRoster,
} from './schedulerHelper';

// =============================================================================
// 1. LINE Webhook HTTPS Endpoint
// =============================================================================

export const lineWebhook = onRequest(
  {
    cors: true,
    region: 'asia-east1',
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

    const vol = await getVolunteerByLineId(userId);
    const volunteerName = vol?.name || '熱心同工';

    const result = await applySlotFill(cycle, team, date, loc, role, volunteerName);

    if (result.success) {
      const confirmMsg: LineMessage = {
        type: 'text',
        text: `🎉 太棒了！${result.message}\n系統已即時同步線上排班表。非常感謝您的擺上與配搭！🙏`,
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

async function handleTextMessageEvent(event: LineEvent) {
  const replyToken = event.replyToken!;
  const userText = (event.message?.text || '').trim();
  const userId = event.source.userId || '';
  const isGroup = event.source.type === 'group' || event.source.type === 'room';
  const { systemUrl } = getLineConfig();

  if (isGroup && event.source.groupId) {
    saveGroupStatus(event.source.groupId, 'group', 'active').catch(() => {});
  }

  // 1. 查詢本週服事
  if (userText.includes('本週服事') || userText.includes('本周服事') || userText.includes('服事名單') || userText === '排班') {
    const rosterText = await formatWeeklyTeamRoster();
    await sendLineReply(replyToken, [{ type: 'text', text: rosterText }]);
    return;
  }

  // 2. 1 對 1 私訊時，動態偵測當週是否有空缺需要補位 (週一至週六)
  if (!isGroup && userId) {
    const vol = await getVolunteerByLineId(userId);
    const dayOfWeek = new Date().getDay();
    const isMonToSat = dayOfWeek >= 1 && dayOfWeek <= 6;

    if (vol && isMonToSat) {
      const vacancies = await findTeamVacanciesForVolunteer(vol);

      if (vacancies.length > 0) {
        const { sundayStr, cycleKey } = getUpcomingSunday();
        const slot = vacancies[0];

        const replyWithQuickReply: LineMessage = {
          type: 'text',
          text: `平安 ${vol.name}！本週日 (${sundayStr}) 您的團隊在【${slot.location}】尚有【${slot.role}】空缺！若您本週方便支援，可直接點選下方按鈕即時補位喔！👇`,
          quickReply: {
            items: [
              {
                type: 'action',
                action: {
                  type: 'postback',
                  label: `${sundayStr} 可以幫忙！`,
                  data: `action=fill_slot&cycle=${cycleKey}&team=${slot.team}&date=${sundayStr}&loc=${encodeURIComponent(
                    slot.location
                  )}&role=${encodeURIComponent(slot.role)}`,
                  displayText: `${sundayStr} 我可以幫忙！`,
                },
              },
              {
                type: 'action',
                action: {
                  type: 'message',
                  label: '本週服事名冊',
                  text: '本週服事',
                },
              },
            ],
          },
        };

        await sendLineReply(replyToken, [replyWithQuickReply]);
        return;
      }
    }
  }

  if (!isGroup) {
    const reply: LineMessage = {
      type: 'text',
      text:
        '平安！您可以輸入「本週服事」查詢當週服事同工名單。\n\n' +
        `若需填報意願或檢視最新排班表，請進入系統：\n${systemUrl}`,
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
  },
  async () => {
    const { sundayStr, cycleKey } = getUpcomingSunday();
    const volunteers = await getAllVolunteers();
    const activeGroups = await getActiveGroups();

    const teamKeys = ['video', 'audio', 'light', 'stage'];
    const allSchedules: Record<string, any> = {};

    for (const tk of teamKeys) {
      const sch = await getSchedule(cycleKey, tk);
      if (sch && sch.shifts) {
        allSchedules[tk] = sch.shifts.filter(
          (s) => s.date.includes(sundayStr) || sundayStr.includes(s.date)
        );
      }
    }

    // 1. 個別通知
    for (const vol of volunteers) {
      if (!vol.lineId) continue;
      const myShifts: Array<{ location: string; role: string }> = [];

      for (const tk of teamKeys) {
        const shifts = allSchedules[tk] || [];
        for (const shift of shifts) {
          if (shift.assignments) {
            for (const [role, person] of Object.entries(shift.assignments)) {
              if (person === vol.name) {
                myShifts.push({ location: shift.location, role });
              }
            }
          }
        }
      }

      if (myShifts.length > 0) {
        const shiftDetails = myShifts
          .map((s) => `📍 場地：${s.location}\n🎯 職位：${s.role}`)
          .join('\n\n');

        const personalMsg: LineMessage = {
          type: 'text',
          text:
            `平安 ${vol.name}！貼心提醒您本週日 (${sundayStr}) 有服事喔：\n\n` +
            `${shiftDetails}\n\n` +
            `請同工留意出勤時間並提早預備心！願神大大同在與祝福您的擺上！✨`,
        };

        await sendLinePush(vol.lineId, [personalMsg]);
      }
    }

    // 2. 群組通知
    const rosterText = await formatWeeklyTeamRoster();
    const groupMsg: LineMessage = {
      type: 'text',
      text: `📢【每週六服事提醒】\n\n${rosterText}`,
    };

    for (const groupId of activeGroups) {
      await sendLinePush(groupId, [groupMsg]);
    }
  }
);

/** 雙月 15 號與 20 號 09:00 表單催填通知 */
export const cycleFormReminder = onSchedule(
  {
    schedule: '0 9 15,20 2,4,6,8,10,12 *',
    timeZone: 'Asia/Taipei',
    region: 'asia-east1',
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
        `平安！新一期（${nextCycleName}）的服事意願登記已正式開放！\n\n` +
        `請各位同工撥空點選下方系統連結填寫您可以出席的主日日期：\n` +
        `🔗 ${systemUrl}\n\n` +
        `⏰ 表單將於本月 20 號截止，請大家把握時間填報，謝謝大家的忠心擺上！🙏`;
    } else {
      pushMessageText =
        `⚠️【${nextCycleName} 服事意願表單即將截止提醒】\n\n` +
        `平安！新一期（${nextCycleName}）的服事意願登記將於【今日截止】！\n\n` +
        `尚未填寫的同工請儘速進入系統完成登記，以利排班幹部進行排班作業：\n` +
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

/** 每日 09:00 生日祝福 Flex Message */
export const dailyBirthdayReminder = onSchedule(
  {
    schedule: '0 9 * * *',
    timeZone: 'Asia/Taipei',
    region: 'asia-east1',
  },
  async () => {
    const now = new Date();
    const utc = now.getTime() + now.getTimezoneOffset() * 60000;
    const twDate = new Date(utc + 8 * 3600000);

    const m = twDate.getMonth() + 1;
    const d = twDate.getDate();
    const todayMMDD = `${m < 10 ? '0' + m : m}-${d < 10 ? '0' + d : d}`;

    const volunteers = await getAllVolunteers();

    for (const vol of volunteers) {
      if (!vol.birthday || !vol.lineId) continue;

      const raw = vol.birthday.trim().replace(/\//g, '-');
      let bMMDD = '';

      const parts = raw.split('-');
      if (parts.length === 3) {
        const bm = parseInt(parts[1], 10);
        const bd = parseInt(parts[2], 10);
        bMMDD = `${bm < 10 ? '0' + bm : bm}-${bd < 10 ? '0' + bd : bd}`;
      } else if (parts.length === 2) {
        const bm = parseInt(parts[0], 10);
        const bd = parseInt(parts[1], 10);
        bMMDD = `${bm < 10 ? '0' + bm : bm}-${bd < 10 ? '0' + bd : bd}`;
      }

      if (bMMDD === todayMMDD) {
        const flexMsg = createBirthdayFlexMessage(vol.name, `${m}月${d}日`);
        await sendLinePush(vol.lineId, [flexMsg]);
      }
    }
  }
);
