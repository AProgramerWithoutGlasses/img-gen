import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const script = fileURLToPath(new URL('../../scripts/ci-scope.mjs', import.meta.url));
const expected = (...enabled) => Object.fromEntries(['business', 'frontend', 'backend', 'integration', 'tools', 'docs']
  .map(name => [name, name === 'docs' || enabled.includes(name)]));
const documentation = expected();
const ui = expected('business', 'frontend', 'integration');
const server = expected('business', 'backend', 'integration');
const tools = expected('tools');
const full = expected('business', 'frontend', 'backend', 'integration', 'tools');

async function repository(t) {
  const root = await mkdtemp(join(tmpdir(), 'imggen-ci-scope-'));
  t.after(async () => {
    assert.equal(dirname(root), resolve(tmpdir()));
    assert.ok(basename(root).startsWith('imggen-ci-scope-'));
    await rm(root, { recursive: true, force: true });
  });
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true, stdio: 'pipe' }).trim();
  const put = async (path, value = 'fixture') => {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), value);
  };
  const commit = () => {
    git('add', '-A');
    git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture');
    return git('rev-parse', 'HEAD');
  };
  git('init', '-b', 'main');
  await put('README.md', 'base');
  let head = commit();
  const output = join(root, '.git', 'ci-output');
  const run = async (base, checkedHead = head) => {
    await writeFile(output, '');
    execFileSync(process.execPath, [script], {
      cwd: root, windowsHide: true, stdio: 'pipe',
      env: { ...process.env, CHANGE_BASE: base, CHANGE_HEAD: checkedHead, GITHUB_OUTPUT: output },
    });
    return Object.fromEntries((await readFile(output, 'utf8')).trim().split('\n').map(line => {
      const [name, value] = line.split('=');
      assert.ok(value === 'true' || value === 'false');
      return [name, value === 'true'];
    }));
  };
  const change = async (path, value = 'new fixture') => {
    const base = head;
    await put(path, value);
    head = commit();
    return run(base);
  };
  return { root, git, put, run, change, head: () => head, save: () => { head = commit(); return head; } };
}

test('真实 Git 文档、设计与研究变更只运行基础文档检查', async t => {
  const repo = await repository(t);
  for (const path of ['README.md', 'docs/workflow.md', 'design/reference.figcraft', 'research/example/result.json',
    'frontend/README.md', 'internal/AGENTS.md', 'tests/README.md', '.github/pull_request_template.md']) {
    assert.deepEqual(await repo.change(path), documentation, path);
  }
  assert.deepEqual(await repo.run(repo.head()), documentation, '空差异不启动业务检查');
});

test('真实 Git 按前后端及工具归属触发，源码内 Markdown 不误当文档', async t => {
  const repo = await repository(t);
  for (const [paths, wanted] of [
    [['frontend/src/App.tsx', 'frontend/src/help.md', 'frontend/public/logo.svg', 'frontend/package.json',
      'frontend/package-lock.json', 'frontend/vite.config.ts', 'frontend/tsconfig.json',
      'frontend/scripts/build.mjs', 'frontend/tests/e2e/dialog-check.mjs'], ui],
    [['main.go', 'go.mod', 'go.sum', 'internal/studio/store.go', 'web/legacy.html',
      'tests/go/store_test.go', 'tests/fixtures/sample.jpg'], server],
    [['scripts/project-status.mjs', 'scripts/lib/figcraft.mjs', 'tests/tools/project-status.test.mjs',
      'tests/design/figcraft-smoke.mjs', 'figcraft.config.json'], tools],
  ]) {
    for (const path of paths) assert.deepEqual(await repo.change(path), wanted, path);
  }
});

test('共享构建入口、契约、CI 与未知路径保留全部检查', async t => {
  const repo = await repository(t);
  for (const path of ['.github/workflows/ci.yml', '.github/actions/setup/action.yml',
    'scripts/ci-scope.mjs', 'scripts/prepare-release.mjs', 'scripts/lib/frontend-build.mjs',
    'package.json', 'package-lock.json', '.npmrc', 'docs/api-contract.md', 'unknown/input.toml',
    'tests/probes/probe_example.py', 'tests/probes/probe_example.go']) {
    assert.deepEqual(await repo.change(path), full, path);
  }
});

test('删除与跨目录重命名保留旧归属，混合改动取并集', async t => {
  const repo = await repository(t);
  await repo.change('frontend/src/removed.ts');
  assert.deepEqual(await repo.change('frontend/src/removed.ts', 'modified source'), ui, '修改现有源码仍检查前端');
  let base = repo.head();
  await rm(join(repo.root, 'frontend/src/removed.ts'));
  repo.save();
  assert.deepEqual(await repo.run(base), ui, '删除前端源码仍检查前端');

  await repo.change('frontend/src/moved.ts', 'identical rename payload');
  base = repo.head();
  await mkdir(join(repo.root, 'docs'), { recursive: true });
  await rename(join(repo.root, 'frontend/src/moved.ts'), join(repo.root, 'docs/moved.md'));
  repo.save();
  assert.deepEqual(await repo.run(base), ui, '移入文档后仍检查旧前端路径');

  await repo.change('frontend/src/cross-owner.ts', 'identical cross-owner payload');
  base = repo.head();
  await mkdir(join(repo.root, 'internal/studio'), { recursive: true });
  await rename(join(repo.root, 'frontend/src/cross-owner.ts'), join(repo.root, 'internal/studio/cross-owner.go'));
  repo.save();
  assert.deepEqual(await repo.run(base), expected('business', 'frontend', 'backend', 'integration'), '跨端改名检查两端');

  base = repo.head();
  await repo.put('frontend/src/new.ts');
  await repo.put('internal/studio/new.go');
  await repo.put('scripts/local-tool.mjs');
  repo.save();
  assert.deepEqual(await repo.run(base), full, '混合改动合并每个归属');
});

test('首推、无效或不可读取的 Git 基线安全回退到全部检查', async t => {
  const repo = await repository(t);
  for (const [base, head] of [
    ['0'.repeat(40), repo.head()], ['', repo.head()], ['not-a-ref', repo.head()],
    ['1'.repeat(40), repo.head()], [repo.head(), '0'.repeat(40)], [repo.head(), 'missing'],
  ]) assert.deepEqual(await repo.run(base, head), full, `${base || '(empty)'} -> ${head}`);
});
