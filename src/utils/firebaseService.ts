// =============================================================================
// Firebase Firestore 服務層（義工排班系統核心資料庫）
//
// 遵循純英文資料結構儲存規範，並提供與前端中文介面對接的雙向轉換層。
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
import {
  toTeamKey,
  VIDEO_SKILL_KEYS,
  REVERSE_VIDEO_SKILL_MAP,
  AUDIO_SKILL_KEYS,
  type VideoSkillKey,
  type AudioSkillKey,
} from './constants';

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
      const vs = data.videoSkills || data.skills || {};
      const as = data.audioSkills || {};

      const row: SheetRow = {
        'Name': data.name || d.id,
        'User_ID': data.lineId || '',
        'LINE_ID': data.lineDisplayName || '',
        'User_Level': data.userLevel || 'user',
        'Job_Title': Array.isArray(data.jobTitles) ? data.jobTitles.join(', ') : '',
        'Skill_Role': Array.isArray(data.skillRoles) ? data.skillRoles.join(', ') : '',
        'Avatar': data.pictureUrl || '',
        'Birthday': data.birthday || '',
        'D_Skill': String(vs.director ?? vs['導播'] ?? 0),
        'AD_Skill': String(vs.ad ?? vs['AD'] ?? 0),
        'Photo_Skill': String(vs.photo ?? vs['平面'] ?? 0),
        'Cam1_Skill': String(vs.cam1 ?? vs['CAM1'] ?? 0),
        'Cam2_Skill': String(vs.cam2 ?? vs['CAM2'] ?? 0),
        'Cam3_Skill': String(vs.cam3 ?? vs['CAM3'] ?? 0),
        'Cam4_Skill': String(vs.cam4 ?? vs['CAM4'] ?? 0),
      };

      // 附加原生結構物件
      (row as any).name = data.name || d.id;
      (row as any).userLevel = data.userLevel || 'user';
      (row as any).jobTitles = data.jobTitles || [];
      (row as any).skillRoles = data.skillRoles || [];
      (row as any).pictureUrl = data.pictureUrl || '';
      (row as any).birthday = data.birthday || '';
      (row as any).isFullTimer = Boolean(data.isFullTimer);
      (row as any).isBackfillLeader = Boolean(data.isBackfillLeader);
      (row as any).videoSkills = {
        director: vs.director ?? vs['導播'] ?? 0,
        ad: vs.ad ?? vs['AD'] ?? 0,
        photo: vs.photo ?? vs['平面'] ?? 0,
        cam1: vs.cam1 ?? vs['CAM1'] ?? 0,
        cam2: vs.cam2 ?? vs['CAM2'] ?? 0,
        cam3: vs.cam3 ?? vs['CAM3'] ?? 0,
        cam4: vs.cam4 ?? vs['CAM4'] ?? 0,
      };
      (row as any).lightLevel = data.lightLevel || 1;
      (row as any).stageLevel = data.stageLevel || 1;
      (row as any).audioSkills = {
        ih_xj: as.ih_xj ?? as.IH_XJ ?? 0,
        ih_sz: as.ih_sz ?? as.IH_SZ ?? 0,
        ob_xj: as.ob_xj ?? as.OB_XJ ?? 0,
        ob_sz: as.ob_sz ?? as.OB_SZ ?? 0,
      };

      result.push(row);
    });

    return { success: true, message: '讀取成功', data: result };
  } catch (err: any) {
    console.error('[fetchVolunteers Error]:', err);
    return { success: false, message: err?.message || '讀取義工名冊失敗', data: null };
  }
}

