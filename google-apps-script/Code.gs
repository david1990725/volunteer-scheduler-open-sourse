// =============================================================================
// Google Apps Script — 義工排班系統後端 API & LINE 官方帳號 Webhook 引擎
// =============================================================================
//
// 📌 功能特色：
// 1. LINE Webhook 雙向互動 (支援 1 對 1 與群組對話、即時查詢)
// 2. 每週六 16:00 自動推播週日服事提醒 (個別同工通知 vs 群組全員名冊)
// 3. 每週期結束月 15 號 & 20 號自動推播服事意願表單催填
// 4. 週一~週六動態浮現空缺補位 Quick Reply (即時更新班表 + 寄信通知管理員)
// 5. 每日生日自動比對與精美 Birthday Flex Message 祝賀
// 6. 前端 React 排班系統資料同步與 Google Sheets 備份
//
// 🔒 資安環境變數設定（請於 Google Apps Script 專案設定 ->「指令碼屬性」設定）：
// - SPREADSHEET_ID: 試算表 ID
// - LINE_CHANNEL_ACCESS_TOKEN: LINE 官方帳號 Channel Access Token
// - LINE_CHANNEL_SECRET: LINE Channel Secret (用於 Webhook 簽名防偽驗證)
// - ADMIN_EMAIL: 管理員通知信箱
// - SYSTEM_URL: 系統前端網址
// - LIFF_URL: LIFF 網址
//
// 🚀 部署步驟：
// 1. 開啟 Google Apps Script：https://script.google.com
// 2. 建立新專案，貼上此程式碼
// 3. 專案設定 -> 指令碼屬性 -> 新增上述環境變數
// 4. 部署 → 新增部署 → 類型選「網頁應用程式」 (執行身分：我，誰可以存取：任何人)
// 5. 取得 Webhook 網址並填入 LINE Developers Console 的 Webhook URL
// 6. 在 GAS 編輯器中執行一次「setupAllTriggers」以自動建立所有定時推播排程！
// =============================================================================

// --- 資安環境變數讀取 ---------------------------------------------------------
function getConfig(key, defaultValue) {
  var prop = PropertiesService.getScriptProperties().getProperty(key);
  return (prop !== null && prop !== undefined && prop !== '') ? prop : (defaultValue || '');
}

/** 取得試算表實例 (優先從環境變數 SPREADSHEET_ID 讀取，亦相容綁定型試算表) */
function getSpreadsheet() {
  var sheetId = getConfig('SPREADSHEET_ID', '');
  if (sheetId) {
    return SpreadsheetApp.openById(sheetId);
  }
  try {
    var active = SpreadsheetApp.getActiveSpreadsheet();
    if (active) return active;
  } catch (e) {}
  throw new Error('未設定 SPREADSHEET_ID 環境變數。請在 GAS 專案設定 ->「指令碼屬性」中新增 SPREADSHEET_ID');
}

// 系統核心設定常數 (全數由環境變數動態注入)
function getLineAccessToken() { return getConfig('LINE_CHANNEL_ACCESS_TOKEN', ''); }
function getLineChannelSecret() { return getConfig('LINE_CHANNEL_SECRET', ''); }
function getAdminEmail() {
  var email = getConfig('ADMIN_EMAIL', '');
  if (!email) {
    try { email = Session.getActiveUser().getEmail(); } catch (e) {}
  }
  return email;
}
function getSystemUrl() { return getConfig('SYSTEM_URL', ''); }
function getLiffUrl() { return getConfig('LIFF_URL', ''); }

// =============================================================================
// 1. Sheet 操作與輔助函數
// =============================================================================

function getVolunteerSheet(ss) {
  return ss.getSheetByName('Sheet1') || ss.getSheetByName('工作表1') || ss.getSheetByName('義工名單') || ss.getSheets()[0];
}

function getGroupsSheet(ss) {
  var sheet = ss.getSheetByName('LINE_Groups');
  if (!sheet) {
    sheet = ss.insertSheet('LINE_Groups');
    sheet.appendRow(['GroupID', 'Type', 'JoinedAt', 'Status']);
  }
  return sheet;
}

function getFormResponsesSheet(ss, team) {
  var defaultName = '影視表單回覆紀錄';
  if (team === '燈光團隊') {
    defaultName = '燈光表單回覆紀錄';
  } else if (team === '音控團隊') {
    defaultName = '音控表單回覆紀錄';
  } else if (team === '舞監團隊') {
    defaultName = '舞監表單回覆紀錄';
  }

  // 優先依自訂 GID (若有在指令碼屬性設定)
  var customGid = getConfig('GID_' + team, '');
  if (customGid) {
    var sheets = ss.getSheets();
    for (var i = 0; i < sheets.length; i++) {
      if (String(sheets[i].getSheetId()) === String(customGid)) {
        return sheets[i];
      }
    }
  }

  return ss.getSheetByName(defaultName) || ss.getSheetByName(team + '表單回覆') || ss.getSheetByName('表單回覆');
}

// =============================================================================
// 2. HTTP 請求分流入口 (doPost & doGet)
// =============================================================================

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse({ success: false, message: '無效的請求內容' });
    }

    const payload = JSON.parse(e.postData.contents);

    // 辨識是否為 LINE Webhook 事件
    if (payload.events && Array.isArray(payload.events)) {
      return handleLineWebhook(payload, e);
    }

    // 前端 React 應用程式 API 操作
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
    } else if (payload.action === 'fetchAllSchedules') {
      return handleFetchAllSchedules();
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
    console.error('[doPost Error]:', err);
    return jsonResponse({ success: false, message: err.toString() });
  }
}

function doGet(e) {
  return jsonResponse({
    success: true,
    message: '義工排班系統後端與 LINE 官方帳號 Webhook 服務運行中 (資安強化版本)',
    timestamp: new Date().toISOString()
  });
}

// =============================================================================
// 3. LINE Webhook 處理核心 (Event Router & 簽名驗證)
// =============================================================================

