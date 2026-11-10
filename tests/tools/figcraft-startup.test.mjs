import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
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

test('打开、验收与批量写入命令缺目标时提前失败，不连接或启动设计应用', () => {
  const missingExecutable = resolve(tmpdir(), `figcraft-uninstalled-${randomUUID()}`, 'figcraft.exe');
  assert.equal(existsSync(missingExecutable), false);
  for (const [action, args, message] of [
    ['open', [], '请指定本次目标稿'],
    ['verify', [], '请指定本次验收稿'],
    ['batch', [], '批量修改必须指定命令文件和目标稿'],
    ['batch', ['missing-commands.json'], '批量修改必须指定命令文件和目标稿'],
  ]) {
    assert.throws(() => execFileSync(process.execPath, [resolve(root, 'scripts/figcraft.mjs'), action, ...args], {
      cwd: root, encoding: 'utf8', windowsHide: true, stdio: 'pipe', timeout: 15_000,
      env: { ...process.env, FIGCRAFT_APP: missingExecutable, FIGCRAFT_CLI: missingExecutable },
    }), error => {
      assert.equal(error.status, 1);
      assert.ok(error.stderr.includes(message), `缺目标时应提示：${message}`);
      assert.ok(!error.stderr.includes(missingExecutable), '缺目标时不应访问设计应用安装路径');
      assert.doesNotMatch(error.stderr, /ENOENT/);
      return true;
    });
  }
});

function verifyFixture(t) {
  const temporary = mkdtempSync(resolve(tmpdir(), 'figcraft-verify-'));
  t.after(() => {
    assert.equal(dirname(temporary), resolve(tmpdir()));
    assert.ok(basename(temporary).startsWith('figcraft-verify-'));
    rmSync(temporary, { recursive: true, force: true });
  });
  mkdirSync(resolve(temporary, 'scripts/lib'), { recursive: true });
  mkdirSync(resolve(temporary, 'design'));
  for (const path of ['package.json', 'figcraft.config.json', 'scripts/figcraft.mjs', 'scripts/lib/figcraft.mjs']) {
    copyFileSync(resolve(root, path), resolve(temporary, path));
  }
  const defaultDocument = JSON.parse(readFileSync(resolve(temporary, 'figcraft.config.json'), 'utf8')).document;
  writeFileSync(resolve(temporary, defaultDocument), 'independent default design fixture');
  const target = resolve(temporary, 'design', `非默认目标-${randomUUID()}.figcraft`);
  const tracePath = resolve(temporary, 'cli-calls.jsonl');
  const auditPath = resolve(temporary, 'outputs/design-audit', `${basename(target)}.json`);
  const exportFolder = resolve(temporary, 'outputs/design-export', basename(target, '.figcraft'));
  const manifestPath = resolve(exportFolder, 'latest.json');
  writeFileSync(target, 'independent saved design fixture');
  const substitute = `
import { appendFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
const action = basename(process.argv[1]);
const [target, ...args] = process.argv.slice(2);
appendFileSync(process.env.FIGCRAFT_TEST_TRACE, JSON.stringify({ action, target, args }) + '\\n');
if (action === 'info') {
  console.log(JSON.stringify({
    pages: [{ name: 'Representative frame', nodes: 1 }],
    missingFonts: process.env.FIGCRAFT_TEST_AUDIT_FAILURE === 'font' ? ['Fixture Missing Font'] : [],
    notes: process.env.FIGCRAFT_TEST_AUDIT_FAILURE === 'note' ? ['Fixture audit warning'] : [],
  }));
} else if (action === 'export') {
  writeFileSync(resolve(args[args.indexOf('--out') + 1], 'frame.png'), 'fixture export');
  console.log('exported');
}
`;
  for (const action of ['info', 'export']) writeFileSync(resolve(temporary, action), substitute);
  const npmCli = [
    process.env.npm_execpath,
    resolve(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
    resolve(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js'),
    resolve(dirname(process.execPath), '../share/nodejs/npm/bin/npm-cli.js'),
  ].find(candidate => candidate && existsSync(candidate));
  assert.ok(npmCli, '需要本项目使用的 npm CLI 来验证实际 npm 脚本入口');
  return {
    target, auditPath, exportFolder, manifestPath,
    calls: () => readFileSync(tracePath, 'utf8').trim().split('\n').map(line => JSON.parse(line)),
    run: failure => execFileSync(process.execPath, [npmCli, 'run', 'design:verify', '--', target], {
      cwd: temporary, encoding: 'utf8', windowsHide: true, stdio: 'pipe', timeout: 30_000,
      env: {
        ...process.env,
        FIGCRAFT_APP: process.execPath,
        FIGCRAFT_CLI: process.execPath,
        FIGCRAFT_TEST_TRACE: tracePath,
        FIGCRAFT_TEST_AUDIT_FAILURE: failure ?? '',
      },
    }),
  };
}

test('design:verify 的 npm 入口对指定非默认稿审计并导出同一目标', t => {
  const fixture = verifyFixture(t);
  assert.notEqual(fixture.target, documentPath);
  fixture.run();
  const calls = fixture.calls();
  assert.ok(calls.some(call => call.action === 'info'), '必须实际执行审计 CLI');
  assert.ok(calls.some(call => call.action === 'export'), '必须实际执行导出 CLI');
  assert.ok(calls.every(call => call.target === fixture.target), '两步不能混入默认稿或其他目标');
  const audit = JSON.parse(readFileSync(fixture.auditPath, 'utf8'));
  const manifest = JSON.parse(readFileSync(fixture.manifestPath, 'utf8'));
  assert.equal(audit.input, fixture.target);
  assert.equal(manifest.input, fixture.target);
  assert.equal(audit.missingFonts.length, 0);
  assert.equal(readFileSync(resolve(manifest.results[0].folder, 'frame.png'), 'utf8'), 'fixture export');
  assert.equal(readFileSync(fixture.target, 'utf8'), 'independent saved design fixture');
});

for (const failure of ['font', 'note']) {
  test(`design:verify 审计${failure === 'font' ? '缺字体' : '有诊断'}时失败，不继续导出`, t => {
    const fixture = verifyFixture(t);
    assert.throws(() => fixture.run(failure), error => {
      assert.equal(error.status, 1);
      return true;
    });
    assert.ok(fixture.calls().every(call => call.action === 'info' && call.target === fixture.target), '审计失败时不能导出或切换目标');
    const audit = JSON.parse(readFileSync(fixture.auditPath, 'utf8'));
    assert.equal(audit.input, fixture.target);
    assert.ok(audit.missingFonts.length || audit.notes.length, '失败须来自已保存的审计诊断');
    assert.equal(existsSync(fixture.exportFolder), false, '审计失败不应生成导出目录或旧成功清单');
  });
}
