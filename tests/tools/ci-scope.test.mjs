import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const script = fileURLToPath(new URL('../../scripts/ci-scope.mjs', import.meta.url));
test('真实 Git 差异让文档/研究跳过业务 CI，但源码和未知基线保留业务检查', async t => {
  const root = await mkdtemp(join(tmpdir(), 'imggen-ci-scope-'));
  t.after(async () => {
    assert.equal(dirname(root), resolve(tmpdir()));
    assert.ok(basename(root).startsWith('imggen-ci-scope-'));
    await rm(root, { recursive: true, force: true });
  });
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true, stdio: 'pipe' }).trim();
  git('init', '-b', 'main');
  const commit = () => { git('add', '.'); git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture'); return git('rev-parse', 'HEAD'); };
  await writeFile(join(root, 'README.md'), 'base');
  const base = commit();
  const output = join(root, '.git', 'ci-output');
  const run = async head => {
    await writeFile(output, '');
    execFileSync(process.execPath, [script], { cwd: root, windowsHide: true, stdio: 'pipe', env: { ...process.env, CHANGE_BASE: base, CHANGE_HEAD: head, GITHUB_OUTPUT: output } });
    return (await readFile(output, 'utf8')).trim();
  };
  await mkdir(join(root, 'research', 'example'), { recursive: true });
  await writeFile(join(root, 'research', 'example', 'report.md'), 'reference');
  await writeFile(join(root, 'README.md'), 'new docs');
  assert.equal(await run(commit()), 'business=false');
  await mkdir(join(root, 'frontend', 'src'), { recursive: true });
  await writeFile(join(root, 'frontend', 'src', 'App.tsx'), 'export default null');
  assert.equal(await run(commit()), 'business=true');
  assert.equal(await run('0'.repeat(40)), 'business=true');
});
