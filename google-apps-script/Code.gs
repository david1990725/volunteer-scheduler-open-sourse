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
    } else if (payload.action === 'syncSchedule') {
      return handleSyncSchedule(payload);
    } else if (payload.action === 'fetchSchedule') {
      return handleFetchSchedule(payload);
    } else if (payload.action === 'submitForm') {
      return handleSubmitForm(payload);
    } else if (payload.action === 'fetchFormResponses') {
      return handleFetchFormResponses();
    } else if (payload.action === 'clearFormResponses') {
      return handleClearFormResponses();
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
  
  let lastCol = sheet.getLastColumn();
  if (lastCol === 0) return jsonResponse({ success: false, message: '工作表為空' });

  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h).trim());
  const nameCol = headers.indexOf('姓名');
  let lineIdCol = headers.indexOf('user_id');
  const roleCol = headers.indexOf('role');
  let photoCol = headers.indexOf('大頭照');
  if (photoCol === -1) photoCol = headers.indexOf('pictureUrl');
  if (photoCol === -1) photoCol = headers.indexOf('頭像');
  
  if (nameCol === -1) return jsonResponse({ success: false, message: '找不到「姓名」欄位' });
  
  if (lineIdCol === -1) {
    lastCol += 1;
    sheet.getRange(1, lastCol).setValue('user_id');
    lineIdCol = lastCol - 1;
  }

  if (photoCol === -1) {
    lastCol += 1;
    sheet.getRange(1, lastCol).setValue('大頭照');
    photoCol = lastCol - 1;
  }
  SpreadsheetApp.flush(); 
  
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    const allData = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
    for (var i = 0; i < allData.length; i++) {
      if (String(allData[i][lineIdCol]).trim() === String(payload.lineId).trim()) {
        return jsonResponse({ success: true, message: '此 LINE 帳號已在名單中', existingName: allData[i][nameCol] });
      }
    }
  }
  
  // 新增一列時，長度需與目前的 lastCol 相符
  const newRow = new Array(lastCol).fill('');
  newRow[nameCol] = payload.name || payload.lineName || '未知';
  newRow[lineIdCol] = payload.lineId;
  if (roleCol !== -1) newRow[roleCol] = 'user';
  if (photoCol !== -1 && payload.pictureUrl) newRow[photoCol] = payload.pictureUrl;
  
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

  let lastCol = sheet.getLastColumn();
  const lastRow = sheet.getLastRow();
  if (lastCol === 0 || lastRow <= 1) return jsonResponse({ success: false, message: '無資料可更新' });

  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h).trim());
  const nameCol = headers.indexOf('姓名');
  let lineIdCol = headers.indexOf('user_id');
  let photoCol = headers.indexOf('大頭照');
  if (photoCol === -1) photoCol = headers.indexOf('pictureUrl');
  if (photoCol === -1) photoCol = headers.indexOf('頭像');

  if (nameCol === -1) return jsonResponse({ success: false, message: '找不到「姓名」欄位' });
  
  // 如果沒有 user_id 欄位，就建一個
  if (lineIdCol === -1) {
    lastCol += 1;
    sheet.getRange(1, lastCol).setValue('user_id');
    lineIdCol = lastCol - 1;
  }
  if (photoCol === -1) {
    lastCol += 1;
    sheet.getRange(1, lastCol).setValue('大頭照');
    photoCol = lastCol - 1;
  }
  SpreadsheetApp.flush();

  const allData = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  for (var i = 0; i < allData.length; i++) {
    if (String(allData[i][nameCol]).trim() === String(payload.name).trim()) {
      sheet.getRange(i + 2, lineIdCol + 1).setValue(payload.lineId);
      if (photoCol !== -1 && payload.pictureUrl) {
        sheet.getRange(i + 2, photoCol + 1).setValue(payload.pictureUrl);
      }
      return jsonResponse({ success: true, message: '已成功更新 LINE 資訊與大頭照' });
    }
  }

  return jsonResponse({ success: false, message: '找不到符合姓名的義工' });
}

