import { readFile, readdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const temp = await mkdtemp(path.join(tmpdir(), 'xiaka-check-'));
let checked = 0;
async function syntax(source, label) {
  const filename = path.join(temp, `${checked++}.js`);
  await writeFile(filename, source);
  const result = spawnSync(process.execPath, ['--check', filename], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${label}:\n${result.stderr}`);
}
async function html(filename) {
  const source = await readFile(filename, 'utf8');
  for (const [index, match] of [...source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)].entries()) {
    if (!/\bsrc\s*=/i.test(match[1]) && match[2].trim()) {
      await syntax(match[2], `${filename} inline script ${index}`);
    }
  }
  return source;
}
async function gas(directory) {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  for (const entry of entries) {
    const filename = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`GAS source cannot contain symlinks: ${filename}`);
    if (entry.isDirectory()) await gas(filename);
    else if (/\.(js|gs)$/.test(entry.name)) await syntax(await readFile(filename, 'utf8'), filename);
    else if (entry.name.endsWith('.html')) await html(filename);
    else if (entry.name.endsWith('.json')) JSON.parse(await readFile(filename, 'utf8'));
  }
  return true;
}
try {
  const config = JSON.parse(await readFile(path.join(root, 'config/integrations.json'), 'utf8')).production;
  for (const name of ['index.html', 'operator.html']) {
    const source = await html(path.join(root, name));
    if (!source.includes(config.webAppUrl)) throw new Error(`${name}: GAS endpoint differs from integration inventory`);
    const id = name === 'index.html' ? config.liffId : config.googleClientId;
    if (!source.includes(id)) throw new Error(`${name}: identity configuration differs from inventory`);
  }
  await syntax(await readFile(path.join(root, 'operator-sw.js'), 'utf8'), 'operator-sw.js');
  const imported = await gas(path.join(root, 'gas/src'));
  if (imported && (await readFile(path.join(root,'operator.html'),'utf8')) !== (await readFile(path.join(root,'gas/src/operator.html'),'utf8'))) throw new Error('Root and GAS operator pages must use the same field contract.');
  console.log(`JavaScript syntax and frontend integration inventory passed (${checked} scripts).`);
  console.log(imported ? 'Imported GAS source syntax checked; runtime behavior requires separate GAS tests.' : 'GAS source NOT imported; backend syntax and behavior remain unverified.');
} finally {
  await rm(temp, { recursive: true, force: true });
}
