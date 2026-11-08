import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { call, cli, command, data, documentPath, fileRoots, output, root } from '../../scripts/lib/figcraft.mjs';

const folder = resolve(output, 'figcraft-smoke', new Date().toISOString().replaceAll(':', '-'));
await mkdir(folder, { recursive: true });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const originalHash = sha(await readFile(documentPath));
const report = { mode: 'desktop MCP through project launcher', checks: [], folder };
const client = new Client({ name: 'UI Studio smoke test', version: '1.0.0' });
const transport = new StdioClientTransport({
  command: process.execPath, args: [resolve(root, 'scripts/figcraft-mcp.mjs')], cwd: root, stderr: 'pipe',
});
let originalDocument;
let testDocument;
const imageData = result => Buffer.from(result.content.find(part => part.type === 'image').data, 'base64');
try {
  await client.connect(transport);
  const tools = (await client.listTools()).tools;
  for (const name of ['batch', 'inspect_document', 'save_file', 'screenshot', 'undo', 'redo']) assert(tools.some(tool => tool.name === name));
  report.toolCount = tools.length;
  await writeFile(resolve(folder, 'tools.json'), JSON.stringify(tools, null, 2));
  originalDocument = (await command(client, 'doc.list')).find(doc => doc.active)?.id;
  report.checks.push('official CLI MCP connects to the desktop through the project launcher');

  await command(client, 'file.new', { name: `UI Studio integration check ${Date.now()}` });
  testDocument = data(await call(client, 'inspect_document', { depth: 0 })).id;
  assert(testDocument !== undefined && testDocument !== originalDocument);
  const created = data(await call(client, 'batch', { document: testDocument, label: 'Temporary integration fixture', commands: [
    { command: 'node.create', as: 'frame', params: { type: 'frame', name: 'MCP check', width: 600, height: 220, props: { fill: '#FFFFFF', layout: 'vertical', padding: 24, gap: 12 } } },
    { command: 'node.create', params: { type: 'text', name: 'Title', parent: { $ref: 'frame' }, text: 'FigCraft 已连接 · 中文测试', props: { fontFamily: 'Microsoft YaHei', fontSize: 24, fill: '#172033' } } },
    { command: 'node.create', params: { type: 'text', name: 'Body', parent: { $ref: 'frame' }, text: '批量操作 / 保存重开 / 截图导出', props: { fontFamily: 'Microsoft YaHei', fontSize: 16, fill: '#475569' } } },
    { command: 'node.create', params: { type: 'rectangle', parent: { $ref: 'frame' }, width: 160, height: 36, props: { fill: '#2563EB', cornerRadius: 6 } } },
  ] }));
  const frameId = created[0].id;
  const getFrame = async () => data(await call(client, 'get_node', { document: testDocument, id: frameId, depth: 2 }));
  const before = await getFrame();
  assert.equal(before.children.length, 3);
  assert.equal(before.children[0].characters, 'FigCraft 已连接 · 中文测试');
  assert.equal(before.children[0].x, 24);
  assert.equal(before.children[1].y, before.children[0].y + before.children[0].height + 12);
  report.checks.push('batch step references, Chinese text and auto layout work on the live canvas');

  const failed = await client.callTool({ name: 'batch', arguments: { document: testDocument, commands: [
    { command: 'node.set', params: { ids: [created[1].id], props: { characters: 'Must be rolled back' } } },
    { command: 'text.set', params: { id: frameId, text: 'A frame is not a text node' } },
  ] } });
  assert.equal(failed.isError, true);
  assert.deepEqual(await getFrame(), before);
  report.checks.push('failed batch rolls back earlier edits');

  await call(client, 'undo', { document: testDocument });
  assert(!JSON.stringify(data(await call(client, 'inspect_document', { document: testDocument, depth: 2 }))).includes('MCP check'));
  await call(client, 'redo', { document: testDocument });
  assert.deepEqual(await getFrame(), before);
  report.checks.push('batch undo and redo preserve the subtree');

  const saved = resolve(folder, 'fixture.figcraft');
  await call(client, 'save_file', { document: testDocument, path: saved });
  const firstPng = imageData(await call(client, 'screenshot', { document: testDocument, ids: [frameId], maxSize: 1200 }));
  await writeFile(resolve(folder, 'live.png'), firstPng);
  let doc = (await command(client, 'doc.list')).find(entry => entry.id === testDocument);
  await command(client, 'file.close', { index: doc.index });
  testDocument = undefined;
  const reopened = data(await call(client, 'open_file', { path: saved }));
  testDocument = reopened.document.id;
  assert(reopened.opened.summary, 'Must read the saved file, not switch to an open tab');
  assert.deepEqual(await getFrame(), before);
  const secondPng = imageData(await call(client, 'screenshot', { document: testDocument, ids: [frameId], maxSize: 1200 }));
  assert.equal(sha(firstPng), sha(secondPng));
  report.checks.push('close/reopen reads disk and preserves the rendered pixels');

  const offlinePng = resolve(folder, 'offline.png');
  await cli(['export', saved, '--node', String(frameId), '--out', offlinePng, ...fileRoots]);
  assert.equal(sha(await readFile(offlinePng)), sha(firstPng));
  report.checks.push('offline CLI export matches the live desktop export');
  const info = JSON.parse((await cli(['info', saved, '--json', ...fileRoots])).stdout);
  assert.equal(info.pages.reduce((sum, page) => sum + page.nodes, 0), 4);
  assert.deepEqual(info.missingFonts, []);
  report.checks.push('saved-file audit sees four content nodes and no missing fonts');
  report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.error = error.stack; process.exitCode = 1;
} finally {
  try {
    if (testDocument !== undefined) {
      const doc = (await command(client, 'doc.list')).find(entry => entry.id === testDocument);
      if (doc) await command(client, 'file.close', { index: doc.index, force: true });
    }
    if (originalDocument !== undefined) {
      const original = (await command(client, 'doc.list')).find(entry => entry.id === originalDocument);
      if (original) await command(client, 'doc.switch', { index: original.index });
    }
    assert.equal(sha(await readFile(documentPath)), originalHash);
  } catch (error) {
    report.cleanupError = error.message; report.status = 'failed'; process.exitCode = 1;
  }
  await client.close();
  await writeFile(resolve(folder, 'report.json'), JSON.stringify(report, null, 2));
  await writeFile(resolve(output, 'figcraft-smoke/latest.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
