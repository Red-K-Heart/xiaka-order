import { access, mkdtemp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { repositoryRoot, production, assertNotImported, importExport } from './gas-import.mjs';

let stage;
try {
  if (process.argv.length !== 2) throw new Error('gas:pull accepts no extra commands or project IDs.');
  await assertNotImported();
  const auth = path.resolve(process.env.CLASP_AUTH_FILE || path.join(homedir(), '.clasprc.json'));
  try { await access(auth); }
  catch { throw new Error('No clasp OAuth file is available. See docs/integration.md; never paste credentials into chat.'); }
  const local = path.join(repositoryRoot, '.local');
  await mkdir(local, { recursive: true });
  stage = await mkdtemp(path.join(local, 'gas-pull-'));
  const cli = path.join(repositoryRoot, 'node_modules/@google/clasp/build/src/index.js');
  // clone is read-only remotely; no push, run, version or deployment command exists here.
  const result = spawnSync(process.execPath, [cli, '--auth', auth, 'clone', production.scriptId], {
    cwd: stage, stdio: 'inherit', env: process.env
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`clasp clone failed (exit ${result.status}); no source was imported.`);
  const count = await importExport(stage, repositoryRoot, 'clasp-clone');
  console.log(`Downloaded and imported ${count} original GAS files. Review before committing; no remote files were changed.`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { if (stage) await rm(stage, { recursive: true, force: true }); }
