// =============================================================================
// Firestore Admin & Scheduling Helper for Firebase Cloud Functions
// =============================================================================

import * as admin from 'firebase-admin';

// 初始化 Firebase Admin (在 Cloud Functions 環境自動使用預設服務帳戶認證)
if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

export interface VolunteerRecord {
  name: string;
  userLevel?: string;
  jobTitles?: string[];
  skillRoles?: string[];
  videoSkills?: Record<string, number>;
  lightLevel?: number;
  stageLevel?: number;
  audioSkills?: Record<string, number>;
  lineId?: string;
  lineDisplayName?: string;
  pictureUrl?: string;
  birthday?: string;
  isFullTimer?: boolean;
  isBackfillLeader?: boolean;
}

export interface ShiftSlot {
  date: string;
  location: string;
  assignments: Record<string, string>;
  roleKeys: string[];
}

export interface ScheduleDoc {
  id?: string;
  cycleKey: string;
  team: string;
  shifts: ShiftSlot[];
  updatedAt?: any;
}

/** 取得當週週日日期字串 (MM/DD) */
export function getUpcomingSunday(baseDate: Date = new Date()): { sundayStr: string; sundayDate: Date; cycleKey: string } {
  const utc = baseDate.getTime() + baseDate.getTimezoneOffset() * 60000;
  const now = new Date(utc + 8 * 3600000);

  const day = now.getDay();
  const diffToSunday = day === 0 ? 0 : 7 - day;

  const sunday = new Date(now);
  sunday.setDate(now.getDate() + diffToSunday);

  const month = sunday.getMonth() + 1;
  const date = sunday.getDate();
  const year = sunday.getFullYear();

  const monthStr = month < 10 ? `0${month}` : `${month}`;
  const dateStr = date < 10 ? `0${date}` : `${date}`;
  const sundayStr = `${monthStr}/${dateStr}`;

  const startMonth = month % 2 === 1 ? month : month - 1;
  const endMonth = startMonth + 1;
  const smStr = startMonth < 10 ? `0${startMonth}` : `${startMonth}`;
  const emStr = endMonth < 10 ? `0${endMonth}` : `${endMonth}`;
  const cycleKey = `${year}_${smStr}-${emStr}`;

  return { sundayStr, sundayDate: sunday, cycleKey };
}

/** 取得所有義工名單 */
export async function getAllVolunteers(): Promise<VolunteerRecord[]> {
  try {
    const snap = await db.collection('volunteers').get();
    const result: VolunteerRecord[] = [];
    snap.forEach((d) => {
      const data = d.data() as any;
      result.push({
        name: data.name || d.id,
        userLevel: data.userLevel || 'user',
        jobTitles: data.jobTitles || [],
        skillRoles: data.skillRoles || [],
        videoSkills: data.videoSkills || {},
        lightLevel: data.lightLevel || 1,
        stageLevel: data.stageLevel || 1,
        audioSkills: data.audioSkills || {},
        lineId: data.lineId,
        lineDisplayName: data.lineDisplayName,
        pictureUrl: data.pictureUrl,
        birthday: data.birthday,
        isFullTimer: data.isFullTimer,
        isBackfillLeader: data.isBackfillLeader,
      });
    });
    return result;
  } catch (err) {
    console.error('[getAllVolunteers Error]:', err);
    return [];
  }
}

/** 依據 LINE userId 尋找義工 */
export async function getVolunteerByLineId(lineId: string): Promise<VolunteerRecord | null> {
  if (!lineId) return null;
  try {
    const snap = await db.collection('volunteers').where('lineId', '==', lineId).limit(1).get();
    if (!snap.empty) {
      const d = snap.docs[0];
      const data = d.data() as any;
      return {
        name: data.name || d.id,
        ...data,
      };
    }
  } catch (err) {
    console.error('[getVolunteerByLineId Error]:', err);
  }
  return null;
}

