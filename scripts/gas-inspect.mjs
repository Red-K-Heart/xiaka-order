import { inventory } from './gas-source.mjs';

try {
  const definitions = await inventory();
  const collisions = [...definitions].filter(([, locations]) => locations.length > 1);
  const changed = collisions.filter(([, locations]) => new Set(locations.map(x => x.sha256)).size > 1);
  console.log(`${definitions.size} global GAS function names; ${collisions.length} duplicated names, ${changed.length} with different source bodies.`);
  for (const [name, locations] of collisions) {
    console.log(`${name}: ${locations.map(x => `${x.file}:${x.line} (${x.arguments} arguments)`).join(' / ')}`);
  }
  if (collisions.length) {
    console.error('GAS deployment check FAILED: global function collisions must be resolved before deployment. Original snapshot was left unchanged.');
    process.exitCode = 1;
  } else console.log('No global function collisions detected. This is not a live GAS integration test.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
