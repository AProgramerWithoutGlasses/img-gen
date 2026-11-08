// Check maintained layout boundaries without traversing dependencies or local evidence.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
  cwd: root, encoding: 'utf8', windowsHide: true,
}).split('\0').filter(file => file && existsSync(resolve(root, file)));
const errors = [];
for (const file of new Set(files)) {
  const business = /^(frontend\/src\/|internal\/|web\/|scripts\/)/.test(file) || !file.includes('/');
  if (business && /(?:_test\.go|\.(?:test|spec)\.[cm]?[jt]sx?|(?:^|\/)probe_[^/]+)$/.test(file)) {
    errors.push(`${file}: 测试请放 tests/ 或 frontend/tests/，不要放业务目录。`);
  }
  if (/^(frontend\/src|internal|web)\/(?:.*\/)?(?:testdata|fixtures|__tests__)\//.test(file)) {
    errors.push(`${file}: 测试专用样本请放独立测试目录。`);
  }
}
for (const file of ['AGENTS.md', '.codex/config.toml', 'docs/workflow.md']) {
  const text = readFileSync(resolve(root, file), 'utf8');
  if (/[A-Z]:[\\/]Users[\\/][^\r\n`'"]+[\\/](?:ui-studio|img-gen)/i.test(text)) {
    errors.push(`${file}: 共享规则不能绑定某个人的项目绝对路径。`);
  }
}
if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
else console.log('结构检查：测试目录与共享配置边界通过。');
