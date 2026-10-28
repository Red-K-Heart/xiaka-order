import { database } from './memory-sheet.mjs';
import { loadGas } from '../../scripts/gas-source.mjs';
export const gasFiles=['Code.js','ReceiptService.js','OperatorData.js'];
export const manager={role:'店長',staffId:'TEST001',name:'測試店長',email:'manager@example.invalid'};
export async function operatorFixture(options={}) {
  const definitions=await loadGas(gasFiles);
  const schema=definitions.operatorSchema_();
  const initial=Object.fromEntries(Object.entries(schema).map(([name,headers])=>[name,[[...headers]]]));
  const order={Order_ID:'ORD-TEST',Customer_Order_Code:'A0900123',Order_Time:'2026-10-28 08:00:00',Pickup_Date:'2026-10-28',Pickup_Time_Slot:'16:00-16:30',Customer_Name:'測試顧客',Customer_Phone:'0912345678',Total_Amount:65,Payment_Status:'現金',Order_Status:'新訂單',Work_Status:'待處理',Revision:1};
  initial.Orders.push(schema.Orders.map(k=>order[k]??''));
  initial.OrderItems.push(schema.OrderItems.map(k=>({Order_ID:'ORD-TEST',Product_ID:'P001',Item_Name:'測試豆干',Quantity:2,Unit_Price:30,Subtotal:60})[k]??''));
  initial.Products=[['Product_ID','Online_Name','Stock_Qty','Reserved_Qty','Manual_Listing_Status','Status','Extra_Formula'],['P001','測試豆干',12,2,'正常','上架','=UNCHANGED_FORMULA()']];
  initial.Settings=[['Setting_Key','Setting_Value'],['Auto_Open_Time','06:00'],['Auto_Close_Time','17:30'],['Pickup_Start_Time','16:00'],['Pickup_End_Time','17:30'],['Pickup_Slot_Interval_Minutes',30],['Business_Days','MON,TUE,WED,THU,FRI,SAT'],['Disabled_Time_Slots','']];
  initial.Staff_Accounts=[['Staff_ID','Google_Subject','Google_Email','Display_Name','Role','Status'],['TEST001','synthetic-subject',manager.email,manager.name,manager.role,'啟用']];
  const db=database(initial,options), cache=new Map();
  const services={...db.services,PropertiesService:{getScriptProperties:()=>({getProperty:key=>key==='OPERATOR_TARGET_SPREADSHEET_ID'?'synthetic-spreadsheet-id':null})},Session:{getActiveUser:()=>({getEmail:()=>manager.email}),getEffectiveUser:()=>({getEmail:()=>manager.email})},CacheService:{getScriptCache:()=>({get:k=>cache.get(k)??null,put:(k,v)=>cache.set(k,v)})},ContentService:{MimeType:{TEXT:'text/plain',JSON:'application/json',JAVASCRIPT:'application/javascript'},createTextOutput:text=>({text,setMimeType(){return this;}})}};
  const gas=await loadGas(gasFiles,services);
  return {gas,db,cache,manager};
}
