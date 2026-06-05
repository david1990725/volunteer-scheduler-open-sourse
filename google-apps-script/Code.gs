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

function getVolunteerSheet(ss) {
  return ss.getSheetByName('Sheet1') || ss.getSheetByName('工作表1') || ss.getSheetByName('義工名單') || ss.getSheets()[0];
}

/**
 * 透過 gid 取得表單回覆紀錄工作表
 */
function getFormResponsesSheet(ss, team) {
  var gid = 120152057; // 預設影視團隊
  var defaultName = '影視表單回覆紀錄';
  
  if (team === '燈光團隊') {
    gid = 1936818818;
    defaultName = '燈光表單回覆紀錄';
  } else if (team === '音控團隊') {
    gid = 205317315;
    defaultName = '音控表單回覆紀錄';
  }

  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    if (sheets[i].getSheetId() == gid) {
      return sheets[i];
    }
  }
  return ss.getSheetByName(defaultName);
}

/**
 * 處理 POST 請求（從前端寫入資料）
 */
function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    
    if (payload.action === 'addVolunteer') {
      return handleAddVolunteer(payload);
    } else if (payload.action === 'fetchVolunteers') {
      return handleFetchVolunteers();
    } else if (payload.action === 'updateLineId') {
      return handleUpdateLineId(payload);
    } else if (payload.action === 'updateSkills') {
      return handleUpdateSkills(payload);
    } else if (payload.action === 'syncSchedule') {
      return handleSyncSchedule(payload);
    } else if (payload.action === 'fetchSchedule') {
      return handleFetchSchedule(payload);
    } else if (payload.action === 'updateUser') {
      return handleUpdateUser(payload);
    } else if (payload.action === 'submitForm') {
      return handleSubmitForm(payload);
    } else if (payload.action === 'fetchFormResponses') {
      return handleFetchFormResponses(payload);
    } else if (payload.action === 'clearFormResponses') {
      return handleClearFormResponses(payload);
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
 * 讀取義工名冊工作表所有資料
 */
function handleFetchVolunteers() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = getVolunteerSheet(ss);
  if (!sheet || sheet.getLastRow() <= 1) {
    return jsonResponse({ success: true, message: '目前沒有義工資料', data: [] });
  }

  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function(h) { return String(h).trim(); });
  const rows = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();

  const result = rows.map(function(row) {
    const obj = {};
    headers.forEach(function(header, index) {
      if (header) {
        obj[header] = row[index] !== undefined && row[index] !== null ? String(row[index]) : '';
      }
    });
    return obj;
  });

  return jsonResponse({ success: true, message: '讀取成功', data: result });
}

/**
 * 新增義工到試算表
 * 會先檢查 user_id 是否已存在，避免重複新增
 */
