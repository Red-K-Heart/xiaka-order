# GAS 全域函式整併

本文件記錄 `577b05b` 的整併階段；後續已新增 OperatorData.js 與營業設定等讀寫功能，最新結果見 [operator-field-audit.md](operator-field-audit.md)。

原始快照提交：`3cbd212`。整併只修改 Git 開發分支，沒有連線更新正式 GAS、試算表或網站。

## 整併結果

- 唯一的核心後端放在 `gas/src/Code.js`，移除重複的 `gas/src/saveOrderToDatabase.js`。
- 保留原有 51 個全域函式名稱，沒有重複定義。收據服務及所有 HTML、manifest、原始匯入紀錄均未變更。
- 原始 7 檔快照仍可從 Git 提交 `3cbd212` 取得；目前工作版本為 6 檔。原始 `import-record.json` 是歷史來源證據，不是修改後程式的校驗清單。

## 兩套程式的取捨

| 項目 | 統一後行為 |
| --- | --- |
| API 路由 | 保留菜單、分類、營業設定、下單、訂單查詢、店務登入／讀取／寫入、顧客取消及輪詢入口 |
| 下單與營業規則 | 採用原 `saveOrderToDatabase.js` 的完整實作，保留伺服器端營業日與取餐時段檢查 |
| 客戶訂單編號 | 新編號採台北日期 `yyyyMMdd` 加每日流水號，例如 `20261028001`；既有字母編號與系統 `Order_ID` 仍依資料列查詢，不改寫舊資料 |
| 店務訂單更新 | 採用具 Google 身分／角色驗證、Revision 檢查與稽核記錄的實作，移除「尚未開放寫入」的重複版本 |
| 訂單狀態與電話 | 保留終態優先分類、電話前導 0 處理、完整電話核對與顧客取消功能 |
| JSONP | 採用原 `Code.js` 對 `<` 的跳脫，成功與錯誤回覆均保留 JSON 語意 |
| 快取寫入 | 統一使用原 `Code.js` 的 `operator:` key、7000 UTF-16 字元分塊、180 秒有效期，避免切開 Unicode surrogate pair，最多 500 塊 |
| 快取讀取 | `operatorGetCachedResponse_` 負責唯一讀取邏輯；保留 `operatorPollResponse_` 作為舊參數介面的轉接，不再建立第二套快取 |
| 快取錯誤 | 檢查 metadata 格式與分塊數量，拒絕越界 part；分塊已過期會回覆明確錯誤，避免假裝已取得完整資料 |

這些取捨是為了保留原有功能並移除覆蓋歧義，不代表已確認線上部署原本啟用哪一套全域實作。Google 測試部署仍需驗證實際資料與設定相容性。

根目錄店務頁要求的 `updateBusinessSettings` 並未在原始後端的可寫操作中實作；本次沒有藉整併新增營業設定寫入。此功能仍需另行實作與測試，不能因重複函式已解決就宣稱可用。

## 回歸驗證

本機測試替換全部 GAS 服務，不發送真實 Google 請求或訂單。

驗證結果：`npm run check` 的 7 個腳本檢查通過；41 項單元測試與 5 項瀏覽器測試通過；`npm run gas:inspect` 確認 51 個全域名稱、0 個重複，並以狀態 0 結束。遠端 GitHub Actions 與真實 Google 整合尚未驗證。

- 身分驗證、角色限制與 stale Revision 拒絕／釋放鎖。
- GET／POST 各入口分流與 JSONP 成功／錯誤回覆跳脫。
- 透過實際 `doGet` 的輪詢回覆，以及兩種 helper 介面的相容性。
- 兩種檔案載入順序得到一致的輪詢結果，無需依靠全域覆蓋順序。
- Unicode 分塊邊界、缺失／過期分塊、錯誤 metadata 及越界索引。
- 每日編號遞增、跨台北日期歸零與超過 999 筆的格式。
- 舊字母編號、新數字編號及系統 ID 的實際查詢；錯誤電話不能查詢。
- 顧客取消核對完整電話、同時更新狀態並釋放鎖，完成單不能取消。
- 店務可更新狀態、增加 Revision 並留下稽核記錄。
- 指定日期店休與禁用取餐時段仍生效。

執行：

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm test
npm run gas:inspect
```

## 後續測試部署注意事項

先使用獨立測試 GAS／試算表，確認綁定 ID、Properties、欄位、觸發器及部署設定。整併涉及移除檔案，不能只把新的 `Code.js` 貼到還保留 `saveOrderToDatabase.gs` 的遠端專案，否則重複定義仍會存在。需審查完整檔案清單；正式專案的更新與移除仍須使用者確認。

本次未修改正式分支、Google 雲端程式、正式資料或觸發器；也未修復先前記錄的 clasp／Zod 開發工具相依警示。
