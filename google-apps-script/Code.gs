// =============================================================================
// Google Apps Script — 義工排班系統後端 API
// =============================================================================
//
// 部署步驟：
// 1. 開啟 Google Apps Script：https://script.google.com
// 2. 建立新專案，貼上此程式碼
// 3. 修改下方 SPREADSHEET_ID 為您的技能樹試算表 ID
// 4. 部署 → 新增部署 → 類型選「網頁應用程式」
//    - 執行身分：我
//    - 誰可以存取：任何人
// 5. 取得部署網址，貼到 .env 的 VITE_APPS_SCRIPT_URL
// =============================================================================

// ⚠️ 請替換為您的技能樹 Google Sheets ID
const SPREADSHEET_ID = '1L3W6RwrE6gzi_znqNXBww9WVRvi2NVuhDj3-hSYmTZI';
const SHEET_NAME = 'Sheet1'; // 視您的工作表名稱調整

/**
 * 處理 POST 請求（從前端寫入資料）
 */
function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    
    if (payload.action === 'addVolunteer') {
      return handleAddVolunteer(payload);
    } else if (payload.action === 'updateLineId') {
      return handleUpdateLineId(payload);
    }
    
    return jsonResponse({ success: false, message: '未知的操作' });
  } catch (err) {
    return jsonResponse({ success: false, message: err.toString() });
  }
}

/**
 * 處理 GET 請求（健康檢查）
 */
function doGet() {
  return jsonResponse({ success: true, message: 'API is running' });
}

/**
 * 新增義工到試算表
 * 會先檢查 user_id 是否已存在，避免重複新增
 */
function handleAddVolunteer(payload) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_NAME);
  
  if (!sheet) return jsonResponse({ success: false, message: '找不到工作表' });
  
  const lastCol = sheet.getLastColumn();
  if (lastCol === 0) return jsonResponse({ success: false, message: '工作表為空' });

  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const nameCol = headers.indexOf('姓名');
  const lineIdCol = headers.indexOf('user_id');
  const roleCol = headers.indexOf('role');
  
  if (nameCol === -1) return jsonResponse({ success: false, message: '找不到「姓名」欄位' });
  
  if (lineIdCol === -1) {
    sheet.getRange(1, lastCol + 1).setValue('user_id');
    return handleAddVolunteer(payload);
  }
  
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    const allData = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
    for (var i = 0; i < allData.length; i++) {
      if (allData[i][lineIdCol] === payload.lineId) {
        return jsonResponse({ success: true, message: '此 LINE 帳號已在名單中', existingName: allData[i][nameCol] });
      }
    }
  }
  
  const newRow = new Array(headers.length).fill('');
  newRow[nameCol] = payload.name || payload.lineName || '未知';
  newRow[lineIdCol] = payload.lineId;
  if (roleCol !== -1) newRow[roleCol] = 'user';
  
  sheet.appendRow(newRow);
  
  return jsonResponse({ success: true, message: '新義工已加入名單', name: newRow[nameCol] });
}

/**
 * 更新既有義工的 user_id
 */
function handleUpdateLineId(payload) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) return jsonResponse({ success: false, message: '找不到工作表' });

  const lastCol = sheet.getLastColumn();
  const lastRow = sheet.getLastRow();
  if (lastCol === 0 || lastRow <= 1) return jsonResponse({ success: false, message: '無資料可更新' });

  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const nameCol = headers.indexOf('姓名');
  const lineIdCol = headers.indexOf('user_id');

  if (nameCol === -1) return jsonResponse({ success: false, message: '找不到「姓名」欄位' });
  
  // 如果沒有 user_id 欄位，就建一個
  if (lineIdCol === -1) {
    sheet.getRange(1, lastCol + 1).setValue('user_id');
    return handleUpdateLineId(payload);
  }

  const allData = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  for (var i = 0; i < allData.length; i++) {
    if (allData[i][nameCol] === payload.name) {
      sheet.getRange(i + 2, lineIdCol + 1).setValue(payload.lineId);
      return jsonResponse({ success: true, message: '已成功綁定 LINE 帳號' });
    }
  }

  return jsonResponse({ success: false, message: '找不到符合姓名的義工' });
}

/**
 * 回傳 JSON 格式的回應（含 CORS 標頭）
 */
function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
