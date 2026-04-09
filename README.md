# 運彩盤口變動追蹤器 (Odds Flow Analyzer)

這是一個全自動化的運彩看盤網頁，專為「朋友圈」設計。
它能夠自動捕捉 NBA 與足球的盤口變動，並交由 Google Gemini AI 進行診斷分析。

## 目錄結構
```
odds-flow-analyzer/
├── .github/workflows/   # GitHub Actions 自動化腳本
├── css/                 # 網站樣式 (Dark Mode, Glassmorphism)
├── js/                  # 前端互動邏輯
├── data/                # 存放爬蟲抓取下來的 JSON (包含歷史 archive)
├── scripts/             # Python 爬蟲與 AI 分析核心
└── index.html           # 網站首頁
```

## 部署與使用指南 (完全免費方案)

此網站設計為透過 **GitHub Pages** 託管，並利用 **GitHub Actions** 達成自動更新數據。請按照以下步驟完成設定：

### 步驟 1: 將程式碼推送到 GitHub
1. 在 GitHub 上建立一個新的 **公開(Public)** 儲存庫（Repository），例如命名為 `odds-flow-analyzer`。
2. 將此資料夾內的所有檔案上傳或 Push 到該儲存庫的主分支 (`main` 或 `master`)。

### 步驟 2: 設定 API 金鑰 (GitHub Secrets)
為了安全起見，AI 金鑰與抓賠率的金鑰不能寫死在程式碼中，我們將把它們存在 GitHub Secrets：
1. 進入您的 GitHub 儲存庫。
2. 點擊頂部的 **Settings**。
3. 在左側選單欄往下拉，找到 **Secrets and variables**，點擊 **Actions**。
4. 點擊綠色的 **New repository secret**。
5. 新增第一個金鑰：
   - Name 欄位填入：`ODDS_API_KEY`
   - Secret 欄位貼上您從 The Odds API 申請到的金鑰。
   - 點擊 Add secret。
6. 重複步驟 4-5 新增第二個金鑰：
   - Name 欄位填入：`GEMINI_API_KEY`
   - Secret 欄位貼上您從 Google AI Studio 申請到的金鑰。

### 步驟 3: 啟動 GitHub Pages
1. 在 **Settings** 頁面的左側選單中點擊 **Pages**。
2. 在 **Build and deployment** 區塊，Source 選擇 `Deploy from a branch`。
3. Branch 下拉選單選擇 `main` (或 `master`)，後方資料夾選擇 `/ (root)`。
4. 點擊 **Save**。
5. 等待約 1~2 分鐘，頁面上方會顯示您專屬的網站網址。

### 步驟 4: 啟動第一筆數據抓取
由於剛建立時 `data/` 資料夾中可能沒有即時數據：
1. 進入儲存庫頂部的 **Actions** 頁籤。
2. 在左側點擊 **Update Odds Data** 工作流。
3. 點擊右側的 **Run workflow** -> 確認執行。
4. 等候腳本執行完成（約 30 秒至 1 分鐘）。
5. 重新整理您的 GitHub Pages 網站，您將看到最新的盤口分析！

往後系統會每 3 小時自動化執行一次抓取動作，並自動歸檔歷史數據。
