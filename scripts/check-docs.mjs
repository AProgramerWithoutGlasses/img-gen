// Validate maintained entry documents. Historical evidence may intentionally reference local outputs.
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const files = ['README.md', 'AGENTS.md', 'docs/README.md', 'docs/workflow.md',
  'docs/DEPLOYMENT.md', 'docs/history/README.md',
  'docs/api-contract.md', 'frontend/README.md',
  'frontend/AGENTS.md', 'internal/AGENTS.md', 'internal/studio/README.md',
  'design/README.md', 'tests/README.md', 'tests/probes/README.md',
  'research/README.md', 'research/AGENTS.md', 'docs/root-layout.md',
  'docs/providers/qiso/README.md'];
let checked = 0;
const failures = [];
for (const file of files) {
  const contents = (await readFile(resolve(root, file), 'utf8')).replace(/```[\s\S]*?```/g, '');
  for (const match of contents.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = match[1].replace(/^<|>$/g, '');
    if (/^(?:file:|[a-z]:[\\/]|\\\\)/i.test(target)) {
      failures.push(`${file}: ${target}（共享说明不能依赖本机文件；个人笔记请放仓库外并移除项目引用。）`);
      continue;
    }
    if (/^[a-z]+:/i.test(target) || target.startsWith('#')) continue;
    checked++;
    const path = decodeURIComponent(target.split('#')[0]);
    const destination = resolve(root, dirname(file), path);
    const fromRoot = relative(root, destination);
    if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
      failures.push(`${file}: ${target}（共享说明不能链接仓库外；个人笔记请保存在本机并移除项目引用。）`);
    } else if (!existsSync(destination)) failures.push(`${file}: ${target}`);
  }
}
console.log(`文档检查：${files.length} 份现行入口，${checked} 个本地链接，${failures.length} 个失效。`);
if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
}
