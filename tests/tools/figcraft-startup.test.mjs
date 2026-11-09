import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { appLaunchArguments, documentPath, requestedDocument, root } from '../../scripts/lib/figcraft.mjs';

test('没有显式目标时禁止启动兜底稿，指定稿保持为唯一启动文件', () => {
  assert.throws(() => appLaunchArguments(), { code: 'FIGCRAFT_NOT_RUNNING' });
  const target = resolve(root, 'design/startup-target-test.figcraft');
  const args = appLaunchArguments(target);
  assert.equal(args.at(-1), target);
  assert.ok(!args.includes(documentPath), '不能夹带旧兜底稿启动');
});

test('MCP 只有明确文件目标可以触发启动，目录及当前文档查询不隐式选稿', () => {
  assert.equal(requestedDocument('run_command', { command: 'doc.list' }), undefined);
  assert.equal(requestedDocument('inspect_document'), undefined);
  assert.equal(requestedDocument('inspect_document', { document: 1157 }), undefined);
  assert.equal(requestedDocument('inspect_document', { document: 'active-tab' }), undefined);
  const path = 'design/对话框设计稿.figcraft';
  assert.equal(requestedDocument('open_file', { path }), path);
  assert.equal(requestedDocument('inspect_document', { document: path }), path);
});

test('打开与批量写入命令缺目标时提前失败，不连接或启动设计应用', () => {
  for (const [action, args, message] of [
    ['open', [], '请指定本次目标稿'],
    ['batch', ['missing-commands.json'], '批量修改必须指定命令文件和目标稿'],
  ]) {
    assert.throws(() => execFileSync(process.execPath, [resolve(root, 'scripts/figcraft.mjs'), action, ...args], {
      cwd: root, encoding: 'utf8', windowsHide: true, stdio: 'pipe', timeout: 15_000,
    }), error => error.status === 1 && error.stderr.includes(message));
  }
});
