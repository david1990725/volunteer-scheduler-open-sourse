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
 * 僅寫入 姓名、LINE_ID，職能與技能值留空
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
