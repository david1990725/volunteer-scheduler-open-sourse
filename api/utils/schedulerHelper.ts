// =============================================================================
// Helper routines for Date, Cycle, and Vacancy calculations
// =============================================================================

import { getSchedule, getFinalSchedule, canServeNetworkDirector, type VolunteerRecord } from './firebaseAdmin.js';

/** 取得當週週日日期字串 (MM/DD) */
export function getUpcomingSunday(baseDate: Date = new Date()): { sundayStr: string; sundayDate: Date; cycleKey: string } {
  // 將時區調整至 UTC+8 (台灣時間)
  const utc = baseDate.getTime() + baseDate.getTimezoneOffset() * 60000;
  const now = new Date(utc + 8 * 3600000);

  const day = now.getDay(); // 0 = Sunday, 1 = Monday, ... 6 = Saturday
  const diffToSunday = day === 0 ? 0 : 7 - day;

  const sunday = new Date(now);
  sunday.setDate(now.getDate() + diffToSunday);

  const month = sunday.getMonth() + 1;
  const date = sunday.getDate();
  const year = sunday.getFullYear();

  const monthStr = month < 10 ? `0${month}` : `${month}`;
  const dateStr = date < 10 ? `0${date}` : `${date}`;
  const sundayStr = `${monthStr}/${dateStr}`;

  // 計算雙月週期 (例如 3-4月: 2026_03-04)
  const startMonth = month % 2 === 1 ? month : month - 1;
  const endMonth = startMonth + 1;
  const smStr = startMonth < 10 ? `0${startMonth}` : `${startMonth}`;
  const emStr = endMonth < 10 ? `0${endMonth}` : `${endMonth}`;
  const cycleKey = `${year}_${smStr}-${emStr}`;

  return { sundayStr, sundayDate: sunday, cycleKey };
}

/** 查詢當週該義工所屬團隊是否有空缺需要補位 (週一至週六動態浮現) */
export async function findTeamVacanciesForVolunteer(
  volunteer: VolunteerRecord
): Promise<Array<{ date: string; location: string; role: string; team: string }>> {
  const { sundayStr, cycleKey } = getUpcomingSunday();

  // 判斷該同工所屬的團隊 (預設 video)
  const teams = volunteer.jobTitles && volunteer.jobTitles.length > 0 ? volunteer.jobTitles : ['video'];
  const vacancies: Array<{ date: string; location: string; role: string; team: string }> = [];
  const seen = new Set<string>();

  for (const team of teams) {
    const schedule = await getSchedule(cycleKey, team);
    if (!schedule || !schedule.shifts) continue;

    for (const shift of schedule.shifts) {
      const matchSunday = shift.date.includes(sundayStr) || sundayStr.includes(shift.date);
      if (!matchSunday) continue;

      if (shift.assignments) {
        for (const [role, assignee] of Object.entries(shift.assignments)) {
          // 備用人員非主要服事空缺，不應觸發呼叫補位機制
          if (role.includes('備用')) continue;
          if (role === '網路導播' && (!shift.location.includes('山莊') || !canServeNetworkDirector(volunteer))) continue;

          if (assignee === '缺' || !assignee || assignee === '') {
            const key = `${shift.location}|${role}|${sundayStr}`;
            if (!seen.has(key)) {
              seen.add(key);
              vacancies.push({
                date: sundayStr,
                location: shift.location,
                role,
                team,
              });
            }
          }
        }
      }
    }
  }

  return vacancies;
}

/** 格式化當週全部服事同工名單 (供群組推播或查詢) */
export async function formatWeeklyTeamRoster(): Promise<string> {
  const { sundayStr, cycleKey } = getUpcomingSunday();
  
  // 1. 優先嘗試從最終整合服事表讀取
  const finalSchedule = await getFinalSchedule(cycleKey);
  if (finalSchedule && finalSchedule.shifts && finalSchedule.shifts.length > 0) {
    const currentShifts = finalSchedule.shifts.filter(
      (s) => s.date.includes(sundayStr) || sundayStr.includes(s.date)
    );

    if (currentShifts.length > 0) {
      let rosterText = `📅【本週日 (${sundayStr}) 全員服事名單】\n`;
      const seenLoc = new Set<string>();

      for (const shift of currentShifts) {
        if (seenLoc.has(shift.location)) continue;
        seenLoc.add(shift.location);

        rosterText += `\n━━━━━━━━━━━━━━━\n📍 ${shift.location}\n`;
        if (shift.assignments) {
          const lines = Object.entries(shift.assignments)
            .filter(([role, person]) => {
              // 備用人員若無人擔任，不顯示於群組名單避免誤解為缺額
              const assigned = String(person || '');
              if (role.includes('備用') && (!assigned || assigned === '缺' || assigned.trim() === '')) return false;
              return true;
            })
            .map(([role, person]) => `  • ${role}：${person || '缺'}`);
          rosterText += lines.join('\n') + '\n';
        }
      }

      rosterText += `\n請各位同工留意服事時間與場地，準時出席！願神賜福大家的服事 ✨`;
      return rosterText;
    }
  }

  // 2. Fallback: 逐團隊個別讀取
  const teams = [
    { key: 'video', name: '🎥 影視團隊' },
    { key: 'audio', name: '🎚️ 音控團隊' },
    { key: 'light', name: '💡 燈光團隊' },
    { key: 'stage', name: '🎬 舞監團隊' },
  ];

  let rosterText = `📅【本週日 (${sundayStr}) 服事同工名單】\n`;
  let hasAnyShift = false;
  const seenEntries = new Set<string>();

  for (const t of teams) {
    const schedule = await getSchedule(cycleKey, t.key);
    if (!schedule || !schedule.shifts) continue;

    const currentShifts = schedule.shifts.filter(
      (s) => s.date.includes(sundayStr) || sundayStr.includes(s.date)
    );

    if (currentShifts.length > 0) {
      hasAnyShift = true;
      rosterText += `\n━━━━━━━━━━━━━━━\n${t.name}\n`;
      for (const shift of currentShifts) {
        rosterText += `📍 ${shift.location}：\n`;
        if (shift.assignments) {
          const lines = Object.entries(shift.assignments)
            .filter(([role, person]) => {
              const key = `${shift.location}|${role}|${person}`;
              if (seenEntries.has(key)) return false;
              seenEntries.add(key);
              return true;
            })
            .map(([role, person]) => `  • ${role}：${person || '缺'}`);
          rosterText += lines.join('\n') + '\n';
        }
      }
    }
  }

  if (!hasAnyShift) {
    rosterText += `\n目前尚未建立 ${sundayStr} 的排班表，敬請期待！`;
  } else {
    rosterText += `\n請各位同工留意服事時間與場地，準時出席！願神賜福大家的服事 ✨`;
  }

  return rosterText;
}

/** 寄送即時補位管理員通知信 (若有設定 ADMIN_EMAIL) */
export async function sendAdminNotificationEmail(info: {
  volunteerName: string;
  date: string;
  location: string;
  role: string;
  team: string;
}) {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail) return;

  console.log(`[Admin Notification]: 寄送補位通知至 ${adminEmail}`, info);
}
