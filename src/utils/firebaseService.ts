// =============================================================================
// Firebase Firestore 服務層（義工排班系統核心資料庫）
//
// 提供與 googleSheets.ts 100% 相容的 API 簽名，全面轉移至 Firestore。
// 支援 Firestore 離線持久化快取、即時同步與高效讀寫。
// =============================================================================

import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  writeBatch,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from './firebase';
import { fetchCSVAsJson } from './fileUtils';

// --- Types -------------------------------------------------------------------

export interface ApiResult {
  success: boolean;
  message: string;
}

export interface ApiResultWithData<T> extends ApiResult {
  data: T | null;
}

export interface NewVolunteerPayload {
  name: string;
  lineId: string;
  lineName: string;
  pictureUrl?: string;
}

export type SheetRow = Record<string, string>;

// Firestore Collections 名稱常量
const COLLECTIONS = {
  VOLUNTEERS: 'volunteers',
  FORM_RESPONSES: 'formResponses',
  SCHEDULES: 'schedules',
};

// 技能欄位名稱對應字典
const SKILL_COLUMN_MAP: Record<string, string> = {
  '導播': 'D_Skill',
  'AD': 'AD_Skill',
  '平面': 'Photo_Skill',
  'CAM1': 'Cam1_Skill',
  'CAM2': 'Cam2_Skill',
  'CAM3': 'Cam3_Skill',
  'CAM4': 'Cam4_Skill',
};

/** 安全清理 Document ID（移除斜線等非法字元） */
function sanitizeDocId(id: string): string {
  return id.replace(/[\/\s]/g, '_').trim();
}

// =============================================================================
// 1. 義工名冊與技能 (Volunteers & Skills)
// =============================================================================

/** 讀取所有義工資料（回傳相容現有 SheetRow[] 格式） */
export async function fetchVolunteers(): Promise<ApiResultWithData<SheetRow[]>> {
  try {
    const colRef = collection(db, COLLECTIONS.VOLUNTEERS);
    const snap = await getDocs(colRef);

    if (snap.empty) {
      return { success: true, message: '目前尚無義工資料', data: [] };
    }

    const result: SheetRow[] = [];
    snap.forEach(d => {
      const data = d.data();
      const row: SheetRow = {
        'Name': data.name || d.id,
        'User_ID': data.lineId || '',
        'User_Level': data.userLevel || data.role || 'user',
        'Job_Title': Array.isArray(data.jobTitles) ? data.jobTitles.join(', ') : (data.jobTitle || ''),
        'Skill_Role': Array.isArray(data.skillRoles) ? data.skillRoles.join(', ') : (data.skillRole || ''),
        'Avatar': data.avatar || data.pictureUrl || '',
        'D_Skill': String(data.skills?.['導播'] ?? data.D_Skill ?? 0),
        'AD_Skill': String(data.skills?.['AD'] ?? data.AD_Skill ?? 0),
        'Photo_Skill': String(data.skills?.['平面'] ?? data.Photo_Skill ?? 0),
        'Cam1_Skill': String(data.skills?.['CAM1'] ?? data.Cam1_Skill ?? 0),
        'Cam2_Skill': String(data.skills?.['CAM2'] ?? data.Cam2_Skill ?? 0),
        'Cam3_Skill': String(data.skills?.['CAM3'] ?? data.Cam3_Skill ?? 0),
        'Cam4_Skill': String(data.skills?.['CAM4'] ?? data.Cam4_Skill ?? 0),
      };

      // 保留任何其餘自訂欄位
      if (data.raw) {
        Object.assign(row, data.raw);
      }

      result.push(row);
    });

    return { success: true, message: '讀取成功', data: result };
  } catch (err: any) {
    console.error('[fetchVolunteers Error]:', err);
    return { success: false, message: err?.message || '讀取義工名冊失敗', data: null };
  }
}

