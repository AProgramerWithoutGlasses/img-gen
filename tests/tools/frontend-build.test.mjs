import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { adoptInstalledDependencies, dependencyState, frontendState, installedDependenciesMatch,
  readJSON, rememberFrontend, reusableFrontend } from '../../scripts/lib/frontend-build.mjs';

const repository = fileURLToPath(new URL('../../', import.meta.url));
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'imggen-build-reuse-'));
  t.after(async () => {
    assert.equal(dirname(root), resolve(tmpdir()));
    assert.ok(basename(root).startsWith('imggen-build-reuse-'));
    await rm(root, { recursive: true, force: true });
  });
  const put = async (path, value) => {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), typeof value === 'string' ? value : JSON.stringify(value));
  };
  const git = (...args) => execFileSync('git', args, { cwd: root, windowsHide: true, stdio: 'pipe', encoding: 'utf8' }).trim();
  git('init', '-b', 'main');
  await put('.gitignore', '.local/\nfrontend/dist/\nfrontend/node_modules/\nweb/\n');
  await put('frontend/package.json', { name: 'build-reuse-fixture', version: '1.0.0', private: true });
  await put('frontend/package-lock.json', { lockfileVersion: 3, packages: { '': { name: 'build-reuse-fixture', version: '1.0.0' } } });
  await put('frontend/node_modules/.package-lock.json', { lockfileVersion: 3, packages: {} });
  await put('frontend/src/main.ts', 'initial source');
  await put('frontend/vite.config.ts', 'initial config');
  await put('frontend/tsconfig.json', '{}');
  await put('frontend/dist/index.html', '<script src="asset.js"></script>');
  await put('frontend/dist/asset.js', 'initial output');
  await cp(join(root, 'frontend/dist'), join(root, 'web/studio'), { recursive: true });
  const dependencies = await dependencyState(root, 'fixture-npm');
  const state = await frontendState(root, dependencies.buildKey, {});
  const receipt = await rememberFrontend(root, state);
  return { root, put, git, dependencies, state, receipt };
}

test('普通构建记录可供发布复用；提交及文档变化不让相同前端输入失效', async t => {
  const { root, put, git, dependencies, state, receipt } = await fixture(t);
  assert.equal(await installedDependenciesMatch(root, dependencies), false);
  assert.equal(await adoptInstalledDependencies(root, dependencies), true, '验证现有安装后可采用，不需要 npm ci');
  assert.equal(await installedDependenciesMatch(root, dependencies), true);
  assert.deepEqual(await reusableFrontend(root, state), receipt);
  await put('docs/release.md', 'documentation only');
  git('add', '.');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture');
  assert.deepEqual(await frontendState(root, dependencies.buildKey, {}), state);
  assert.deepEqual(await reusableFrontend(root, state), receipt);
});

test('源码、未跟踪资源、配置、构建环境或依赖变化均阻止复用旧产物', async t => {
  const { root, put, dependencies, state } = await fixture(t);
  for (const [path, original, changed] of [
    ['frontend/src/main.ts', 'initial source', 'changed source'],
    ['frontend/vite.config.ts', 'initial config', 'changed config'],
    ['frontend/tsconfig.json', '{}', '{"strict":true}'],
  ]) {
    await put(path, changed);
    const current = await frontendState(root, dependencies.buildKey, {});
    assert.notEqual(current.key, state.key);
    assert.equal(await reusableFrontend(root, current), null);
    await put(path, original);
  }
  await put('frontend/public/new-untracked.svg', '<svg/>');
  assert.equal(await reusableFrontend(root, await frontendState(root, dependencies.buildKey, {})), null);
  await rm(join(root, 'frontend/public/new-untracked.svg'));
  assert.equal(await reusableFrontend(root, await frontendState(root, dependencies.buildKey, { VITE_EXAMPLE: 'changed' })), null);
  const otherNpm = await dependencyState(root, 'different-npm');
  assert.notEqual(otherNpm.key, dependencies.key, 'npm版本变化需要重新核对安装');
  assert.deepEqual(await frontendState(root, otherNpm.buildKey, {}), state, '实际安装和编译工具未变时不重复构建');
  await put('frontend/package-lock.json', { lockfileVersion: 3, packages: { '': { name: 'changed-lock' } } });
  assert.equal(await reusableFrontend(root, await frontendState(root, (await dependencyState(root, 'fixture-npm')).buildKey, {})), null);
});

