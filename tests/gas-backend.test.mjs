import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadGas, inventory } from '../scripts/gas-source.mjs';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const variants = ['Code.js', 'saveOrderToDatabase.js'];
const state = 'a'.repeat(48);
const headers = ['Staff_ID', 'Google_Subject', 'Google_Email', 'Display_Name', 'Role', 'Status'];
function authServices({ claims = {}, staff = {}, status = 200 } = {}) {
  let fetches = 0;
  const verified = {
    iss: 'https://accounts.google.com', aud: 'synthetic-client-id', email_verified: true,
    exp: Math.floor(Date.now() / 1000) + 3600, email: 'operator@example.invalid', sub: 'synthetic-subject', ...claims
  };
  const account = {
    Staff_ID: 'TEST001', Google_Subject: 'synthetic-subject', Google_Email: 'operator@example.invalid',
    Display_Name: '測試人員', Role: '店長', Status: '啟用', ...staff
  };
  return {
    count: () => fetches,
    services: {
      PropertiesService: { getScriptProperties: () => ({
        getProperty: name => { assert.equal(name, 'OPERATOR_GOOGLE_CLIENT_ID'); return 'synthetic-client-id'; }
      }) },
      UrlFetchApp: { fetch: (url, options) => {
        fetches++;
        assert.equal(url, 'https://oauth2.googleapis.com/tokeninfo?id_token=synthetic-id-token');
        assert.equal(options.muteHttpExceptions, true);
        return { getResponseCode: () => status, getContentText: () => JSON.stringify(verified) };
      } },
      SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: name => {
        assert.equal(name, 'Staff_Accounts');
        return { getLastRow: () => 2, getDataRange: () => ({ getValues: () => [headers, headers.map(h => account[h])] }) };
      } }) }
    }
  };
}
function contentServices() {
  return { ContentService: {
    MimeType: { TEXT: 'text/plain', JAVASCRIPT: 'application/javascript' },
    createTextOutput: text => ({ text, mime: null, setMimeType(mime) { this.mime = mime; return this; } })
  } };
}
function cacheServices() {
  const values = new Map();
  const cache = {
    put: (key, value, ttl) => { assert.equal(ttl, 180); values.set(key, value); },
    putAll: (items, ttl) => { assert.equal(ttl, 180); Object.entries(items).forEach(([k, v]) => values.set(k, v)); },
    get: key => values.get(key) ?? null
  };
  return { CacheService: { getScriptCache: () => cache } };
}

test('uploaded snapshot matches every original hash and contains exactly the recorded source files', async () => {
  const record = JSON.parse(await readFile(new URL('../gas/import-record.json', import.meta.url), 'utf8'));
  const files = await readdir(new URL('../gas/src/', import.meta.url));
  assert.deepEqual(files.sort(), Object.keys(record.sha256).sort());
  for (const [name, expected] of Object.entries(record.sha256)) {
    const bytes = await readFile(new URL(`../gas/src/${name}`, import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), expected, name);
  }
});

