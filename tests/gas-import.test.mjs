import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { importExport, production } from '../scripts/gas-import.mjs';

async function fixture(t) {
  const base = await mkdtemp(path.join(tmpdir(), 'xiaka-import-test-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const source = path.join(base, 'export');
  const root = path.join(base, 'repo');
  await mkdir(source); await mkdir(root);
  const code = 'function doGet() { return "fixture only"; }\n';
  await writeFile(path.join(source, 'Code.gs'), code);
  await writeFile(path.join(source, 'appsscript.json'), '{"runtimeVersion":"V8"}\n');
  return { source, root, code };
}

test('imports original bytes and provenance, excludes credentials and spreadsheet data', async t => {
  const { source, root, code } = await fixture(t);
  await writeFile(path.join(source, '.clasprc.json'), '{"token":"synthetic-test-value"}');
  await writeFile(path.join(source, 'Orders.csv'), 'synthetic spreadsheet data');
  await writeFile(path.join(source, '.clasp.json'), JSON.stringify({ scriptId: production.scriptId }));
  assert.equal(await importExport(source, root), 2);
  assert.deepEqual((await readdir(path.join(root, 'gas/src'))).sort(), ['Code.gs', 'appsscript.json']);
  assert.equal(await readFile(path.join(root, 'gas/src/Code.gs'), 'utf8'), code);
  const record = JSON.parse(await readFile(path.join(root, 'gas/import-record.json'), 'utf8'));
  assert.equal(record.scriptId, production.scriptId);
  assert.equal(record.sha256['Code.gs'], createHash('sha256').update(code).digest('hex'));
});

test('refuses to overwrite previously imported or locally edited source', async t => {
  const { source, root } = await fixture(t);
  await importExport(source, root);
  const filename = path.join(root, 'gas/src/Code.gs');
  await writeFile(filename, '// local edits');
  await assert.rejects(importExport(source, root), /Refusing to overwrite/);
  assert.equal(await readFile(filename, 'utf8'), '// local edits');
});

test('rejects a different GAS project without creating source', async t => {
  const { source, root } = await fixture(t);
  await writeFile(path.join(source, '.clasp.json'), '{"scriptId":"another-project"}');
  await assert.rejects(importExport(source, root), /scriptId does not match/);
  await assert.rejects(readFile(path.join(root, 'gas/src/Code.gs')), { code: 'ENOENT' });
});

test('requires the real manifest and server code', async t => {
  const { source, root } = await fixture(t);
  await rm(path.join(source, 'appsscript.json'));
  await assert.rejects(importExport(source, root), /original appsscript.json/);
  await writeFile(path.join(source, 'appsscript.json'), '{}');
  await rm(path.join(source, 'Code.gs'));
  await assert.rejects(importExport(source, root), /no GAS server-side source/);
});

test('rejects source symlinks rather than copying files outside the export', async t => {
  const { source, root } = await fixture(t);
  await symlink(path.join(source, 'Code.gs'), path.join(source, 'Linked.gs'));
  await assert.rejects(importExport(source, root), /symlinks/);
});
