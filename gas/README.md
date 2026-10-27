# GAS 原始碼

此目錄預留給現有 Apps Script 專案的真實原始碼，目前尚未取得。

- 專案 ID 記錄在 `config/integrations.json`。
- `npm run gas:pull` 使用已授權的 clasp **下載**指定專案，將檔案匯入 `gas/src/`。
- 已有匯出資料夾時：`npm run gas:import -- /path/to/source-directory`。
- 匯出資料必須包含原本的 `appsscript.json` 與 `.gs` 或 `.js` 程式。不得自行補一個 manifest 來通過檢查。
- 匯入時保留原始檔案內容，並產生 `gas/import-record.json`，記錄專案 ID、來源方式及每個檔案的 SHA-256。本機匯出檔的專案身分仍需由提供者確認；雜湊只能確認內容，不能證明來源。
- 匯入工具不覆寫既有 `gas/src/`，不複製 clasp 憑證與試算表 CSV；後續更新請另行下載並審查差異。
- 加入 Git 前必須檢查原始碼是否寫死密碼、API 金鑰或個人資料；若有，先移到適合的秘密設定中，再另案驗證必要程式變更。

這裡沒有正式專案的 `.clasp.json`，也沒有 `push`、`run` 或部署 npm 指令。第一次版本管理只建立現況快照，不更新雲端專案。

完整程序見 [docs/integration.md](../docs/integration.md)。
