import { 
  collection, 
  doc, 
  setDoc, 
  getDoc, 
  getDocs, 
  updateDoc, 
  addDoc,
  writeBatch
} from "firebase/firestore";
import { db } from "../firebase/config";

// --- Types -------------------------------------------------------------------

interface ApiResult {
  success: boolean;
  message: string;
}

interface ApiResultWithData<T> extends ApiResult {
  data: T | null;
}

interface NewVolunteerPayload {
  name: string;
  lineId: string;
  lineName: string;
  pictureUrl?: string;
}

// --- Collections ------------------------------------------------------------
const VOLUNTEERS_COL = "volunteers";
const SCHEDULES_COL = "schedules";
const RESPONSES_COL = "form_responses";

// --- 義工名單與 LINE 綁定 ----------------------------------------------------

/** 讀取所有義工 */
export async function fetchVolunteers(): Promise<ApiResultWithData<any[]>> {
  try {
    const querySnapshot = await getDocs(collection(db, VOLUNTEERS_COL));
    const data = querySnapshot.docs.map(doc => ({ ...doc.data() }));
    return { success: true, message: '讀取成功', data };
  } catch (err) {
    console.error('[Firebase: fetchVolunteers]', err);
    return { success: false, message: '讀取失敗', data: null };
  }
}

/** 註冊新義工 */
export async function registerNewVolunteer(payload: NewVolunteerPayload): Promise<ApiResult> {
  try {
    const docRef = doc(db, VOLUNTEERS_COL, payload.name);
    await setDoc(docRef, {
      ...payload,
      createdAt: new Date().toISOString(),
      skills: {}
    }, { merge: true });
    return { success: true, message: '註冊成功' };
  } catch (err) {
    console.error('[Firebase: registerNewVolunteer]', err);
    return { success: false, message: '寫入 Firebase 失敗' };
  }
}

/** 綁定 / 更新義工的 LINE user_id 與顯示名稱 */
export async function updateVolunteerLineId(
  payload: { name: string; lineId: string; lineName?: string; pictureUrl?: string },
): Promise<ApiResult> {
  try {
    const docRef = doc(db, VOLUNTEERS_COL, payload.name);
    await updateDoc(docRef, {
      lineId: payload.lineId,
      lineName: payload.lineName,
      pictureUrl: payload.pictureUrl,
      updatedAt: new Date().toISOString()
    });
    return { success: true, message: '更新成功' };
  } catch (err) {
    console.error('[Firebase: updateVolunteerLineId]', err);
    return { success: false, message: '更新失敗' };
  }
}

/** 更新義工技能數值 */
export async function updateVolunteerSkills(
  payload: { name: string; skills: Record<string, number> },
): Promise<ApiResult> {
  try {
    const docRef = doc(db, VOLUNTEERS_COL, payload.name);
    await updateDoc(docRef, {
      skills: payload.skills,
      updatedAt: new Date().toISOString()
    });
    return { success: true, message: '技能更新成功' };
  } catch (err) {
    console.error('[Firebase: updateVolunteerSkills]', err);
    return { success: false, message: '技能更新失敗' };
  }
}

// --- 排班表同步與讀取 ---------------------------------------------------------

/** 將排班結果同步寫入 Firestore */
export async function syncSchedule(
  payload: { sheetName: string; data: string[][] },
): Promise<ApiResult> {
  try {
    const docRef = doc(db, SCHEDULES_COL, payload.sheetName);
    await setDoc(docRef, {
      data: payload.data,
      updatedAt: new Date().toISOString()
    });
    return { success: true, message: '同步成功' };
  } catch (err) {
    console.error('[Firebase: syncSchedule]', err);
    return { success: false, message: '同步失敗' };
  }
}

/** 從 Firestore 讀取指定月份的排班資料 */
export async function fetchScheduleFromCloud(
  sheetName: string,
): Promise<ApiResultWithData<string[][]>> {
  try {
    const docRef = doc(db, SCHEDULES_COL, sheetName);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      return { success: true, message: '讀取成功', data: docSnap.data().data };
    }
    return { success: false, message: '找不到資料', data: null };
  } catch (err) {
    console.error('[Firebase: fetchScheduleFromCloud]', err);
    return { success: false, message: '讀取失敗', data: null };
  }
}

// --- 表單提交 ---------------------------------------------------------------

/** 提交個人排班表單 */
export async function submitVolunteerForm(
  payload: { data: Record<string, string> },
): Promise<ApiResult> {
  try {
    await addDoc(collection(db, RESPONSES_COL), {
      ...payload.data,
      submittedAt: new Date().toISOString()
    });
    return { success: true, message: '提交成功' };
  } catch (err) {
    console.error('[Firebase: submitVolunteerForm] 網路錯誤，資料存入離線佇列:', err);
    enqueueOfflineForm(payload.data);
    return { 
      success: true, 
      message: '目前處於離線狀態，資料已安全儲存於您的裝置。將於網路恢復時自動同步。' 
    };
  }
}

/** 讀取所有表單回覆 */
export async function fetchFormResponsesFromCloud(): Promise<ApiResultWithData<Record<string, string>[]>> {
  try {
    const querySnapshot = await getDocs(collection(db, RESPONSES_COL));
    const data = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Record<string, string>));
    return { success: true, message: '讀取成功', data };
  } catch (err) {
    console.error('[Firebase: fetchFormResponsesFromCloud]', err);
    return { success: false, message: '讀取失敗', data: null };
  }
}

/** 清空所有表單回覆 */
export async function clearFormResponsesInCloud(): Promise<ApiResult> {
  try {
    const querySnapshot = await getDocs(collection(db, RESPONSES_COL));
    const batch = writeBatch(db);
    querySnapshot.docs.forEach((doc) => {
      batch.delete(doc.ref);
    });
    await batch.commit();
    return { success: true, message: '清空成功' };
  } catch (err) {
    console.error('[Firebase: clearFormResponsesInCloud]', err);
    return { success: false, message: '清空失敗' };
  }
}

// --- 離線佇列管理 -------------------------------------------------------------

const OFFLINE_QUEUE_KEY = 'offline_form_responses_firebase';

/** 將表單資料加入離線佇列 */
function enqueueOfflineForm(data: Record<string, string>): void {
  const queue = JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || '[]');
  queue.push(data);
  localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
}

/** 檢查並同步離線表單資料 */
export async function syncOfflineForms(): Promise<void> {
  if (!navigator.onLine) return;

  const queue: Record<string, string>[] = JSON.parse(
    localStorage.getItem(OFFLINE_QUEUE_KEY) || '[]',
  );
  if (queue.length === 0) return;

  const failedItems: Record<string, string>[] = [];
  let successCount = 0;

  for (const data of queue) {
    try {
      const result = await submitVolunteerForm({ data });
      if (result.success) {
        successCount++;
      } else {
        failedItems.push(data);
      }
    } catch {
      failedItems.push(data);
    }
  }

  localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(failedItems));

  if (successCount > 0) {
    window.dispatchEvent(
      new CustomEvent('offline-sync-complete', { detail: successCount }),
    );
  }
}