/** 記錄或更新群組狀態 */
export async function saveGroupStatus(groupId: string, type: string, status: 'active' | 'left'): Promise<void> {
  if (!groupId) return;
  try {
    await db.collection('line_groups').doc(groupId).set(
      {
        groupId,
        type: type || 'group',
        status,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  } catch (err) {
    console.error('[saveGroupStatus Error]:', err);
  }
}

/** 取得所有活躍的群組 ID */
export async function getActiveGroups(): Promise<string[]> {
  try {
    const snap = await db.collection('line_groups').where('status', '==', 'active').get();
    const groups: string[] = [];
    snap.forEach((d) => {
      const data = d.data();
      if (data.groupId) groups.push(data.groupId);
    });
    return groups;
  } catch (err) {
    console.error('[getActiveGroups Error]:', err);
    return [];
  }
}

/** 取得指定週期與團隊的排班表 */
export async function getSchedule(cycleKey: string, team: string = 'video'): Promise<ScheduleDoc | null> {
  try {
    const docId = `${cycleKey}_${team}`;
    const snap = await db.collection('schedules').doc(docId).get();
    if (snap.exists) {
      return { id: snap.id, ...(snap.data() as any) };
    }

    const legacySnap = await db.collection('schedules').doc(cycleKey).get();
    if (legacySnap.exists) {
      return { id: legacySnap.id, ...(legacySnap.data() as any) };
    }
  } catch (err) {
    console.error('[getSchedule Error]:', err);
  }
  return null;
}

/** 即時補位更新排班表 */
export async function applySlotFill(
  cycleKey: string,
  team: string,
  targetDate: string,
  location: string,
  role: string,
  volunteerName: string
): Promise<{ success: boolean; message: string }> {
  try {
    const schedule = await getSchedule(cycleKey, team);
    if (!schedule || !schedule.shifts) {
      return { success: false, message: `找不到週期 ${cycleKey} 的排班表` };
    }

    let found = false;
    const updatedShifts = schedule.shifts.map((shift) => {
      const shiftDate = shift.date.trim();
      const shiftLoc = shift.location.trim();

      const matchDate = shiftDate.includes(targetDate) || targetDate.includes(shiftDate);
      const matchLoc = !location || shiftLoc.includes(location) || location.includes(shiftLoc);

      if (matchDate && matchLoc) {
        if (shift.assignments && (shift.assignments[role] === '缺' || !shift.assignments[role] || shift.assignments[role] === '')) {
          shift.assignments[role] = volunteerName;
          found = true;
        }
      }
      return shift;
    });

    if (!found) {
      return { success: false, message: `該週 (${targetDate} ${location} ${role}) 可能已被填補或無此空缺。` };
    }

    const docId = schedule.id || `${cycleKey}_${team}`;
    await db.collection('schedules').doc(docId).set(
      { shifts: updatedShifts, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true }
    );

    return { success: true, message: `已成功將 ${volunteerName} 填入 ${targetDate} ${location}【${role}】！` };
  } catch (err: any) {
    console.error('[applySlotFill Error]:', err);
    return { success: false, message: err?.message || '更新排班表失敗' };
  }
}

/** 查詢當週該義工所屬團隊是否有空缺需要補位 */
export async function findTeamVacanciesForVolunteer(
  volunteer: VolunteerRecord
): Promise<Array<{ date: string; location: string; role: string; team: string }>> {
  const { sundayStr, cycleKey } = getUpcomingSunday();
  const teams = volunteer.jobTitles && volunteer.jobTitles.length > 0 ? volunteer.jobTitles : ['video'];
  const vacancies: Array<{ date: string; location: string; role: string; team: string }> = [];

  for (const team of teams) {
    const schedule = await getSchedule(cycleKey, team);
    if (!schedule || !schedule.shifts) continue;

    for (const shift of schedule.shifts) {
      const matchSunday = shift.date.includes(sundayStr) || sundayStr.includes(shift.date);
      if (!matchSunday) continue;

      if (shift.assignments) {
        for (const [role, assignee] of Object.entries(shift.assignments)) {
          if (assignee === '缺' || !assignee || assignee === '') {
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

  return vacancies;
}

/** 格式化當週全部服事同工名單 */
export async function formatWeeklyTeamRoster(): Promise<string> {
  const { sundayStr, cycleKey } = getUpcomingSunday();
  const teams = [
    { key: 'video', name: '🎥 影視團隊' },
    { key: 'audio', name: '🎚️ 音控團隊' },
    { key: 'light', name: '💡 燈光團隊' },
    { key: 'stage', name: '🎬 舞監團隊' },
  ];

  let rosterText = `📅【本週日 (${sundayStr}) 服事同工名單】\n`;
  let hasAnyShift = false;

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
          const lines = Object.entries(shift.assignments).map(
            ([role, person]) => `  • ${role}：${person || '缺'}`
          );
          rosterText += lines.join('\n') + '\n';
        }
      }
    }
  }

  if (!hasAnyShift) {
    rosterText += `\n目前尚未建立 ${sundayStr} 的各團隊排班表，敬請期待！`;
  } else {
    rosterText += `\n請各位同工留意服事時間與場地，準時出席！願神賜福大家的服事 ✨`;
  }

  return rosterText;
}
