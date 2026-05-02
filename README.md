# BOL Production 主日轉播排班系統

> 台北靈糧堂主日轉播團隊的智慧排班與志工管理系統

## ✨ 功能特色

### 🔐 角色權限系統
- **姓名驗證登入** — 透過 Google Sheets 名單即時驗證身分
- **Admin / User 雙角色** — 管理員可操作後台排班，志工僅能填寫表單

### 📝 前台表單系統
- 類 Google 表單的填報介面，勾選可服事日期與地點（山莊 / 宣教）
- 支援**多次提交**，不會覆蓋先前的意願
- 預設全時開啟，可切換為雙數月 10–25 號限時開放

### ⚙️ 自動排班引擎
- 依據技能值、輪替公式、偏好加分自動分配最佳人選
- **5 階段排班流程**：宣教導播 → 山莊導播 → 山莊各職位 → 信息版 → 後處理補位
- 專職人員智慧輪休機制
- 全能補位：每月自動選出缺口最嚴重的一週補位

### 📊 後台管理
- **RAW 資料管理** — 查看、匯出、清空志工填報資料
- **編輯排班** — 手動微調自動排班結果（含備用列、燈控、餐點數量）
- **版本記憶** — 自動保存最近 10 個版本，支援回溯還原
- **多格式匯出** — Excel / PNG / PDF 一鍵匯出

### 🎨 視覺設計
- **Liquid Glass** 毛玻璃美學，金黃色系品牌色調
- 深色 / 淺色模式即時切換
- **互動光影效果** — 桌面端隨滑鼠移動，手機端隨加速度計傾斜
- Logo 登入動畫 — 登入前後平滑位移過場

---

## 🏗️ 專案架構

```
volunteer-scheduler/
├── public/
│   ├── logo.png                    品牌 Logo
│   ├── skill_tree.csv              本地技能樹備用資料
│   └── schedule_responses.csv      本地排班回應測試資料
├── src/
│   ├── hooks/
│   │   └── useInteractiveLighting.ts   互動光影 Hook（滑鼠 + 加速度計）
│   ├── utils/
│   │   ├── scheduler.ts                排班引擎核心
│   │   ├── dateUtils.ts                週期計算（主日日期產生）
│   │   └── fileUtils.ts                CSV/XLSX 解析與下載工具
│   ├── components/
│   │   ├── Login.tsx                    姓名驗證登入
│   │   ├── FrontendForm.tsx            志工填報表單
│   │   └── AdminRawData.tsx            RAW 資料管理
│   ├── App.tsx                         主應用（路由 + 排班 UI）
│   ├── index.css                       Liquid Glass 設計系統
│   └── main.tsx                        進入點
├── index.html
├── package.json
├── tsconfig.json
└── vite.config.ts
```

---

## 🚀 快速開始

### 環境需求
- Node.js ≥ 18
- npm ≥ 9

### 安裝與啟動

```bash
# 安裝依賴
npm install

# 啟動開發伺服器
npm run dev
```

開啟 [http://localhost:5173](http://localhost:5173) 即可使用。

### 建置生產版本

```bash
npm run build
```

產出的靜態檔案位於 `dist/` 資料夾。

---

## 📋 資料來源

| 資料 | 來源 | 說明 |
|------|------|------|
| 技能樹（名單） | [Google Sheets](https://docs.google.com/spreadsheets/d/1L3W6RwrE6gzi_znqNXBww9WVRvi2NVuhDj3-hSYmTZI) | 即時讀取，含姓名、職能、技能值、角色（admin/user） |
| 排班意願 | localStorage | 志工透過前台表單填寫，儲存於瀏覽器 |
| 備用回應 | `/schedule_responses.csv` | 無志工填報時的測試用 fallback |

---

## 🔧 技術棧

| 技術 | 用途 |
|------|------|
| **React 19** | UI 框架 |
| **TypeScript 6** | 型別安全 |
| **Vite 8** | 建置工具與開發伺服器 |
| **SheetJS (xlsx)** | CSV / Excel 解析與匯出 |
| **html2canvas** | 排班表截圖匯出 PNG |
| **jsPDF** | PDF 匯出 |
| **Lucide React** | 圖示庫 |

---

## ⚡ 排班演算法簡介

```
Phase 0: 解析表單 → 建立每週各地點的人員可用清單
Phase 1: 逐週分配
  Step 1: 宣教導播（專職優先）
  Step 2: 山莊導播（具備資格者）
  Step 3: 山莊其他職位（含偏好加分 + 彈性度加分）
  Step 4: 信息版（山莊專職人員兼任）
  Step 5: 偏好違規檢測
Phase 2: 廖亦東後處理補位（每月找最弱週填最關鍵空缺）
```

**輪替公式**：`調整技能值 = 基礎技能值 − 同職位次數 × 1.5 − 總服事次數 × 0.1`

---

## 📌 注意事項

- 資料僅儲存於瀏覽器 `localStorage`，清除瀏覽器資料會遺失排班紀錄
- Logo 檔案請放置於 `public/logo.png`
- 若需恢復雙數月開放機制，修改 `src/utils/dateUtils.ts` 中的 `isOpen` 邏輯

---

## 📄 授權

此專案為台北靈糧堂 BOL Production 團隊內部使用。
