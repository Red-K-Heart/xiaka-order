import assert from 'node:assert/strict';

export function utility() {
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
export function database(initial, options = {}) {
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
            if(options.drop && options.drop(name,row,column,values)) return range;
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
    getId: () => 'synthetic-spreadsheet-id',
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
