import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { operatorFixture, manager } from './helpers/operator-gas.mjs';
const state=n=>String(n).padStart(48,'a');
const plain=value=>JSON.parse(JSON.stringify(value));
const write=(gas,action,changes,n=1,user=manager)=>gas.operatorWriteData_({action,changes,state:state(n)},user);

test('opening: every editable field survives a save and fresh spreadsheet snapshot',async()=>{
 const {gas,db}=await operatorFixture();
 const changes={date:'20261028',status:'draft',revision:0,floatAmount:1500,weather:'雨天',note:'交班測試',inventory:{P001:{incoming:20,reserved:3,ordered:2}}};
 const result=write(gas,'saveOpening',changes);
 assert.equal(result.verified,true);
 const record=gas.getOperatorReadSnapshot_().openings['20261028'];
 assert.equal(record.floatAmount,1500);assert.equal(record.weather,'雨天');assert.equal(record.note,'交班測試');
 assert.deepEqual(plain(record.inventory),changes.inventory);assert.equal(record.revision,1);assert.equal(record.actor,manager.name);
 assert.match(record.updatedAt,/^\d{8} (?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/);
 assert.equal(db.tables.Operator_Audit_Log.length,2);
 assert.throws(()=>write(gas,'saveOpening',changes,2),/其他人更新/);
 assert.equal(write(gas,'saveOpening',changes).replayed,true);
});

test('settlement: money, categorized expenses and all inventory columns persist, removed expenses become inactive',async()=>{
 const {gas}=await operatorFixture();
 const changes={date:'20261028',status:'draft',revision:0,cashSales:700,expenseBaseAmount:20,wasteAmount:15,floatAmount:1500,countedCash:2150,note:'盤點差額',inventory:{P001:{sold:7,waste:1,reserved:4,orderPrep:9}},expenses:[{category:'耗材',name:'紙袋',amount:30,note:'測試單據'},{category:'租金',name:'攤位',amount:50,note:'測試'}]};
 assert.equal(write(gas,'saveSettlement',changes).verified,true);
 let record=gas.getOperatorReadSnapshot_().settlements['20261028'];
 for(const k of ['cashSales','expenseBaseAmount','wasteAmount','floatAmount','countedCash','note'])assert.equal(record[k],changes[k],k);
 assert.equal(record.expenseAmount,100);assert.deepEqual(plain(record.inventory),changes.inventory);assert.deepEqual(plain(record.expenses),changes.expenses);
 write(gas,'saveSettlement',{...changes,revision:1,expenses:[changes.expenses[0]]},2);
 record=gas.getOperatorReadSnapshot_().settlements['20261028'];assert.equal(record.expenses.length,1);assert.equal(record.expenseAmount,50);
 write(gas,'saveSettlement',{...changes,revision:2,status:'closed'},3);
 assert.throws(()=>write(gas,'saveSettlement',{...changes,revision:3},4),/已關閉/);
 write(gas,'saveSettlement',{...changes,revision:3,status:'reopened'},5);
 assert.equal(gas.getOperatorReadSnapshot_().settlements['20261028'].status,'reopened');
});

test('settings: every control persists, inventory retains reservations and unrelated formulas',async()=>{
 const {gas,db}=await operatorFixture();
 const before=plain(gas.getOperatorReadSnapshot_().settings);
 const changes={openTime:'07:00',closeTime:'22:00',pickupStartTime:'17:00',pickupEndTime:'20:00',pickupIntervalMinutes:15,businessDays:['MON','WED'],disabledSlots:['17:30-17:45'],stockReason:'補貨測試',expected:before,stock:[{id:'P001',quantity:9,manualHidden:true,expected:{quantity:10,manualHidden:false}}]};
 assert.equal(write(gas,'updateBusinessSettings',changes).verified,true);
 const snapshot=gas.getOperatorReadSnapshot_();
 for(const k of ['openTime','closeTime','pickupStartTime','pickupEndTime','pickupIntervalMinutes','businessDays','disabledSlots'])assert.deepEqual(plain(snapshot.settings[k]),changes[k],k);
 assert.equal(snapshot.products[0].quantity,9);assert.equal(snapshot.products[0].stockQty,11);assert.equal(snapshot.products[0].reservedQty,2);assert.equal(snapshot.products[0].manualHidden,true);
 assert.equal(db.tables.Products[1][6],'=UNCHANGED_FORMULA()');
 assert.throws(()=>write(gas,'updateBusinessSettings',changes,2),/其他人更新/);
});

test('onsite calculator order is saved to Orders and OrderItems and read back as completed',async()=>{
 const {gas,db}=await operatorFixture();
 const result=write(gas,'createOnsiteOrder',{amount:65,expression:'30 + 35 ='});
 assert.equal(result.verified,true);
 const order=gas.getOperatorReadSnapshot_().orders.find(o=>o.systemId===result.orderId);
 assert.equal(order.amount,65);assert.equal(order.status,'completed');assert.equal(order.remarks,'30 + 35 =');assert.equal(order.items.length,1);assert.match(order.pickupDate,/^\d{8}$/);
 assert.equal(db.tables.Orders.length,3);assert.equal(db.tables.OrderItems.length,3);
 assert.equal(write(gas,'createOnsiteOrder',{amount:65,expression:'30 + 35 ='}).replayed,true);assert.equal(db.tables.Orders.length,3);
});

test('empty numeric parameters default to zero, never to fabricated credentials or identities',async()=>{
 const {gas}=await operatorFixture();write(gas,'saveOpening',{date:'20261028',status:'draft',inventory:{P001:{incoming:'',reserved:'',ordered:''}}});
 const record=gas.getOperatorReadSnapshot_().openings['20261028'];assert.equal(record.floatAmount,0);assert.equal(record.weather,'未填寫');assert.equal(record.actor,manager.name);assert.equal(record.inventory.P001.incoming,0);
});

test('role and invalid date/time/amount checks fail before data mutations',async()=>{
 const {gas,db}=await operatorFixture();
 for(const [action,changes,user] of [
  ['saveOpening',{date:'20261028'}, {...manager,role:'員工'}],
  ['saveOpening',{date:'20260230'},manager],
  ['saveOpening',{date:'20261028',floatAmount:-1},manager],
  ['saveSettlement',{date:'20261028',status:'closed'}, {...manager,role:'員工'}],
  ['createOnsiteOrder',{amount:-1},manager],
  ['updateBusinessSettings',{openTime:'25:00'},manager]
 ]) assert.throws(()=>write(gas,action,changes,1,user));
 assert.equal(db.writes.length,0);
});

test('write readback mismatch is an error and cannot return verified success or an audit success marker',async()=>{
 const {gas,db}=await operatorFixture({drop:(name,row,column)=>name==='Daily_Openings'&&row===2&&column===3});
 assert.throws(()=>write(gas,'saveOpening',{date:'20261028',floatAmount:123,status:'draft'}),/寫後讀回不一致/);
 assert.equal(db.tables.Operator_Audit_Log.length,1);
});

test('legacy ISO dates normalize to compact dates and schema inspection reads headers only',async()=>{
 const {gas,db}=await operatorFixture();
 const snapshot=gas.getOperatorReadSnapshot_();assert.equal(snapshot.orders[0].pickupDate,'20261028');assert.equal(snapshot.orders[0].orderTime,'20261028 08:00:00');
 const report=gas.inspectOperatorSchema();assert.equal(report.spreadsheetId,'synthetic-spreadsheet-id');assert.ok(report.sheets.Daily_Openings.headers.includes('Opening_Date'));assert.equal(db.writes.length,0);
 assert.equal(JSON.stringify(report).includes('測試顧客'),false);
});

test('an explicitly empty business-week selection stays closed instead of reverting to all days',async()=>{
 const {gas}=await operatorFixture();const expected=plain(gas.getOperatorReadSnapshot_().settings);
 write(gas,'updateBusinessSettings',{...expected,businessDays:[],expected});
 assert.deepEqual(plain(gas.getOperatorReadSnapshot_().settings.businessDays),[]);
 assert.equal(gas.getBusinessScheduleForDate_('20261028').acceptingOrders,false);
});

test('formula-like text is rejected without partial mutation',async()=>{
 const {gas,db}=await operatorFixture();assert.throws(()=>write(gas,'saveOpening',{date:'20261028',note:'=IMPORTDATA("https://example.invalid")'}),/公式/);assert.equal(db.writes.length,0);
});

test('schema inspection is unavailable to an anonymous web invocation',async()=>{
 const {gas}=await operatorFixture();gas.Session.getActiveUser=()=>({getEmail:()=>''});assert.throws(()=>gas.inspectOperatorSchema(),/專案編輯器/);
});

test('reviewable schema document matches the server field contract',async()=>{
 const {gas}=await operatorFixture();const document=JSON.parse(await readFile(new URL('../config/operator-schema.json',import.meta.url),'utf8'));assert.equal(document.contractVersion,2);assert.deepEqual(plain(gas.operatorSchema_()),document.tables);
});

test('writes to a wrongly bound spreadsheet are blocked before mutation',async()=>{
 const {gas,db}=await operatorFixture();gas.PropertiesService.getScriptProperties=()=>({getProperty:()=> 'another-spreadsheet'});assert.throws(()=>write(gas,'saveOpening',{date:'20261028'}),/試算表與設定目標不符/);assert.equal(db.writes.length,0);
});

test('authenticated read returns an error instead of reading a wrongly bound spreadsheet',async()=>{
 const {gas,db}=await operatorFixture();gas.verifyOperatorGoogleCredential_=()=>({success:true,user:manager});gas.PropertiesService.getScriptProperties=()=>({getProperty:()=> 'another-spreadsheet'});
 gas.handleOperatorReadPost_({parameter:{operatorPayload:JSON.stringify({state:state(9),credential:'synthetic',action:'readSnapshot'})}});
 const meta=gas.operatorPollResponse_(state(9),'meta');assert.equal(meta.ready,true);const message=JSON.parse(gas.operatorPollResponse_(state(9),'chunk',0).value);assert.equal(message.result.success,false);assert.match(message.result.message,/試算表與設定目標不符/);assert.equal(db.writes.length,0);
});

test('legacy Chinese completion states retain their server-side write locks',async()=>{
 const {gas,db}=await operatorFixture();
 for(const [table,key,status] of [['Daily_Openings','Opening_Date','已完成開店'],['Daily_Settlements','Settlement_Date','已結算']]) {
  const headers=db.tables[table][0];db.tables[table].push(headers.map(h=>h===key?'20261028':h==='Status'?status:h==='Revision'?0:''));
 }
 assert.throws(()=>write(gas,'saveOpening',{date:'20261028',status:'draft'}),/已完成開店/);
 assert.throws(()=>write(gas,'saveSettlement',{date:'20261028',status:'draft'}),/已關閉/);
 assert.equal(db.writes.length,0);
});