/**
 * 同步排班結果到 Google Sheets
 * 根據名稱找尋 Sheet，如果沒有就建立一個新的。有就清空覆蓋。
 */
function handleSyncSchedule(payload) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(payload.sheetName);
  
  if (!sheet) {
    sheet = ss.insertSheet(payload.sheetName);
  } else {
    sheet.clear();
  }
  
  // payload.data 是一個 2D Array
  if (payload.data && payload.data.length > 0) {
    sheet.getRange(1, 1, payload.data.length, payload.data[0].length).setValues(payload.data);
  }
  
  return jsonResponse({ success: true, message: '同步成功' });
}

/**
 * 從 Google Sheets 讀取指定工作表的排班資料
 * payload.sheetName: 要讀取的工作表名稱
 */
function handleFetchSchedule(payload) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(payload.sheetName);
  
  if (!sheet) {
    return jsonResponse({ success: false, message: '找不到工作表: ' + payload.sheetName, data: null });
  }
  
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  
  if (lastRow === 0 || lastCol === 0) {
    return jsonResponse({ success: false, message: '工作表為空', data: null });
  }
  
  var data = sheet.getRange(1, 1, lastRow, lastCol).getDisplayValues();
  
  return jsonResponse({ success: true, message: '讀取成功', data: data });
}
/**
 * 處理義工填報表單提交
 * 將資料寫入「表單回覆」工作表
 */
function handleSubmitForm(payload) {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheetName = '表單回覆';
  var sheet = ss.getSheetByName(sheetName);
  
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }
  
  var formData = payload.data;
  if (!formData) {
    return jsonResponse({ success: false, message: '沒有收到表單資料' });
  }
  
  // 取得所有欄位 key
  var keys = Object.keys(formData);
  
  // 若工作表是空的，先寫入標題列
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(keys);
  } else {
    // 確保標題列包含所有欄位（新欄位會自動擴充）
    var existingHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(function(h) { return String(h).trim(); });
    var newKeys = keys.filter(function(k) { return existingHeaders.indexOf(k) === -1; });
    if (newKeys.length > 0) {
      var startCol = sheet.getLastColumn() + 1;
      for (var i = 0; i < newKeys.length; i++) {
        sheet.getRange(1, startCol + i).setValue(newKeys[i]);
      }
    }
    // 重新讀取標題列
    keys = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(function(h) { return String(h).trim(); });
  }
  
  // 依標題列順序組裝新行
  var newRow = keys.map(function(k) { return formData[k] || ''; });
  sheet.appendRow(newRow);
  
  return jsonResponse({ success: true, message: '表單已成功提交' });
}

/**
 * 讀取「表單回覆」工作表所有資料
 */
function handleFetchFormResponses() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName('表單回覆');
  
  if (!sheet || sheet.getLastRow() <= 1) {
    return jsonResponse({ success: true, message: '目前沒有表單資料', data: [] });
  }
  
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function(h) { return String(h).trim(); });
  var rows = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  
  var result = [];
  for (var i = 0; i < rows.length; i++) {
    var obj = {};
    for (var j = 0; j < headers.length; j++) {
      if (headers[j]) {
        obj[headers[j]] = rows[i][j] !== undefined && rows[i][j] !== null ? String(rows[i][j]) : '';
      }
    }
    result.push(obj);
  }
  
  return jsonResponse({ success: true, message: '讀取成功', data: result });
}

/**
 * 清空「表單回覆」工作表（保留標題列）
 */
function handleClearFormResponses() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName('表單回覆');
  
  if (!sheet) {
    return jsonResponse({ success: true, message: '工作表不存在，無需清空' });
  }
  
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.deleteRows(2, lastRow - 1);
  }
  
  return jsonResponse({ success: true, message: '已成功清空所有表單回覆' });
}

/**
 * 回傳 JSON 格式的回應（含 CORS 標頭）
 */
function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
