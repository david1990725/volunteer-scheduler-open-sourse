// =============================================================================
// Vercel Serverless Function — Saturday 16:00 Service Reminder Cron
// =============================================================================

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { sendLinePush, LineMessage } from './utils/lineService';
import { getAllVolunteers, getActiveGroups, getSchedule } from './utils/firebaseAdmin';
import { getUpcomingSunday, formatWeeklyTeamRoster } from './utils/schedulerHelper';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const { sundayStr, cycleKey } = getUpcomingSunday();
    const volunteers = await getAllVolunteers();
    const activeGroups = await getActiveGroups();

    // 團隊清單
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

    let individualCount = 0;
    let groupCount = 0;

    // 1. 個別通知：僅針對本週有服事的同工推播其「專屬場地與職位」
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

        const ok = await sendLinePush(vol.lineId, [personalMsg]);
        if (ok) individualCount++;
      }
    }

    // 2. 群組通知：向所有群組公佈「當週全員完整服事名冊」
    const rosterText = await formatWeeklyTeamRoster();
    const groupMsg: LineMessage = {
      type: 'text',
      text: `📢【每週六服事提醒】\n\n${rosterText}`,
    };

    for (const groupId of activeGroups) {
      const ok = await sendLinePush(groupId, [groupMsg]);
      if (ok) groupCount++;
    }

    return res.status(200).json({
      success: true,
      message: `週六服事提醒發送完成！個別通知: ${individualCount} 人，群組通知: ${groupCount} 個群組。`,
      sunday: sundayStr,
      individualCount,
      groupCount,
    });
  } catch (err: any) {
    console.error('[cron-saturday Error]:', err);
    return res.status(500).json({ success: false, error: err?.message || String(err) });
  }
}
