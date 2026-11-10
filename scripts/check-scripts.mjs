import { execFileSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
export async function checkScripts(root) {
  let count = 0;
  for (const folder of ['scripts', 'tests']) {
    for (const file of await readdir(resolve(root, folder), { recursive: true })) {
      if (file.endsWith('.mjs')) {
        execFileSync(process.execPath, ['--check', resolve(root, folder, file)], { windowsHide: true, stdio: 'inherit' });
        count++;
      }
    }
  }
  console.log(`Script syntax checked: ${count}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await checkScripts(fileURLToPath(new URL('../', import.meta.url)));
}
