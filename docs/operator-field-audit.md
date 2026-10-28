# operator.html 與試算表欄位讀寫檢查

本次完成的是 **程式對照、修正與隔離讀寫驗證**。正式試算表尚未通過連線驗證：環境沒有可用的 Google 使用者 OAuth，對使用者提供的試算表編輯網址請求仍遭代理 403 擋下。不能把下述測試當成真實 Google 儲存成功的證明。

本分支沒有部署 GAS、發布網站、變更正式試算表、填入正式測試資料或轉換既有日期。

## 發現與修正

- 原本開店、結算／支出多為本機暫存；現在增加經 Google 身分及角色驗證的寫入入口。
- 原本 `updateBusinessSettings` 沒有後端處理；現在補齊營業時間、每週營業日、停用時段、庫存及手動下架讀寫。
- 原本現場計算器不能在連線模式儲存；現在可儲存總額到 Orders 與 OrderItems。
- 原本結算快照缺少支出、報廢成本、完整盤點資料；現在全部依欄名讀回。
- 原本開店的已訂數量顯示格缺少讀取標記，送出變成 0；已修正，並由伺服器依商品 ID、取餐日期與未取消訂單重新計算。
- 原本庫存與日期欄位在連線模式被鎖定、部分欄位未放進請求；現在加入表單 payload 與版本衝突檢查。
- 原本修改訂單可能忽略不存在的欄位並整列覆寫；現在僅更新指定儲存格、補入必要新欄，保留無關欄位／公式並寫後讀回。
- 若所有星期都取消勾選，原本空字串會被當成「每天營業」；已修正為整週不營業。

## 欄位對照

下表欄名是**依目前原始碼整理的欄位契約**，尚未與正式試算表的實際表頭核對。完整欄位清單在 [operator-schema.json](../config/operator-schema.json)，並由測試核對與伺服器一致。

