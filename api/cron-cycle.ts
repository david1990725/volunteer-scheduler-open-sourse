// =============================================================================
// Vercel Serverless Function — Cycle Form Reminders (15th & 20th)
// =============================================================================

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { sendLinePush, getLineConfig, LineMessage } from './utils/lineService';
import { getAllVolunteers, getActiveGroups } from './utils/firebaseAdmin';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const { systemUrl } = getLineConfig();
    const now = new Date();
    // 轉至 UTC+8
    const utc = now.getTime() + now.getTimezoneOffset() * 60000;
    const twDate = new Date(utc + 8 * 3600000);

    const month = twDate.getMonth() + 1;
    const date = twDate.getDate();

    // 判斷是否為雙月（週期結束月）且日期為 15 號或 20 號 (或是透過 ?force=15 測試)
    const forceDate = req.query.force ? Number(req.query.force) : null;
    const isEvenMonth = month % 2 === 0;

    let reminderType: '15' | '20' | null = null;
    if (forceDate === 15 || (isEvenMonth && date === 15)) {
      reminderType = '15';
    } else if (forceDate === 20 || (isEvenMonth && date === 20)) {
      reminderType = '20';
    }

    if (!reminderType && !req.query.force) {
      return res.status(200).json({
        success: true,
        message: `今日 (${month}/${date}) 非週期月 15 號或 20 號，無需發送催填通知。`,
        month,
        date,
      });
    }

    const nextCycleStart = month === 12 ? 1 : month + 1;
    const nextCycleEnd = nextCycleStart + 1;
    const nextCycleName = `${nextCycleStart}-${nextCycleEnd}月`;

    let pushMessageText = '';
    if (reminderType === '15' || forceDate === 15) {
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

    let userCount = 0;
    let groupCount = 0;

    // 個別推播
    for (const vol of volunteers) {
      if (vol.lineId) {
        const ok = await sendLinePush(vol.lineId, [msg]);
        if (ok) userCount++;
      }
    }

    // 群組推播
    for (const groupId of activeGroups) {
      const ok = await sendLinePush(groupId, [msg]);
      if (ok) groupCount++;
    }

    return res.status(200).json({
      success: true,
      message: `週期表單提醒 (${reminderType || forceDate} 號) 發送完成！個別同工: ${userCount} 人，群組: ${groupCount} 個。`,
      reminderType,
      userCount,
      groupCount,
    });
  } catch (err: any) {
    console.error('[cron-cycle Error]:', err);
    return res.status(500).json({ success: false, error: err?.message || String(err) });
  }
}
