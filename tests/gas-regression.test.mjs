import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadGas } from '../scripts/gas-source.mjs';

const files = ['Code.js', 'ReceiptService.js'];
const state = 'b'.repeat(48);
function content() {
  return { ContentService: {
    MimeType: { TEXT: 'text/plain', JSON: 'application/json', JAVASCRIPT: 'application/javascript' },
    createTextOutput: text => ({ text, setMimeType() { return this; } })
  } };
}
function utility() {
  return { Utilities: {
    getUuid: () => 'synthetic-uuid',
    formatDate: (date, zone, pattern) => {
      assert.equal(zone, 'Asia/Taipei');
      const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
        timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
        second: '2-digit', hourCycle: 'h23'
      }).formatToParts(date).map(x => [x.type, x.value]));
      const values = { yyyy: parts.year, MM: parts.month, dd: parts.day, HH: parts.hour, mm: parts.minute, ss: parts.second };
      return pattern.replace(/yyyy|MM|dd|HH|mm|ss/g, token => values[token]);
    }
  } };
}
function database(initial) {
  const tables = structuredClone(initial);
  const writes = [];
  let releases = 0;
  function sheet(name) {
    if (!tables[name]) return null;
    const rows = tables[name];
    return {
      getLastRow: () => rows.length,
      getLastColumn: () => Math.max(0, ...rows.map(x => x.length)),
      getDataRange: () => ({ getValues: () => rows.map(x => x.slice()) }),
      getRange: (row, column, height = 1, width = 1) => {
        const range = {
          getValues: () => Array.from({ length: height }, (_, i) => Array.from({ length: width }, (_, j) => rows[row - 1 + i]?.[column - 1 + j] ?? '')),
          setValues: values => {
            writes.push({ name, row, column, values });
            values.forEach((cells, i) => {
              rows[row - 1 + i] ||= [];
              cells.forEach((v, j) => { rows[row - 1 + i][column - 1 + j] = v; });
            });
            return range;
          },
          setValue: value => range.setValues([[value]]),
          setNumberFormat: () => range
        };
        return range;
      },
      appendRow: row => { rows.push([...row]); writes.push({ name, append: true }); },
      setFrozenRows: () => {}
    };
  }
  const ss = {
    getSheetByName: sheet,
    insertSheet: name => { assert.ok(!tables[name]); tables[name] = []; return sheet(name); }
  };
  return {
    tables, writes, released: () => releases,
    services: {
      SpreadsheetApp: { getActiveSpreadsheet: () => ss },
      LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => releases++ }) },
      Logger: { log: () => {} }, ...utility()
    }
  };
}
function orders({ code = 'A0900123', status = '新訂單', revision = 1 } = {}) {
  return {
    Orders: [
      ['Order_ID', 'Customer_Order_Code', 'Customer_Phone', 'Customer_Name', 'Order_Status', 'Work_Status', 'Revision', 'Total_Amount'],
      ['ORD-TEST', code, 912345678, '測試顧客', status, status, revision, 65]
    ],
    OrderItems: [['Order_ID', 'Item_Name', 'Quantity', 'Unit_Price', 'Subtotal'], ['ORD-TEST', '測試豆干', 1, 65, 65]]
  };
}

for (const [api, handler] of [
  ['products', 'getProductsForFrontend'], ['catalogRules', 'getCatalogRules'],
  ['storeSettings', 'getStoreSettings'], ['orderStatus', 'getOrderStatus'], ['submitOrder', 'submitOrderData']
]) {
  test(`unified GET dispatch preserves ${api}`, async () => {
    const gas = await loadGas(files, content());
    let calls = 0;
    gas[handler] = () => { calls++; return { marker: api }; };
    const response = gas.doGet({ parameter: { api, callback: 'cb', data: '{}' } });
    assert.deepEqual(JSON.parse(response.text.slice(3, -2)), { marker: api });
    assert.equal(calls, 1);
  });
}
for (const [flag, handler] of [
  ['operatorAuth', 'handleOperatorAuthPost_'], ['operatorRead', 'handleOperatorReadPost_'],
  ['operatorWrite', 'handleOperatorWritePost_'], ['customerCancel', 'handleCustomerCancelPost_']
]) {
  test(`unified POST dispatch preserves ${flag}`, async () => {
    const gas = await loadGas(files);
    const event = { parameter: { [flag]: '1' } };
    gas[handler] = actual => { assert.equal(actual, event); return 'handled'; };
    assert.equal(gas.doPost(event), 'handled');
  });
}

test('JSONP escapes HTML delimiters on both successful and error responses', async () => {
  const gas = await loadGas(files, content());
  for (const error of [false, true]) {
    gas.getProductsForFrontend = () => { if (error) throw new Error('</script>'); return { value: '</script>' }; };
    const response = gas.doGet({ parameter: { api: 'products', callback: 'cb' } });
    assert.ok(!response.text.includes('<'));
    const parsed = JSON.parse(response.text.slice(3, -2));
    assert.equal(error ? parsed.message : parsed.value, '</script>');
  }
});

