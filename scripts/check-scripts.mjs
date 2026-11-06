import { execFileSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const files = (await readdir(root, { recursive: true })).filter(file => file.endsWith('.mjs'));
for (const file of files) execFileSync(process.execPath, ['--check', resolve(root, file)], { windowsHide: true, stdio: 'inherit' });
console.log(`Script syntax checked: ${files.length}`);
