// Validate maintained entry documents. Historical evidence may intentionally reference local outputs.
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const files = ['README.md', 'AGENTS.md', 'docs/README.md', 'docs/workflow.md',
  'docs/DEPLOYMENT.md', 'docs/repository-layout.md', 'docs/studio-integration.md',
  'docs/efficiency.md', 'docs/api-contract.md', 'frontend/README.md',
  'frontend/AGENTS.md', 'internal/AGENTS.md', 'internal/studio/README.md',
  'design/README.md', 'tests/README.md', 'tests/probes/README.md',
  'research/README.md', 'research/AGENTS.md'];
let checked = 0;
const failures = [];
for (const file of files) {
  const contents = (await readFile(resolve(root, file), 'utf8')).replace(/```[\s\S]*?```/g, '');
  for (const match of contents.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = match[1].replace(/^<|>$/g, '');
    if (/^[a-z]+:/i.test(target) || target.startsWith('#')) continue;
    checked++;
    const path = decodeURIComponent(target.split('#')[0]);
    if (!existsSync(resolve(root, dirname(file), path))) failures.push(`${file}: ${target}`);
  }
}
console.log(`文档检查：${files.length} 份现行入口，${checked} 个本地链接，${failures.length} 个失效。`);
if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
}
