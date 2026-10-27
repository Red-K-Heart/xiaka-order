import { lstat, readdir, readFile, mkdtemp, mkdir, writeFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
export const production = JSON.parse(await readFile(new URL('../config/integrations.json', import.meta.url), 'utf8')).production;

// Accept only source files, never a clasp credential/config file or spreadsheet data.
export async function readExport(directory) {
  const files = new Map();
  async function walk(current, prefix = '') {
    if ((await lstat(current)).isSymbolicLink()) throw new Error('Source symlinks are not supported.');
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error('Source symlinks are not supported.');
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const relative = prefix + entry.name;
      const filename = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(filename, `${relative}/`);
      else if (entry.isFile() && (relative === 'appsscript.json' || /\.(gs|js|html)$/i.test(relative))) {
        files.set(relative, await readFile(filename));
      }
    }
  }
  await walk(directory);
  if (!files.has('appsscript.json')) throw new Error('Export must include the original appsscript.json; do not invent a manifest.');
  JSON.parse(files.get('appsscript.json').toString('utf8'));
  if (![...files.keys()].some(name => /\.(gs|js)$/i.test(name))) throw new Error('Export contains no GAS server-side source.');
  // If the export carries project identity, it must match the requested project.
  try {
    const clasp = JSON.parse(await readFile(path.join(directory, '.clasp.json'), 'utf8'));
    if (clasp.scriptId !== production.scriptId) throw new Error('Export scriptId does not match the requested production project.');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return files;
}

export async function assertNotImported(root = repositoryRoot) {
  for (const name of ['src', 'import-record.json']) {
    try {
      await lstat(path.join(root, 'gas', name));
      throw new Error('GAS was already imported. Refusing to overwrite; import a fresh copy separately and review its diff.');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

export async function importExport(directory, root = repositoryRoot, method = 'local-export') {
  await assertNotImported(root);
  const files = await readExport(directory);
  const gasDirectory = path.join(root, 'gas');
  await mkdir(gasDirectory, { recursive: true });
  const stage = await mkdtemp(path.join(gasDirectory, '.import-'));
  try {
    const hashes = {};
    for (const [name, content] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
      const filename = path.join(stage, name);
      await mkdir(path.dirname(filename), { recursive: true });
      await writeFile(filename, content);
      hashes[name] = createHash('sha256').update(content).digest('hex');
    }
    // All validation/copying completes before the tracked source directory appears.
    await assertNotImported(root);
    await rename(stage, path.join(gasDirectory, 'src'));
    await writeFile(path.join(gasDirectory, 'import-record.json'), JSON.stringify({
      scriptId: production.scriptId,
      method,
      sourceIdentity: method === 'clasp-clone' ? 'requested Apps Script ID' : 'user-supplied export; verify project identity before committing',
      sha256: hashes
    }, null, 2) + '\n', { flag: 'wx' });
    return files.size;
  } finally { await rm(stage, { recursive: true, force: true }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) throw new Error('Usage: npm run gas:import -- /path/to/exported/source-directory');
    const count = await importExport(path.resolve(process.argv[2]));
    console.log(`Imported ${count} files into gas/src. Review source for embedded secrets before git add; then run npm test.`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
