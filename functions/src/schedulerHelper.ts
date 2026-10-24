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
  managedTeams?: string[];
  isActive?: boolean;
}

export interface VolunteerAuthRecord {
  volunteerId: string;
  name: string;
  userLevel: string;
  managedTeams: string[];
  isActive: boolean;
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

/** 供登入與綁定使用的最小身分資料；不把完整名冊送回前端。 */
export async function getVolunteerAuthRecordByLineId(lineId: string): Promise<VolunteerAuthRecord | null> {
  if (!lineId) return null;
  const snap = await db.collection('volunteers').where('lineId', '==', lineId).limit(1).get();
  if (snap.empty) return null;
  const record = snap.docs[0];
  const data = record.data() as any;
  return {
    volunteerId: record.id,
    name: data.name || record.id,
    userLevel: data.userLevel || 'user',
    managedTeams: Array.isArray(data.managedTeams) ? data.managedTeams : [],
    isActive: data.isActive !== false,
  };
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

  const seenAssignments = new Set<string>(); // key: `${location}|${role}|${date}`
  const seenVacancies = new Set<string>();   // key: `${location}|${role}|${date}`

  try {
    const snap = await db.collection('schedules').get();

    // 收集屬於目前週期的所有 documents
    // 雙月週期常見名稱: e.g. 2026_09-10, 2026年_9-10月排班表, 2026年 9-10月排班表, 2026年_09-10月排班表
    const allDocs: Array<{ id: string; data: any; isFinal: boolean }> = [];
    snap.forEach((docSnap) => {
      const docId = docSnap.id;
      const data = docSnap.data();
      const isFinal = docId.endsWith('_final') || docId.includes('final');
      allDocs.push({ id: docId, data, isFinal });
    });

    // 優先策略：若存在包含該主日日期的 `_final` 整合文件，則僅解析 `_final` 文件以避免重複
    // 若無 `_final` 或 `_final` 中無資料，則解析各團隊文件並透過 Set 去重
    let docsToProcess = allDocs.filter((d) => d.isFinal);
    let hasTargetSundayInFinal = false;

    for (const d of docsToProcess) {
      const matrix = parseMatrixFromDoc(d.data);
      if (matrix && matrix.some((row) => row.some((c) => String(c).includes(sundayStr) || String(c).includes(sundayShortStr)))) {
        hasTargetSundayInFinal = true;
        break;
      }
    }

    if (!hasTargetSundayInFinal) {
      // 若 _final 沒有或不存在，改為讀取非 _final 的個別團隊排班表
      docsToProcess = allDocs.filter((d) => !d.isFinal);
    }

    for (const docObj of docsToProcess) {
      const docId = docObj.id;
      const data = docObj.data;
      const sheetName = data.sheetName || docId;
      const matrix = parseMatrixFromDoc(data);

      if (!matrix || matrix.length === 0) continue;

      let currentLocation = '大堂';
      let dateColMap: Record<number, string> = {}; // colIndex -> date string (e.g. 09/06)

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
            // 比對是否為目標週日 (支援 09/06, 9/6, 09-06, 9-6 等)
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
        // 略過餐點統計列與備用席位 (備用1、備用2、早餐、午餐等)
        if (
          !roleName ||
          roleName.includes('數量') ||
          roleName.includes('份數') ||
          roleName.includes('便當') ||
          roleName.includes('早餐') ||
          roleName.includes('午餐') ||
          roleName.includes('備用') ||
          roleName.includes('備份')
        ) {
          continue;
        }

        for (const col of targetCols) {
          const cellVal = String(row[col] || '').trim();
          const dateLabel = dateColMap[col] || sundayStr;
          const uniqueKey = `${currentLocation}|${roleName}|${dateLabel}`;

          // 判斷是否為空缺
          if (!cellVal || cellVal === '缺' || cellVal === '待補' || cellVal === '未填' || cellVal === '徵求' || cellVal === '-') {
            if (!seenVacancies.has(uniqueKey)) {
              seenVacancies.add(uniqueKey);
              vacancies.push({
                docId,
                sheetName,
                rowIndex: r,
                colIndex: col,
                date: dateLabel,
                location: currentLocation,
                role: roleName,
                team: roleName.includes('燈') ? 'light' : roleName.includes('音') ? 'audio' : roleName.includes('舞') ? 'stage' : 'video',
              });
            }
          } else {
            // 已安排同工
            const person = cellVal;
            if (!seenAssignments.has(uniqueKey)) {
              seenAssignments.add(uniqueKey);

              if (!assignmentsByVolunteer[person]) assignmentsByVolunteer[person] = [];
              assignmentsByVolunteer[person].push({
                volunteerName: person,
                location: currentLocation,
                role: roleName,
                date: dateLabel,
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
      }
    }
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

/** 輔助：更新排班文件中的 shifts 陣列 */
function updateShiftsArray(
  shifts: any[],
  targetDate: string,
  targetLoc: string,
  targetRole: string,
  volunteerName: string
): any[] {
  if (!Array.isArray(shifts)) return [];
  return shifts.map((shift: any) => {
    const shiftDate = String(shift.date || '').trim();
    const shiftLoc = String(shift.location || '').trim();
    const matchDate = shiftDate.includes(targetDate) || targetDate.includes(shiftDate);
    const matchLoc = !targetLoc || shiftLoc.includes(targetLoc) || targetLoc.includes(shiftLoc);

    if (matchDate && matchLoc) {
      const assignments = { ...(shift.assignments || {}) };
      assignments[targetRole] = volunteerName;
      return { ...shift, assignments };
    }
    return shift;
  });
}

/** 輔助：在 2D 矩陣中尋找對應的 location, date, role 並填入義工姓名 */
function updateMatrixCell(
  matrix: string[][],
  targetDate: string,
  targetLoc: string,
  targetRole: string,
  volunteerName: string
): boolean {
  if (!Array.isArray(matrix)) return false;
  let curLoc = '';
  let dateColMap: Record<number, string> = {};

  for (let r = 0; r < matrix.length; r++) {
    const row = matrix[r] || [];
    const firstCell = String(row[0] || '').trim();

    if (firstCell.startsWith('【') && firstCell.endsWith('】')) {
      curLoc = firstCell.replace(/【|】/g, '').trim();
      dateColMap = {};
      continue;
    }

    if (firstCell.includes('職務') || firstCell.includes('日期') || firstCell === '崗位') {
      dateColMap = {};
      for (let c = 1; c < row.length; c++) {
        const cellVal = String(row[c] || '').trim();
        if (cellVal.includes(targetDate) || targetDate.includes(cellVal)) {
          dateColMap[c] = cellVal;
        }
      }
      continue;
    }

    if (firstCell === targetRole && (!targetLoc || curLoc.includes(targetLoc) || targetLoc.includes(curLoc))) {
      for (const colStr of Object.keys(dateColMap)) {
        const col = Number(colStr);
        row[col] = volunteerName;
        return true;
      }
    }
  }
  return false;
}

/** 即時寫入 Firestore 矩陣與 shifts 進行全域排班文件雙向同步 */
export async function applySlotFillToMatrix(
  docId: string,
  rowIndex: number,
  colIndex: number,
  volunteerName: string,
  targetLocParam?: string,
  targetDateParam?: string,
  targetRoleParam?: string
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

    // 1. 定位該儲存格的地點、日期與職位名稱 (優先採用傳入的精準參數)
    let targetLoc = targetLocParam || '';
    let targetDate = targetDateParam || '';
    const targetRole = targetRoleParam || String(matrix[rowIndex][0] || '').trim();

    // 往上尋找地點 (若未傳入)
    if (!targetLoc) {
      for (let r = rowIndex - 1; r >= 0; r--) {
        const cell = String(matrix[r]?.[0] || '').trim();
        if (cell.startsWith('【') && cell.endsWith('】')) {
          targetLoc = cell.replace(/【|】/g, '').trim();
          break;
        }
      }
    }

    // 往上尋找日期標頭 (若未傳入)
    if (!targetDate) {
      for (let r = rowIndex - 1; r >= 0; r--) {
        const cell = String(matrix[r]?.[0] || '').trim();
        if (cell.includes('職務') || cell.includes('日期') || cell === '崗位') {
          targetDate = String(matrix[r]?.[colIndex] || '').trim();
          break;
        }
      }
    }

    // 2. 更新當前文件的矩陣與 shifts
    matrix[rowIndex][colIndex] = volunteerName;

    const updatePayload: Record<string, any> = {
      dataJson: JSON.stringify(matrix),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    if (Array.isArray(data.shifts) && data.shifts.length > 0) {
      updatePayload.shifts = updateShiftsArray(data.shifts, targetDate, targetLoc, targetRole, volunteerName);
    }

    await docRef.set(updatePayload, { merge: true });

    // 3. 全域雙向同步：掃描並同步寫入所有相關團隊排班表與 _final 整合服事表
    try {
      const allSchedules = await db.collection('schedules').get();
      for (const sDoc of allSchedules.docs) {
        if (sDoc.id === docId) continue;
        const sData = sDoc.data() || {};
        let needUpdate = false;
        const sPayload: Record<string, any> = {
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };

        // 同步更新 shifts 陣列
        if (Array.isArray(sData.shifts) && sData.shifts.length > 0) {
          const hasMatch = sData.shifts.some((s: any) => {
            const matchD = !targetDate || (s.date || '').includes(targetDate) || targetDate.includes(s.date || '');
            const matchL = !targetLoc || (s.location || '').includes(targetLoc) || targetLoc.includes(s.location || '');
            return matchD && matchL && s.assignments && (targetRole in s.assignments || s.assignments[targetRole] !== undefined);
          });

          if (hasMatch) {
            sPayload.shifts = updateShiftsArray(sData.shifts, targetDate, targetLoc, targetRole, volunteerName);
            needUpdate = true;
          }
        }

        // 同步更新 dataJson 二維矩陣
        const sMatrix = parseMatrixFromDoc(sData);
        if (sMatrix && updateMatrixCell(sMatrix, targetDate, targetLoc, targetRole, volunteerName)) {
          sPayload.dataJson = JSON.stringify(sMatrix);
          needUpdate = true;
        }

        if (needUpdate) {
          await sDoc.ref.set(sPayload, { merge: true });
        }
      }
    } catch (syncErr) {
      console.warn('[applySlotFill Global Sync Warning]:', syncErr);
    }

    return { success: true, message: '班表已成功即時更新' };
  } catch (err: any) {
    console.error('[applySlotFillToMatrix Error]:', err);
    return { success: false, message: err?.message || '寫入失敗' };
  }
}

/** 判斷義工是否具備補位該職位的能力或所屬團隊 */
export function canVolunteerFillVacancy(volunteer: VolunteerRecord, roleName: string, team: string): boolean {
  // 1. 若該職位為備用席位，不列入推播
  if (roleName.includes('備用') || roleName.includes('備份')) return false;

  if (roleName === '網路導播') {
    return Boolean(
      volunteer.skillRoles?.includes('director_sz') || volunteer.skillRoles?.includes('director_xj') ||
      ((volunteer.videoSkills?.networkDirector || 0) > 0 && (volunteer.videoSkills?.ad || 0) >= 5)
    );
  }

  // 2. 全能補位幹部 (Backfill Leader) 或 全職同工 -> 具備所有補位資格
  if (volunteer.isBackfillLeader || volunteer.isFullTimer) return true;

  // 3. 檢查具體技能樹認證 (skillRoles / videoSkills / audioSkills / lightLevel / stageLevel)
  if (volunteer.skillRoles && volunteer.skillRoles.includes(roleName)) {
    return true;
  }
  if (volunteer.videoSkills && (volunteer.videoSkills[roleName] || 0) >= 1) {
    return true;
  }
  if (volunteer.audioSkills && (volunteer.audioSkills[roleName] || 0) >= 1) {
    return true;
  }
  if (roleName.includes('燈') && (volunteer.lightLevel || 0) >= 1) {
    return true;
  }
  if (roleName.includes('舞') && (volunteer.stageLevel || 0) >= 1) {
    return true;
  }

  // 4. 檢查團隊所屬 (若 jobTitles 包含對應團隊)
  const titles = volunteer.jobTitles || [];
  const titlesStr = titles.join(',');

  if (team === 'video' || roleName.includes('導播') || roleName.includes('字卡') || roleName.includes('攝影') || roleName.includes('主控')) {
    if (titlesStr.includes('影視') || titlesStr.includes('video')) return true;
  }
  if (team === 'audio' || roleName.includes('音控') || roleName.includes('PA') || roleName.includes('OB') || roleName.includes('IN')) {
    if (titlesStr.includes('音控') || titlesStr.includes('audio')) return true;
  }
  if (team === 'light' || roleName.includes('燈光') || roleName.includes('燈控')) {
    if (titlesStr.includes('燈光') || titlesStr.includes('light')) return true;
  }
  if (team === 'stage' || roleName.includes('舞監') || roleName.includes('舞台')) {
    if (titlesStr.includes('舞監') || titlesStr.includes('stage')) return true;
  }

  // 若義工無特定職稱或屬於通識志工，且無技能限制，預設可支援影視
  if (titles.length === 0 && (team === 'video' || !team)) {
    return true;
  }

  return false;
}