function handleLineWebhook(payload, e) {
  // 🔒 資安驗證：驗證 LINE Webhook 簽名 (HMAC-SHA256)
  if (!verifyLineSignature(e)) {
    console.warn('[Security Warning]: LINE Webhook 簽名驗證未通過');
    return ContentService.createTextOutput('Invalid Signature').setMimeType(ContentService.MimeType.TEXT);
  }

  var events = payload.events;
  for (var i = 0; i < events.length; i++) {
    var event = events[i];
    try {
      if (event.type === 'message' && event.message.type === 'text') {
        handleLineTextMessage(event);
      } else if (event.type === 'postback') {
        handleLinePostback(event);
      } else if (event.type === 'join' || event.type === 'memberJoined') {
        handleLineJoinGroup(event);
      } else if (event.type === 'leave' || event.type === 'memberLeft') {
        handleLineLeaveGroup(event);
      } else if (event.type === 'follow') {
        handleLineFollow(event);
      }
    } catch (eventErr) {
      console.error('[Event Error]:', eventErr);
    }
  }
  return ContentService.createTextOutput('OK').setMimeType(ContentService.MimeType.TEXT);
}

/** 🔒 簽名驗證邏輯 */
function verifyLineSignature(e) {
  var channelSecret = getLineChannelSecret();
  if (!channelSecret) return true; // 若尚未設定 Secret 則暫時放行，方便初始連線測試

  var signature = e && e.headers && (e.headers['X-Line-Signature'] || e.headers['x-line-signature']);
  if (!signature) return false;

  var body = e.postData.contents;
  var hash = Utilities.computeHmacSha256Signature(body, channelSecret);
  var expectedSignature = Utilities.base64Encode(hash);
  return signature === expectedSignature;
}

/** 處理加入好友 (follow) */
function handleLineFollow(event) {
  var welcomeText = "平安！歡迎加入【義工排班官方小幫手】🎉\n\n" +
    "本帳號將提供：\n" +
    "1. 📅 每週六下午 16:00 週日服事貼心提醒\n" +
    "2. 📝 每期服事意願表單催填通知\n" +
    "3. ⚡ 即時空缺補位與班表查詢\n" +
    "4. 🎂 專屬生日祝福\n\n" +
    "請點擊下方連結綁定您的服事帳號或查看排班系統：\n" + getSystemUrl();
  
  sendLineReply(event.replyToken, [{ type: 'text', text: welcomeText }]);
}

/** 處理官方帳號加入群組 (join) */
function handleLineJoinGroup(event) {
  var groupId = event.source.groupId || event.source.roomId;
  if (groupId) {
    saveGroupStatus(groupId, event.source.type || 'group', 'active');
  }

  var groupWelcome = "平安！感謝邀請【義工排班官方小幫手】加入群組 🤝\n\n" +
    "小幫手將會在：\n" +
    "⏰ 每週六下午 16:00 自動公佈【本週日服事同工完整名單】\n" +
    "📢 週期意願表單開放 (15號) 與截止 (20號) 時提醒大家填報！\n\n" +
    "隨時輸入「本週服事」即可快速查詢本週服事同工名單！";

  sendLineReply(event.replyToken, [{ type: 'text', text: groupWelcome }]);
}

/** 處理官方帳號離開群組 (leave) */
function handleLineLeaveGroup(event) {
  var groupId = event.source.groupId || event.source.roomId;
  if (groupId) {
    saveGroupStatus(groupId, event.source.type || 'group', 'left');
  }
}

/** 記錄或更新群組狀態 */
function saveGroupStatus(groupId, type, status) {
  try {
    var ss = getSpreadsheet();
    var sheet = getGroupsSheet(ss);
    var data = sheet.getDataRange().getValues();
    
    var foundRow = -1;
    for (var i = 1; i < data.length; i++) {
      if (data[i][0] === groupId) {
        foundRow = i + 1;
        break;
      }
    }

    if (foundRow > 0) {
      sheet.getRange(foundRow, 4).setValue(status);
    } else {
      sheet.appendRow([groupId, type, new Date().toISOString(), status]);
    }
  } catch (err) {
    console.error('[saveGroupStatus Error]:', err);
  }
}

/** 取得所有活躍中的群組 ID */
function getActiveGroupIds() {
  try {
    var ss = getSpreadsheet();
    var sheet = getGroupsSheet(ss);
    var data = sheet.getDataRange().getValues();
    var activeIds = [];
    for (var i = 1; i < data.length; i++) {
      if (data[i][3] === 'active' && data[i][0]) {
        activeIds.push(data[i][0]);
      }
    }
    return activeIds;
  } catch (err) {
    console.error('[getActiveGroupIds Error]:', err);
    return [];
  }
}

// =============================================================================
// 4. 文字訊息互動與即時空缺補位 (Quick Reply & Message Handler)
// =============================================================================