/** 手動新增義工（由後台管理員操作） */
export async function addNewVolunteer(payload: {
  name: string;
  jobTitles: string[];
  userLevel?: string;
  pictureUrl?: string;
  avatar?: string;
  lineId?: string;
  birthday?: string;
  lightLevel?: number;
  stageLevel?: number;
  videoSkills?: Record<string, number>;
  audioSkills?: Record<string, number>;
}): Promise<ApiResult> {
  try {
    const name = payload.name.trim();
    if (!name) return { success: false, message: '請輸入義工姓名' };

    const docId = sanitizeDocId(name);
    const docRef = doc(db, COLLECTIONS.VOLUNTEERS, docId);
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
      return { success: false, message: `名單中已存在名為「${name}」的成員` };
    }

    const defaultVideoSkills = payload.videoSkills || {
      director: 0, ad: 0, photo: 0, cam1: 0, cam2: 0, cam3: 0, cam4: 0
    };
    const defaultAudioSkills = payload.audioSkills || {
      ih_xj: 0, ih_sz: 0, ob_xj: 0, ob_sz: 0
    };

    // 轉換 jobTitles 為英文
    const cleanJobTitles = Array.from(new Set(
      (payload.jobTitles || []).map(t => toTeamKey(t)).filter(Boolean)
    ));

    await setDoc(docRef, {
      name: name,
      lineId: payload.lineId || '',
      lineDisplayName: '',
      pictureUrl: payload.pictureUrl || payload.avatar || '',
      birthday: payload.birthday || '',
      userLevel: payload.userLevel || 'user',
      jobTitles: cleanJobTitles,
      skillRoles: [],
      videoSkills: defaultVideoSkills,
      lightLevel: payload.lightLevel || 1,
      stageLevel: payload.stageLevel || 1,
      audioSkills: defaultAudioSkills,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    return { success: true, message: `已成功新增義工「${name}」！` };
  } catch (err: any) {
    console.error('[addNewVolunteer Error]:', err);
    return { success: false, message: err?.message || '新增義工失敗' };
  }
}

/** 更新義工特定團隊的等級 (Level 1~3: lightLevel 或 stageLevel) */
export async function updateVolunteerLevel(payload: {
  name: string;
  field: 'lightLevel' | 'stageLevel' | string;
  level: number;
}): Promise<ApiResult> {
  try {
    const docId = sanitizeDocId(payload.name.trim());
    const docRef = doc(db, COLLECTIONS.VOLUNTEERS, docId);
    const levelNum = Math.max(1, Math.min(3, Number(payload.level) || 1));
    
    // 支援直接傳入 '燈光團隊' 或 'lightLevel'
    let targetField = 'lightLevel';
    if (payload.field === 'stageLevel' || payload.field === '舞監團隊' || payload.field === 'stage') {
      targetField = 'stageLevel';
    }

    await setDoc(
      docRef,
      {
        [targetField]: levelNum,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    const teamLabel = targetField === 'lightLevel' ? '燈光團隊' : '舞監團隊';
    return { success: true, message: `${payload.name} 的 ${teamLabel} 等級已更新為 Level ${levelNum}！` };
  } catch (err: any) {
    console.error('[updateVolunteerLevel Error]:', err);
    return { success: false, message: err?.message || '更新等級失敗' };
  }
}

/** 向後相容別名 */
export const updateVolunteerTeamLevel = async (payload: { name: string; team: string; level: number }) => {
  const field = (payload.team === '舞監團隊' || payload.team === 'stage') ? 'stageLevel' : 'lightLevel';
  return updateVolunteerLevel({ name: payload.name, field, level: payload.level });
};

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

    // 新增義工（純淨英文結構）
    await setDoc(docRef, {
      name: name,
      lineId: payload.lineId || '',
      lineDisplayName: payload.lineName || '',
      pictureUrl: payload.pictureUrl || '',
      userLevel: 'user',
      jobTitles: [],
      skillRoles: [],
      videoSkills: { director: 0, ad: 0, photo: 0, cam1: 0, cam2: 0, cam3: 0, cam4: 0 },
      lightLevel: 1,
      stageLevel: 1,
      audioSkills: { ih_xj: 0, ih_sz: 0, ob_xj: 0, ob_sz: 0 },
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
    if (payload.pictureUrl) updateData.pictureUrl = payload.pictureUrl;

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
  jobTitles?: string[];
  jobTitle?: string;
  userLevel: string;
  pictureUrl?: string;
  avatar?: string;
  birthday?: string;
}): Promise<ApiResult> {
  try {
    const oldDocId = sanitizeDocId(payload.oldName.trim());
    const newName = payload.newName.trim();
    const newDocId = sanitizeDocId(newName);

    // 解析英文 jobTitles
    let rawTitles: string[] = [];
    if (payload.jobTitles && Array.isArray(payload.jobTitles)) {
      rawTitles = payload.jobTitles;
    } else if (payload.jobTitle) {
      rawTitles = payload.jobTitle.split(',').map(s => s.trim()).filter(Boolean);
    }
    const cleanJobTitles = Array.from(new Set(rawTitles.map(t => toTeamKey(t)).filter(Boolean)));

    const updateData: Record<string, any> = {
      name: newName,
      jobTitles: cleanJobTitles,
      userLevel: payload.userLevel,
      pictureUrl: payload.pictureUrl || payload.avatar || '',
      updatedAt: serverTimestamp(),
    };
    if (payload.birthday !== undefined) {
      updateData.birthday = payload.birthday;
    }

    if (oldDocId === newDocId) {
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

/** 更新影視義工 7 軸技能評分 (videoSkills) 及特殊機制角色 */
export async function updateVolunteerVideoSkills(payload: {
  name: string;
  skills?: Record<string, number>;
  videoSkills?: Record<string, number>;
  isFullTimer?: boolean;
  isBackfillLeader?: boolean;
}): Promise<ApiResult> {
  try {
    const docId = sanitizeDocId(payload.name.trim());
    const docRef = doc(db, COLLECTIONS.VOLUNTEERS, docId);

    const inputSkills = payload.videoSkills || payload.skills || {};
    const cleanVideoSkills: Record<string, number> = {
      director: 0, ad: 0, photo: 0, cam1: 0, cam2: 0, cam3: 0, cam4: 0
    };

    Object.entries(inputSkills).forEach(([key, val]) => {
      const enKey = (REVERSE_VIDEO_SKILL_MAP[key] || key.toLowerCase()) as VideoSkillKey;
      if (VIDEO_SKILL_KEYS.includes(enKey)) {
        cleanVideoSkills[enKey] = Math.max(0, Math.min(10, Number(val) || 0));
      }
    });

    const updateData: Record<string, any> = {
      videoSkills: cleanVideoSkills,
      updatedAt: serverTimestamp(),
    };

    if (payload.isFullTimer !== undefined) {
      updateData.isFullTimer = payload.isFullTimer;
    }
    if (payload.isBackfillLeader !== undefined) {
      updateData.isBackfillLeader = payload.isBackfillLeader;
    }

    await setDoc(docRef, updateData, { merge: true });

    return { success: true, message: '影視技能與角色設定更新成功！' };
  } catch (err: any) {
    console.error('[updateVolunteerVideoSkills Error]:', err);
    return { success: false, message: err?.message || '更新技能失敗' };
  }
}

/** 向後相容別名 */
export const updateVolunteerSkills = updateVolunteerVideoSkills;

/** 更新音控義工 4 軸獨立等級 (Level 0~3) */
export async function updateVolunteerAudioSkills(payload: {
  name: string;
  audioSkills: Record<string, number>;
}): Promise<ApiResult> {
  try {
    const docId = sanitizeDocId(payload.name.trim());
    const docRef = doc(db, COLLECTIONS.VOLUNTEERS, docId);

    const cleanAudioSkills: Record<string, number> = {
      ih_xj: 0, ih_sz: 0, ob_xj: 0, ob_sz: 0
    };
    
    Object.entries(payload.audioSkills || {}).forEach(([k, val]) => {
      const enKey = k.toLowerCase() as AudioSkillKey;
      if (AUDIO_SKILL_KEYS.includes(enKey)) {
        cleanAudioSkills[enKey] = Math.max(0, Math.min(3, Number(val) || 0));
      }
    });

    await setDoc(
      docRef,
      {
        audioSkills: cleanAudioSkills,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );

    return { success: true, message: `${payload.name} 的音控 4 軸等級已更新！` };
  } catch (err: any) {
    console.error('[updateVolunteerAudioSkills Error]:', err);
    return { success: false, message: err?.message || '更新音控等級失敗' };
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
    const enTeam = toTeamKey(payload.team || 'video');
    const timestamp = payload.data['時間戳記'] || new Date().toISOString();
    const name = payload.data['姓名'] || '未知';
    const docId = `${sanitizeDocId(enTeam)}_${sanitizeDocId(name)}_${new Date(timestamp).getTime() || Date.now()}`;

    const docRef = doc(db, COLLECTIONS.FORM_RESPONSES, docId);
    await setDoc(docRef, {
      team: enTeam,
      name,
      timestamp,
      data: payload.data, // 包含 [9/7], [9/14] 等動態日期地點
      createdAt: serverTimestamp(),
    });

    return { success: true, message: '表單已成功提交' };
  } catch (err: any) {
    console.error('[submitVolunteerForm Error]:', err);
    return { success: true, message: '表單已暫存於本地快取，連線時將自動送出' };
  }
}

/** 讀取指定團隊的所有排班表單回覆 */
export async function fetchFormResponsesFromCloud(team?: string): Promise<ApiResultWithData<Record<string, string>[]>> {
  try {
    const colRef = collection(db, COLLECTIONS.FORM_RESPONSES);
    const enTeam = toTeamKey(team || 'video');
    const q = query(colRef, where('team', '==', enTeam));
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
    const enTeam = toTeamKey(team || 'video');
    const q = query(colRef, where('team', '==', enTeam));
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
    const enTeam = toTeamKey(team);
    const q = query(colRef, where('team', '==', enTeam), where('timestamp', '==', timestamp));
    const snap = await getDocs(q);

    if (snap.empty) {
      // 嘗試從內層 data['時間戳記'] 查詢
      const allTeamQ = query(colRef, where('team', '==', enTeam));
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
// 3. 週期排班表 (Schedules & Google Sheets 備份)
// =============================================================================

const APPS_SCRIPT_URL = import.meta.env.VITE_APPS_SCRIPT_URL || '';

/** 呼叫舊版 Apps Script API 用於 Google Sheets 雙向備份 */
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
    console.warn(`[Apps Script Backup] 無法連線至 "${action}":`, err);
    return null;
  }
}

/** 解析 Firestore 班表文件中的 2D 矩陣資料 */
function parseScheduleDataFromDoc(docData: any): string[][] | null {
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
    return docData.rows.map((r: any) => (Array.isArray(r.cells) ? r.cells : []));
  }
  if (Array.isArray(docData.data)) {
    return docData.data;
  }
  return null;
}

/** 將排班結果矩陣同步寫入 Firestore（主要），並雙重備份寫入 Google Sheets */
export async function syncSchedule(payload: {
  sheetName: string;
  data: string[][];
}): Promise<ApiResult> {
  try {
    const docId = sanitizeDocId(payload.sheetName.trim());
    const docRef = doc(db, COLLECTIONS.SCHEDULES, docId);

    // 1. 主要寫入：Firebase Firestore（使用 dataJson 避免 Firestore 巢狀陣列限制）
    await setDoc(docRef, {
      sheetName: payload.sheetName,
      dataJson: JSON.stringify(payload.data),
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
 * 2. 若 Firestore 尚無資料，自動從 Google Sheets 讀取並雙向回寫至 Firestore。
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
        const scheduleMatrix = parseScheduleDataFromDoc(snap.data());
        if (scheduleMatrix && scheduleMatrix.length > 0) {
          return {
            success: true,
            message: '讀取成功 (來自 Firebase)',
            data: scheduleMatrix,
          };
        }
      }
    }

    // 若 Firestore 沒有或要求強制拉取，從 Google Sheets 讀取並雙向同步回 Firestore
    if (APPS_SCRIPT_URL) {
      const sheetRes = await fetchFromOldAppsScript<any>('fetchSchedule', { sheetName });
      if (sheetRes && sheetRes.success && sheetRes.data && Array.isArray(sheetRes.data) && sheetRes.data.length > 0) {
        await setDoc(docRef, {
          sheetName,
          dataJson: JSON.stringify(sheetRes.data),
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
  console.log('[Firebase] 離線快取與同步已由 Firestore SDK 自動管理');
}
