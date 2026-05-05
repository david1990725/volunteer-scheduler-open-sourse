// =============================================================================
// Google Sheets API 層（透過 Google Apps Script Web App 代理）
//
// 所有對 Google Sheets 的讀寫皆透過此模組統一發送。
// 使用 callAppsScript() 泛型函數消除重複的 fetch / error-handling 模板。
// =============================================================================

const APPS_SCRIPT_URL = import.meta.env.VITE_APPS_SCRIPT_URL || '';

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

// --- Core: 統一 API 呼叫函數 -------------------------------------------------

/**
 * 透過 Apps Script Web App 發送 POST 請求。
 * 統一處理：URL 檢查、HTTP 錯誤、JSON 解析失敗。
 *
 * @param action   - Apps Script 端的 action 名稱
 * @param payload  - 額外的請求參數（會與 action 合併）
 * @param fallback - 發生錯誤時的預設回傳值
 */
async function callAppsScript<T>(
  action: string,
  payload: Record<string, unknown> | object = {},
  fallback: T,
): Promise<T> {
  if (!APPS_SCRIPT_URL) {
    console.error(`[callAppsScript] VITE_APPS_SCRIPT_URL 未設定，無法執行 "${action}"`);
    return fallback;
  }

  const res = await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' }, // Apps Script CORS workaround
    body: JSON.stringify({ action, ...payload }),
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }

  // Apps Script 偶爾會回傳 HTML 錯誤頁面，需防禦性解析
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`回應非 JSON 格式: ${text.slice(0, 200)}`);
  }
}

// --- 義工名單與 LINE 綁定 ----------------------------------------------------

/** 註冊新義工（寫入姓名、LINE 名稱、user_id） */
export async function registerNewVolunteer(payload: NewVolunteerPayload): Promise<ApiResult> {
  try {
    const result = await callAppsScript<ApiResult>(
      'addVolunteer',
      payload,
      { success: false, message: 'Apps Script URL 尚未設定，請聯繫管理員。' },
    );
    return { success: result.success ?? true, message: result.message ?? '新增成功' };
  } catch (err) {
    console.error('[registerNewVolunteer]', err);
    return { success: false, message: '寫入試算表失敗，請稍後再試。' };
  }
}

/** 綁定 / 更新義工的 LINE user_id 與顯示名稱 */
export async function updateVolunteerLineId(
  payload: { name: string; lineId: string; lineName?: string },
): Promise<ApiResult> {
  try {
    const result = await callAppsScript<ApiResult>(
      'updateLineId',
      payload,
      { success: false, message: 'Apps Script URL 尚未設定，請聯繫管理員。' },
    );
    return { success: result.success ?? true, message: result.message ?? '更新成功' };
  } catch (err) {
    console.error('[updateVolunteerLineId]', err);
    return { success: false, message: '更新試算表失敗，請稍後再試。' };
  }
}

/** 更新義工技能數值 */
export async function updateVolunteerSkills(
  payload: { name: string; skills: Record<string, number> },
): Promise<ApiResult> {
  try {
    const result = await callAppsScript<ApiResult>(
      'updateSkills',
      payload,
      { success: false, message: 'Apps Script URL 尚未設定，請聯繫管理員。' },
    );
    return { success: result.success ?? true, message: result.message ?? '技能更新成功' };
  } catch (err) {
    console.error('[updateVolunteerSkills]', err);
    return { success: false, message: '更新技能失敗，請稍後再試。' };
  }
}

// --- 排班表同步與讀取 ---------------------------------------------------------

/** 將排班結果同步寫入 Google Sheets */
export async function syncSchedule(
  payload: { sheetName: string; data: string[][] },
): Promise<ApiResult> {
  try {
    const result = await callAppsScript<ApiResult>(
      'syncSchedule',
      payload,
      { success: false, message: 'Apps Script URL 尚未設定，請聯繫管理員。' },
    );
    return { success: result.success ?? true, message: result.message ?? '同步成功' };
  } catch (err) {
    console.error('[syncSchedule]', err);
    return { success: false, message: '同步試算表失敗，請稍後再試。' };
  }
}

