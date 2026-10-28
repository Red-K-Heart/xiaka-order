# GAS 原始碼

使用者於 2026-10-28 提供之 `gas.rar` 原始快照保存在 Git 提交 `3cbd212`，當時 7 個檔案的 SHA-256 全部與原始 `import-record.json` 一致。該紀錄的專案 ID 與使用者指定專案相同；檔案雜湊不構成 Google 線上部署身分證明。

`src/` 現在是整併後的工作版本，共 6 個檔案。`Code.js` 提供唯一的核心後端，`ReceiptService.js` 保留收據服務；重複的 `saveOrderToDatabase.js` 已移除。51 個既有全域函式名稱全數保留，且沒有重複定義。決策與測試見 [GAS 整併說明](../docs/gas-consolidation.md)，原始問題記錄見 [GAS 檢查結果](../docs/gas-review.md)。

`import-record.json` 保留原始上傳的來源證據，**不會隨後續程式編輯更新雜湊**。要核對原始快照請檢出 `3cbd212`，不要拿這份原始紀錄判定現行修改後的程式有無變更。

- 專案 ID 記錄在 `config/integrations.json`。
- `npm run gas:pull` 使用已授權的 clasp **下載**指定專案，將檔案匯入 `gas/src/`。
- 已有匯出資料夾時：`npm run gas:import -- /path/to/source-directory`。
- 匯出資料必須包含原本的 `appsscript.json` 與 `.gs` 或 `.js` 程式。不得自行補一個 manifest 來通過檢查。
- 匯入時保留原始檔案內容，並產生 `gas/import-record.json`，記錄專案 ID、來源方式及每個檔案的 SHA-256。本機匯出檔的專案身分仍需由提供者確認；雜湊只能確認內容，不能證明來源。
- 匯入工具不覆寫既有 `gas/src/`，不複製 clasp 憑證與試算表 CSV；後續更新請另行下載並審查差異。
- 加入 Git 前必須檢查原始碼是否寫死密碼、API 金鑰或個人資料；若有，先移到適合的秘密設定中，再另案驗證必要程式變更。

這裡沒有正式專案的 `.clasp.json`，也沒有 `push`、`run` 或部署 npm 指令。第一次版本管理只建立現況快照，不更新雲端專案。

因原始碼已存在，`gas:pull` 與 `gas:import` 會拒絕再次匯入，以免覆寫工作版本。下次更新應下載到另一個資料夾，檢查差異後另外提交。

完整程序見 [docs/integration.md](../docs/integration.md)。
