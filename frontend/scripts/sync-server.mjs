import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const dist = new URL('../dist/', import.meta.url);
const target = new URL('../../web/studio/', import.meta.url);
const targetPath = resolve(fileURLToPath(target));
await readdir(dist);
await mkdir(target, { recursive: true });
// Only clean this script's generated subtree, never the legacy web sources.
for (const file of await readdir(target)) {
  const child = resolve(targetPath, file);
  if (dirname(child) !== targetPath) throw new Error('Generated path escaped web/studio');
  await rm(child, { recursive: true, force: true });
}
await cp(dist, target, { recursive: true });
console.log('Embedded frontend prepared: ' + fileURLToPath(target));
