import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { collectStatus } from '../project-status.mjs';

async function repository(t) {
  const root = await mkdtemp(join(tmpdir(), 'ui-studio-status-'));
  t.after(async () => {
    assert.equal(dirname(root), resolve(tmpdir()));
    assert.ok(basename(root).startsWith('ui-studio-status-'));
    await rm(root, { recursive: true, force: true });
  });
  const git = (...args) => execFileSync('git', args, { cwd: root, windowsHide: true, encoding: 'utf8', stdio: 'pipe' }).trim();
  git('init', '-b', 'main');
  git('config', 'user.name', 'Status test');
  git('config', 'user.email', 'status-test@example.invalid');
  await writeFile(join(root, '.gitignore'), '.env\n');
  await writeFile(join(root, '.env'), 'PRIVATE_TEST_VALUE_DO_NOT_DISPLAY');
  await mkdir(join(root, 'design'));
  await writeFile(join(root, 'design/start.figcraft'), 'saved draft');
  git('add', '.');
  git('-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture');
  return { root, git };
}

test('本地状态区分未推送提交、未提交改动和已保存原稿，不读取密钥正文', async t => {
  const { root, git } = await repository(t);
  git('remote', 'add', 'origin', root);
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  git('branch', '--set-upstream-to=origin/main');
  await writeFile(join(root, 'note.md'), 'committed change');
  git('add', 'note.md');
  git('-c', 'commit.gpgsign=false', 'commit', '-m', 'local work');
  await writeFile(join(root, 'note.md'), 'unsaved to Git');
  const result = await collectStatus({ root });
  assert.equal(result.branch, 'main');
  assert.equal(result.upstream, 'origin/main');
  assert.equal(result.ahead, 1);
  assert.equal(result.behind, 0);
  assert.equal(result.changes.length, 1);
  assert.match(result.changes[0], /note\.md$/);
  assert.equal(result.design.savedBytes, 11);
  assert.equal(result.remote, undefined);
  assert.ok(!JSON.stringify(result).includes('PRIVATE_TEST_VALUE_DO_NOT_DISPLAY'));
});

test('没有上游或缺少本地产物时仍可查看状态，不把缺失误报为已准备', async t => {
  const { root } = await repository(t);
  const result = await collectStatus({ root });
  assert.equal(result.upstream, null);
  assert.equal(result.ahead, null);
  assert.deepEqual(result.changes, []);
  assert.equal(result.dependencies.frontend, false);
  assert.equal(result.dependencies.design, false);
  assert.equal(result.embeddedFrontend, false);
});

test('远程查询读取真实 Git 引用并发现过时跟踪记录，不修改工作区或跟踪引用', async t => {
  const { root, git } = await repository(t);
  git('remote', 'add', 'origin', root);
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  git('branch', '--set-upstream-to=origin/main');
  const oldTracking = git('rev-parse', 'origin/main');
  await writeFile(join(root, 'new.md'), 'new commit');
  git('add', 'new.md');
  git('-c', 'commit.gpgsign=false', 'commit', '-m', 'advance main');
  const result = await collectStatus({ root, remote: true });
  assert.equal(result.remote.reachable, true);
  assert.equal(result.remote.main, git('rev-parse', 'HEAD'));
  assert.equal(result.remote.matchesLocalTracking, false);
  assert.equal(git('rev-parse', 'origin/main'), oldTracking);
  assert.equal(git('status', '--porcelain'), '');
});

test('远程不可用时明确失败，不把缓存引用当作已连接', async t => {
  const { root, git } = await repository(t);
  git('remote', 'add', 'origin', join(root, 'missing.git'));
  const result = await collectStatus({ root, remote: true });
  assert.equal(result.remote.reachable, false);
  assert.equal(result.remote.reason, 'repository-or-auth');
  assert.equal(result.remote.main, undefined);
});
