# 🏛️ BOL Production 主日轉播智慧排班系統

> 台北靈糧堂主日轉播團隊的專業級排班、技能發展與志工管理系統。

![Project Banner](https://img.shields.io/badge/BOL_Production-Volunteer_Scheduler-EAB308?style=for-the-badge&logo=react)
![Tech Stack](https://img.shields.io/badge/TypeScript-Vite-blue?style=for-the-badge)
![Tech Stack](https://img.shields.io/badge/LINE-LIFF-06C755?style=for-the-badge)

---

## ✨ 核心特色

### 🎭 RPG 風格技能管理 (Admin Skill Tree)
- **視覺化狀態面板** — 透過 Radar Chart (雷達圖) 直觀檢視每位義工的六維技能屬性。
- **即時配點系統** — 現代化漸變滑桿調整技能值，仿 RPG 遊戲的配點體驗。
- **全平台響應式** — 手機端採用滑出式 Modal 面板，電腦端提供寬闊的側邊管理介面。

### 🔐 LINE 整合登入與自動綁定
- **LIFF 快速登入** — 支援 LINE 一鍵登入，無需記住密碼。
- **智慧身分對照** — 自動比對 LINE 使用者 ID 與名冊姓名，支援**自動綁定機制**。
- **雲端同步** — 登入資訊即時同步至 Google Sheets，確保多端資料一致。

### ⚙️ 專業級排班引擎
- **智慧演算** — 依據技能權重、歷史服事頻率、人員偏好自動計算最優排班。
- **專職輪休邏輯** — 自動判斷同工人力，確保休息機制正常運作。
- **關鍵補位系統** — 偵測每月排班缺口，自動指派關鍵人力支援。

### 📝 現代化填報介面
- **Liquid Glass 視覺** — 採用毛玻璃特效、動態漸變色調與流暢的物理感動畫。
- **離線暫存機制** — 支援網路斷線時自動存入佇列，恢復連線後自動同步至雲端。
- **深淺模式切換** — 完美支持系統深色模式，提供極致的視覺舒適度。

---

## 🏗️ 專案架構

```text
volunteer-scheduler/
├── google-apps-script/         # 雲端後端 (Google Apps Script)
│   └── Code.gs                 # 處理 Sheets 讀寫與 LINE 綁定邏輯
├── src/
│   ├── components/
│   │   ├── AdminSkillTree.tsx  # RPG 技能管理核心
│   │   ├── FrontendForm.tsx    # 志工填報介面
│   │   ├── Login.tsx           # LINE / 姓名雙模登入
│   │   └── AdminRawData.tsx    # 原始資料管理
│   ├── hooks/
│   │   ├── useLiff.ts          # LINE LIFF 授權管理
│   │   └── useInteractiveLighting.ts # 互動玻璃光影效果
│   ├── utils/
│   │   ├── scheduler.ts        # 排班演算法核心
│   │   ├── googleSheets.ts     # 雲端 API 溝通層 (DRY Refactored)
│   │   └── dateUtils.ts        # 週期與日期運算
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

---

## 📋 資料同步機制 (Google Sheets)

本系統將 Google Sheets 作為雲端資料庫，透過 Apps Script 進行溝通：

| 欄位類型 | 說明 |
| :--- | :--- |
| **姓名** | 義工唯一識別名稱 |
| **LINE_ID** | 顯示使用者的 LINE 名稱 |
| **user_id** | LINE 平台唯一識別碼 (`Uxxxx...`)，用於自動登入 |
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