function handleLineTextMessage(event) {
  var userText = (event.message.text || '').trim();
  var isGroup = event.source.type === 'group' || event.source.type === 'room';
  var userId = event.source.userId;

  // 1. 群組訊息處理
  if (isGroup) {
    if (userText.indexOf('本週服事') !== -1 || userText.indexOf('查班表') !== -1) {
      var nextSun = getNextSundayDate();
      var sundayRoster = getSundayFullRoster(nextSun);
      sendLineReply(event.replyToken, [sundayRoster]);
      return;
    }
    if (userText.indexOf('填表') !== -1 || userText.indexOf('意願表') !== -1) {
      var formText = "📝【服事意願表單連結】\n請點擊下方連結進入系統完成填報：\n" + getSystemUrl();
      sendLineReply(event.replyToken, [{ type: 'text', text: formText }]);
      return;
    }
    return; // 群組中若非特定指令則保持安靜
  }

  // 2. 個人 1-on-1 對話處理
  var volunteer = findVolunteerByLineId(userId);
  var nextSunDate = getNextSundayDate();
  var nextSunStr = formatDateMMDD(nextSunDate);

  // 關鍵字：本週服事 / 我的服事
  if (userText.indexOf('本週服事') !== -1 || userText.indexOf('我的服事') !== -1) {
    if (volunteer) {
      var myAssignment = getVolunteerSundayAssignment(volunteer.name, nextSunDate);
      if (myAssignment) {
        var replyMsg = "【本週日服事安排 🎯】\n" +
          "同工 " + volunteer.name + " 平安！\n" +
          "📅 日期：" + nextSunStr + " (週日)\n" +
          "📍 地點：" + myAssignment.location + "\n" +
          "🎯 職位：" + myAssignment.role + "\n\n" +
          "請準時出席並預備心服事，願主賜福！";
        sendLineReply(event.replyToken, [{ type: 'text', text: replyMsg }]);
      } else {
        var noShiftMsg = "【本週服事通知】\n" +
          "同工 " + volunteer.name + " 平安，本週日 (" + nextSunStr + ") 您目前沒有排定的服事。\n" +
          "感謝您的擺上與代禱！";
        
        // 檢查是否有同團隊空缺可補位
        var vacantSlots = getTeamVacantSlots(volunteer, nextSunDate);
        if (vacantSlots.length > 0) {
          noShiftMsg += "\n\n💡 目前所屬團隊有需要支援的空缺，若您可以幫忙請點選下方按鈕：";
          sendLineReplyWithQuickReply(event.replyToken, noShiftMsg, vacantSlots, volunteer.name);
        } else {
          sendLineReply(event.replyToken, [{ type: 'text', text: noShiftMsg }]);
        }
      }
    } else {
      sendLineReply(event.replyToken, [{
        type: 'text',
        text: "平安！目前系統尚未綁定您的 LINE 帳號。\n請點擊系統連結登入並完成綁定：\n" + getSystemUrl()
      }]);
    }
    return;
  }

  // 關鍵字：填表 / 意願
  if (userText.indexOf('填表') !== -1 || userText.indexOf('意願') !== -1) {
    sendLineReply(event.replyToken, [{
      type: 'text',
      text: "📝【服事意願填報】\n請點擊下方連結進入系統完成填報：\n" + getSystemUrl()
    }]);
    return;
  }

  // 預設回應 (週一~週六隨時浮現空缺補位 Quick Reply)
  var defaultMsg = "平安" + (volunteer ? "，" + volunteer.name + " 同工" : "") + "！我是義工排班小幫手 🤖\n\n" +
    "您可以輸入：\n" +
    "👉「本週服事」：查詢這週日服事安排\n" +
    "👉「填表」：取得服事意願表單連結\n" +
    "👉「排班系統」：" + getSystemUrl();

  // 若為週一至週六，且同工團隊有空缺，下方即刻浮現 Quick Reply！
  var now = new Date();
  var dayOfWeek = now.getDay(); // 0: Sun, 1~6: Mon~Sat
  if (volunteer && dayOfWeek >= 1 && dayOfWeek <= 6) {
    var vacantSlots = getTeamVacantSlots(volunteer, nextSunDate);
    if (vacantSlots.length > 0) {
      defaultMsg += "\n\n📢【支援募集】本週日 (" + nextSunStr + ") 所屬團隊尚有職位需要同工支援，若您有空歡迎點擊下方按鈕補位！";
      sendLineReplyWithQuickReply(event.replyToken, defaultMsg, vacantSlots, volunteer.name);
      return;
    }
  }

  sendLineReply(event.replyToken, [{ type: 'text', text: defaultMsg }]);
}

/** 傳送帶有 Quick Reply (MM/DD 可以幫忙！) 的訊息 */
function sendLineReplyWithQuickReply(replyToken, text, vacantSlots, volunteerName) {
  var quickReplyItems = [];
  
  for (var i = 0; i < Math.min(vacantSlots.length, 10); i++) {
    var slot = vacantSlots[i];
    var label = slot.date + " 可以幫忙！";
    var displayText = slot.date + " 我可以幫忙補位 " + slot.location + " " + slot.role + "！";
    var postbackData = "action=fill_slot&date=" + encodeURIComponent(slot.date) +
      "&location=" + encodeURIComponent(slot.location) +
      "&role=" + encodeURIComponent(slot.role) +
      "&team=" + encodeURIComponent(slot.team) +
      "&sheetName=" + encodeURIComponent(slot.sheetName) +
      "&rowIndex=" + slot.rowIndex +
      "&colIndex=" + slot.colIndex +
      "&user=" + encodeURIComponent(volunteerName);

    quickReplyItems.push({
      type: 'action',
      action: {
        type: 'postback',
        label: label.substring(0, 20),
        data: postbackData,
        displayText: displayText
      }
    });
  }

  var messageObj = {
    type: 'text',
    text: text,
    quickReply: {
      items: quickReplyItems
    }
  };

  sendLineReply(replyToken, [messageObj]);
}

/** 處理 Postback 事件 (同工點擊補位按鈕) */
function handleLinePostback(event) {
  var postbackData = event.postback.data;
  var params = parseQueryString(postbackData);

  if (params.action === 'fill_slot') {
    var date = decodeURIComponent(params.date || '');
    var location = decodeURIComponent(params.location || '');
    var role = decodeURIComponent(params.role || '');
    var team = decodeURIComponent(params.team || '');
    var user = decodeURIComponent(params.user || '');
    var sheetName = decodeURIComponent(params.sheetName || '');
    var rowIndex = parseInt(params.rowIndex, 10);
    var colIndex = parseInt(params.colIndex, 10);

    // 舊版試算表沒有可驗證的技能與身分資料；網路導播一律交由新版補位流程處理。
    if (role === '網路導播') {
      sendLineReply(event.replyToken, [{ type: 'text', text: '⚠️ 網路導播請使用新版排班系統補位。' }]);
      return;
    }

    // 1. 即時更新班表
    var updateResult = applySlotFillToSchedule(sheetName, rowIndex, colIndex, user);

    if (updateResult.success) {
      // 回覆同工確認訊息
      var confirmMsg = "🎉 感謝您的熱心擺上與及時支援！\n\n" +
        "已成功為您登記補位：\n" +
        "📅 日期：" + date + " (週日)\n" +
        "📍 地點：" + location + "\n" +
        "🎯 職位：" + role + "\n\n" +
        "線上班表已即時更新完成，願神祝福您的服事！";
      sendLineReply(event.replyToken, [{ type: 'text', text: confirmMsg }]);

      // 2. 即時發送 Email 通知給管理員
      sendAdminNotificationEmail({
        volunteer: user,
        date: date,
        location: location,
        role: role,
        team: team,
        sheetName: sheetName
      });
    } else {
      sendLineReply(event.replyToken, [{
        type: 'text',
        text: "⚠️ 補位失敗：" + updateResult.message + "\n請洽詢團隊管理員。"
      }]);
    }
  }
}