for (const file of variants) {
  test(`${file}: authorized staff identity is checked against audience and Staff_Accounts`, async () => {
    const mock = authServices();
    const gas = await loadGas([file], mock.services);
    const result = gas.verifyOperatorGoogleCredential_('synthetic-id-token');
    assert.equal(result.success, true);
    assert.equal(result.user.staffId, 'TEST001');
    assert.equal(result.user.role, '店長');
    assert.equal(mock.count(), 1);
  });

  test(`${file}: missing credential is rejected before any fetch`, async () => {
    const mock = authServices();
    const gas = await loadGas([file], mock.services);
    assert.throws(() => gas.verifyOperatorGoogleCredential_(''), /沒有收到 Google 登入憑證/);
    assert.equal(mock.count(), 0);
  });

  for (const [name, changes] of [
    ['wrong audience', { claims: { aud: 'another-client' } }],
    ['expired token', { claims: { exp: 1 } }],
    ['unverified email', { claims: { email_verified: false } }],
    ['inactive staff', { staff: { Status: '停用' } }],
    ['mismatched Google subject', { staff: { Google_Subject: 'another-subject' } }],
    ['unknown staff role', { staff: { Role: 'untrusted-role' } }],
    ['Google rejects token', { status: 401 }]
  ]) {
    test(`${file}: rejects ${name}`, async () => {
      const mock = authServices(changes);
      const gas = await loadGas([file], mock.services);
      assert.throws(() => gas.verifyOperatorGoogleCredential_('synthetic-id-token'), /Google|帳號|Email/);
    });
  }

  test(`${file}: invalid JSONP callback is rejected before backend access`, async () => {
    const gas = await loadGas([file], contentServices());
    const result = gas.doGet({ parameter: { api: 'products', callback: 'alert(1)' } });
    assert.equal(result.text, 'Invalid callback');
    assert.equal(result.mime, 'text/plain');
  });

  test(`${file}: public product JSONP response uses the requested callback`, async () => {
    const gas = await loadGas([file], contentServices());
    gas.getProductsForFrontend = () => [{ Product_ID: 'TEST001', Price: 30 }];
    const result = gas.doGet({ parameter: { api: 'products', callback: 'testCallback' } });
    assert.equal(result.mime, 'application/javascript');
    assert.deepEqual(JSON.parse(result.text.slice('testCallback('.length, -2)), [{ Product_ID: 'TEST001', Price: 30 }]);
  });

  test(`${file}: operator response cache reconstructs a multi-chunk Unicode payload`, async () => {
    const gas = await loadGas([file], cacheServices());
    const message = { type: 'TEST', text: '測試🍢'.repeat(8000) };
    gas.operatorStoreResponse_(state, message);
    const poll = (mode, part) => file === 'Code.js'
      ? gas.operatorPollResponse_(state, mode, part)
      : gas.operatorGetCachedResponse_({ state, mode, part });
    const meta = poll('meta');
    assert.equal(meta.ready, true);
    assert.ok(meta.chunkCount > 1);
    let serialized = '';
    for (let i = 0; i < meta.chunkCount; i++) serialized += poll('chunk', i).value;
    assert.deepEqual(JSON.parse(serialized), message);
    assert.throws(() => gas.operatorStoreResponse_('bad-state', message), /狀態無效/);
  });
}

test('newer order writer rejects staff editing details before touching a spreadsheet', async () => {
  const gas = await loadGas(['saveOrderToDatabase.js']);
  assert.throws(() => gas.updateOperatorOrder_({ action: 'updateOrderDetails', orderId: 'TEST001' }, { role: '員工' }), /只有系統管理員或店長/);
});

test('newer order writer rejects stale revision and releases its lock without writes', async () => {
  let releases = 0;
  const gas = await loadGas(['saveOrderToDatabase.js'], {
    LockService: { getScriptLock: () => ({ waitLock: ms => assert.equal(ms, 20000), releaseLock: () => releases++ }) },
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: () => ({
      getLastRow: () => 2,
      getDataRange: () => ({ getValues: () => [['Order_ID', 'Work_Status', 'Revision'], ['TEST001', '待處理', 2]] }),
      getRange: () => { throw new Error('Unexpected write attempt'); }
    }) }) }
  });
  assert.throws(() => gas.updateOperatorOrder_({
    action: 'updateOrderStatus', orderId: 'TEST001', revision: 1, changes: { status: 'completed' }
  }, { role: '店長' }), /已被其他人更新/);
  assert.equal(releases, 1);
});

test('receipt header aliases preserve zero values and normalize whitespace', async () => {
  const gas = await loadGas(['ReceiptService.js']);
  assert.equal(gas.getReceiptValue_([0], ['\uFEFF Total_Amount\n'], ['Total_Amount'], 999), 0);
  assert.equal(gas.getReceiptValue_([], ['Other'], ['Total_Amount'], 999), 999);
});

test('snapshot diagnostic: global collisions include both entrypoints and incompatible order-code signatures', async () => {
  const definitions = await inventory();
  for (const name of ['doGet', 'doPost', 'handleOperatorWritePost_', 'operatorStoreResponse_']) {
    assert.equal(definitions.get(name).length, 2, name);
  }
  assert.deepEqual(definitions.get('generateCustomerOrderCode_').map(x => x.arguments).sort(), [2, 3]);
});

test('snapshot diagnostic: cache protocols are incompatible under alternate definition orders', async () => {
  const codeLast = await loadGas(['saveOrderToDatabase.js', 'Code.js'], cacheServices());
  codeLast.operatorStoreResponse_(state, { text: 'synthetic response' });
  assert.equal(codeLast.operatorPollResponse_(state, 'meta').ready, true);
  assert.equal(codeLast.operatorGetCachedResponse_({ state, mode: 'meta' }).pending, true);

  const saveLast = await loadGas(['Code.js', 'saveOrderToDatabase.js'], cacheServices());
  saveLast.operatorStoreResponse_(state, { text: 'synthetic response' });
  assert.equal(saveLast.operatorGetCachedResponse_({ state, mode: 'meta' }).ready, true);
  assert.equal(saveLast.operatorPollResponse_(state, 'meta').pending, true);
});
