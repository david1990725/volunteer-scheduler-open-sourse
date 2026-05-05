# 🏛️ BOL Production 主日轉播智慧排班系統

> 台北靈糧堂主日轉播團隊的專業級排班、技能發展與志工管理系統。

![Project Banner](https://img.shields.io/badge/BOL_Production-Volunteer_Scheduler-EAB308?style=for-the-badge&logo=react)
![Tech Stack](https://img.shields.io/badge/TypeScript-Vite-blue?style=for-the-badge)
![Tech Stack](https://img.shields.io/badge/LINE-LIFF-06C755?style=for-the-badge)

---

## ✨ 核心特色

### 🎭 RPG 風格技能管理 (Admin Skill Tree)
- **視覺化狀態面板** — 透過 Radar Chart (雷達圖) 直觀檢視每位義工的六維技能屬性。
- **夥伴頭像顯示** — 自動同步 LINE 專業頭像，讓管理介面更具親和力與辨識度。
- **即時配點系統** — 現代化漸變滑桿調整技能值，仿 RPG 遊戲的配點體驗。

### 🔐 LINE 整合登入與自動綁定
- **LIFF 快速登入** — 支援 LINE 一鍵登入，無需記住密碼。
- **自動大頭照同步** — 登入時自動抓取並更新使用者的 LINE 頭像至雲端名冊。
- **智慧身分對照** — 自動比對 LINE 使用者 ID 與名冊姓名，支援**自動綁定機制**。

### ⚙️ 專業級排班引擎
- **智慧演算** — 依據技能權重、歷史服事頻率、人員偏好自動計算最優排班。
- **專職輪休邏輯** — 自動判斷同工人力，確保休息機制正常運作。
- **關鍵補位系統** — 偵測每月排班缺口，自動指派關鍵人力支援。

### 📝 現代化填報與資料管理
- **卡片式 RAW 資料檢視** — 管理後台採用優雅的卡片式設計呈現每則填報，清晰顯示日期與地點勾選。
- **雲端優先架構** — 禁用本地不穩定快取，全面採用 Google Sheets 作為真值來源 (Source of Truth)。
- **Liquid Glass 視覺** — 採用毛玻璃特效、動態漸變色調與流暢的物理感動畫。

---

## 🏗️ 專案架構

```text
volunteer-scheduler/
├── google-apps-script/         # 雲端後端 (Google Apps Script)
│   └── Code.gs                 # 處理 Sheets 讀寫、LINE 綁定與表單回覆紀錄
├── src/
│   ├── components/
│   │   ├── AdminSkillTree.tsx  # RPG 技能管理與頭像顯示
│   │   ├── FrontendForm.tsx    # 志工填報介面
│   │   ├── Login.tsx           # LINE / 姓名雙模登入與頭像同步
│   │   └── AdminRawData.tsx    # 卡片式原始資料管理 (雲端同步)
│   ├── hooks/
│   │   ├── useLiff.ts          # LINE LIFF 授權管理
│   │   └── useInteractiveLighting.ts # 互動玻璃光影效果
│   ├── utils/
│   │   ├── scheduler.ts        # 排班演算法核心與資料解析
│   │   ├── googleSheets.ts     # 雲端 API 溝通層 (DRY 原則)
│   │   └── dateUtils.ts        # 週期與日期運算 (自動輪轉)
│   └── index.css               # 全域設計系統與動畫定義
└── vite.config.ts
```

---

## 🚀 快速開始

### 1. 安裝與開發
```bash
# 安裝依賴
npm install

# 啟動本地開發
npm run dev
```

### 2. 環境變數設定 (`.env`)
請建立 `.env` 檔案並設定以下參數：
- `VITE_LIFF_ID`: 您的 LINE LIFF ID
- `VITE_APPS_SCRIPT_URL`: 已部署的 Google Apps Script 網址

### 3. Google Apps Script 部署
請務必將 `google-apps-script/Code.gs` 的內容發佈為「網頁應用程式」，並在每次代碼更新後**發佈新版本**。

---

## 📋 資料同步機制 (Google Sheets)

系統會自動維護以下試算表欄位：

| 欄位類型 | 說明 |
| :--- | :--- |
| **姓名** | 義工唯一識別名稱 |
| **LINE_ID** | 顯示使用者的 LINE 名稱 |
| **user_id** | LINE 平台唯一識別碼 (`Uxxxx...`) |
| **大頭照** | 自動同步的 LINE Profile 圖片網址 |
| **技能值** | 0-10 分的職位熟練度 |

---

## 🛠️ 技術棧

- **核心**: React 19, TypeScript, Vite
- **視覺**: Lucide React (圖示), Recharts (雷達圖), CSS Variables
- **整合**: LINE LIFF SDK, Google Apps Script API
- **處理**: SheetJS (資料解析), html2canvas & jsPDF (匯出)

---

## 📄 授權與維護

此專案由台北靈糧堂 BOL Production 團隊專屬使用。任何問題請聯繫團隊技術管理員。