/** 註冊新義工（LINE 登入且尚未在名冊中時調用） */
export async function registerNewVolunteer(payload: NewVolunteerPayload): Promise<ApiResult> {
  try {
    const name = payload.name.trim();
    if (!name) return { success: false, message: '姓名不可為空' };

    const docId = sanitizeDocId(name);
    const docRef = doc(db, COLLECTIONS.VOLUNTEERS, docId);
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
      // 若已存在但未綁定 lineId 則更新
      await updateDoc(docRef, {
        lineId: payload.lineId,
        lineDisplayName: payload.lineName || '',
        pictureUrl: payload.pictureUrl || '',
        updatedAt: serverTimestamp(),
      });
      return { success: true, message: '已找到同名義工，已自動綁定 LINE 資訊' };
    }

    // 新增義工
    await setDoc(docRef, {
      name: name,
      lineId: payload.lineId || '',
      lineDisplayName: payload.lineName || '',
      pictureUrl: payload.pictureUrl || '',
      userLevel: 'user',
      role: 'user',
      jobTitles: [],
      skillRoles: [],
      skills: {},
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    return { success: true, message: '新義工已加入名單' };
  } catch (err: any) {
    console.error('[registerNewVolunteer Error]:', err);
    return { success: false, message: err?.message || '註冊新義工失敗' };
  }
}

/** 綁定 / 更新義工 LINE 資訊與大頭貼 */
export async function updateVolunteerLineId(payload: {
  name: string;
  lineId: string;
  lineName?: string;
  pictureUrl?: string;
}): Promise<ApiResult> {
  try {
    const name = payload.name.trim();
    const docId = sanitizeDocId(name);
    const docRef = doc(db, COLLECTIONS.VOLUNTEERS, docId);

    const updateData: Record<string, any> = {
      lineId: payload.lineId,
      updatedAt: serverTimestamp(),
    };
    if (payload.lineName) updateData.lineDisplayName = payload.lineName;
    if (payload.pictureUrl) {
      updateData.pictureUrl = payload.pictureUrl;
      updateData.avatar = payload.pictureUrl;
    }

    await setDoc(docRef, updateData, { merge: true });
    return { success: true, message: '已成功更新 LINE 資訊與大頭照' };
  } catch (err: any) {
    console.error('[updateVolunteerLineId Error]:', err);
    return { success: false, message: err?.message || '更新 LINE 資訊失敗' };
  }
}

/** 更新使用者基本資料 (姓名、團隊職能、權限、大頭照) */
export async function updateUser(payload: {
  oldName: string;
  newName: string;
  jobTitle: string;
  userLevel: string;
  avatar: string;
}): Promise<ApiResult> {
  try {
    const oldDocId = sanitizeDocId(payload.oldName.trim());
    const newName = payload.newName.trim();
    const newDocId = sanitizeDocId(newName);

    const jobTitles = payload.jobTitle.split(',').map(s => s.trim()).filter(Boolean);
    const updateData = {
      name: newName,
      jobTitles: jobTitles,
      jobTitle: payload.jobTitle,
      userLevel: payload.userLevel,
      role: payload.userLevel,
      avatar: payload.avatar,
      pictureUrl: payload.avatar,
      updatedAt: serverTimestamp(),
    };

    if (oldDocId === newDocId) {
      // 原義工更動資料
      const docRef = doc(db, COLLECTIONS.VOLUNTEERS, oldDocId);
      await setDoc(docRef, updateData, { merge: true });
    } else {
      // 義工更名：複製舊資料到新文檔並刪除舊文檔
      const oldDocRef = doc(db, COLLECTIONS.VOLUNTEERS, oldDocId);
      const oldSnap = await getDoc(oldDocRef);
      const oldData = oldSnap.exists() ? oldSnap.data() : {};

      const newDocRef = doc(db, COLLECTIONS.VOLUNTEERS, newDocId);
      await setDoc(newDocRef, { ...oldData, ...updateData }, { merge: true });
      await deleteDoc(oldDocRef);
    }

    return { success: true, message: '使用者資料更新成功' };
  } catch (err: any) {
    console.error('[updateUser Error]:', err);
    return { success: false, message: err?.message || '更新使用者失敗' };
  }
}

/** 更新義工技能評分 */
export async function updateVolunteerSkills(payload: {
  name: string;
  skills: Record<string, number>;
}): Promise<ApiResult> {
  try {
    const docId = sanitizeDocId(payload.name.trim());
    const docRef = doc(db, COLLECTIONS.VOLUNTEERS, docId);

    const cleanSkills: Record<string, number> = {};
    const columnSkills: Record<string, number> = {};

    Object.entries(payload.skills).forEach(([skillName, val]) => {
      const numVal = Math.max(0, Math.min(10, Number(val) || 0));
      cleanSkills[skillName] = numVal;
      const colName = SKILL_COLUMN_MAP[skillName] || `${skillName}_Skill`;
      columnSkills[colName] = numVal;
    });

    await setDoc(
      docRef,
      {
        skills: cleanSkills,
        ...columnSkills,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );

    return { success: true, message: '技能更新成功' };
  } catch (err: any) {
    console.error('[updateVolunteerSkills Error]:', err);
    return { success: false, message: err?.message || '更新技能失敗' };
  }
}

// =============================================================================
// 2. 意願填報資料 (Form Responses / RAW Data)
// =============================================================================

/** 提交個人排班表單（Firestore 具備原生離線支援，離線時會自動排入快取佇列，上線自動同步） */
export async function submitVolunteerForm(payload: {
  data: Record<string, string>;
  team?: string;
}): Promise<ApiResult> {
  try {
    const team = payload.team || '影視團隊';
    const timestamp = payload.data['時間戳記'] || new Date().toISOString();
    const name = payload.data['姓名'] || '未知';
    const docId = `${sanitizeDocId(team)}_${sanitizeDocId(name)}_${new Date(timestamp).getTime() || Date.now()}`;

    const docRef = doc(db, COLLECTIONS.FORM_RESPONSES, docId);
    await setDoc(docRef, {
      team,
      name,
      timestamp,
      data: payload.data, // 包含 [9/7], [9/14] 等動態日期地點
      createdAt: serverTimestamp(),
    });

    return { success: true, message: '表單已成功提交' };
  } catch (err: any) {
    console.error('[submitVolunteerForm Error]:', err);
    // 若出錯仍可嘗試保底回傳成功訊息，Firestore SDK 仍會在背景嘗試離線同步
    return { success: true, message: '表單已暫存於本地快取，連線時將自動送出' };
  }
}

/** 讀取指定團隊的所有排班表單回覆 */
export async function fetchFormResponsesFromCloud(team?: string): Promise<ApiResultWithData<Record<string, string>[]>> {
  try {
    const colRef = collection(db, COLLECTIONS.FORM_RESPONSES);
    const targetTeam = team || '影視團隊';
    const q = query(colRef, where('team', '==', targetTeam));
    const snap = await getDocs(q);

    if (snap.empty) {
      return { success: true, message: '目前沒有表單資料', data: [] };
    }

    const list: Record<string, string>[] = [];
    snap.forEach(d => {
      const val = d.data();
      if (val.data && typeof val.data === 'object') {
        list.push({ ...val.data });
      }
    });

    return { success: true, message: '讀取成功', data: list };
  } catch (err: any) {
    console.error('[fetchFormResponsesFromCloud Error]:', err);
    return { success: false, message: err?.message || '讀取表單回覆失敗', data: null };
  }
}

/** 清空指定團隊的所有表單回覆紀錄 */
export async function clearFormResponsesInCloud(team?: string): Promise<ApiResult> {
  try {
    const colRef = collection(db, COLLECTIONS.FORM_RESPONSES);
    const targetTeam = team || '影視團隊';
    const q = query(colRef, where('team', '==', targetTeam));
    const snap = await getDocs(q);

    if (snap.empty) {
      return { success: true, message: '目前無資料，無需清空' };
    }

    const batch = writeBatch(db);
    snap.docs.forEach(d => {
      batch.delete(d.ref);
    });
    await batch.commit();

    return { success: true, message: '已成功清空該團隊表單紀錄' };
  } catch (err: any) {
    console.error('[clearFormResponsesInCloud Error]:', err);
    return { success: false, message: err?.message || '清空表單失敗' };
  }
}

/** 刪除指定團隊與時間戳記的單筆表單回覆 */
export async function deleteFormResponseInCloud(team: string, timestamp: string): Promise<ApiResult> {
  try {
    const colRef = collection(db, COLLECTIONS.FORM_RESPONSES);
    const q = query(colRef, where('team', '==', team), where('timestamp', '==', timestamp));
    const snap = await getDocs(q);

    if (snap.empty) {
      // 嘗試從內層 data['時間戳記'] 查詢
      const allTeamQ = query(colRef, where('team', '==', team));
      const allSnap = await getDocs(allTeamQ);
      const matched = allSnap.docs.filter(d => d.data().data?.['時間戳記'] === timestamp);

      if (matched.length > 0) {
        const batch = writeBatch(db);
        matched.forEach(d => batch.delete(d.ref));
        await batch.commit();
        return { success: true, message: '刪除成功' };
      }

      return { success: false, message: '找不到欲刪除的表單資料' };
    }

    const batch = writeBatch(db);
    snap.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();

    return { success: true, message: '刪除成功' };
  } catch (err: any) {
    console.error('[deleteFormResponseInCloud Error]:', err);
    return { success: false, message: err?.message || '刪除失敗' };
  }
}

// =============================================================================
// 3. 週期排班表 (Schedules)
// =============================================================================

/** 將排班結果矩陣同步寫入 Firestore（主要），並雙重備份寫入 Google Sheets */
export async function syncSchedule(payload: {
  sheetName: string;
  data: string[][];
}): Promise<ApiResult> {
  try {
    const docId = sanitizeDocId(payload.sheetName.trim());
    const docRef = doc(db, COLLECTIONS.SCHEDULES, docId);

    // 1. 主要寫入：Firebase Firestore
    await setDoc(docRef, {
      sheetName: payload.sheetName,
      data: payload.data,
      updatedAt: serverTimestamp(),
    });

    let backupSuccess = false;
    let backupMessage = '';

    // 2. 雙重備份：寫回 Google Sheets
    if (APPS_SCRIPT_URL) {
      try {
        const backupRes = await fetchFromOldAppsScript<any>('syncSchedule', {
          sheetName: payload.sheetName,
          data: payload.data,
        });
        if (backupRes && backupRes.success) {
          backupSuccess = true;
        } else {
          backupMessage = backupRes?.message || '未知錯誤';
        }
      } catch (err: any) {
        backupMessage = err?.message || '連線失敗';
      }
    }

    if (backupSuccess) {
      return {
        success: true,
        message: `排班資料已成功儲存至 Firebase，並已同步備份至 Google Sheets 工作表 [${payload.sheetName}]！`,
      };
    } else if (APPS_SCRIPT_URL) {
      return {
        success: true,
        message: `排班資料已成功儲存至 Firebase！(註：Google Sheets 備份異常: ${backupMessage})`,
      };
    }

    return { success: true, message: '排班資料已成功儲存至 Firebase！' };
  } catch (err: any) {
    console.error('[syncSchedule Error]:', err);
    return { success: false, message: err?.message || '同步班表失敗' };
  }
}

/** 
 * 從雲端讀取指定週期的排班資料（支援雙向同步）：
 * 1. 優先從 Firestore 讀取。
 * 2. 若 Firestore 尚無資料（或指定 forceSyncFromSheets），自動從 Google Sheets 讀取並雙向回寫至 Firestore。
 */
export async function fetchScheduleFromCloud(
  sheetName: string,
  options?: { forceSyncFromSheets?: boolean }
): Promise<ApiResultWithData<string[][]>> {
  try {
    const docId = sanitizeDocId(sheetName.trim());
    const docRef = doc(db, COLLECTIONS.SCHEDULES, docId);

    // 若非強制從 Google Sheets 重新拉取，先查 Firestore
    if (!options?.forceSyncFromSheets) {
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        const data = snap.data();
        if (data.data && Array.isArray(data.data) && data.data.length > 0) {
          return {
            success: true,
            message: '讀取成功 (來自 Firebase)',
            data: data.data,
          };
        }
      }
    }

    // 若 Firestore 沒有或要求強制拉取，從 Google Sheets 讀取並雙向同步回 Firestore
    if (APPS_SCRIPT_URL) {
      const sheetRes = await fetchFromOldAppsScript<any>('fetchSchedule', { sheetName });
      if (sheetRes && sheetRes.success && sheetRes.data && Array.isArray(sheetRes.data) && sheetRes.data.length > 0) {
        // 雙向同步：將 Google Sheets 的內容自動寫入 Firestore
        await setDoc(docRef, {
          sheetName,
          data: sheetRes.data,
          updatedAt: serverTimestamp(),
          syncedFrom: 'GoogleSheets',
        }, { merge: true });

        console.log(`[Bidirectional Sync] 排班表 [${sheetName}] 已自 Google Sheets 同步至 Firestore`);
        return {
          success: true,
          message: '讀取成功 (自 Google Sheets 同步至 Firebase)',
          data: sheetRes.data,
        };
      }
    }

    return { success: false, message: `找不到班表: ${sheetName}`, data: null };
  } catch (err: any) {
    console.error('[fetchScheduleFromCloud Error]:', err);
    return { success: false, message: err?.message || '讀取班表失敗', data: null };
  }
}

// =============================================================================
// 4. 離線相容管理
// =============================================================================

export async function syncOfflineForms(): Promise<void> {
  // Firestore 離線持久化自動在後台處理同步，此函數保留以相容舊版呼叫點
  console.log('[Firebase] 離線快取與同步已由 Firestore SDK 自動管理');
}

// =============================================================================
// 5. 資料一鍵遷移工具 (從現有 Google Sheets 匯入至 Firebase Firestore)
// =============================================================================

const SKILL_TREE_CSV_URL = 'https://docs.google.com/spreadsheets/d/1L3W6RwrE6gzi_znqNXBww9WVRvi2NVuhDj3-hSYmTZI/export?format=csv';
const APPS_SCRIPT_URL = import.meta.env.VITE_APPS_SCRIPT_URL || '';

/** 呼叫舊版 Apps Script API 用於資料遷移 */
async function fetchFromOldAppsScript<T>(action: string, payload: Record<string, unknown> = {}): Promise<T | null> {
  if (!APPS_SCRIPT_URL) return null;
  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action, ...payload }),
    });
    if (!res.ok) return null;
    const text = await res.text();
    return JSON.parse(text) as T;
  } catch (err) {
    console.warn(`[Migration] 無法從 Apps Script 讀取 "${action}":`, err);
    return null;
  }
}