| 頁面／欄位 | 試算表欄位 | 讀寫與預設值 |
| --- | --- | --- |
| 開店日期 | Daily_Openings.Opening_Date | yyyymmdd；有效日期必填，不替使用者猜測日期 |
| 預備金 | Daily_Openings.Opening_Float | 讀寫，空白 0，禁止負值 |
| 天氣 | Daily_Openings.Weather | 讀寫，空白「未填寫」 |
| 開店備註 | Daily_Openings.Notes | 讀寫，空白字串 |
| 開店進貨／保留數量 | Opening_Inventory.Incoming_Qty / Reserved_Qty | 依 Opening_Date + Product_ID 讀寫，空白 0，非負整數 |
| 開店已訂數量 | Opening_Inventory.Ordered_Qty | 顯示並記錄；由 Orders + OrderItems 在伺服器計算，不信任客戶端提供的數字 |
| 開店草稿／完成 | Daily_Openings.Status | draft / completed；完成後拒絕覆寫 |
| 開店人員／時間／版本 | Created_By / Updated_By / Created_At / Updated_At / Revision | 使用驗證後人員與伺服器時間，不採用頁面傳來的 actor |
| 訂單編號／系統編號 | Orders.Customer_Order_Code / Order_ID | 唯讀；舊字母編號、日期流水號與系統 ID 都可查詢 |
| 訂單品項 | OrderItems 的 Item_Name、Quantity、Unit_Price、Subtotal 等 | 唯讀顯示；不由修改訂單視窗改商品內容 |
| 取餐日期／時間 | Orders.Pickup_Date / Pickup_Time_Slot | 修改後寫入並讀回；yyyymmdd、HH:mm 或 HH:mm-HH:mm |
| 顧客姓名／電話 | Orders.Customer_Name / Customer_Phone | 修改後寫入並讀回；不為缺少的真實身分編造資料，電話保留前導 0 |
| 訂單金額／備註 | Orders.Total_Amount / Remarks | 修改後寫入並讀回；金額不可為負 |
| 訂單完成／取消 | Orders.Work_Status / Order_Status | 寫入存在的狀態欄；拒絕過期 Revision 與終態再次變更 |
| 訂單修改人員／時間 | Orders.Updated_By / Updated_At / Revision、Order_Audit_Log | 驗證後人員與伺服器時間；記錄前後資料及請求 ID |
| 現場計算金額／算式 | Orders.Total_Amount / Remarks，OrderItems.Quantity / Unit_Price / Subtotal | 儲存完成狀態的現場交易；金額必須大於 0，重試相同請求不重複建單 |
| 訂餐起訖時間 | Settings 的 Auto_Open_Time / Auto_Close_Time | 讀寫，空白讀取預設 06:00 / 17:30；新寫入須 HH:mm |
| 取餐起訖時間 | Settings 的 Pickup_Start_Time / Pickup_End_Time | 讀寫，預設 16:00 / 17:30；結束晚於開始 |
| 取餐間隔 | Settings.Pickup_Slot_Interval_Minutes | 讀寫，預設 30，1–720 整數分鐘 |
| 每週營業日 | Settings.Business_Days | 讀寫；允許明確空陣列表示全週休息，不改回每天營業 |
| 停用取餐時段 | Settings.Disabled_Time_Slots | 讀寫；儲存停用的 HH:mm-HH:mm 清單；切換時不清除其他表單輸入 |
| 可售數量 | Products.Stock_Qty、Reserved_Qty | 顯示 Stock_Qty − Reserved_Qty；寫入時加回既有預訂量，不覆寫 Reserved_Qty |
| 手動下架 | Products.Manual_Listing_Status | 讀寫「手動下架」／「正常」 |
| 庫存異動原因 | Inventory_Log.Reason，及前後數量／人員／時間 | 記錄，空白預設「作業頁調整」 |
| 結算日期／狀態 | Daily_Settlements.Settlement_Date / Status | yyyymmdd；draft / closed / reopened，關閉後需先重開 |
| 結算現金收款 | Daily_Settlements.Cash_Sales_Amount | 讀寫，空白 0 |
| 支出合計／既有未分項支出 | Daily_Settlements.Expense_Amount / Expense_Base_Amount | 由明細加既有支出重算；不信任客戶端傳來的合計 |
| 報廢成本 | Daily_Settlements.Waste_Amount | 讀寫，空白 0 |
| 結算備註 | Daily_Settlements.Notes | 讀寫，空白字串 |
| 賣出／報廢／保留／下單備貨 | Settlement_Inventory_Counts.Sold_Qty / Waste_Qty / Reserved_Qty / Order_Prep_Qty | 按 Settlement_Date + Product_ID 讀寫，空白 0，非負整數 |
| 舊版盤點量 | Settlement_Inventory_Counts.Counted_Qty | 保留相容，與頁面保留數量一致 |
| 支出類別／名稱／金額／備註 | Expense_Ledger.Category / Expense_Name / Amount / Notes | 各筆完整讀寫；類別預設「其他」、金額 0、文字空白；移除改標 Active=false，不刪除整張表 |
| 結算人員／時間／版本 | Daily_Settlements.Created_* / Updated_* / Closed_* / Revision | 驗證後人員與伺服器時間；關閉與重開均走後端 |
| Opening_Float / Counted_Cash（既有結算欄） | Daily_Settlements.Opening_Float / Counted_Cash | 從舊資料讀入並保留，頁面目前沒有獨立編輯控制，不虛構盤點金額 |

## 不應寫入試算表的頁面控制

- 搜尋字、訂單清單日期篩選、分類分頁與訂單篩選：僅影響畫面。
- 測試系統時間、還原時間：僅預覽，不修改伺服器時間或試算表日期。
- 展示角色：僅示意模式；真正權限以 GAS 驗證後的 Staff_Accounts 角色為準。
- 日期狀態檢視、hidden closedToggle / specialNote：讀取 Business_Calendar / Settings 顯示；指定日期例外仍由 Business_Calendar 管理，不假裝頁面可編輯。
- 額外訂單詳情、Google 登入人員、品項說明／評分、付款狀態：目前為讀取顯示，沒有對應編輯控制。
- 自動草稿與離線修改：保留在本機並標示未同步，**不會自動寫入 Google**。須重新登入、核對版本並按儲存；衝突不會被靜默覆寫。

