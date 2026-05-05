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
 * 透過 Google Apps Script Web App 將現有義工綁定 user_id 與 LINE 名稱
 */
export async function updateVolunteerLineId(payload: { name: string; lineId: string; lineName?: string }): Promise<{ success: boolean; message: string }> {
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
 * 透過 Google Apps Script 更新義工的技能數值
 */
export async function updateVolunteerSkills(payload: { name: string; skills: Record<string, number> }): Promise<{ success: boolean; message: string }> {
  if (!APPS_SCRIPT_URL) {
    return { success: false, message: 'Apps Script URL 尚未設定，請聯繫管理員。' };
  }

  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({
        action: 'updateSkills',
        ...payload,
      }),
    });

    const result = await res.json();
    return { success: result.success ?? true, message: result.message ?? '技能更新成功' };
  } catch (err) {
    console.error('Failed to update volunteer skills:', err);
    return { success: false, message: '更新技能失敗，請稍後再試。' };
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
  } catch (err: any) {
    console.error('Failed to submit form to cloud, saving to offline queue:', err);
    // 網路錯誤時，將資料存入離線佇列
    const offlineQueue = JSON.parse(localStorage.getItem('offline_form_responses') || '[]');
    offlineQueue.push(payload.data);
    localStorage.setItem('offline_form_responses', JSON.stringify(offlineQueue));
    return { success: true, message: '目前處於離線狀態，資料已安全儲存於您的裝置。將於網路恢復時自動同步。' };
  }
}

/**
 * 檢查並同步離線表單資料
 */
export async function syncOfflineForms() {
  if (!navigator.onLine) return;
  
  const offlineQueue = JSON.parse(localStorage.getItem('offline_form_responses') || '[]');
  if (offlineQueue.length === 0) return;

  const remainingQueue = [];
  let successCount = 0;

  for (const data of offlineQueue) {
    try {
      if (APPS_SCRIPT_URL) {
        const res = await fetch(APPS_SCRIPT_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: JSON.stringify({ action: 'submitForm', data }),
        });
        const result = await res.json();
        if (result.success) {
          successCount++;
        } else {
          remainingQueue.push(data); // 提交失敗，保留在佇列中
        }
      }
    } catch (err) {
      console.error('Offline sync failed for an item:', err);
      remainingQueue.push(data); // 網路再度中斷，保留在佇列中
    }
  }

  localStorage.setItem('offline_form_responses', JSON.stringify(remainingQueue));
  
  if (successCount > 0) {
    console.log(`成功同步了 ${successCount} 筆離線表單資料。`);
    // 可選：如果需要通知使用者，可以在這裡觸發一個 CustomEvent
    window.dispatchEvent(new CustomEvent('offline-sync-complete', { detail: successCount }));
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
