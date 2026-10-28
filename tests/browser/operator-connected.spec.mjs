import { test, expect } from '@playwright/test';
import { operatorFixture } from '../helpers/operator-gas.mjs';

async function connect(page,options={}) {
 const fixture=await operatorFixture(options);
 if(options.legacy) {const read=fixture.gas.getOperatorReadSnapshot_;fixture.gas.getOperatorReadSnapshot_=()=>{const data=read();delete data.contractVersion;return data;};}
 fixture.gas.verifyOperatorGoogleCredential_=()=>({success:true,user:fixture.manager});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.clock.setFixedTime(new Date('2026-10-28T09:00:00+08:00'));
 await page.route('**/*',route=>new URL(route.request().url()).origin==='http://127.0.0.1:4173'?route.continue():route.abort('blockedbyclient'));
 await page.route('https://accounts.google.com/gsi/client',route=>route.fulfill({contentType:'application/javascript',body:`
  window.google={accounts:{id:{initialize(config){this.callback=config.callback;},renderButton(element){const button=document.createElement('button');button.textContent='測試登入';button.onclick=()=>this.callback({credential:'test.'+btoa(JSON.stringify({exp:4102444800}))+'.test'});element.append(button);},disableAutoSelect(){}}}};
 `}));
 await page.route('https://script.google.com/macros/s/**',async route=>{
  try {
   const req=route.request(), url=new URL(req.url());let result;
   if(req.method()==='POST') result=fixture.gas.doPost({parameter:Object.fromEntries(new URLSearchParams(req.postData()||''))});
   else {
    if(url.searchParams.get('api')!=='operatorPoll')throw new Error('Unexpected live API request');
    result=fixture.gas.doGet({parameter:Object.fromEntries(url.searchParams)});
   }
   await route.fulfill({contentType:req.method()==='POST'?'text/plain':'application/javascript',body:result.text});
  } catch(error) {errors.push(error.message);await route.abort('failed');}
 });
 await page.goto('/operator.html');
 await page.getByRole('button',{name:'測試登入',exact:true}).click();
 await expect(page.locator('#authUserStatus')).toContainText('已連線');
 return {...fixture,errors};
}
function row(db,name,index=1) {const table=db.tables[name];return Object.fromEntries(table[0].map((h,i)=>[h,table[index][i]]));}

test('connected opening form saves each field through actual GAS handlers and restores it on reload',async({page})=>{
 const {db,errors}=await connect(page);
 await expect(page.locator('#openingDate')).toHaveValue('20261028');
 await page.locator('#openingFloat').fill('1200');await page.locator('#openingWeather').selectOption('晴天');await page.locator('#openingNote').fill('開店測試');
 await page.locator('[data-opening-incoming]').fill('20');await page.locator('[data-opening-reserved]').fill('3');
 await page.locator('#saveOpeningDraft').click();
 await expect(page.locator('#toast')).toHaveText('開店資料已寫入並讀回確認');
 expect(row(db,'Daily_Openings')).toMatchObject({Opening_Date:'20261028',Opening_Float:1200,Weather:'晴天',Notes:'開店測試',Status:'draft'});
 expect(row(db,'Opening_Inventory')).toMatchObject({Product_ID:'P001',Incoming_Qty:20,Reserved_Qty:3,Ordered_Qty:2});
 await page.reload();await expect(page.locator('#authUserStatus')).toContainText('已連線');
 await expect(page.locator('#openingFloat')).toHaveValue('1200');await expect(page.locator('#openingWeather')).toHaveValue('晴天');await expect(page.locator('#openingNote')).toHaveValue('開店測試');await expect(page.locator('[data-opening-incoming]')).toHaveValue('20');
 expect(errors).toEqual([]);
});

test('connected settlement form stores inventory, all expense fields and totals, then closes and reopens remotely',async({page})=>{
 const {db,errors}=await connect(page);page.on('dialog',dialog=>dialog.accept());
 await page.locator('#settlementTab').click();
 for(const [field,value] of [['sold','7'],['waste','1'],['reserved','4'],['order','9']])await page.locator(`[data-settlement-${field}]`).fill(value);
 await page.locator('#cashSales').fill('700');await page.locator('#wasteAmount').fill('15');await page.locator('#settlementNote').fill('結算測試');
 await page.locator('#addExpenseRecord').click();
 await page.locator('[data-expense-field="category"]').selectOption('耗材');await page.locator('[data-expense-field="name"]').fill('紙袋');await page.locator('[data-expense-field="amount"]').fill('30');await page.locator('[data-expense-field="note"]').fill('單據測試');
 await page.locator('#saveDraft').click();await expect(page.locator('#toast')).toHaveText('結算與支出明細已寫入並讀回確認');
 expect(row(db,'Daily_Settlements')).toMatchObject({Settlement_Date:'20261028',Cash_Sales_Amount:700,Expense_Amount:30,Waste_Amount:15,Notes:'結算測試'});
 expect(row(db,'Settlement_Inventory_Counts')).toMatchObject({Sold_Qty:7,Waste_Qty:1,Reserved_Qty:4,Order_Prep_Qty:9});
 expect(row(db,'Expense_Ledger')).toMatchObject({Category:'耗材',Expense_Name:'紙袋',Amount:30,Notes:'單據測試',Active:true});
 await page.reload();await expect(page.locator('#authUserStatus')).toContainText('已連線');await page.locator('#settlementTab').click();
 await expect(page.locator('#cashSales')).toHaveValue('700');await expect(page.locator('#expenseAmount')).toHaveValue('30');await expect(page.locator('[data-expense-field="note"]')).toHaveValue('單據測試');
 await page.locator('#closeSettlement').click();await expect(page.locator('#settlementBadge')).toHaveText('已結算');
 await page.locator('#reopenSettlement').click();await expect(page.locator('#settlementBadge')).toHaveText('已重開');
 expect(row(db,'Daily_Settlements').Status).toBe('reopened');expect(errors).toEqual([]);
});