## 日期、時間與預設值

- 作業頁可見日期與傳輸日期統一 `yyyymmdd`；避免使用顯示格式取決於 Windows 的原生 date input。
- 時間統一 24 小時制 `HH:mm`；作業時間戳採 `yyyymmdd HH:mm:ss`，時區 Asia/Taipei。
- 新作業頁寫入的日期、時間戳、電話及字串設定使用文字格式，保留前導 0。既有 ISO 日期或 Date 儲存格讀取時轉為相同顯示格式，不批次改寫舊資料。
- 數量／金額預設 0、可選備註空白、天氣「未填寫」、支出類別「其他」。日期、真實顧客身分、Google token、OAuth 設定不編造預設值。
- 現場計算器只有總額，沒有商品明細，因此記為「現場計算」單一項目，不據此擅自扣減某個商品庫存。

## 寫入驗證與資料保護

- 登入後讀取與寫入前都確認綁定目標：預設必須為使用者指定的試算表 ID；獨立測試副本須在 Script Properties 設定 `OPERATOR_TARGET_SPREADSHEET_ID` 為副本 ID，否則拒絕寫入。這是公開識別資訊，不是密鑰。
- 所有作業寫入先由既有 Google token 驗證及 Staff_Accounts 檢查授權；完成／重開結算、開店及營業／庫存設定須店長或管理員。員工可儲存結算草稿與現場交易。
- 新表頭／工作表只在已授權的儲存動作執行時補入，不在讀取快照時建立。既有欄位、其他資料列與無關公式不覆寫，不清空整張表。
- 每一個指定欄位寫後重新讀取比對，成功回覆必須有 `verified:true`，前端才顯示儲存成功。
- 開店／結算使用 Revision；營業／庫存設定比較原值；過期版本回傳錯誤，不靜默覆蓋。
- 同一請求 ID 成功後重試不重複寫入；要求相同人員、操作與 payload。
- 前端要求 `contractVersion:2`，舊 GAS 版本會在送出寫入前被阻擋。部署時需先更新並驗證 GAS 測試版，再更新使用相同欄位契約的頁面。
- Google Sheets 沒有跨表交易：某欄位失敗時，前面的部分欄位可能已寫入，不能宣稱已回復；系統回報失敗而不建立成功稽核標記。發生此情況需讀取核對實際狀態後處理，不可盲目連按重試。
- 不允許文字欄位帶入 `=` 開頭公式；稽核記錄不存 Google token。

## 本機測試與仍待完成的實際驗證

本機測試使用真正匯入的 GAS 函式、POST + JSONP 輪詢及記憶體儲存格，Google 身分服務在測試中替代。瀏覽器確實操作表單，驗證儲存後的實際記憶體表格，再重新載入頁面核對；不是把寫入函式直接替換為永遠成功的回覆。

本機最終結果：56 項單元測試與 12 項瀏覽器測試通過；8 個腳本語法／設定檢查通過；70 個 GAS 全域函式名稱、0 個重複。這些不是 Google 線上測試結果。

目前尚未完成：正式表頭／欄名相容性、綁定試算表 ID、真實 OAuth／Staff_Accounts、Google 寫入權限、觸發器、配額、實際跨表部分失敗、Google 測試部署及正式資料讀回。

下一步需提供 **每個工作表名稱與第一列表頭**（不含顧客資料），並取得測試副本存取權，才能核對這份契約是否與現有表格一致。不要為取得表頭把正式試算表改成公開。

新增的 `inspectOperatorSchema()` 只讀取試算表 ID、各表表頭、缺少欄位及筆數，不讀出顧客資料、密鑰或設定值；限制由可用本人身分的專案編輯器執行。此函式仍只存在開發分支，尚未放到 Google 專案；若要採用，需先審查並核准 Google 程式變更。也可以直接手動提供表頭，不改 Google 程式。
