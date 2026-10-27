# GitHub、Google 試算表與 GAS 維護流程

## 已知現況

| 項目 | 設定與證據 |
| --- | --- |
| GitHub | `Red-K-Heart/xiaka-order`，目前 `main` 為 `53525cc9fe233bdfe803cfa9c7be52c16ddf498e` |
| 正式網站 | https://red-k-heart.github.io/xiaka-order/ |
| 試算表 | https://docs.google.com/spreadsheets/d/1e7UfNG598B523Ux0RjhrbLtE9TfcFLtDsnGhGKZbR4Q/edit |
| GAS 編輯專案 | https://script.google.com/home/projects/1FfzwD63lbb4QV5MqyKxV8cg0MYxqW90Hz4_z90Rmc5P1WuxdLHFr58CP/edit |
| 前端所用部署 | 兩個 HTML 內的 `GAS_WEB_APP_URL`，另記錄於 `config/integrations.json` |
| LINE / Google 登入設定 | LIFF ID 與 Google OAuth client ID 已由前端讀取並記錄於設定清單；不是登入憑證 |
| 後端來源、工作表結構 | 尚未取得；不能根據前端推測為已驗證 |

`config/integrations.json` 是供工具檢查的設定清單，不會改寫瀏覽器內的正式設定。提供的編輯專案是否產生目前使用中的 `/exec` 部署，以及該專案實際連接哪個試算表，仍須在取得 Google 存取權後核對。

目前可用 HTTPS Git 代理讀取此 GitHub 專案。GitHub API、Google 編輯頁與 Apps Script API 曾被環境代理以 403 擋下，並且環境內沒有 clasp 使用者 OAuth 憑證。這是不同的前提：網路放行不代表 Google 已授權，Git 讀取成功也不代表能建立 PR。

正式網站網址應使用不含查詢參數的版本；不要把 LINE 登入的 `code`、`state` 或其他登入回傳參數加入文件、commit 或測試資料。

## 取得第一份 GAS 版本

建議在你自己的電腦完成 Google 登入並下載原始碼，無須把 Google 憑證交給聊天。

1. 取得本次開發分支，進入專案資料夾，安裝 Node.js 24 與 Python 3。
2. 執行 `npm ci --ignore-scripts`。
3. 到 [Apps Script 使用者設定](https://script.google.com/home/usersettings) 確認 Apps Script API 已開啟。使用對此專案具有適當權限的 Google 帳號。
4. 執行 `npm exec -- clasp login`，在自己的瀏覽器完成官方 Google OAuth。clasp 的預設授權包含可修改程式的 scope；本專案下載工具只執行唯讀的 `clone`。不要在聊天中貼 OAuth code、access token、refresh token 或 `.clasprc.json`。
5. 執行 `npm run gas:pull`。工具只下載設定清單中的 GAS 專案，暫存資料放在忽略的 `.local/`，成功後保留 `gas/src/` 及 `gas/import-record.json`。
6. 檢查 `gas/src/` 是否含寫死的秘密或不應公開的資料。確認後再加入 Git；不要把 OAuth 憑證一併提交。
7. 執行 `npm run check`，再執行完整 `npm test`。若 GAS 語法檢查失敗，先保留原始內容並診斷，不要為了通過檢查改寫現有雲端程式。

若你已有從 clasp 匯出的資料夾：

```sh
npm run gas:import -- /absolute/path/to/export
```

必須提供原始 `appsscript.json` 和全部 `.gs` / `.js` / `.html` 檔案；只複製 GAS 編輯器目前顯示的單一分頁並不完整。若匯出資料夾含 `.clasp.json`，工具會核對它的 `scriptId`；`.clasp.json` 本身不會被複製到版本管理目錄。

雲端若已有安全提供的 clasp OAuth 檔案，可將 `CLASP_AUTH_FILE` 指向它後執行 `npm run gas:pull`；不要把原始 JSON 內容放進環境設定草稿或聊天。這個檔案可能由 Google SDK 更新，位置必須可寫。環境內同名的其他 Google 憑證不代表擁有這個使用者的 GAS 權限。此環境目前尚未完成這個授權流程。

## 測試涵蓋範圍

| 指令 | 驗證內容 | 不代表的能力 |
| --- | --- | --- |
| `npm run check` | 兩頁 inline JS、Service Worker 語法與前端公開設定一致性；匯入後再檢查 GAS 語法 | 不執行 SpreadsheetApp 或 GAS 遠端函式 |
| `npm run test:unit` | 匯入保留內容、來源記錄、專案身分檢查、不覆寫與拒絕符號連結 | 不驗證尚未取得的 GAS 商業邏輯 |
| `npm run test:browser` | 店務示例訂單搜尋、計算機與本機保存；訂購頁 JSONP 菜單、購物車、結帳、休息狀態、失敗後重試 | 不驗證真實 Google / LINE 登入、付款、訂單提交或離線 Service Worker |

瀏覽器測試使用合成資料；所有外部網路連線均被攔截。只模擬所需的唯讀菜單 API，其餘請求（包含會寫入的 GET 與 POST）會被阻擋。測試中的最小 CSS 替代品只支援顯示/隱藏判斷，不是版面或正式 CDN 驗證。

GitHub Actions 只使用 `contents: read`，執行安裝與測試，沒有 Google 密鑰、GAS push 或正式網站部署步驟。本次在雲端機器驗證的結果不能當成 GitHub Actions 已執行成功。

## 取得原始碼後的下一階段

以下工作需要真實 GAS 原始碼及 Google 存取權，目前尚未執行：

1. 讀取原始 manifest、Script Properties 的**名稱**、實際使用的試算表 ID、工作表名稱、欄位與觸發器；不把秘密值或顧客資料放進版本管理。
2. 核對前端的 `/exec` 部署確實對應提供的 GAS 專案，並確認部署版本及授權設定。
3. 將實際後端入口與前端契約對照。目前前端使用 `storeSettings`、`catalogRules`、`products`、`orderStatus`、`submitOrder`、取消訂單 POST，以及店務 `operatorAuth` / `operatorRead` / `operatorWrite` POST 搭配 `operatorPoll` JSONP。**有些 GET 會寫入資料，不能僅以 HTTP 方法判斷唯讀。**
4. 建立獨立的測試試算表、測試 GAS 專案與測試部署，只放合成或去識別資料。原正式專案可能把試算表 ID 寫死；未完成檢查前不能直接複製後執行。建立遠端專案與部署需另行取得授權。
5. 依真正函式建立後端單元測試，替換 SpreadsheetApp 等 GAS 服務；再在測試部署驗證讀取、下單、取消、店務權限與衝突處理。先設計測試 API 目標切換，避免本機頁面仍連到正式部署。

## 審查與發布界線

已授權：修改程式、執行本機測試、建立開發分支及 PR。

正式發布、合併至可能觸發 GitHub Pages 的正式分支、更新正式 GAS 程式或部署、變更正式試算表及其存取權，需先提供具體變更與測試結果給使用者確認。本次沒有執行這些操作。

發布前記錄舊版 Git commit、GAS 部署 ID 與版本，以便回復程式。試算表結構變更需另行規劃備份與回復方法，回復 GAS 程式並不會回復資料。

需要的額外網域已加入環境草稿：`api.github.com`、`docs.google.com`、`script.googleapis.com`、`sheets.googleapis.com`、`oauth2.googleapis.com`、`www.googleapis.com`、`red-k-heart.github.io`。保留原有 CDN、Google、LINE 白名單。儲存草稿不保證目前執行中的代理已放行；套用後須重試實際服務。
