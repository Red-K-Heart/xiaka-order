# xiaka-order

呷喀煙燻滷味訂購頁與店務頁。正式網站是靜態 HTML / JavaScript，後端使用 Google Apps Script（GAS）與 Google 試算表。

## 本機開發

需要 Node.js 24、npm 與 Python 3。套件只供開發與測試使用，網站本身不需要建置。

```sh
npm ci --ignore-scripts
npm run serve
```

伺服器使用本機 8000 埠，訂購頁是 `index.html`，店務頁是 `operator.html`。直接瀏覽訂購頁會使用既有正式 GAS 網址；本機開發時不要送出測試訂單到正式系統。

## 測試

首次安裝測試瀏覽器：

```sh
npx --no-install playwright install chromium
npm test
```

雲端環境已有 Chromium 時可使用：

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm test
```

`npm test` 包含 JavaScript 語法與設定一致性檢查、GAS 匯入工具單元測試，以及使用合成資料的瀏覽器測試。測試攔截所有外部網路請求，不會讀寫真實訂單。通過這些測試不代表 Google / LINE 登入或正式 GAS 後端已完成驗證。

已匯入的 GAS 原始碼另有隔離測試，涵蓋登入驗證、JSONP、快取、角色限制與 Revision 衝突。服務全部以記憶體中的替身取代，不會連線 Google。

發布前還必須執行：

```sh
npm run gas:inspect
```

**目前這個檢查會失敗**：原始 GAS 快照有 31 個重複的全域函式名稱，其中 12 個內容不同。這是已確認的原始碼問題，尚未整併；功能測試通過不代表可以部署。詳見 [GAS 檢查結果](docs/gas-review.md)。

GitHub Actions 在 PR 與 `main` 更新時執行測試及函式衝突檢查，不含部署步驟；衝突未處理前預期會顯示失敗。

## Google 試算表與 GAS

[整合與授權指引](docs/integration.md) 說明如何匯入真正的 GAS 原始碼、取得 Google 授權、建立測試環境及安排發布。

已由使用者提供的 `gas.rar` 匯入 7 個原始檔案至 `gas/src/`，並保留原始 `gas/import-record.json`，所有雜湊相符。尚未存取真實試算表、Script Properties 的值或線上部署；沒有更新正式程式或資料。