/** 即時寫入班表工作表 */
function applySlotFillToSchedule(sheetName, rowIndex, colIndex, userName) {
  try {
    var ss = getSpreadsheet();
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      return { success: false, message: '找不到對應的班表工作表' };
    }

    var cell = sheet.getRange(rowIndex + 1, colIndex + 1);
    var currentValue = String(cell.getValue() || '').trim();

    // 檢查是否已被其他人搶先補位
    if (currentValue && currentValue !== '缺' && currentValue !== '待補' && currentValue !== '未填' && currentValue !== userName) {
      return { success: false, message: '該職位已由 ' + currentValue + ' 補位囉！' };
    }

    cell.setValue(userName);
    SpreadsheetApp.flush();
    return { success: true, message: '班表更新成功' };
  } catch (err) {
    console.error('[applySlotFillToSchedule Error]:', err);
    return { success: false, message: err.toString() };
  }
}

/** 寄送管理員 Email 通知 */
function sendAdminNotificationEmail(info) {
  try {
    var adminEmail = getAdminEmail();
    if (!adminEmail) return;

    var subject = "【服事即時補位通知】" + info.volunteer + " 已登記補位 " + info.date + " " + info.location + " " + info.role;
    var htmlBody = "<div style='font-family: Arial, sans-serif; padding: 20px; line-height: 1.6; color: #333;'>" +
      "<h2 style='color: #2563eb;'>📢 義工即時補位成功通知</h2>" +
      "<p>管理員您好，</p>" +
      "<p>同工 <strong>" + info.volunteer + "</strong> 已透過 LINE 官方帳號登記補位本週日服事，系統已同步完成線上班表即時更新。</p>" +
      "<div style='background: #f1f5f9; padding: 16px; border-radius: 8px; margin: 16px 0;'>" +
      "<p style='margin: 4px 0;'><strong>📅 服事日期：</strong>" + info.date + " (週日)</p>" +
      "<p style='margin: 4px 0;'><strong>👥 所屬團隊：</strong>" + info.team + "</p>" +
      "<p style='margin: 4px 0;'><strong>📍 服事地點：</strong>" + info.location + "</p>" +
      "<p style='margin: 4px 0;'><strong>🎯 補位職位：</strong>" + info.role + "</p>" +
      "<p style='margin: 4px 0;'><strong>🕒 登記時間：</strong>" + new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }) + "</p>" +
      "</div>" +
      "<p><a href='" + getSystemUrl() + "' style='display: inline-block; padding: 10px 20px; background: #2563eb; color: #fff; text-decoration: none; border-radius: 6px;'>前往排班系統檢視</a></p>" +
      "<p style='color: #64748b; font-size: 0.85rem;'>此信件為系統自動發送，請勿直接回覆。</p>" +
      "</div>";

    MailApp.sendEmail({
      to: adminEmail,
      subject: subject,
      htmlBody: htmlBody
    });
  } catch (err) {
    console.error('[sendAdminNotificationEmail Error]:', err);
  }
}

// =============================================================================
// 5. 定時排程推播 (Triggers: 週六提醒、15/20號催填、每日生日祝賀)
// =============================================================================

/**
 * ⏰ 功能 2：每週六下午 16:00 自動推播週日服事提醒
 * - 個別通知：僅針對有服事的同工推播其「專屬職位與地點」
 * - 群組通知：彙整「本週日所有團隊服事同工完整名單」
 */
function sendSaturdayServiceReminders() {
  var nextSunDate = getNextSundayDate();
  var nextSunStr = formatDateMMDD(nextSunDate);
  var assignments = getSundayAssignments(nextSunDate);

  // 1. 個別通知 (1-on-1 Push Notification)
  for (var name in assignments.byVolunteer) {
    var item = assignments.byVolunteer[name];
    if (item.lineId) {
      var indMsg = "【主日服事提醒 🔔】\n" +
        "平安，" + name + " 同工！\n\n" +
        "提醒您明天（" + nextSunStr + " 週日）有服事安排：\n" +
        "📍 地點：" + item.location + "\n" +
        "🎯 職位：" + item.role + "\n\n" +
        "⏰ 請留意報到與彩排時間，願神大大賜福您的擺上與服事！🙏";
      sendLinePush(item.lineId, [{ type: 'text', text: indMsg }]);
    }
  }

  // 2. 群組通知 (Group Push Notification)
  var groupRosterMsg = getSundayFullRoster(nextSunDate);
  var groupIds = getActiveGroupIds();
  for (var g = 0; g < groupIds.length; g++) {
    sendLinePush(groupIds[g], [groupRosterMsg]);
  }
}

/**
 * ⏰ 功能 3 & 4：每週期月結束前 15 號 & 20 號催填服事意願表
 */
function checkAndSendCycleFormReminders() {
  var now = new Date();
  var day = now.getDate();
  var month = now.getMonth() + 1;

  // 雙數月 (2, 4, 6, 8, 10, 12) 為週期月結尾
  var isEvenMonth = month % 2 === 0;
  if (!isEvenMonth) return;

  var nextM1 = month === 12 ? 1 : month + 1;
  var nextM2 = month === 12 ? 2 : month + 2;
  var nextCycleLabel = nextM1 + "～" + nextM2 + "月";

  if (day === 15) {
    // 15 號：開放填寫通知
    var msg15 = "🔔【新一期服事意願填報開始】\n" +
      "各位同工平安！\n\n" +
      "【" + nextCycleLabel + "】的服事意願表單現已開放填寫。\n" +
      "請各位同工把握時間，於 20 號前點擊下方連結完成填報：\n\n" +
      "👉 填報連結：" + getSystemUrl() + "\n\n" +
      "感謝您每週的忠心付出與擺上！🙏";

    broadcastToAllVolunteersAndGroups(msg15);
  } else if (day === 20) {
    // 20 號：截止二次提醒
    var msg20 = "⚠️【即將截止！服事意願最後催填提醒】\n" +
      "各位同工平安！\n\n" +
      "【" + nextCycleLabel + "】服事意願表單即將截止。\n" +
      "尚未填寫的夥伴請盡速點擊下方連結完成意願填報：\n\n" +
      "👉 填報連結：" + getSystemUrl() + "\n\n" +
      "若有調度需求請儘早告知團隊同工，謝謝大家！🙌";

    broadcastToAllVolunteersAndGroups(msg20);
  }
}