/** 從雲端讀取指定工作表的排班資料 */
export async function fetchScheduleFromCloud(
  sheetName: string,
): Promise<ApiResultWithData<string[][]>> {
  try {
    const result = await callAppsScript<ApiResultWithData<string[][]>>(
      'fetchSchedule',
      { sheetName },
      { success: false, message: 'Apps Script URL 尚未設定，請聯繫管理員。', data: null },
    );
    return {
      success: result.success ?? false,
      message: result.message ?? '讀取失敗',
      data: result.data ?? null,
    };
  } catch (err) {
    console.error('[fetchScheduleFromCloud]', err);
    return { success: false, message: '從雲端讀取排班資料失敗，請稍後再試。', data: null };
  }
}

// --- 表單提交與離線佇列 -------------------------------------------------------

/** 提交個人排班表單到雲端；離線時自動存入 localStorage 佇列 */
export async function submitVolunteerForm(
  payload: { data: Record<string, string> },
): Promise<ApiResult> {
  try {
    const result = await callAppsScript<ApiResult>(
      'submitForm',
      { data: payload.data },
      { success: false, message: 'Apps Script URL 尚未設定，請聯繫管理員。' },
    );
    return { success: result.success ?? true, message: result.message ?? '提交成功' };
  } catch (err) {
    console.error('[submitVolunteerForm] 網路錯誤，資料存入離線佇列:', err);
    enqueueOfflineForm(payload.data);
    return {
      success: true,
      message: '目前處於離線狀態，資料已安全儲存於您的裝置。將於網路恢復時自動同步。',
    };
  }
}

/** 讀取雲端所有排班表單回覆 */
export async function fetchFormResponsesFromCloud(): Promise<ApiResultWithData<Record<string, string>[]>> {
  try {
    const result = await callAppsScript<ApiResultWithData<Record<string, string>[]>>(
      'fetchFormResponses',
      {},
      { success: false, message: 'Apps Script URL 尚未設定，請聯繫管理員。', data: null },
    );
    return {
      success: result.success ?? false,
      message: result.message ?? '讀取失敗',
      data: result.data ?? null,
    };
  } catch (err) {
    console.error('[fetchFormResponsesFromCloud]', err);
    return { success: false, message: '從雲端讀取表單回覆失敗，請稍後再試。', data: null };
  }
}

/** 清空雲端所有表單回覆 */
export async function clearFormResponsesInCloud(): Promise<ApiResult> {
  try {
    const result = await callAppsScript<ApiResult>(
      'clearFormResponses',
      {},
      { success: false, message: 'Apps Script URL 尚未設定，請聯繫管理員。' },
    );
    return { success: result.success ?? false, message: result.message ?? '清空失敗' };
  } catch (err) {
    console.error('[clearFormResponsesInCloud]', err);
    return { success: false, message: '清空雲端表單回覆失敗，請稍後再試。' };
  }
}

// --- 離線佇列管理 -------------------------------------------------------------

const OFFLINE_QUEUE_KEY = 'offline_form_responses';

/** 將表單資料加入離線佇列 */
function enqueueOfflineForm(data: Record<string, string>): void {
  const queue = JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || '[]');
  queue.push(data);
  localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
}

/** 檢查並同步離線表單資料（需在上線時呼叫） */
export async function syncOfflineForms(): Promise<void> {
  if (!navigator.onLine || !APPS_SCRIPT_URL) return;

  const queue: Record<string, string>[] = JSON.parse(
    localStorage.getItem(OFFLINE_QUEUE_KEY) || '[]',
  );
  if (queue.length === 0) return;

  const failedItems: Record<string, string>[] = [];
  let successCount = 0;

  for (const data of queue) {
    try {
      const result = await callAppsScript<ApiResult>(
        'submitForm',
        { data },
        { success: false, message: '' },
      );
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