test('cache chunks preserve surrogate boundaries and both polling APIs validate missing or invalid chunks', async () => {
  const values = new Map();
  const cache = {
    put: (key, value) => {
      if (key.includes(':chunk:')) {
        const first = value.charCodeAt(0), last = value.charCodeAt(value.length - 1);
        assert.ok(!(first >= 0xDC00 && first <= 0xDFFF));
        assert.ok(!(last >= 0xD800 && last <= 0xDBFF));
      }
      values.set(key, value);
    },
    get: key => values.get(key) ?? null
  };
  const gas = await loadGas(files, { CacheService: { getScriptCache: () => cache } });
  assert.equal(gas.operatorGetCachedResponse_({ state }).pending, true);
  assert.ok(gas.operatorGetCachedResponse_({ state: 'invalid' }).error);
  gas.operatorStoreResponse_(state, { text: '🍢'.repeat(10000) });
  const meta = gas.operatorGetCachedResponse_({ state });
  assert.ok(meta.chunkCount > 1);
  assert.ok(gas.operatorPollResponse_(state, 'chunk', meta.chunkCount).error);
  assert.ok(gas.operatorPollResponse_(state, 'chunk', -1).error);
  assert.ok(gas.operatorPollResponse_(state, 'unknown').error);
  const chunkKey = [...values.keys()].find(key => key.endsWith(':chunk:0'));
  values.delete(chunkKey);
  assert.match(gas.operatorPollResponse_(state, 'chunk', 0).error, /過期/);
  const metaKey = [...values.keys()].find(key => key.endsWith(':meta'));
  values.set(metaKey, '{');
  assert.match(gas.operatorPollResponse_(state, 'meta').error, /格式錯誤/);
});

test('customer order numbers increment per Taipei date, reset on a new day and exceed three digits safely', async () => {
  const properties = new Map();
  const gas = await loadGas(files, {
    ...utility(), PropertiesService: { getScriptProperties: () => ({
      getProperty: key => properties.get(key) ?? null,
      setProperties: values => Object.entries(values).forEach(([k, v]) => properties.set(k, v))
    }) }
  });
  const now = new Date('2026-10-28T01:00:00+08:00');
  assert.equal(gas.generateCustomerOrderCode_(now, '2026-10-28'), '20261028001');
  assert.equal(gas.generateCustomerOrderCode_(now, '2026-10-28'), '20261028002');
  properties.set('CUSTOMER_ORDER_CODE_NEXT_SEQUENCE', '1000');
  assert.equal(gas.generateCustomerOrderCode_(now, '2026-10-28'), '202610281000');
  assert.equal(gas.generateCustomerOrderCode_(new Date('2026-10-29T01:00:00+08:00'), '2026-10-29'), '20261029001');
});

for (const code of ['A0900123', '20261028001', 'ORD-TEST']) {
  test(`customer lookup accepts ${code} with full phone and rejects the wrong phone`, async () => {
    const db = database(orders({ code: code === 'ORD-TEST' ? '20261028001' : code }));
    const gas = await loadGas(files, db.services);
    const result = gas.getOrderStatus(code, '0912-345-678');
    assert.equal(result.status, 'success');
    assert.equal(result.order_id, 'ORD-TEST');
    assert.equal(result.items.length, 1);
    assert.equal(gas.getOrderStatus(code, '0900000000').status, 'error');
    assert.equal(db.writes.length, 0);
  });
}

test('customer cancellation checks full phone, updates both statuses and releases the lock', async () => {
  const db = database(orders());
  const gas = await loadGas(files, db.services);
  assert.throws(() => gas.cancelCustomerOrder_('A0900123', '0900000000'), /不正確/);
  assert.equal(db.writes.length, 0);
  const result = gas.cancelCustomerOrder_('A0900123', '0912345678');
  assert.equal(result.status, 'success');
  assert.equal(db.tables.Orders[1][4], '已取消');
  assert.equal(db.tables.Orders[1][5], '已取消');
  assert.equal(db.released(), 2);
});

test('customer cannot cancel a completed order', async () => {
  const db = database(orders({ status: '已完成' }));
  const gas = await loadGas(files, db.services);
  assert.throws(() => gas.cancelCustomerOrder_('A0900123', '0912345678'), /已完成/);
  assert.equal(db.writes.length, 0);
  assert.equal(db.released(), 1);
});

test('operator status updates remain enabled, increment revision and append an audit record', async () => {
  const db = database(orders());
  const gas = await loadGas(files, db.services);
  const result = gas.updateOperatorOrder_({
    action: 'updateOrderStatus', orderId: 'A0900123', revision: 1, state, changes: { status: 'completed' }
  }, { role: '員工', staffId: 'TEST001', name: '測試人員' });
  assert.equal(result.success, true);
  assert.equal(result.revision, 2);
  assert.equal(db.tables.Orders[1][4], '已完成');
  assert.equal(db.tables.Orders[1][5], '已完成');
  assert.equal(db.tables.Orders[1][6], 2);
  assert.equal(db.tables.Order_Audit_Log.length, 2);
  assert.equal(db.released(), 1);
});

test('business calendar closure and disabled pickup intervals remain enforced', async () => {
  const db = database({
    Settings: [['Setting_Key', 'Setting_Value'], ['Business_Days', 'MON,TUE,WED,THU,FRI,SAT,SUN']],
    Business_Calendar: [['Business_Date', 'Business_Type', 'Note'], ['2026-10-28', 'CLOSED', '測試休息日']]
  });
  const gas = await loadGas(files, db.services);
  const schedule = gas.getBusinessScheduleForDate_('2026-10-28', new Date('2026-10-28T09:00:00+08:00'));
  assert.equal(schedule.acceptingOrders, false);
  assert.equal(schedule.message, '測試休息日');
  const slots = { pickupStartTime: '16:00', pickupEndTime: '17:30', pickupIntervalMinutes: 30, disabledSlots: ['16:30-17:00'] };
  assert.equal(gas.isConfiguredPickupSlot_('16:00-16:30', slots), true);
  assert.equal(gas.isConfiguredPickupSlot_('16:30-17:00', slots), false);
  assert.equal(gas.isConfiguredPickupSlot_('16:15-16:45', slots), false);
});