/** 向所有已綁定 LINE 的同工及活躍群組廣播訊息 */
function broadcastToAllVolunteersAndGroups(text) {
  var ss = getSpreadsheet();
  var sheet = getVolunteerSheet(ss);
  if (sheet && sheet.getLastRow() > 1) {
    var data = sheet.getDataRange().getValues();
    var headers = data[0].map(function(h) { return String(h).trim(); });
    var lineIdCol = headers.indexOf('User_ID');
    if (lineIdCol !== -1) {
      for (var i = 1; i < data.length; i++) {
        var lineId = String(data[i][lineIdCol] || '').trim();
        if (lineId && lineId.startsWith('U')) {
          sendLinePush(lineId, [{ type: 'text', text: text }]);
        }
      }
    }
  }

  var groupIds = getActiveGroupIds();
  for (var g = 0; g < groupIds.length; g++) {
    sendLinePush(groupIds[g], [{ type: 'text', text: text }]);
  }
}

/**
 * ⏰ 功能 6：每日 09:00 生日祝賀 Flex Message
 */
function sendDailyBirthdayGreetings() {
  var now = new Date();
  var currentMonth = now.getMonth() + 1;
  var currentDay = now.getDate();

  var ss = getSpreadsheet();
  var sheet = getVolunteerSheet(ss);
  if (!sheet || sheet.getLastRow() <= 1) return;

  var data = sheet.getDataRange().getValues();
  var headers = data[0].map(function(h) { return String(h).trim(); });
  var nameCol = headers.indexOf('Name');
  var lineIdCol = headers.indexOf('User_ID');
  var bdayCol = headers.indexOf('Birthday');
  if (bdayCol === -1) bdayCol = headers.indexOf('生日');

  if (nameCol === -1 || bdayCol === -1) return;

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var name = String(row[nameCol] || '').trim();
    var lineId = lineIdCol !== -1 ? String(row[lineIdCol] || '').trim() : '';
    var bdayStr = String(row[bdayCol] || '').trim();

    if (!name || !bdayStr || !lineId) continue;

    if (isBirthdayToday(bdayStr, currentMonth, currentDay)) {
      var flexMsg = createBirthdayFlexMessage(name);
      sendLinePush(lineId, [flexMsg]);
      console.log('[Birthday Sent]: 已向 ' + name + ' 發送生日祝福 Flex Message');
    }
  }
}

/** 比對日期字串是否為今日生日 */
function isBirthdayToday(bdayStr, currentMonth, currentDay) {
  var parts = bdayStr.split(/[-/]/);
  var m = 0;
  var d = 0;
  if (parts.length === 3) {
    m = parseInt(parts[1], 10);
    d = parseInt(parts[2], 10);
  } else if (parts.length === 2) {
    m = parseInt(parts[0], 10);
    d = parseInt(parts[1], 10);
  }
  return m === currentMonth && d === currentDay;
}

/** 建立精美 Birthday Flex Message */
function createBirthdayFlexMessage(name) {
  return {
    type: "flex",
    altText: "🎂 " + name + "，祝您生日快樂！願上帝大大賜福您！",
    contents: {
      type: "bubble",
      size: "giga",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: "#FBBF24",
        paddingAll: "20px",
        contents: [
          {
            type: "text",
            text: "🎉 HAPPY BIRTHDAY 🎂",
            weight: "bold",
            color: "#FFFFFF",
            size: "md",
            letterSpacing: "2px"
          },
          {
            type: "text",
            text: "親愛的 " + name + " 同工",
            weight: "bold",
            color: "#FFFFFF",
            size: "xxl",
            margin: "md"
          }
        ]
      },
      hero: {
        type: "image",
        url: "https://images.unsplash.com/photo-1513151233558-d860c5398176?w=800&auto=format&fit=crop&q=80",
        size: "full",
        aspectRatio: "20:9",
        aspectMode: "cover"
      },
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        paddingAll: "20px",
        backgroundColor: "#1E293B",
        contents: [
          {
            type: "text",
            text: "願耶和華賜福給你，保護你；\n願耶和華使祂的臉光照你，賜恩給你；\n願耶和華向你仰臉，賜你平安。",
            wrap: true,
            color: "#E2E8F0",
            size: "sm",
            style: "italic",
            lineSpacing: "6px"
          },
          {
            type: "separator",
            color: "#334155",
            margin: "lg"
          },
          {
            type: "text",
            text: "感謝您在敬拜服事中的忠心與擺上！在這特別的日子裡，願上帝加倍恩待您，使您新的一歲滿有喜樂、恩典與屬天的力量！🌟",
            wrap: true,
            color: "#94A3B8",
            size: "sm",
            margin: "lg",
            lineSpacing: "5px"
          }
        ]
      }
    }
  };

  var sysUrl = getSystemUrl();
  if (sysUrl) {
    bubble.contents.footer = {
      type: "box",
      layout: "vertical",
      backgroundColor: "#0F172A",
      paddingAll: "16px",
      contents: [
        {
          type: "button",
          style: "primary",
          color: "#F59E0B",
          action: {
            type: "uri",
            label: "進入排班系統",
            uri: sysUrl
          }
        }
      ]
    };
  }

  return bubble;
}

/** 每日例行檢查入口 (排程每日 09:00 執行) */
function dailyScheduledChecks() {
  sendDailyBirthdayGreetings();
  checkAndSendCycleFormReminders();
}

// =============================================================================
// 6. 班表與義工資料解析 Helper
// =============================================================================

function getNextSundayDate() {
  var now = new Date();
  var day = now.getDay();
  var diff = day === 0 ? 0 : 7 - day;
  var next = new Date(now);
  next.setDate(now.getDate() + diff);
  next.setHours(0, 0, 0, 0);
  return next;
}

function formatDateMMDD(d) {
  var m = String(d.getMonth() + 1);
  var day = String(d.getDate());
  return (m.length === 1 ? '0' + m : m) + '/' + (day.length === 1 ? '0' + day : day);
}

