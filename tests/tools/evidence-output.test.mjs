import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { evidenceOptions, prepareEvidenceOutput, repositoryRoot } from '../../frontend/tests/e2e/evidence-output.mjs';

async function workspace(t) {
  const parent = join(repositoryRoot, 'outputs');
  await mkdir(parent, { recursive: true });
  const path = await mkdtemp(join(parent, 'evidence-output-test-'));
  t.after(async () => {
    assert.equal(dirname(path), parent);
    assert.ok(basename(path).startsWith('evidence-output-test-'));
    await rm(path, { recursive: true, force: true });
  });
  return path;
}

test('默认目录兼容，指定绝对或仓库相对目录后证据写入指定位置且不覆盖正例', async t => {
  const path = await workspace(t);
  const passed = join(path, 'passed');
  const negative = join(path, 'negative space #中文');
  const options = { defaultDirectory: relative(repositoryRoot, passed), booleanFlags: ['--dialog-only'] };
  const positiveOutput = await prepareEvidenceOutput([], options);
  await writeFile(new URL('result.json', positiveOutput.url), 'passed');
  for (const selected of [negative, relative(repositoryRoot, negative)]) {
    const output = await prepareEvidenceOutput(['--dialog-only', '--output-dir', selected], options);
    assert.equal(output.path, negative);
    assert.ok(output.flags.has('--dialog-only'));
    await writeFile(new URL('result.json', output.url), 'expected negative');
    assert.equal(await readFile(new URL('result.json', positiveOutput.url), 'utf8'), 'passed');
    assert.equal(await readFile(join(negative, 'result.json'), 'utf8'), 'expected negative');
  }
  assert.equal(evidenceOptions([], { defaultDirectory: 'frontend/outputs/preview' }).path,
    resolve(repositoryRoot, 'frontend/outputs/preview'));
  assert.equal(evidenceOptions([], { defaultDirectory: 'frontend/outputs/workbench-motion' }).path,
    resolve(repositoryRoot, 'frontend/outputs/workbench-motion'));
});

test('缺值、非法值、重复及未知参数均在建目录前失败', async t => {
  const path = await workspace(t);
  const destination = join(path, 'must-not-exist');
  const options = { defaultDirectory: destination, booleanFlags: ['--dialog-only'] };
  for (const args of [
    ['--output-dir'], ['--output-dir', ''], ['--output-dir', '  '],
    ['--output-dir', '--dialog-only'], ['--output-dir', 'bad\0path'],
    ['--output-dir', destination, '--output-dir', destination],
    ['--output-dir', destination, '--unknown'],
    ['--dialog-only', '--dialog-only'],
  ]) {
    await assert.rejects(prepareEvidenceOutput(args, options), /output-dir|Unknown option|dialog-only/);
    assert.equal(existsSync(destination), false);
  }
});

test('两个真实浏览器入口均先拒绝错误参数，不启动服务器或建立输出目录', async t => {
  const path = await workspace(t);
  for (const script of ['preview-check.mjs', 'workbench-motion-check.mjs']) {
    const destination = join(path, script);
    const entry = fileURLToPath(new URL('../../frontend/tests/e2e/' + script, import.meta.url));
    assert.throws(() => execFileSync(process.execPath, [entry, '--output-dir', destination, '--unknown'], {
      cwd: path, encoding: 'utf8', stdio: 'pipe', windowsHide: true, timeout: 15_000,
    }), error => {
      assert.equal(error.status, 1);
      assert.match(error.stderr, /Unknown option: --unknown/);
      assert.doesNotMatch(error.stderr, /EADDRINUSE|browserType\.launch|Executable doesn't exist/);
      return true;
    });
    assert.equal(existsSync(destination), false);
  }
});
