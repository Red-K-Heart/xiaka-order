# GAS 原始快照檢查紀錄

檢查日期：2026-10-28（Asia/Taipei）。來源為使用者在自己的電腦以 clasp 下載後上傳的 `gas.rar`。

**這是提交 `3cbd212` 的歷史檢查紀錄。** 後續已整併重複函式，現行結果請看 [gas-consolidation.md](gas-consolidation.md)。下述原始檔案數、雜湊相符狀態與檢查失敗均描述當時的原始快照，並非目前工作版本。

## 匯入與秘密檢查

- 7 個檔案已原樣保存於 `gas/src/`；`gas/import-record.json` 也保留原始上傳內容。單元測試逐一驗證 SHA-256 與檔案清單。
- 原始紀錄中的 GAS 專案 ID 與使用者指定 ID 相符；這是匯出紀錄及內容一致性核對，未透過 Google API 驗證部署身分。
- 檢查未發現明確寫死的密碼、Google API 金鑰、OAuth Client Secret、私密金鑰、GitHub token 或 JWT 權杖。另檢視憑證／token／secret 等名稱的引用，以及不透明的長字串；發現的 Google OAuth Client ID 是公開識別資訊。
- Google ID token 由請求中的 credential 傳入，並送至 Google tokeninfo 驗證；原始碼未包含實際 token。
- `PropertiesService` 中的真實設定值不包含在匯出檔，因此本次無法檢查那些值。未發現秘密不是保證不存在；未檢查未上傳的檔案、遠端 properties、執行記錄或 Google 帳戶。
- 沒有提交壓縮檔、OAuth 憑證、試算表訂單資料或 `node_modules`。
- 原始 HTML 中的 9 處尾端空白一併保留，以維持原始雜湊；`git diff --check` 會指出這些既有空白。新工具與文件則通過空白檢查。

## 已確認的全域函式衝突

GAS 檔案共用全域名稱空間。目前 51 個函式名稱中，31 個在 `Code.js` 和 `saveOrderToDatabase.js` 重複，其中 12 個的函式內容不同。不能只因每個檔案單獨語法正確就將兩套實作視為可一起部署。

| 位置 | 差異與影響 |
| --- | --- |
| `Code.js:1149` / `saveOrderToDatabase.js:1157` | `generateCustomerOrderCode_` 分別接受 3 與 2 個參數，編號分別採字母／時間／電話末碼與日期／流水號；必須明確決定要用的格式 |
| `Code.js:3666` / `saveOrderToDatabase.js:3825` | `handleOperatorWritePost_` 一個直接回覆未開放寫入，另一個會驗證並更新訂單，啟用哪個實作會改變功能 |
| `Code.js:3683` / `saveOrderToDatabase.js:3732` | `operatorStoreResponse_` 使用不同快取 key 與分塊大小；對應的兩個 polling helper 不互通 |
| 兩檔的 `doGet`、`doPost` | API 分流內容不同，不能依靠未核對的全域覆蓋結果選定功能 |

其餘內容不同的名稱：`getOperatorReadSnapshot_`、`getOrderStatus`、`getStoreSettings`、`handleOperatorAuthPost_`、`handleOperatorReadPost_`、`operatorNormalizeWorkStatus_`、`saveOrderData_`。

隔離測試實際載入兩種先後順序，確認兩種快取格式不相容。這是**現況診斷測試**，不是把這個缺陷視為理想行為。後續整併程式時，應同步改成單一實作的回歸測試。

`npm run gas:inspect` 回傳 **exit 1**。GitHub Actions 在功能測試後執行此檢查，所以這份原始快照的 CI 預期會在該步驟失敗。沒有移除衝突程式、略過檢查或變更原始檔以取得通過結果。

## 從程式確認的整合依賴

- 試算表以 `SpreadsheetApp.getActiveSpreadsheet()` 取得。未見以提供的試算表 ID 明確開啟，因此仍須核對 GAS 實際綁定的容器。
- 程式引用的工作表名稱包括 `Orders`、`OrderItems`、`Products`／`products`、`CATALOG_RULES`／`Catalog_Rules`／`catalog_rules`、`Settings`、`Staff_Accounts`、`Order_Audit_Log`。這是程式的預期名稱，不代表線上都存在。
- 讀取的 Script Properties 名稱包括 `OPERATOR_GOOGLE_CLIENT_ID`、`CUSTOMER_ORDER_CODE_DATE`、`CUSTOMER_ORDER_CODE_NEXT_INDEX`、`CUSTOMER_ORDER_CODE_NEXT_SEQUENCE`；後兩者屬不同編號實作的狀態。
- `Staff_Accounts` 驗證需要 `Staff_ID`、`Google_Subject`、`Google_Email`、`Display_Name`、`Role`、`Status` 標題。
- Manifest 為 V8、Asia/Taipei；webapp 宣告以部署者身分執行，允許匿名存取。這是匯出設定，不證明目前 `/exec` 的部署版本與設定。
- `gas/src/index.html`、`gas/src/operator.html` 與根目錄的 GitHub Pages 頁面不同。兩份均保留，未自動相互覆蓋。

## 本機驗證結果

- `npm run check`：8 個腳本的語法與前端設定檢查通過；不包含 GAS 模板的線上渲染。
- `npm run test:unit`：35 項通過，其中 30 項涵蓋原始快照、後端函式或衝突診斷，5 項為匯入工具測試。
- `npm run test:browser`：5 項通過，使用現有 Chromium、合成菜單與本機示例資料，所有外部請求均被攔截。
- `npm run gas:inspect`：失敗，原因為上述 31 個全域名稱衝突。
- 未執行線上 Google 登入、GAS 遠端函式、真實試算表讀寫、獨立 Google 測試部署或正式發布。

後端測試替換 PropertiesService、UrlFetchApp、SpreadsheetApp、CacheService、ContentService 與 LockService。涵蓋有效人員、錯誤 audience、過期／未驗證 token、停用人員、subject 不符、角色限制、JSONP callback、Unicode 分塊快取及 Revision 衝突不寫入並釋放鎖。這些結果不保證真實 GAS 服務與資料格式全部相容。

## npm 相依套件警示

`npm audit` 回報 2 個 high 項目：`@google/clasp` 及其相依 `zod`，底層為同一個 [Zod 記憶體耗盡漏洞](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)。目前安裝的 Zod 是 `3.25.76`，公告修補版是 `4.6.6` 以上。

clasp 3.4.1 宣告依賴 `zod: ^3.25.76`，不能在不跨主要版本的情況直接換成 Zod 4。npm 提議將 clasp 降到 2.5.0，屬不相容的主要版本變更；本次未執行 `npm audit fix --force`、未強制覆寫 Zod，也未改變鎖檔。漏洞仍未修復，後續需驗證相容的工具升級或替換方案。這些是開發工具依賴，不是網站直接載入的程式，但工具使用仍應納入評估。

## 發布限制

本次只匯入原始快照、建立本機測試並提交開發分支。重複函式需要先整併，並在獨立 Google 測試環境驗證。正式網站／GAS 發布及正式試算表資料變更仍須使用者確認。