/** 尋找同工資料 */
function findVolunteerByLineId(lineId) {
  if (!lineId) return null;
  var ss = getSpreadsheet();
  var sheet = getVolunteerSheet(ss);
  if (!sheet || sheet.getLastRow() <= 1) return null;

  var data = sheet.getDataRange().getValues();
  var headers = data[0].map(function(h) { return String(h).trim(); });
  var nameCol = headers.indexOf('Name');
  var lineIdCol = headers.indexOf('User_ID');
  var jobTitleCol = headers.indexOf('Job_Title');

  if (nameCol === -1 || lineIdCol === -1) return null;

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][lineIdCol]).trim() === String(lineId).trim()) {
      var rawTitles = jobTitleCol !== -1 ? String(data[i][jobTitleCol] || '') : '';
      return {
        name: String(data[i][nameCol]).trim(),
        lineId: lineId,
        jobTitles: rawTitles.split(',').map(function(t) { return t.trim(); }).filter(Boolean)
      };
    }
  }
  return null;
}

/** 取得某週日所有服事分配 */
function getSundayAssignments(targetSunday) {
  var targetMMDD = formatDateMMDD(targetSunday);
  var ss = getSpreadsheet();
  var sheets = ss.getSheets();
  var byVolunteer = {};
  var byTeam = { '影視': [], '燈光': [], '舞監': [], '音控': [] };

  var vSheet = getVolunteerSheet(ss);
  var nameToLineId = {};
  if (vSheet && vSheet.getLastRow() > 1) {
    var vData = vSheet.getDataRange().getValues();
    var vHeaders = vData[0].map(function(h) { return String(h).trim(); });
    var nCol = vHeaders.indexOf('Name');
    var lCol = vHeaders.indexOf('User_ID');
    for (var v = 1; v < vData.length; v++) {
      var n = String(vData[v][nCol] || '').trim();
      var lid = String(vData[v][lCol] || '').trim();
      if (n) nameToLineId[n] = lid;
    }
  }

  for (var s = 0; s < sheets.length; s++) {
    var sheet = sheets[s];
    var sheetName = sheet.getName();
    if (sheetName.indexOf('表單回覆') !== -1 || sheetName === 'LINE_Groups' || sheetName === 'Sheet1') continue;

    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    if (lastRow <= 1 || lastCol <= 1) continue;

    var data = sheet.getRange(1, 1, lastRow, lastCol).getValues();
    var headerRow = data[0].map(function(h) { return String(h).trim(); });

    var dateColIndices = [];
    for (var c = 0; c < headerRow.length; c++) {
      if (headerRow[c].indexOf(targetMMDD) !== -1 || headerRow[c] === targetMMDD) {
        dateColIndices.push(c);
      }
    }

    if (dateColIndices.length === 0) continue;

    for (var r = 1; r < data.length; r++) {
      var roleName = String(data[r][0] || '').trim();
      var locationName = String(data[r][1] || '').trim();

      for (var d = 0; d < dateColIndices.length; d++) {
        var col = dateColIndices[d];
        var assigned = String(data[r][col] || '').trim();

        if (assigned && assigned !== '缺' && assigned !== '待補' && assigned !== '未填') {
          var teamKey = '影視';
          if (roleName.indexOf('燈') !== -1 || sheetName.indexOf('燈') !== -1) teamKey = '燈光';
          else if (roleName.indexOf('舞') !== -1 || sheetName.indexOf('舞') !== -1) teamKey = '舞監';
          else if (roleName.indexOf('音') !== -1 || roleName.indexOf('IN') !== -1 || roleName.indexOf('OB') !== -1 || sheetName.indexOf('音') !== -1) teamKey = '音控';

          byVolunteer[assigned] = {
            role: roleName,
            location: locationName || '大堂',
            team: teamKey,
            lineId: nameToLineId[assigned] || ''
          };

          if (!byTeam[teamKey]) byTeam[teamKey] = [];
          byTeam[teamKey].push({
            name: assigned,
            role: roleName,
            location: locationName
          });
        }
      }
    }
  }

  return { byVolunteer: byVolunteer, byTeam: byTeam };
}

/** 取得同工所屬團隊在目標週日的空缺清單 */
function getTeamVacantSlots(volunteer, targetSunday) {
  var targetMMDD = formatDateMMDD(targetSunday);
  var ss = getSpreadsheet();
  var sheets = ss.getSheets();
  var slots = [];

  var userTeams = volunteer.jobTitles || [];

  for (var s = 0; s < sheets.length; s++) {
    var sheet = sheets[s];
    var sheetName = sheet.getName();
    if (sheetName.indexOf('表單回覆') !== -1 || sheetName === 'LINE_Groups' || sheetName === 'Sheet1') continue;

    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    if (lastRow <= 1 || lastCol <= 1) continue;

    var data = sheet.getRange(1, 1, lastRow, lastCol).getValues();
    var headerRow = data[0].map(function(h) { return String(h).trim(); });

    var dateColIndices = [];
    for (var c = 0; c < headerRow.length; c++) {
      if (headerRow[c].indexOf(targetMMDD) !== -1 || headerRow[c] === targetMMDD) {
        dateColIndices.push(c);
      }
    }

    if (dateColIndices.length === 0) continue;

    for (var r = 1; r < data.length; r++) {
      var roleName = String(data[r][0] || '').trim();
      var locationName = String(data[r][1] || '').trim();

      for (var d = 0; d < dateColIndices.length; d++) {
        var col = dateColIndices[d];
        var val = String(data[r][col] || '').trim();

        if (!val || val === '缺' || val === '待補' || val === '未填') {
          var teamName = '影視團隊';
          if (roleName.indexOf('燈') !== -1 || sheetName.indexOf('燈') !== -1) teamName = '燈光團隊';
          else if (roleName.indexOf('舞') !== -1 || sheetName.indexOf('舞') !== -1) teamName = '舞監團隊';
          else if (roleName.indexOf('音') !== -1 || sheetName.indexOf('音') !== -1) teamName = '音控團隊';

          var isMatch = userTeams.some(function(t) {
            return t.indexOf(teamName.replace('團隊', '')) !== -1 ||
                   teamName.indexOf(t.replace('團隊', '')) !== -1 ||
                   t === 'admin' || t === 'video';
          });

          if (isMatch) {
            slots.push({
              date: targetMMDD,
              location: locationName || '主堂',
              role: roleName,
              team: teamName,
              sheetName: sheetName,
              rowIndex: r,
              colIndex: col
            });
          }
        }
      }
    }
  }

  return slots;
}

