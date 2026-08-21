// =============================================================================
// Firestore Admin & Advanced Schedule Matrix Parser for Firebase Functions
// =============================================================================

import * as admin from 'firebase-admin';

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

export interface ParsedAssignment {
  volunteerName: string;
  location: string;
  role: string;
  date: string;
  sheetName: string;
}

export interface VacancySlot {
  docId: string;
  sheetName: string;
  rowIndex: number;
  colIndex: number;
  date: string;
  location: string;
  role: string;
  team: string;
}

/** 取得即將到來的週日日期與關鍵字 (UTC+8 台灣時間) */
export function getUpcomingSunday(baseDate: Date = new Date()): {
  sundayStr: string;
  sundayShortStr: string;
  sundayDate: Date;
  cycleKey: string;
  year: number;
} {
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
  const sundayStr = `${monthStr}/${dateStr}`; // "03/01"
  const sundayShortStr = `${month}/${date}`;  // "3/1"

  const startMonth = month % 2 === 1 ? month : month - 1;
  const endMonth = startMonth + 1;
  const cycleKey = `${year}_${startMonth < 10 ? '0' + startMonth : startMonth}-${endMonth < 10 ? '0' + endMonth : endMonth}`;

  return { sundayStr, sundayShortStr, sundayDate: sunday, cycleKey, year };
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

/** 解析 Firestore 班表文件中的 2D 矩陣資料 */
function parseMatrixFromDoc(docData: any): string[][] | null {
  if (!docData) return null;
  if (typeof docData.dataJson === 'string') {
    try {
      const parsed = JSON.parse(docData.dataJson);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      return null;
    }
  }
  if (Array.isArray(docData.rows)) {
    return docData.rows.map((r: any) => (Array.isArray(r.cells) ? r.cells : Array.isArray(r) ? r : []));
  }
  if (Array.isArray(docData.data)) {
    return docData.data;
  }
  return null;
}

/**
 * 完整解析所有排班表在目標週日的同工名冊與空缺
 */
export async function parseSundaySchedule(targetDate?: Date): Promise<{
  assignmentsByVolunteer: Record<string, ParsedAssignment[]>;
  assignmentsByLocation: Record<string, Array<{ role: string; person: string }>>;
  vacancies: VacancySlot[];
  targetSundayStr: string;
}> {
  const { sundayStr, sundayShortStr } = getUpcomingSunday(targetDate);
  const assignmentsByVolunteer: Record<string, ParsedAssignment[]> = {};
  const assignmentsByLocation: Record<string, Array<{ role: string; person: string }>> = {};
  const vacancies: VacancySlot[] = [];

  try {
    const snap = await db.collection('schedules').get();

    snap.forEach((docSnap) => {
      const docId = docSnap.id;
      const data = docSnap.data();
      const sheetName = data.sheetName || docId;
      const matrix = parseMatrixFromDoc(data);

      if (!matrix || matrix.length === 0) return;

      let currentLocation = '大堂';
      let dateColMap: Record<number, string> = {}; // colIndex -> date string (e.g. 03/01)

      for (let r = 0; r < matrix.length; r++) {
        const row = matrix[r] || [];
        const firstCell = String(row[0] || '').trim();

        // 1. 偵測地點標題 (例如 【山莊大堂】 或 【宣教大樓】)
        if (firstCell.startsWith('【') && firstCell.endsWith('】')) {
          currentLocation = firstCell.replace(/【|】/g, '').trim();
          dateColMap = {}; // 重設欄位映射
          continue;
        }

        // 2. 偵測日期標頭列 (例如 "職務 / 日期", "日期", "職務")
        if (firstCell.includes('職務') || firstCell.includes('日期') || firstCell === '崗位') {
          dateColMap = {};
          for (let c = 1; c < row.length; c++) {
            const cellVal = String(row[c] || '').trim();
            // 比對是否為目標週日 (支援 03/01, 3/1, 03-01, 3-1 等)
            if (
              cellVal === sundayStr ||
              cellVal === sundayShortStr ||
              cellVal.includes(sundayStr) ||
              cellVal.includes(sundayShortStr) ||
              cellVal.replace(/-/g, '/') === sundayStr ||
              cellVal.replace(/-/g, '/') === sundayShortStr
            ) {
              dateColMap[c] = cellVal;
            }
          }
          continue;
        }

        // 若尚未找到目標週日的欄位索引，略過一般列
        const targetCols = Object.keys(dateColMap).map(Number);
        if (targetCols.length === 0) continue;

        // 3. 處理職位崗位列
        const roleName = firstCell;
        if (!roleName || roleName.includes('數量') || roleName.includes('份數') || roleName.includes('便當') || roleName.includes('早餐')) {
          continue; // 略過餐點統計列
        }

        for (const col of targetCols) {
          const cellVal = String(row[col] || '').trim();
          const dateLabel = dateColMap[col];

          // 判斷是否為空缺
          if (!cellVal || cellVal === '缺' || cellVal === '待補' || cellVal === '未填' || cellVal === '徵求' || cellVal === '-') {
            vacancies.push({
              docId,
              sheetName,
              rowIndex: r,
              colIndex: col,
              date: dateLabel || sundayStr,
              location: currentLocation,
              role: roleName,
              team: roleName.includes('燈') ? 'light' : roleName.includes('音') ? 'audio' : roleName.includes('舞') ? 'stage' : 'video',
            });
          } else {
            // 已安排同工
            const person = cellVal;
            if (!assignmentsByVolunteer[person]) assignmentsByVolunteer[person] = [];
            assignmentsByVolunteer[person].push({
              volunteerName: person,
              location: currentLocation,
              role: roleName,
              date: dateLabel || sundayStr,
              sheetName,
            });

            if (!assignmentsByLocation[currentLocation]) assignmentsByLocation[currentLocation] = [];
            assignmentsByLocation[currentLocation].push({
              role: roleName,
              person,
            });
          }
        }
      }
    });
  } catch (err) {
    console.error('[parseSundaySchedule Error]:', err);
  }

  return {
    assignmentsByVolunteer,
    assignmentsByLocation,
    vacancies,
    targetSundayStr: sundayStr,
  };
}

/** 格式化「本週服事」完整名冊 */
export async function formatWeeklyTeamRoster(): Promise<string> {
  const { assignmentsByLocation, targetSundayStr } = await parseSundaySchedule();
  const locations = Object.keys(assignmentsByLocation);

  if (locations.length === 0) {
    return `📅【本週日 (${targetSundayStr}) 服事名單】\n\n目前線上尚未建立或發布 ${targetSundayStr} 的服事排班表。請洽排班幹部或進入系統查看最新狀態！`;
  }

  let text = `📅【本週日 (${targetSundayStr}) 服事同工名單】\n`;

  for (const loc of locations) {
    text += `\n📍【${loc}】\n`;
    const items = assignmentsByLocation[loc] || [];
    for (const item of items) {
      text += `  • ${item.role}：${item.person}\n`;
    }
  }

  text += `\n✨ 請各位同工預備心並準時出席！願神大大賜福服事！`;
  return text;
}

/** 即時寫入 Firestore 矩陣進行補位 */
export async function applySlotFillToMatrix(
  docId: string,
  rowIndex: number,
  colIndex: number,
  volunteerName: string
): Promise<{ success: boolean; message: string }> {
  try {
    const docRef = db.collection('schedules').doc(docId);
    const snap = await docRef.get();

    if (!snap.exists) {
      return { success: false, message: '找不到對應的排班表文件' };
    }

    const data = snap.data() || {};
    const matrix = parseMatrixFromDoc(data);

    if (!matrix || !matrix[rowIndex]) {
      return { success: false, message: '班表格式異常，無法定位該欄位' };
    }

    const currentCell = String(matrix[rowIndex][colIndex] || '').trim();
    if (currentCell && currentCell !== '缺' && currentCell !== '待補' && currentCell !== '未填' && currentCell !== volunteerName) {
      return { success: false, message: `該職位剛剛已由 ${currentCell} 登記補位囉！` };
    }

    matrix[rowIndex][colIndex] = volunteerName;

    await docRef.set(
      {
        dataJson: JSON.stringify(matrix),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return { success: true, message: '班表已成功即時更新' };
  } catch (err: any) {
    console.error('[applySlotFillToMatrix Error]:', err);
    return { success: false, message: err?.message || '寫入失敗' };
  }
}
