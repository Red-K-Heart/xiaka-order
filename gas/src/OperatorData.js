/** 作業頁資料契約。所有寫入都必須先經 handleOperatorWritePost_ 驗證 Google 身分。 */
function operatorSchema_() {
  return {
    Daily_Openings: ['Opening_Date','Status','Opening_Float','Weather','Notes','Revision','Created_At','Created_By','Updated_At','Updated_By'],
    Opening_Inventory: ['Opening_Date','Product_ID','Incoming_Qty','Reserved_Qty','Ordered_Qty'],
    Daily_Settlements: ['Settlement_Date','Status','Cash_Sales_Amount','Opening_Float','Counted_Cash','Expense_Amount','Expense_Base_Amount','Waste_Amount','Notes','Revision','Created_At','Created_By','Updated_At','Updated_By','Closed_At','Closed_By'],
    Settlement_Inventory_Counts: ['Settlement_Date','Product_ID','Counted_Qty','Sold_Qty','Waste_Qty','Reserved_Qty','Order_Prep_Qty'],
    Expense_Ledger: ['Settlement_Date','Expense_ID','Category','Expense_Name','Amount','Notes','Active'],
    Operator_Audit_Log: ['Request_ID','Action','Record_Key','Actor_ID','Actor_Name','Created_At','Changes_JSON'],
    Settings: ['Setting_Key','Setting_Value'],
    Inventory_Log: ['Request_ID','Product_ID','Before_Qty','After_Qty','Manual_Hidden','Reason','Actor','Created_At'],
    Orders: ['Order_ID','Customer_Order_Code','Order_Time','Pickup_Date','Pickup_Time_Slot','Customer_Name','Customer_Phone','Total_Amount','Payment_Status','Order_Status','Work_Status','Remarks','Revision','Created_At','Created_By','Updated_At','Updated_By'],
    OrderItems: ['Order_ID','Product_ID','Item_Name','Quantity','Unit_Price','Subtotal','Is_Gift']
  };
}
function operatorDay_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]') value = Utilities.formatDate(value, 'Asia/Taipei', 'yyyyMMdd');
  var text = String(value === undefined || value === null ? '' : value).trim();
  var match = text.match(/^(\d{4})[-/]?(\d{2})[-/]?(\d{2})(?:[ T].*)?$/);
  if (!match) throw new Error('日期須為 yyyymmdd，例如 20261028。');
  var date = new Date(Date.UTC(Number(match[1]), Number(match[2])-1, Number(match[3]), 12));
  if (date.getUTCFullYear() !== Number(match[1]) || date.getUTCMonth()+1 !== Number(match[2]) || date.getUTCDate() !== Number(match[3])) throw new Error('日期不存在。');
  return match[1]+match[2]+match[3];
}
function operatorStamp_() { return Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyyMMdd HH:mm:ss'); }
function operatorNumber_(value, label, integer) {
  if (value === '' || value === undefined || value === null) return 0;
  var number = Number(value);
  if (!isFinite(number) || number < 0 || (integer && Math.floor(number) !== number)) throw new Error(label+'須為非負'+(integer?'整數':'數值')+'。');
  return number;
}
function operatorClock_(value) {
  var text = String(value || '').trim();
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(text)) throw new Error('時間須使用 24 小時制 HH:mm。');
  return text;
}
function operatorTable_(ss, name, columns) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  var headers = sheet.getLastColumn() ? sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0].map(function(x){return String(x||'').trim();}) : [];
  var seen = {};
  headers.forEach(function(h){ if(h && seen[h]) throw new Error(name+' 有重複欄名：'+h); if(h) seen[h]=true; });
  var missing = columns.filter(function(h){return headers.indexOf(h)<0;});
  if (missing.length) sheet.getRange(1,headers.length+1,1,missing.length).setValues([missing]);
  return { sheet:sheet, headers:headers.concat(missing) };
}
/** 只修改明確指定的儲存格，保留其他欄位與公式；每一格寫後重新讀取。 */
function operatorUpsert_(ss, name, keys, fields, columns) {
  Object.keys(fields).forEach(function(key){if(typeof fields[key]==='string' && /^\s*=/.test(fields[key])) throw new Error('文字欄位不可包含試算表公式。');});
  var table = operatorTable_(ss,name,columns || operatorSchema_()[name] || Object.keys(fields));
  var rows = table.sheet.getDataRange().getValues();
  var matches = [];
  for(var r=1;r<rows.length;r++) {
    if(Object.keys(keys).every(function(k){
      var v=rows[r][table.headers.indexOf(k)];
      if(v===''||v===null||v===undefined)return false;
      return /_Date$/.test(k) ? operatorDay_(v)===operatorDay_(keys[k]) : String(v)===String(keys[k]);
    })) matches.push(r+1);
  }
  if(matches.length>1) throw new Error(name+' 的資料主鍵重複，請先核對。');
  var row = matches[0] || Math.max(2,table.sheet.getLastRow()+1);
  Object.keys(fields).forEach(function(key){
    var column=table.headers.indexOf(key);
    if(column<0) throw new Error(name+' 缺少 '+key);
    var range=table.sheet.getRange(row,column+1);
    if(typeof fields[key]==='string') range.setNumberFormat('@');
    range.setValues([[fields[key]]]);
  });
  if(SpreadsheetApp.flush) SpreadsheetApp.flush();
  var persisted=table.sheet.getRange(row,1,1,table.headers.length).getValues()[0];
  Object.keys(fields).forEach(function(key){
    var actual=persisted[table.headers.indexOf(key)];
    if(String(actual)!==String(fields[key])) throw new Error(name+'.'+key+' 寫後讀回不一致，尚未確認儲存成功。');
  });
  return row;
}
function operatorManager_(user) {
  if(!user || ['系統管理員','店長'].indexOf(user.role)<0) throw new Error('只有系統管理員或店長可以執行此操作。');
}
function operatorFindDay_(ss,name,column,day) {
  var rows=operatorReadRows_(ss,name).filter(function(row){return row[column] && operatorDay_(row[column])===day;});
  if(rows.length>1) throw new Error(name+' 的日期重複，請先核對。');
  return rows[0] || {};
}
function operatorInventory_(value, fields) {
  var result={};
  Object.keys(value || {}).forEach(function(id){
    if(!id || id.length>200) throw new Error('商品編號無效。');
    result[id]={};
    fields.forEach(function(f){result[id][f]=operatorNumber_(value[id][f],f,true);});
  });
  return result;
}
function operatorWriteData_(payload,user) {
  if(!user || ['系統管理員','店長','員工'].indexOf(user.role)<0) throw new Error('作業角色無效。');
  operatorCheckSpreadsheet_(SpreadsheetApp.getActiveSpreadsheet());
  var action=String(payload.action||''), changes=payload.changes || {};
  operatorValidateText_(changes);
  var allowed=['saveOpening','saveSettlement','updateBusinessSettings','createOnsiteOrder'];
  if(allowed.indexOf(action)<0) return updateOperatorOrder_(payload,user);
  if(action==='saveOpening'||action==='updateBusinessSettings'||(action==='saveSettlement'&&changes.status!=='draft')) operatorManager_(user);
  var lock=LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var ss=SpreadsheetApp.getActiveSpreadsheet(), stamp=operatorStamp_();
    // Request IDs make retries idempotent only after all writes and audit readback succeed.
    var prior=operatorReadRows_(ss,'Operator_Audit_Log').filter(function(row){return row.Request_ID===payload.state;})[0];
    if(prior) {
      if(prior.Actor_ID!==(user.staffId||user.email)||prior.Action!==action||prior.Changes_JSON!==JSON.stringify(changes)) throw new Error('重複請求身分不符。');
      return {success:true,verified:true,replayed:true};
    }
    var result;
    if(action==='saveOpening'||action==='saveSettlement') result=operatorSaveDay_(ss,action,changes,user,stamp);
    if(action==='updateBusinessSettings') result=operatorSaveSettings_(ss,changes,user,stamp,payload.state);
    if(action==='createOnsiteOrder') result=operatorSaveOnsite_(ss,changes,user,stamp,payload.state);
    operatorUpsert_(ss,'Operator_Audit_Log',{Request_ID:payload.state},{Request_ID:payload.state,Action:action,Record_Key:result.key||'',Actor_ID:user.staffId||user.email,Actor_Name:user.name||user.email,Created_At:stamp,Changes_JSON:JSON.stringify(changes)});
    return {success:true,verified:true,revision:result.revision,orderId:result.orderId};
  } finally {lock.releaseLock();}
}
function operatorSaveDay_(ss,action,c,user,stamp) {
  var opening=action==='saveOpening', day=operatorDay_(c.date), name=opening?'Daily_Openings':'Daily_Settlements', key=opening?'Opening_Date':'Settlement_Date';
  var old=operatorFindDay_(ss,name,key,day), status=String(c.status||'draft');
  if((opening?['draft','completed']:['draft','closed','reopened']).indexOf(status)<0) throw new Error('作業狀態無效。');
  var oldStatus=String(old.Status||'').trim();
  var oldClosed=(opening?['completed','已完成','完成','已完成開店']:['closed','已結算']).indexOf(oldStatus)>=0;
  if(opening && oldClosed) throw new Error('已完成開店，不可覆寫。');
  if(!opening && oldClosed && status!=='reopened') throw new Error('結算已關閉，需先重開。');
  if(!opening && status==='reopened' && !oldClosed) throw new Error('只能重開已關閉的結算。');
  var revision=Number(old.Revision)||0;
  if(revision!==(Number(c.revision)||0)) throw new Error('資料已被其他人更新，請重新載入。');
  var inventory=operatorInventory_(c.inventory,opening?['incoming','reserved','ordered']:['sold','waste','reserved','orderPrep']);
  var products=operatorReadRows_(ss,'Products').map(function(p){return String(p.Product_ID);});
  Object.keys(inventory).forEach(function(id){if(products.indexOf(id)<0) throw new Error('盤點商品不存在：'+id);});
  if(opening) {
    var ordered=getOperatorReadSnapshot_().orderedByDate[day] || {};
    Object.keys(inventory).forEach(function(id){inventory[id].ordered=Number(ordered[id])||0;});
  }
  var expenses=(c.expenses||[]).map(function(e,i){return {id:day+'-'+i,category:String(e.category||'其他'),name:String(e.name||''),amount:operatorNumber_(e.amount,'支出金額'),note:String(e.note||'')};});
  var fields={Status:status,Revision:revision+1,Created_At:old.Created_At||stamp,Created_By:old.Created_By||user.name||user.email,Updated_At:stamp,Updated_By:user.name||user.email,Notes:String(c.note||'')};
  fields[key]=day;
  if(opening) {
    fields.Opening_Float=operatorNumber_(c.floatAmount,'預備金'); fields.Weather=String(c.weather||'未填寫');
  } else {
    fields.Cash_Sales_Amount=operatorNumber_(c.cashSales,'現金收款');
    fields.Expense_Base_Amount=operatorNumber_(c.expenseBaseAmount,'既有支出');
    fields.Expense_Amount=fields.Expense_Base_Amount+expenses.reduce(function(sum,e){return sum+e.amount;},0);
    fields.Waste_Amount=operatorNumber_(c.wasteAmount,'報廢成本');
    fields.Opening_Float=operatorNumber_(c.floatAmount===undefined?old.Opening_Float:c.floatAmount,'預備金');
    fields.Counted_Cash=operatorNumber_(c.countedCash===undefined?old.Counted_Cash:c.countedCash,'盤點現金');
    fields.Closed_At=status==='closed'?stamp:(old.Closed_At||''); fields.Closed_By=status==='closed'?(user.name||user.email):(old.Closed_By||'');
  }
  // Validate the whole payload before starting writes; Sheets has no multi-table transaction.
  var keys={};keys[key]=day;
  Object.keys(inventory).forEach(function(id){
    var v=inventory[id], row={Product_ID:id};row[key]=day;
    if(opening){row.Incoming_Qty=v.incoming;row.Reserved_Qty=v.reserved;row.Ordered_Qty=v.ordered;}
    else {row.Sold_Qty=v.sold;row.Waste_Qty=v.waste;row.Reserved_Qty=v.reserved;row.Counted_Qty=v.reserved;row.Order_Prep_Qty=v.orderPrep;}
    var itemKey={Product_ID:id};itemKey[key]=day;
    operatorUpsert_(ss,opening?'Opening_Inventory':'Settlement_Inventory_Counts',itemKey,row);
  });
  if(!opening) {
    var active={};
    expenses.forEach(function(e){active[e.id]=true;operatorUpsert_(ss,'Expense_Ledger',{Expense_ID:e.id},{Settlement_Date:day,Expense_ID:e.id,Category:e.category,Expense_Name:e.name,Amount:e.amount,Notes:e.note,Active:true});});
    operatorReadRows_(ss,'Expense_Ledger').filter(function(e){return e.Settlement_Date&&operatorDay_(e.Settlement_Date)===day&&!active[e.Expense_ID];}).forEach(function(e){operatorUpsert_(ss,'Expense_Ledger',{Expense_ID:e.Expense_ID},{Active:false});});
  }
  operatorUpsert_(ss,name,keys,fields);
  return {key:day,revision:revision+1};
}
function operatorSaveSettings_(ss,c,user,stamp,requestId) {
  var times={openTime:operatorClock_(c.openTime),closeTime:operatorClock_(c.closeTime),pickupStartTime:operatorClock_(c.pickupStartTime),pickupEndTime:operatorClock_(c.pickupEndTime)};
  var interval=operatorNumber_(c.pickupIntervalMinutes,'取餐間隔',true);
  if(interval<1||interval>720||times.pickupEndTime<=times.pickupStartTime) throw new Error('取餐時間或間隔無效。');
  if(!Array.isArray(c.businessDays)||c.businessDays.some(function(d){return ['MON','TUE','WED','THU','FRI','SAT','SUN'].indexOf(d)<0;})) throw new Error('每週營業日無效。');
  var before=getOperatorReadSnapshot_().settings;
  if(!c.expected) throw new Error('缺少設定版本，請重新載入。');
  ['openTime','closeTime','pickupStartTime','pickupEndTime','pickupIntervalMinutes','businessDays','disabledSlots'].forEach(function(k){if(JSON.stringify(before[k])!==JSON.stringify(c.expected[k])) throw new Error('營業設定已被其他人更新，請重新載入。');});
  var products=operatorReadRows_(ss,'Products'), stock=(c.stock||[]).map(function(item){
    var matches=products.filter(function(p){return String(p.Product_ID)===String(item.id);});
    if(matches.length!==1) throw new Error('商品不存在或編號重複。');
    var current=matches[0], available=Math.max(0,(Number(current.Stock_Qty)||0)-(Number(current.Reserved_Qty)||0));
    if(!item.expected||available!==Number(item.expected.quantity)||(String(current.Manual_Listing_Status)==='手動下架')!==item.expected.manualHidden) throw new Error('庫存已被其他人更新，請重新載入。');
    return {id:String(item.id),quantity:operatorNumber_(item.quantity,'可售數量',true),reserved:Number(current.Reserved_Qty)||0,hidden:!!item.manualHidden,before:available};
  });
  (c.disabledSlots||[]).forEach(function(slot){var match=String(slot).match(/^(\d{2}:\d{2})-(\d{2}:\d{2})$/);if(!match||operatorClock_(match[1])>=operatorClock_(match[2]))throw new Error('停用時段格式無效。');});
  var setting={Auto_Open_Time:times.openTime,Auto_Close_Time:times.closeTime,Pickup_Start_Time:times.pickupStartTime,Pickup_End_Time:times.pickupEndTime,Pickup_Slot_Interval_Minutes:interval,Business_Days:c.businessDays.join(','),Disabled_Time_Slots:(c.disabledSlots||before.disabledSlots||[]).join(',')};
  Object.keys(setting).forEach(function(k){operatorUpsert_(ss,'Settings',{Setting_Key:k},{Setting_Key:k,Setting_Value:setting[k]});});
  stock.forEach(function(p){
    operatorUpsert_(ss,'Products',{Product_ID:p.id},{Stock_Qty:p.quantity+p.reserved,Manual_Listing_Status:p.hidden?'手動下架':'正常'},['Product_ID','Stock_Qty','Reserved_Qty','Manual_Listing_Status']);
    operatorUpsert_(ss,'Inventory_Log',{Product_ID:p.id,Request_ID:requestId},{Request_ID:requestId,Product_ID:p.id,Before_Qty:p.before,After_Qty:p.quantity,Manual_Hidden:p.hidden,Reason:String(c.stockReason||'作業頁調整'),Actor:user.name||user.email,Created_At:stamp});
  });
  return {key:'Settings'};
}
function operatorSaveOnsite_(ss,c,user,stamp,requestId) {
  var amount=operatorNumber_(c.amount,'現場金額');if(amount<=0) throw new Error('現場金額必須大於零。');
  var id='POS-'+requestId, day=stamp.slice(0,8);
  operatorUpsert_(ss,'Orders',{Order_ID:id},{Order_ID:id,Customer_Order_Code:id,Order_Time:stamp,Pickup_Date:day,Pickup_Time_Slot:stamp.slice(9,14),Customer_Name:'現場交易',Customer_Phone:'',Total_Amount:amount,Payment_Status:'現金',Order_Status:'已完成',Work_Status:'已完成',Remarks:String(c.expression||''),Revision:1,Created_At:stamp,Created_By:user.name||user.email,Updated_At:stamp,Updated_By:user.name||user.email});
  operatorUpsert_(ss,'OrderItems',{Order_ID:id},{Order_ID:id,Product_ID:'',Item_Name:'現場計算',Quantity:1,Unit_Price:amount,Subtotal:amount,Is_Gift:false});
  return {key:id,orderId:id,revision:1};
}
/** 只讀表頭與筆數，不回傳顧客或權杖資料。由專案擁有者在 GAS 編輯器執行。 */
function inspectOperatorSchema() {
  var active=Session.getActiveUser().getEmail(), effective=Session.getEffectiveUser().getEmail();
  if(!active || active!==effective) throw new Error('請由專案編輯器執行唯讀結構檢查。');
  var ss=SpreadsheetApp.getActiveSpreadsheet(), schema=operatorSchema_(), result={spreadsheetId:ss.getId(),sheets:{}};
  Object.keys(schema).forEach(function(name){var sheet=ss.getSheetByName(name), headers=sheet&&sheet.getLastColumn()?sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0].map(String):[];result.sheets[name]={exists:!!sheet,headers:headers,missing:schema[name].filter(function(h){return headers.indexOf(h)<0;}),rows:sheet?Math.max(0,sheet.getLastRow()-1):0};});
  console.log(JSON.stringify(result));return result;
}
function operatorFormattedDate_(value,pattern) {
  if(value===undefined||value===null||value==='') return '';
  if(Object.prototype.toString.call(value)==='[object Date]') return Utilities.formatDate(value,'Asia/Taipei',pattern);
  var text=String(value).trim();
  if(/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(text)) return Utilities.formatDate(new Date(text),'Asia/Taipei',pattern);
  try {
    var compact=operatorDay_(text), day=pattern.indexOf('yyyy-MM-dd')>=0?compact.slice(0,4)+'-'+compact.slice(4,6)+'-'+compact.slice(6):compact;
    if(pattern.indexOf('HH')<0) return day;
    var time=text.match(/[ T](\d{2}:\d{2})(?::(\d{2}))?/);
    return day+(time?' '+time[1]+(pattern.indexOf('ss')>=0?':'+(time[2]||'00'):''):'');
  } catch(_) {return text;}
}
function operatorCompleteSnapshot_(ss,snapshot) {
  snapshot.contractVersion=2;
  snapshot.orders.forEach(function(order){order.pickupDate=operatorFormattedDate_(order.pickupDate,'yyyyMMdd');order.orderTime=operatorFormattedDate_(order.orderTime,'yyyyMMdd HH:mm:ss');});
  snapshot.businessCalendar.forEach(function(row){row.date=operatorFormattedDate_(row.date,'yyyyMMdd');});
  snapshot.pickupSlots.forEach(function(row){row.date=operatorFormattedDate_(row.date,'yyyyMMdd');});
  var defaults={openTime:'06:00',closeTime:'17:30',pickupStartTime:'16:00',pickupEndTime:'17:30',pickupIntervalMinutes:30};
  Object.keys(defaults).forEach(function(k){if(snapshot.settings[k]===''||snapshot.settings[k]===undefined||snapshot.settings[k]===null)snapshot.settings[k]=defaults[k];});
  snapshot.orderedByDate={};
  var ordersById={};snapshot.orders.forEach(function(order){ordersById[order.systemId]=order;});
  operatorReadRows_(ss,'OrderItems').forEach(function(item){
    var order=ordersById[String(item.Order_ID||'')],id=String(item.Product_ID||'');
    if(!order||order.status==='cancelled'||!id)return;
    var totals=snapshot.orderedByDate[order.pickupDate] || (snapshot.orderedByDate[order.pickupDate]={});
    totals[id]=(totals[id]||0)+(Number(item.Quantity)||0);
  });
  snapshot.openings={};
  operatorReadRows_(ss,'Daily_Openings').forEach(function(row){
    if(!row.Opening_Date)return;var day=operatorDay_(row.Opening_Date);
    snapshot.openings[day]={date:day,status:['completed','已完成','完成','已完成開店'].indexOf(String(row.Status||''))>=0?'completed':'draft',floatAmount:Number(row.Opening_Float)||0,weather:String(row.Weather||'未填寫'),note:String(row.Notes||''),revision:Number(row.Revision)||0,actor:String(row.Updated_By||row.Created_By||''),updatedAt:operatorFormattedDate_(row.Updated_At||row.Created_At,'yyyyMMdd HH:mm:ss'),inventory:{}};
  });
  operatorReadRows_(ss,'Opening_Inventory').forEach(function(row){
    if(!row.Opening_Date||!row.Product_ID)return;var item=snapshot.openings[operatorDay_(row.Opening_Date)];
    if(item)item.inventory[String(row.Product_ID)]={incoming:Number(row.Incoming_Qty)||0,reserved:Number(row.Reserved_Qty)||0,ordered:Number(row.Ordered_Qty)||0};
  });
  var settlements={};
  Object.keys(snapshot.settlements).forEach(function(oldDay){var day=operatorDay_(oldDay);settlements[day]=snapshot.settlements[oldDay];settlements[day].date=day;});
  snapshot.settlements=settlements;
  operatorReadRows_(ss,'Daily_Settlements').forEach(function(row){
    if(!row.Settlement_Date)return;var day=operatorDay_(row.Settlement_Date), record=settlements[day]||{date:day,status:'draft',inventoryCounts:{}};
    Object.assign(record,{cashSales:Number(row.Cash_Sales_Amount)||0,expenseAmount:Number(row.Expense_Amount)||0,expenseBaseAmount:row.Expense_Base_Amount===''||row.Expense_Base_Amount===undefined?Number(row.Expense_Amount)||0:Number(row.Expense_Base_Amount)||0,wasteAmount:Number(row.Waste_Amount)||0,floatAmount:Number(row.Opening_Float)||0,countedCash:Number(row.Counted_Cash)||0,revision:Number(row.Revision)||0,note:String(row.Notes||''),actor:String(row.Updated_By||row.Closed_By||row.Created_By||''),updatedAt:operatorFormattedDate_(row.Updated_At||row.Closed_At||row.Created_At,'yyyyMMdd HH:mm:ss'),inventory:{},expenses:[]});
    settlements[day]=record;
  });
  operatorReadRows_(ss,'Settlement_Inventory_Counts').forEach(function(row){
    if(!row.Settlement_Date||!row.Product_ID)return;var record=settlements[operatorDay_(row.Settlement_Date)];if(!record)return;
    record.inventory=record.inventory||{};record.inventoryCounts=record.inventoryCounts||{};
    var reserved=Number(row.Reserved_Qty===undefined||row.Reserved_Qty===''?row.Counted_Qty:row.Reserved_Qty)||0;
    record.inventory[String(row.Product_ID)]={sold:Number(row.Sold_Qty)||0,waste:Number(row.Waste_Qty)||0,reserved:reserved,orderPrep:Number(row.Order_Prep_Qty)||0};
    record.inventoryCounts[String(row.Product_ID)]=reserved;
  });
  operatorReadRows_(ss,'Expense_Ledger').forEach(function(row){
    if(!row.Settlement_Date||row.Active===false||String(row.Active).toLowerCase()==='false')return;var record=settlements[operatorDay_(row.Settlement_Date)];
    if(record){record.expenses=record.expenses||[];record.expenses.push({category:String(row.Category||'其他'),name:String(row.Expense_Name||''),amount:Number(row.Amount)||0,note:String(row.Notes||'')});}
  });
  return snapshot;
}

function operatorValidateText_(value) {
  if(typeof value==='string' && /^\s*=/.test(value)) throw new Error('文字欄位不可包含試算表公式。');
  if(value && typeof value==='object') Object.keys(value).forEach(function(key){operatorValidateText_(value[key]);});
}

function operatorCheckSpreadsheet_(ss) {
  var expected=PropertiesService.getScriptProperties().getProperty('OPERATOR_TARGET_SPREADSHEET_ID') || '1e7UfNG598B523Ux0RjhrbLtE9TfcFLtDsnGhGKZbR4Q';
  if(!ss || ss.getId()!==expected) throw new Error('綁定試算表與設定目標不符，已阻止寫入。');
}