/** 取得某同工在週日的服事分配 */
function getVolunteerSundayAssignment(volunteerName, targetSunday) {
  var assignments = getSundayAssignments(targetSunday);
  return assignments.byVolunteer[volunteerName] || null;
}

/** 產生週日全員服事名單格式化訊息 (用於群組推播) */
function getSundayFullRoster(targetSunday) {
  var targetMMDD = formatDateMMDD(targetSunday);
  var assignments = getSundayAssignments(targetSunday);
  var byTeam = assignments.byTeam;

  var text = "📅【本週日 (" + targetMMDD + ") 服事同工名單】\n\n";
  var emojis = { '影視': '🎥', '燈光': '💡', '舞監': '🎭', '音控': '🔊' };
  var hasAny = false;

  for (var team in byTeam) {
    var list = byTeam[team];
    if (list && list.length > 0) {
      hasAny = true;
      text += (emojis[team] || '👥') + " " + team + "團隊：\n";
      for (var i = 0; i < list.length; i++) {
        var item = list[i];
        text += " • " + item.role + (item.location ? " (" + item.location + ")" : "") + "：" + item.name + "\n";
      }
      text += "\n";
    }
  }

  if (!hasAny) {
    text += "目前本週日尚無排班資料或正在排班中。\n\n";
  }

  text += "🙏 感謝各位同工的擺上與付出，願主加倍賜福！\n👉 完整班表：" + getSystemUrl();
  return { type: 'text', text: text };
}

// =============================================================================
// 7. LINE Messaging API 底層呼叫 (Push & Reply)
// =============================================================================

function sendLinePush(to, messages) {
  var token = getLineAccessToken();
  if (!token || !to) return;
  try {
    var url = 'https://api.line.me/v2/bot/message/push';
    UrlFetchApp.fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
      },
      payload: JSON.stringify({
        to: to,
        messages: messages
      }),
      muteHttpExceptions: true
    });
  } catch (err) {
    console.error('[sendLinePush Error]:', err);
  }
}

function sendLineReply(replyToken, messages) {
  var token = getLineAccessToken();
  if (!token || !replyToken) return;
  try {
    var url = 'https://api.line.me/v2/bot/message/reply';
    UrlFetchApp.fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
      },
      payload: JSON.stringify({
        replyToken: replyToken,
        messages: messages
      }),
      muteHttpExceptions: true
    });
  } catch (err) {
    console.error('[sendLineReply Error]:', err);
  }
}

// =============================================================================
// 8. 舊版前端相容 API Handlers (CRUD)
// =============================================================================

function handleFetchVolunteers() {
  const ss = getSpreadsheet();
  const sheet = getVolunteerSheet(ss);
  if (!sheet || sheet.getLastRow() <= 1) {
    return jsonResponse({ success: true, message: '目前沒有義工資料', data: [] });
  }

  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function(h) { return String(h).trim(); });
  const rows = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();

  const result = [];
  for (let i = 0; i < rows.length; i++) {
    const obj = {};
    for (let j = 0; j < headers.length; j++) {
      if (headers[j]) {
        obj[headers[j]] = rows[i][j] !== undefined && rows[i][j] !== null ? String(rows[i][j]) : '';
      }
    }
    result.push(obj);
  }

  return jsonResponse({ success: true, message: '讀取成功', data: result });
}

function handleAddVolunteer(payload) {
  const ss = getSpreadsheet();
  const sheet = getVolunteerSheet(ss);
  if (!sheet) return jsonResponse({ success: false, message: '找不到義工名單工作表' });

  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function(h) { return String(h).trim(); });
  
  let nameCol = headers.indexOf('Name');
  let lineIdCol = headers.indexOf('User_ID');
  let bdayCol = headers.indexOf('Birthday');

  if (nameCol === -1) {
    sheet.getRange(1, lastCol + 1).setValue('Name');
    nameCol = lastCol;
  }

  const allData = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, lastCol).getValues() : [];
  for (let i = 0; i < allData.length; i++) {
    if (String(allData[i][nameCol]).trim() === String(payload.name).trim()) {
      return jsonResponse({ success: false, message: '此義工已在名單中' });
    }
  }

  const newRow = new Array(lastCol).fill('');
  newRow[nameCol] = payload.name;
  if (lineIdCol !== -1 && payload.lineId) newRow[lineIdCol] = payload.lineId;
  if (bdayCol !== -1 && payload.birthday) newRow[bdayCol] = payload.birthday;

  sheet.appendRow(newRow);
  return jsonResponse({ success: true, message: '義工新增成功' });
}

function handleUpdateLineId(payload) {
  const ss = getSpreadsheet();
  const sheet = getVolunteerSheet(ss);
  if (!sheet) return jsonResponse({ success: false, message: '找不到工作表' });

  const lastCol = sheet.getLastColumn();
  const lastRow = sheet.getLastRow();
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function(h) { return String(h).trim(); });
  const nameCol = headers.indexOf('Name');
  let lineIdCol = headers.indexOf('User_ID');

  if (nameCol === -1 || lineIdCol === -1) {
    return jsonResponse({ success: false, message: '找不到必要欄位' });
  }

  const rows = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][nameCol]).trim() === String(payload.name).trim()) {
      sheet.getRange(i + 2, lineIdCol + 1).setValue(payload.lineId);
      SpreadsheetApp.flush();
      return jsonResponse({ success: true, message: 'LINE ID 更新成功' });
    }
  }
  return jsonResponse({ success: false, message: '找不到義工' });
}