test('dist 或嵌入副本损坏、缺失及多余文件均阻止复用，不能只认摘要记录', async t => {
  const { root, put, state } = await fixture(t);
  for (const path of ['frontend/dist/asset.js', 'web/studio/asset.js']) {
    await put(path, 'damaged output');
    assert.equal(await reusableFrontend(root, state), null);
    await put(path, 'initial output');
    assert.ok(await reusableFrontend(root, state));
  }
  await put('web/studio/stale.js', 'stale');
  assert.equal(await reusableFrontend(root, state), null);
  await rm(join(root, 'web/studio/stale.js'));
  await rm(join(root, 'frontend/dist/asset.js'));
  assert.equal(await reusableFrontend(root, state), null);
});

test('锁文件不匹配或实际缺依赖时不把现有安装记录为可复用', async t => {
  const { root, put } = await fixture(t);
  await put('frontend/package.json', { name: 'build-reuse-fixture', version: '1.0.0', dependencies: { toy: '1.0.0' } });
  await put('frontend/package-lock.json', { lockfileVersion: 3, packages: {
    '': { dependencies: { toy: '1.0.0' } }, 'node_modules/toy': { version: '1.0.0' },
  } });
  await put('frontend/node_modules/.package-lock.json', { lockfileVersion: 3, packages: { 'node_modules/toy': { version: '2.0.0' } } });
  assert.equal(await adoptInstalledDependencies(root, await dependencyState(root, 'fixture-npm')), false);
  await put('frontend/node_modules/.package-lock.json', { lockfileVersion: 3, packages: { 'node_modules/toy': { version: '1.0.0' } } });
  assert.equal(await adoptInstalledDependencies(root, await dependencyState(root, 'fixture-npm')), false, '锁元数据一致也不能掩盖实际缺失的依赖');
});

test('真实构建入口成功后记录缓存；构建中源码变化时拒绝更新记录', async t => {
  const { root, put, git } = await fixture(t);
  const actualPackage = JSON.parse(await readFile(join(repository, 'frontend/package.json'), 'utf8'));
  const fakePackages = { typescript: { version: '1.0.0' }, vite: { version: '1.0.0' } };
  await put('frontend/package.json', { name: 'build-reuse-fixture', version: '1.0.0', scripts: { build: actualPackage.scripts.build }, devDependencies: { typescript: '1.0.0', vite: '1.0.0' } });
  const packages = Object.fromEntries(Object.entries(fakePackages).map(([name, value]) => ['node_modules/' + name, value]));
  await put('frontend/package-lock.json', { lockfileVersion: 3, packages: { '': { devDependencies: { typescript: '1.0.0', vite: '1.0.0' } }, ...packages } });
  await put('frontend/node_modules/.package-lock.json', { lockfileVersion: 3, packages });
  for (const [name, value] of Object.entries(fakePackages)) await put(`frontend/node_modules/${name}/package.json`, { name, ...value });
  await put('frontend/node_modules/typescript/bin/tsc', 'process.exit(0)');
  await put('frontend/node_modules/vite/bin/vite.js', `const fs = require('node:fs'); if (process.env.FIXTURE_MUTATE) fs.writeFileSync('src/main.ts', 'changed during build');`);
  for (const path of ['frontend/scripts/build.mjs', 'scripts/lib/frontend-build.mjs']) {
    await put(path, await readFile(join(repository, path), 'utf8'));
  }
  git('add', '.');
  const npmCli = process.env.npm_execpath;
  const args = npmCli ? [npmCli, 'run', 'build'] : [join(root, 'frontend/scripts/build.mjs')];
  const run = environment => execFileSync(process.execPath, args, { cwd: join(root, 'frontend'), windowsHide: true, encoding: 'utf8', stdio: 'pipe', env: { ...process.env, ...environment } });
  run({ FIXTURE_MUTATE: '' });
  const receiptPath = join(root, '.local/release-cache/frontend.json');
  const successful = await readJSON(receiptPath);
  assert.ok(successful?.outputs['index.html']);
  assert.throws(() => run({ FIXTURE_MUTATE: '1' }), error => {
    assert.equal(error.status, 1);
    assert.match(error.stderr, /inputs changed during build/);
    return true;
  });
  assert.deepEqual(await readJSON(receiptPath), successful);
});
