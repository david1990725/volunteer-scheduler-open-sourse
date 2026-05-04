// =============================================================================
// Google Sheets 寫入工具（透過 Google Apps Script Web App）
// =============================================================================

const APPS_SCRIPT_URL = import.meta.env.VITE_APPS_SCRIPT_URL || '';

interface NewVolunteerPayload {
  name: string;
  lineId: string;
  lineName: string;
  pictureUrl?: string;
}

/**
 * 透過 Google Apps Script Web App 將新義工寫入技能樹試算表
 * 僅寫入 姓名、user_id，職能與技能值留空
 */
export async function registerNewVolunteer(payload: NewVolunteerPayload): Promise<{ success: boolean; message: string }> {
  if (!APPS_SCRIPT_URL) {
    console.error('VITE_APPS_SCRIPT_URL is not configured');
    return { success: false, message: 'Apps Script URL 尚未設定，請聯繫管理員。' };
  }

  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' }, // Apps Script CORS workaround
      body: JSON.stringify({
        action: 'addVolunteer',
        ...payload,
      }),
    });

    const result = await res.json();
    return { success: result.success ?? true, message: result.message ?? '新增成功' };
  } catch (err) {
    console.error('Failed to register new volunteer:', err);
    return { success: false, message: '寫入試算表失敗，請稍後再試。' };
  }
}

/**
 * 透過 Google Apps Script Web App 將現有義工綁定 user_id
 */
export async function updateVolunteerLineId(payload: { name: string; lineId: string }): Promise<{ success: boolean; message: string }> {
  if (!APPS_SCRIPT_URL) {
    console.error('VITE_APPS_SCRIPT_URL is not configured');
    return { success: false, message: 'Apps Script URL 尚未設定，請聯繫管理員。' };
  }

  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({
        action: 'updateLineId',
        ...payload,
      }),
    });

    const result = await res.json();
    return { success: result.success ?? true, message: result.message ?? '更新成功' };
  } catch (err) {
    console.error('Failed to update volunteer line id:', err);
    return { success: false, message: '更新試算表失敗，請稍後再試。' };
  }
}

/**
 * 透過 Google Apps Script 同步排班結果到 Google Sheets
 */
export async function syncSchedule(payload: { sheetName: string; data: string[][] }): Promise<{ success: boolean; message: string }> {
  if (!APPS_SCRIPT_URL) {
    console.error('VITE_APPS_SCRIPT_URL is not configured');
    return { success: false, message: 'Apps Script URL 尚未設定，請聯繫管理員。' };
  }

  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({
        action: 'syncSchedule',
        ...payload,
      }),
    });

    const result = await res.json();
    return { success: result.success ?? true, message: result.message ?? '同步成功' };
  } catch (err) {
    console.error('Failed to sync schedule:', err);
    return { success: false, message: '同步試算表失敗，請稍後再試。' };
  }
}

/**
 * 透過 Google Apps Script 從雲端讀取指定工作表的排班資料
 */
export async function fetchScheduleFromCloud(sheetName: string): Promise<{ success: boolean; message: string; data: string[][] | null }> {
  if (!APPS_SCRIPT_URL) {
    console.error('VITE_APPS_SCRIPT_URL is not configured');
    return { success: false, message: 'Apps Script URL 尚未設定，請聯繫管理員。', data: null };
  }

  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({
        action: 'fetchSchedule',
        sheetName,
      }),
    });

    const result = await res.json();
    return { success: result.success ?? false, message: result.message ?? '讀取失敗', data: result.data ?? null };
  } catch (err) {
    console.error('Failed to fetch schedule from cloud:', err);
    return { success: false, message: '從雲端讀取排班資料失敗，請稍後再試。', data: null };
  }
}

/**
 * 透過 Google Apps Script 將個人排班表單資料提交到雲端 (Google Sheets)
 */
export async function submitVolunteerForm(payload: { data: Record<string, string> }): Promise<{ success: boolean; message: string }> {
  if (!APPS_SCRIPT_URL) {
    console.error('VITE_APPS_SCRIPT_URL is not configured');
    return { success: false, message: 'Apps Script URL 尚未設定，請聯繫管理員。' };
  }

  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({
        action: 'submitForm',
        data: payload.data,
      }),
    });

    const result = await res.json();
    return { success: result.success ?? true, message: result.message ?? '提交成功' };
  } catch (err) {
    console.error('Failed to submit form to cloud:', err);
    return { success: false, message: '提交表單至雲端失敗，請稍後再試。' };
  }
}

/**
 * 透過 Google Apps Script 從雲端讀取所有排班表單回覆
 */
export async function fetchFormResponsesFromCloud(): Promise<{ success: boolean; message: string; data: Record<string, string>[] | null }> {
  if (!APPS_SCRIPT_URL) {
    console.error('VITE_APPS_SCRIPT_URL is not configured');
    return { success: false, message: 'Apps Script URL 尚未設定，請聯繫管理員。', data: null };
  }

  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({
        action: 'fetchFormResponses',
      }),
    });

    const result = await res.json();
    return { success: result.success ?? false, message: result.message ?? '讀取失敗', data: result.data ?? null };
  } catch (err) {
    console.error('Failed to fetch form responses from cloud:', err);
    return { success: false, message: '從雲端讀取表單回覆失敗，請稍後再試。', data: null };
  }
}

/**
 * 透過 Google Apps Script 清空雲端的所有表單回覆
 */
export async function clearFormResponsesInCloud(): Promise<{ success: boolean; message: string }> {
  if (!APPS_SCRIPT_URL) {
    console.error('VITE_APPS_SCRIPT_URL is not configured');
    return { success: false, message: 'Apps Script URL 尚未設定，請聯繫管理員。' };
  }

  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({
        action: 'clearFormResponses',
      }),
    });

    const result = await res.json();
    return { success: result.success ?? false, message: result.message ?? '清空失敗' };
  } catch (err) {
    console.error('Failed to clear form responses in cloud:', err);
    return { success: false, message: '清空雲端表單回覆失敗，請稍後再試。' };
  }
}