test('connected settings persist business hours, weekday choices, stock and manual listing',async({page})=>{
 const {db,errors}=await connect(page);page.on('dialog',dialog=>dialog.accept());
 await page.locator('#settingsTab').click();await page.locator('#editSettings').click();
 await page.locator('#openTime').selectOption('07:00');await page.locator('#closeTime').selectOption('22:00');await page.locator('#pickupStartTime').selectOption('17:00');await page.locator('#pickupEndTime').selectOption('20:00');await page.locator('#pickupIntervalMinutes').fill('15');await page.locator('#pickupIntervalMinutes').dispatchEvent('change');
 await page.locator('[data-qty="0"]').fill('9');await page.locator('[data-hidden="0"]').check();await page.locator('#stockReason').fill('盤點測試');
 await page.locator('[data-business-day][value="SAT"]').uncheck();
 await page.locator('#slotList [data-slot]').first().click();
 await expect(page.locator('#openTime')).toHaveValue('07:00');await expect(page.locator('[data-qty="0"]')).toHaveValue('9');
 await page.locator('#saveSettings').click();await expect(page.locator('#toast')).toHaveText('營業規則已更新並記錄異動');
 const values=Object.fromEntries(db.tables.Settings.slice(1).map(r=>[r[0],r[1]]));expect(values).toMatchObject({Auto_Open_Time:'07:00',Auto_Close_Time:'22:00',Pickup_Start_Time:'17:00',Pickup_End_Time:'20:00',Pickup_Slot_Interval_Minutes:15,Business_Days:'MON,TUE,WED,THU,FRI',Disabled_Time_Slots:'17:00-17:15'});
 expect(row(db,'Products')).toMatchObject({Stock_Qty:11,Reserved_Qty:2,Manual_Listing_Status:'手動下架',Extra_Formula:'=UNCHANGED_FORMULA()'});
 await page.reload();await expect(page.locator('#authUserStatus')).toContainText('已連線');await page.locator('#settingsTab').click();
 await expect(page.locator('#openTime')).toHaveValue('07:00');await expect(page.locator('[data-qty="0"]')).toHaveValue('9');await expect(page.locator('[data-hidden="0"]')).toBeChecked();expect(errors).toEqual([]);
});

test('connected calculator saves a real GAS-backed memory-sheet order instead of local-only data',async({page})=>{
 const {db,errors}=await connect(page);await page.locator('#ordersTab').click();await page.locator('[data-filter="calculator"]').click();
 await page.locator('[data-calc-key="quick:30"]').click();await page.locator('[data-calc-key="quick:35"]').click();await page.locator('#saveOnsiteOrder').click();await expect(page.locator('#toast')).toHaveText('現場訂單已寫入並讀回確認');
 expect(db.tables.Orders.length).toBe(3);expect(row(db,'Orders',2)).toMatchObject({Customer_Name:'現場交易',Total_Amount:65,Order_Status:'已完成'});expect(db.tables.OrderItems.length).toBe(3);expect(errors).toEqual([]);
});

test('connected order edit persists every edit control with compact dates and 24-hour times',async({page})=>{
 const {db,errors}=await connect(page);page.on('dialog',dialog=>dialog.accept());
 await page.locator('#ordersTab').click();await page.locator('[data-action="edit"]').click();
 await page.locator('#editPickupDate').fill('20261029');await page.locator('#editPickupTime').fill('17:15-17:30');await page.locator('#editName').fill('測試更新');await page.locator('#editPhone').fill('0911111111');await page.locator('#editAmount').fill('99');await page.locator('#editRemarks').fill('備註測試');
 await page.locator('#editForm').getByRole('button',{name:'確認修改',exact:true}).click();await expect(page.locator('#toast')).toHaveText('訂單資料已更新');
 expect(row(db,'Orders')).toMatchObject({Pickup_Date:'20261029',Pickup_Time_Slot:'17:15-17:30',Customer_Name:'測試更新',Customer_Phone:'0911111111',Total_Amount:99,Remarks:'備註測試',Revision:2});
 expect(errors).toEqual([]);
});

test('old GAS contract blocks writes before a request can mutate data',async({page})=>{
 const {db,errors}=await connect(page,{legacy:true});await page.locator('#ordersTab').click();await page.locator('[data-filter="calculator"]').click();await page.locator('[data-calc-key="quick:30"]').click();await page.locator('#saveOnsiteOrder').click();
 await expect(page.locator('#toast')).toHaveText('後端尚未更新至欄位契約 v2，已阻止寫入');expect(db.tables.Orders.length).toBe(2);expect(db.writes.length).toBe(0);expect(errors).toEqual([]);
});

test('failed spreadsheet readback never displays a successful opening save',async({page})=>{
 const {db,errors}=await connect(page,{drop:(name,row,column)=>name==='Daily_Openings'&&row===2&&column===3});await page.locator('#openingFloat').fill('123');await page.locator('#saveOpeningDraft').click();
 await expect(page.locator('#toast')).toContainText('寫後讀回不一致');await expect(page.locator('#openingBadge')).toHaveText('草稿');expect(db.tables.Operator_Audit_Log.length).toBe(1);expect(errors).toEqual([]);
});
