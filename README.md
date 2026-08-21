# 🏛️ BOL Production 智慧義工排班與 LINE 官方小幫手系統

> 專為影視轉播、燈光、音控、舞監等多團隊設計的現代化專業排班、技能發展與 LINE 智慧通知自動化系統。

[![React](https://img.shields.io/badge/React-19.2-61DAFB?style=for-the-badge&logo=react)](https://reactjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.0-3178C6?style=for-the-badge&logo=typescript)](https://www.typescriptlang.org/)
[![Firebase](https://img.shields.io/badge/Firebase-Firestore-FFCA28?style=for-the-badge&logo=firebase)](https://firebase.google.com/)
[![LINE](https://img.shields.io/badge/LINE-LIFF_%26_Messaging_API-06C755?style=for-the-badge&logo=line)](https://developers.line.biz/)
[![Vite](https://img.shields.io/badge/Vite-8.0-646CFF?style=for-the-badge&logo=vite)](https://vitejs.dev/)

---

## ✨ 核心特色

### 🤖 1. LINE 官方帳號 Webhook 智慧小幫手
- **1 對 1 互動與群組支援**：同工可隨時私訊或於群組輸入「本週服事」查詢個人與當週全員服事名冊。
- **每週六 16:00 定時服事提醒**：
  - **個別通知**：精準發送該同工專屬的「日期、場地、職位」。
  - **群組通知**：彙整推播「本週日所有團隊（影視、燈光、舞監、音控）服事同工完整名單」。
- **週期月 15 號 & 20 號催填提醒**：於週期月結束前自動推播下一期意願表單開放與截止倒數通知。
- **週一至週六即時空缺補位 (Quick Reply)**：
  - 依據同工 LINE UID 與團隊自動偵測當週缺口，動態浮現 `[MM/DD 可以幫忙！]` 按鈕。
  - 點選後即時寫入線上排班表，並自動寄發通知信給管理員。
- **每日 09:00 生日祝福 Flex Message**：每日自動比對壽星並推播質感賀卡與經文祝福。

### 🎭 2. 多團隊 RPG 風格技能管理
- **視覺化技能雷達圖** — 直觀檢視每位義工的多維度職能評分。
- **夥伴大頭照自動同步** — 登入時自動同步 LINE 專業頭像至雲端名冊。
- **分級體系管理** — 支援影視 7 軸技能、音控 4 軸等級、燈光與舞監 Level 1~3 分級。

### ⚙️ 3. 智慧排班引擎與意願收集
- **多團隊意願表單** — 支援影視、燈光、舞監、音控各團隊獨立意願填報與日期勾選。
- **智慧排班演算** — 考量技能權重、歷史服事頻率、專職輪休與衝突避讓。
- **雲端雙向持久化** — 主要資料存儲於 Firebase Firestore，並具備 Google Sheets 雙向備份。

---

## 🏗️ 專案架構

```text
volunteer-scheduler/
├── google-apps-script/         # 後端 API 與 LINE Webhook 引擎 (Google Apps Script)
│   └── Code.gs                 # LINE Webhook、定時排程、即時補位、郵件發送與 Sheets 備份
├── src/
│   ├── components/             # React 前端元件
│   │   ├── AdminRosterTeam.tsx # 義工名冊管理 (含生日維護)
│   │   ├── AdminSkillTreeTeam.tsx # RPG 技能樹與評分
│   │   ├── FormVideo.tsx / FormAudio.tsx / ... # 各團隊意願表單
│   │   ├── HomePage.tsx        # 首頁與班表檢視
│   │   └── Login.tsx           # LINE LIFF 一鍵登入
│   ├── utils/
│   │   ├── firebaseService.ts  # Firestore 核心資料庫服務層
│   │   ├── scheduler.ts        # 排班演算法核心與資料解析
│   │   ├── dateUtils.ts        # 雙月週期與主日運算
│   │   └── constants.ts        # 全域中英文轉換與職位對照表
│   └── index.css               # 毛玻璃質感設計系統
├── .env.example                # 環境變數範本
└── vite.config.ts
```

---

## 🚀 快速開始

### 1. 安裝與本地啟動

```bash
# 複製儲存庫
git clone https://github.com/david1990725/volunteer-scheduler.git
cd volunteer-scheduler

# 安裝依賴套件
npm install

# 複製環境變數設定
cp .env.example .env

# 啟動本地開發伺服器
npm run dev
```

### 2. 前端環境變數設定 (`.env`)

請編輯 `.env` 填入您的服務設定：

```env
VITE_LIFF_ID=your_liff_id_here
VITE_APPS_SCRIPT_URL=https://script.google.com/macros/s/your_deployment_id/exec

# LINE Messaging API Configuration (Vercel Serverless 後端使用)
LINE_CHANNEL_ACCESS_TOKEN=your_line_channel_access_token
LINE_CHANNEL_SECRET=your_line_channel_secret

# 管理員信箱 (用於接收即時補位通知信)
ADMIN_EMAIL=admin@example.com
SYSTEM_URL=https://bolproduction.vercel.app

VITE_FIREBASE_API_KEY=your_firebase_api_key
VITE_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your_project_id
VITE_FIREBASE_STORAGE_BUCKET=your_project.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
VITE_FIREBASE_APP_ID=your_app_id
VITE_FIREBASE_MEASUREMENT_ID=your_measurement_id
```

---

## ⚡ LINE 官方帳號 Webhook 設定 (Vercel Serverless + Firestore)

專案已原生內建 Vercel Serverless API，直連 Firebase Firestore，提供 100% 穩定的 `200 OK` 響應：

1. **Vercel 環境變數設定**：
   在 Vercel 專案的 **Settings → Environment Variables** 中新增：
   - `LINE_CHANNEL_ACCESS_TOKEN`: LINE 官方帳號 Messaging API Token
   - `LINE_CHANNEL_SECRET`: LINE Webhook 簽名驗證 Secret
   - `ADMIN_EMAIL`: 管理員通知信箱
   - `SYSTEM_URL`: `https://bolproduction.vercel.app`
   - `VITE_FIREBASE_*`: 各項 Firebase 連線設定

2. **LINE Developers Console 設定**：
   - **Webhook URL** 填入：
     ```text
     https://bolproduction.vercel.app/api/line-webhook
     ```
   - 點擊 **Verify** 即可立即驗證成功（回傳 200 OK）。
   - 將 **Use Webhook** 切換為 **Enabled（開啟）**。

3. **自動化定時推播 (Vercel Cron)**：
   - 透過 `vercel.json` 自動排程：
     - **每週六 16:00 (UTC 08:00)**: 自動推播週日服事（個別通知 vs 群組名冊）
     - **週期月 15 號 & 20 號 (UTC 01:00)**: 自動推播意願表單催填
     - **每日 09:00 (UTC 01:00)**: 自動比對當天壽星並推播 Birthday Flex Message 賀卡


---

## 📄 授權條款 (License)

本專案採用 [MIT License](LICENSE) 開源授權。