function handleAddVolunteer(payload) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = getVolunteerSheet(ss);
  
  if (!sheet) return jsonResponse({ success: false, message: '找不到工作表' });
  
  let lastCol = sheet.getLastColumn();
  if (lastCol === 0) return jsonResponse({ success: false, message: '工作表為空' });

  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h).trim());
  const nameCol = headers.indexOf('Name');
  let lineIdCol = headers.indexOf('User_ID');
  const roleCol = headers.indexOf('User_Level');
  let photoCol = headers.indexOf('Avatar');
  
  if (nameCol === -1) return jsonResponse({ success: false, message: '找不到「Name」欄位' });
  
  if (lineIdCol === -1) {
    lastCol += 1;
    sheet.getRange(1, lastCol).setValue('User_ID');
    lineIdCol = lastCol - 1;
  }

  if (photoCol === -1) {
    lastCol += 1;
    sheet.getRange(1, lastCol).setValue('Avatar');
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
  const sheet = getVolunteerSheet(ss);
  if (!sheet) return jsonResponse({ success: false, message: '找不到工作表' });

  let lastCol = sheet.getLastColumn();
  const lastRow = sheet.getLastRow();
  if (lastCol === 0 || lastRow <= 1) return jsonResponse({ success: false, message: '無資料可更新' });

  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h).trim());
  const nameCol = headers.indexOf('Name');
  let lineIdCol = headers.indexOf('User_ID');
  let photoCol = headers.indexOf('Avatar');

  if (nameCol === -1) return jsonResponse({ success: false, message: '找不到「Name」欄位' });
  
  // 如果沒有 User_ID 欄位，就建一個
  if (lineIdCol === -1) {
    lastCol += 1;
    sheet.getRange(1, lastCol).setValue('User_ID');
    lineIdCol = lastCol - 1;
  }
  if (photoCol === -1) {
    lastCol += 1;
    sheet.getRange(1, lastCol).setValue('Avatar');
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
 * 更新義工技能數值
 */
function handleUpdateSkills(payload) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = getVolunteerSheet(ss);
  if (!sheet) return jsonResponse({ success: false, message: '找不到工作表' });

  let lastCol = sheet.getLastColumn();
  const lastRow = sheet.getLastRow();
  if (lastCol === 0 || lastRow <= 1) return jsonResponse({ success: false, message: '無資料可更新' });

  const headerRange = sheet.getRange(1, 1, 1, lastCol);
  const headers = headerRange.getValues()[0].map(function(h) { return String(h).trim(); });
  const nameCol = headers.indexOf('Name');
  if (nameCol === -1) return jsonResponse({ success: false, message: '找不到「Name」欄位' });

  const skillColumnNames = {
    '導播': 'D_Skill',
    'AD': 'AD_Skill',
    '平面': 'Photo_Skill',
    'CAM1': 'Cam1_Skill',
    'CAM2': 'Cam2_Skill',
    'CAM3': 'Cam3_Skill',
    'CAM4': 'Cam4_Skill'
  };

  const skills = payload.skills || {};
  const skillColumns = {};

  Object.keys(skills).forEach(function(skillName) {
    const headerName = skillColumnNames[skillName] || skillName + '_Skill';
    let colIndex = headers.indexOf(headerName);
    if (colIndex === -1) {
      lastCol += 1;
      sheet.getRange(1, lastCol).setValue(headerName);
      headers.push(headerName);
      colIndex = lastCol - 1;
    }
    skillColumns[skillName] = colIndex;
  });
  SpreadsheetApp.flush();

  const names = sheet.getRange(2, nameCol + 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < names.length; i++) {
    if (String(names[i][0]).trim() === String(payload.name).trim()) {
      Object.keys(skills).forEach(function(skillName) {
        const colIndex = skillColumns[skillName];
        const value = Math.max(0, Math.min(10, Number(skills[skillName]) || 0));
        sheet.getRange(i + 2, colIndex + 1).setValue(value);
      });
      return jsonResponse({ success: true, message: '技能更新成功' });
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
  var team = payload.team || '影視團隊';
  var sheet = getFormResponsesSheet(ss, team);
  
  if (!sheet) {
    sheet = ss.insertSheet(team + '表單回覆紀錄');
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
function handleFetchFormResponses(payload) {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var team = payload && payload.team ? payload.team : '影視團隊';
  var sheet = getFormResponsesSheet(ss, team);
  
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
function handleClearFormResponses(payload) {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var team = payload && payload.team ? payload.team : '影視團隊';
  var sheet = getFormResponsesSheet(ss, team);
  
  if (!sheet) {
    return jsonResponse({ success: true, message: '工作表不存在，無需清空' });
  }
  
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.deleteRows(2, lastRow - 1);
  }
  SpreadsheetApp.flush();
  return jsonResponse({ success: true, message: '已清空表單回覆紀錄' });
}

/**
 * 更新使用者基本資料 (Job_Title, Name, User_Level, Avatar)
 */
function handleUpdateUser(payload) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = getVolunteerSheet(ss);
  if (!sheet) return jsonResponse({ success: false, message: '找不到工作表' });

  const lastCol = sheet.getLastColumn();
  const lastRow = sheet.getLastRow();
  if (lastCol === 0 || lastRow <= 1) return jsonResponse({ success: false, message: '無資料可更新' });

  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function(h) { return String(h).trim(); });
  const nameCol = headers.indexOf('Name');
  if (nameCol === -1) return jsonResponse({ success: false, message: '找不到「Name」欄位' });

  let jobTitleCol = headers.indexOf('Job_Title');
  let userLevelCol = headers.indexOf('User_Level');
  let avatarCol = headers.indexOf('Avatar');
  
  if (jobTitleCol === -1 || userLevelCol === -1 || avatarCol === -1) {
    return jsonResponse({ success: false, message: '試算表缺少部分必要欄位 (Job_Title, User_Level, Avatar)' });
  }

  const rows = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  const data = payload.data || {};
  const oldName = data.oldName;
  const newName = data.newName;
  const jobTitle = data.jobTitle;
  const userLevel = data.userLevel;
  const avatar = data.avatar;

  if (!oldName) return jsonResponse({ success: false, message: '缺少原姓名(oldName)' });

  let targetRowIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    const rowName = String(rows[i][nameCol] || '').trim();
    if (rowName === String(oldName).trim()) {
      targetRowIdx = i + 2; 
      break;
    }
  }

  if (targetRowIdx === -1) {
    return jsonResponse({ success: false, message: '找不到該名義工' });
  }

  sheet.getRange(targetRowIdx, nameCol + 1).setValue(newName || '');
  sheet.getRange(targetRowIdx, jobTitleCol + 1).setValue(jobTitle || '');
  sheet.getRange(targetRowIdx, userLevelCol + 1).setValue(userLevel || '');
  sheet.getRange(targetRowIdx, avatarCol + 1).setValue(avatar || '');

  SpreadsheetApp.flush();
  return jsonResponse({ success: true, message: '使用者資料更新成功' });
}

/**
 * 回傳 JSON 格式的回應（含 CORS 標頭）
 */
function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