function handleUpdateUser(payload) {
  const ss = getSpreadsheet();
  const sheet = getVolunteerSheet(ss);
  if (!sheet) return jsonResponse({ success: false, message: '找不到工作表' });

  const lastCol = sheet.getLastColumn();
  const lastRow = sheet.getLastRow();
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function(h) { return String(h).trim(); });
  const nameCol = headers.indexOf('Name');
  let jobTitleCol = headers.indexOf('Job_Title');
  let userLevelCol = headers.indexOf('User_Level');
  let avatarCol = headers.indexOf('Avatar');
  let bdayCol = headers.indexOf('Birthday');
  if (bdayCol === -1) bdayCol = headers.indexOf('生日');

  const rows = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  const data = payload.data || payload;
  const oldName = data.oldName || data.name;
  const newName = data.newName || data.name;

  let targetRowIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][nameCol]).trim() === String(oldName).trim()) {
      targetRowIdx = i + 2;
      break;
    }
  }

  if (targetRowIdx === -1) {
    return jsonResponse({ success: false, message: '找不到該名義工' });
  }

  if (newName) sheet.getRange(targetRowIdx, nameCol + 1).setValue(newName);
  if (jobTitleCol !== -1 && data.jobTitle) sheet.getRange(targetRowIdx, jobTitleCol + 1).setValue(Array.isArray(data.jobTitle) ? data.jobTitle.join(', ') : data.jobTitle);
  if (userLevelCol !== -1 && data.userLevel) sheet.getRange(targetRowIdx, userLevelCol + 1).setValue(data.userLevel);
  if (avatarCol !== -1 && (data.avatar || data.pictureUrl)) sheet.getRange(targetRowIdx, avatarCol + 1).setValue(data.avatar || data.pictureUrl);
  if (bdayCol !== -1 && data.birthday) sheet.getRange(targetRowIdx, bdayCol + 1).setValue(data.birthday);

  SpreadsheetApp.flush();
  return jsonResponse({ success: true, message: '使用者資料更新成功' });
}

function handleSyncSchedule(payload) {
  var ss = getSpreadsheet();
  var sheetName = payload.sheetName;
  var data = payload.data;

  if (!sheetName || !data || !Array.isArray(data)) {
    return jsonResponse({ success: false, message: '缺少必要欄位' });
  }

  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  } else {
    sheet.clear();
  }

  if (data.length > 0) {
    var range = sheet.getRange(1, 1, data.length, data[0].length);
    range.setValues(data);
  }

  SpreadsheetApp.flush();
  return jsonResponse({ success: true, message: '排班資料已成功同步備份至 Google Sheets [' + sheetName + ']' });
}

function handleFetchSchedule(payload) {
  var ss = getSpreadsheet();
  var sheetName = payload.sheetName;
  if (!sheetName) return jsonResponse({ success: false, message: '缺少工作表名稱' });

  var sheet = ss.getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() === 0) {
    return jsonResponse({ success: false, message: '工作表不存在或無資料' });
  }

  var values = sheet.getDataRange().getValues();
  return jsonResponse({ success: true, message: '讀取成功', data: values });
}

function handleFetchAllSchedules() {
  var ss = getSpreadsheet();
  var sheets = ss.getSheets();
  var result = {};

  for (var i = 0; i < sheets.length; i++) {
    var name = sheets[i].getName();
    if (name.indexOf('表單回覆') === -1 && name !== 'Sheet1' && name !== '工作表1' && name !== 'LINE_Groups') {
      if (sheets[i].getLastRow() > 0) {
        result[name] = sheets[i].getDataRange().getValues();
      }
    }
  }

  return jsonResponse({ success: true, message: '讀取所有班表成功', data: result });
}

function handleSubmitForm(payload) {
  var ss = getSpreadsheet();
  var team = payload.team || '影視團隊';
  var sheet = getFormResponsesSheet(ss, team);
  var formData = payload.data || {};

  var keys = Object.keys(formData);
  var newRow = keys.map(function(k) { return formData[k] || ''; });
  sheet.appendRow(newRow);

  return jsonResponse({ success: true, message: '表單已成功提交' });
}

function handleFetchFormResponses(payload) {
  var ss = getSpreadsheet();
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
        obj[headers[j]] = String(rows[i][j] || '');
      }
    }
    result.push(obj);
  }

  return jsonResponse({ success: true, message: '讀取成功', data: result });
}

function handleClearFormResponses(payload) {
  var ss = getSpreadsheet();
  var team = payload && payload.team ? payload.team : '影視團隊';
  var sheet = getFormResponsesSheet(ss, team);
  if (sheet && sheet.getLastRow() > 1) {
    sheet.deleteRows(2, sheet.getLastRow() - 1);
  }
  return jsonResponse({ success: true, message: '已清空表單回覆紀錄' });
}

function handleUpdateSkills(payload) {
  return jsonResponse({ success: true, message: '技能更新操作已交由 Firebase Firestore 管理' });
}

// =============================================================================
// 9. 定時排程 Trigger 一鍵自動安裝
// =============================================================================

/**
 * 🛠️ 一鍵自動設定所有定時推播 Trigger
 * 在 GAS 編輯器中執行此函式，即可自動註冊所有必要排程！
 */
function setupAllTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    ScriptApp.deleteTrigger(triggers[i]);
  }

  // 1. 每週六下午 16:00 執行「sendSaturdayServiceReminders」
  ScriptApp.newTrigger('sendSaturdayServiceReminders')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.SATURDAY)
    .atHour(16)
    .inTimezone('Asia/Taipei')
    .create();

  // 2. 每天上午 09:00 執行「dailyScheduledChecks」 (生日祝福 + 15/20號催填)
  ScriptApp.newTrigger('dailyScheduledChecks')
    .timeBased()
    .everyDays(1)
    .atHour(9)
    .inTimezone('Asia/Taipei')
    .create();

  console.log('✅ 所有定時排程 Trigger 已成功註冊完畢！');
}

// --- 實用測試工具 -------------------------------------------------------------

function testSaturdayReminder() {
  sendSaturdayServiceReminders();
}

function testBirthdayGreeting() {
  sendDailyBirthdayGreetings();
}

function testFormReminder() {
  checkAndSendCycleFormReminders();
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function parseQueryString(qs) {
  var params = {};
  if (!qs) return params;
  var pairs = qs.split('&');
  for (var i = 0; i < pairs.length; i++) {
    var p = pairs[i].split('=');
    if (p.length === 2) {
      params[p[0]] = p[1];
    }
  }
  return params;
}
