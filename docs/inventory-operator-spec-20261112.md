# 呷喀庫存與 OPERATOR 修改規格 — 2026-11-12

狀態：正式 main 分支的已核准實作規格；功能尚未部署。既有 operator.html 的版面、配色、按鈕樣式維持不變。

## 已核准的業務規則
- G 型庫存基本單位為台兩（1 台斤 = 16 台兩），P 型依商品基本計數單位（個、隻、支、片）。
- 每個銷售規格定義 Sales_Base_Qty；線上訂購份數乘以 Sales_Base_Qty 轉換為庫存基本單位。
- 今日預計進貨量 = 昨日收攤輸入的 Purchase_Order_Qty。
- 今日合格餘量 Closing_Qty：僅可留至明日繼續販售的食材，且不包含已分配給線上訂單的食材。
- 今日現場實際耗用 Onsite_Consumption_Qty = Actual_Inbound_Qty + Opening_Qty - Online_Order_Qty - Closing_Qty；包括現場銷售、贈送、報廢、盤點差異，不再拆分。負值保留並警示。
- 線上訂單成立即扣帳，取消或修改需同步回沖或重新計算；不得重複販售線上食材。
- 未確認進貨時 Online_Default_Quota = (Planned_Inbound_Qty + Opening_Qty)/2。
- 已確認進貨時 Online_Default_Quota = (MIN(Planned_Inbound_Qty, Actual_Inbound_Qty) + Opening_Qty)/2。
- Quota_Manual_Override=FALSE 時 Online_Active_Quota 隨預設值更新；TRUE 時保留人工設定。
- 線上可接受新增量 = MAX(0, MIN(Online_Active_Quota - Online_Order_Qty, Supply_Qty - Online_Order_Qty))。進貨未確認 Supply_Qty = Planned_Inbound_Qty + Opening_Qty；確認後 = Actual_Inbound_Qty + Opening_Qty。
- 可訂整份數 = FLOOR(線上可接受新增量 / Sales_Base_Qty)；數值必須在同一商品基本單位下運算。
- 若已成立線上訂單超過實際供應，停止該品項新單並警示系統管理員、店長、店員；不得自動取消已成立訂單。
- 人工提高配額不能越過供應量上限。
- GAS 寫單時以 LockService 串行化：重新讀取庫存、配額與已成立訂單數，檢查所有品項後一次完成寫入；取消與修改需同樣加鎖並回沖。不得只信任 index.html。
- 所有 Google Sheets 讀寫依欄位標題建立 mapping，不使用固定欄位序號。

## Inventory_Daily 欄位（Date + Product_ID 唯一鍵）
Date, Product_ID, Opening_Qty, Planned_Inbound_Qty, Actual_Inbound_Qty, Inbound_Confirmed, Purchase_Order_Qty, Online_Default_Quota, Online_Active_Quota, Quota_Manual_Override, Online_Order_Qty, Online_Available_Qty, Closing_Qty, Onsite_Consumption_Qty, Updated_At, Updated_By

## Products 新增欄位
Inventory_Type, Inventory_Base_Unit, Sales_Unit, Sales_Base_Qty

## OPERATOR 新增功能
1. 開店/進貨：顯示昨日訂貨與結存，輸入實際進貨，確認後重算預設配額、檢查短缺。
2. 線上配額：預設/實際/已訂/剩餘，人工覆寫開關、修改人與時間。
3. 收攤/訂貨：每品項輸入合格餘量與明日訂貨量，計算現場耗用與明日預計供應，負數顯示異常。
4. 異常警示：供應短缺、配額不足、日結負值，保留受影響訂單與處理紀錄。

## 實作與部署注意
- 線上預訂時段與現場營業時段由既有營業設定讀取，避免硬編碼。
- 進貨確認前的線上庫存檢查是依預估量；不能保證實際到貨量，故進貨確認後必須再核對。
- 線上訂單未交付但已扣帳，收攤時不得將其計入 Closing_Qty。
- 若單一商品有多種銷售規格，應另建 Product_Sales_Units，避免單一 Sales_Base_Qty 無法表示。
- 先檢查現有 GAS 來源、工作表標題、權限與訂單狀態，再接上真實寫入；不以示意資料覆蓋正式資料。
