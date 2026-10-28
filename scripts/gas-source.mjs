import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import path from 'node:path';

export const sourceDirectory = fileURLToPath(new URL('../gas/src/', import.meta.url));

export async function loadGas(files, services = {}) {
  // This context has no require, process, fetch or real GAS services.
  // Only explicitly supplied in-memory service doubles are available.
  const context = vm.createContext({ ...services }, { codeGeneration: { strings: false, wasm: false } });
  for (const name of files) {
    const source = await readFile(path.join(sourceDirectory, name), 'utf8');
    new vm.Script(source, { filename: name }).runInContext(context, { timeout: 1000 });
  }
  return context;
}

export async function inventory() {
  const definitions = new Map();
  async function visit(directory, prefix = '') {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error('GAS source symlinks are not supported.');
      const name = prefix + entry.name;
      if (entry.isDirectory()) { await visit(path.join(directory, entry.name), `${name}/`); continue; }
      if (!/\.(js|gs)$/i.test(name)) continue;
      const source = await readFile(path.join(directory, entry.name), 'utf8');
      const context = await loadGas([name]);
      // Inspect actual globally exposed functions after parsing, not comments or strings.
      for (const key of Object.keys(context).sort()) {
        if (typeof context[key] !== 'function') continue;
        const body = context[key].toString();
        const offset = source.indexOf(body);
        if (offset < 0) throw new Error(`Cannot locate global function ${key} in ${name}`);
        const definition = {
          file: name, line: source.slice(0, offset).split('\n').length,
          arguments: context[key].length,
          sha256: createHash('sha256').update(body).digest('hex')
        };
        const previous = definitions.get(key) || [];
        previous.push(definition);
        definitions.set(key, previous);
      }
    }
  }
  await visit(sourceDirectory);
  return definitions;
}