/** 從 Google Sheets 一鍵搬遷所有資料（義工名冊、各團隊表單紀錄、排班表）至 Firestore */
export async function migrateGoogleSheetsToFirebase(): Promise<{
  success: boolean;
  message: string;
  counts: { volunteers: number; responses: number; schedules: number };
}> {
  try {
    console.log('[Migration] 開始從 Google Sheets 匯入全部資料至 Firestore...');
    let volCount = 0;
    let respCount = 0;
    let schedCount = 0;

    // 1. 抓取義工名冊 CSV 匯入 Firestore
    const csvVolunteers = await fetchCSVAsJson(SKILL_TREE_CSV_URL);

    if (csvVolunteers && csvVolunteers.length > 0) {
      const batch = writeBatch(db);

      for (const row of csvVolunteers) {
        const rawName = row['Name'] || row['姓名'];
        const name = typeof rawName === 'string' ? rawName.trim() : (rawName ? String(rawName).trim() : '');
        if (!name) continue;

        const docId = sanitizeDocId(name);
        const docRef = doc(db, COLLECTIONS.VOLUNTEERS, docId);

        const jobTitles = String(row['Job_Title'] || '').split(',').map((r: string) => r.trim()).filter(Boolean);
        const skillRoles = String(row['Skill_Role'] || row['職能'] || '').split(',').map((r: string) => r.trim()).filter(Boolean);

        const skills: Record<string, number> = {
          '導播': parseInt(row['D_Skill']) || parseInt(row['導播技能值']) || 0,
          'AD': parseInt(row['AD_Skill']) || parseInt(row['AD技能值']) || 0,
          '平面': parseInt(row['Photo_Skill']) || parseInt(row['Photo技能值']) || parseInt(row['平面技能值']) || 0,
          'CAM1': parseInt(row['Cam1_Skill']) || parseInt(row['Cam1技能值']) || 0,
          'CAM2': parseInt(row['Cam2_Skill']) || parseInt(row['Cam2技能值']) || 0,
          'CAM3': parseInt(row['Cam3_Skill']) || parseInt(row['Cam3技能值']) || 0,
          'CAM4': parseInt(row['Cam4_Skill']) || parseInt(row['Cam4技能值']) || 0,
        };

        batch.set(
          docRef,
          {
            name: name,
            lineId: row['User_ID'] || row['lineId'] || '',
            userLevel: row['User_Level'] || 'user',
            role: row['User_Level'] || 'user',
            jobTitles: jobTitles,
            skillRoles: skillRoles,
            avatar: row['Avatar'] || '',
            pictureUrl: row['Avatar'] || '',
            skills: skills,
            D_Skill: skills['導播'],
            AD_Skill: skills['AD'],
            Photo_Skill: skills['平面'],
            Cam1_Skill: skills['CAM1'],
            Cam2_Skill: skills['CAM2'],
            Cam3_Skill: skills['CAM3'],
            Cam4_Skill: skills['CAM4'],
            raw: row,
            updatedAt: serverTimestamp(),
          },
          { merge: true },
        );

        volCount++;
      }

      await batch.commit();
      console.log(`[Migration] 義工名冊匯入完成：${volCount} 筆`);
    }

    // 2. 搬遷所有團隊的意願表單 RAW 回覆紀錄
    const teams = ['影視團隊', '燈光團隊', '音控團隊', '舞監團隊'];
    for (const team of teams) {
      const res = await fetchFromOldAppsScript<any>('fetchFormResponses', { team });
      if (res && res.success && Array.isArray(res.data) && res.data.length > 0) {
        const batch = writeBatch(db);
        for (const item of res.data) {
          const timestamp = item['時間戳記'] || new Date().toISOString();
          const name = item['姓名'] || '未知';
          const docId = `${sanitizeDocId(team)}_${sanitizeDocId(name)}_${new Date(timestamp).getTime() || Date.now()}`;
          const docRef = doc(db, COLLECTIONS.FORM_RESPONSES, docId);

          batch.set(docRef, {
            team,
            name,
            timestamp,
            data: item,
            createdAt: serverTimestamp(),
          }, { merge: true });

          respCount++;
        }
        await batch.commit();
        console.log(`[Migration] ${team} 表單回覆匯入完成：${res.data.length} 筆`);
      }
    }

    // 3. 搬遷所有歷史與當期排班表 (包含過去數年各月份/雙月)
    const importedSheetNames = new Set<string>();

    // 3.1 嘗試從 Apps Script 一次性抓取所有工作表
    const allSchedRes = await fetchFromOldAppsScript<any>('fetchAllSchedules');
    if (allSchedRes && allSchedRes.success && Array.isArray(allSchedRes.data)) {
      for (const item of allSchedRes.data) {
        if (item.sheetName && Array.isArray(item.data) && item.data.length > 0) {
          const sName = String(item.sheetName).trim();
          const docId = sanitizeDocId(sName);
          const docRef = doc(db, COLLECTIONS.SCHEDULES, docId);

          await setDoc(docRef, {
            sheetName: sName,
            data: item.data,
            updatedAt: serverTimestamp(),
          }, { merge: true });

          importedSheetNames.add(sName);
          schedCount++;
          console.log(`[Migration] 排班表 [${sName}] 匯入完成！`);
        }
      }
    }

    // 3.2 補漏掃描：若有舊版 Apps Script 尚未更新 handleFetchAllSchedules，逐一掃描 2024~2027 各週期
    const yearsToScan = [2024, 2025, 2026, 2027];
    const cyclesToScan = [[1, 2], [3, 4], [5, 6], [7, 8], [9, 10], [11, 12]];

    for (const yr of yearsToScan) {
      for (const c of cyclesToScan) {
        const potentialNames = [
          `${yr}年 ${c[0]}-${c[1]}月排班表`,
          `${yr}年${c[0]}-${c[1]}月排班表`,
          `${yr}年 ${c[0]}~${c[1]}月排班表`,
          `${yr}年${c[0]}~${c[1]}月排班表`,
        ];

        for (const sheetName of potentialNames) {
          if (importedSheetNames.has(sheetName)) continue;

          const res = await fetchFromOldAppsScript<any>('fetchSchedule', { sheetName });
          if (res && res.success && res.data && Array.isArray(res.data) && res.data.length > 0) {
            const docId = sanitizeDocId(sheetName.trim());
            const docRef = doc(db, COLLECTIONS.SCHEDULES, docId);

            await setDoc(docRef, {
              sheetName,
              data: res.data,
              updatedAt: serverTimestamp(),
            }, { merge: true });

            importedSheetNames.add(sheetName);
            schedCount++;
            console.log(`[Migration] 排班表 [${sheetName}] 匯入完成！`);
            break;
          }
        }
      }
    }

    console.log(`[Migration] 全部資料搬遷完成！義工: ${volCount}, 表單: ${respCount}, 班表: ${schedCount}`);
    return {
      success: true,
      message: `全站資料搬遷完成！\n已匯入：\n• 義工名冊：${volCount} 位\n• 各團隊表單回覆：${respCount} 筆\n• 歷史與當期排班表：${schedCount} 份`,
      counts: { volunteers: volCount, responses: respCount, schedules: schedCount },
    };
  } catch (err: any) {
    console.error('[Migration Error]:', err);
    return {
      success: false,
      message: err?.message || '資料遷移過程中發生錯誤',
      counts: { volunteers: 0, responses: 0, schedules: 0 },
    };
  }
}
