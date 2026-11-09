import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { appStatus, call, cli, command, connect, data, documentPath, fileRoots, output, prepare } from './lib/figcraft.mjs';

const [action, input, extra] = process.argv.slice(2);
const file = resolve(input ?? documentPath);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

async function savedInfo(path) {
  const result = await cli(['info', path, '--json', ...fileRoots]);
  return { ...JSON.parse(result.stdout), diagnostics: result.stderr };
}

async function main() {
  await prepare();
  if (action === 'audit') {
    const started = performance.now();
    const before = hash(await readFile(file));
    const info = await savedInfo(file);
    const after = hash(await readFile(file));
    if (before !== after) throw new Error('The file changed during audit; save it and retry.');
    const report = {
      input: file, source: 'saved file', sha256: after, bytes: (await stat(file)).size,
      cliVersion: (await cli(['--version'])).stdout, ...info,
      contentNodes: info.pages.reduce((total, page) => total + page.nodes, 0),
      elapsedMs: Math.round(performance.now() - started),
    };
    await mkdir(resolve(output, 'design-audit'), { recursive: true });
    const reportPath = resolve(output, 'design-audit', `${basename(file)}.json`);
    await writeFile(reportPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ contentNodes: report.contentNodes, pages: info.pages.length, missingFonts: info.missingFonts, notes: info.notes, report: reportPath }));
    if (info.missingFonts?.length || info.notes?.length) process.exitCode = 1;
    return;
  }
  if (action === 'export') {
    const info = await savedInfo(file);
    if (new Set(info.pages.map(page => page.name)).size !== info.pages.length) {
      throw new Error('Batch export requires unique page names because the installed CLI selects pages by name. Rename duplicate pages first.');
    }
    const folder = resolve(output, 'design-export', basename(file, '.figcraft'));
    await mkdir(folder, { recursive: true });
    // Unique run folders prevent stale images from earlier deleted frames being mistaken for new exports.
    const run = resolve(folder, new Date().toISOString().replaceAll(':', '-'));
    await mkdir(run);
    const results = [];
    for (const [index, page] of info.pages.entries()) {
      if (!page.nodes) { results.push({ page: page.name, skipped: 'empty page' }); continue; }
      const pageFolder = resolve(run, `page-${index + 1}`);
      await mkdir(pageFolder);
      const result = await cli(['export', file, '--page', page.name, '--format', 'png', '--scale', '1', '--out', pageFolder, ...fileRoots]);
      results.push({ page: page.name, folder: pageFolder, diagnostics: result.stderr });
    }
    await writeFile(resolve(folder, 'latest.json'), JSON.stringify({ input: file, run, results }, null, 2));
    console.log(JSON.stringify({ manifest: resolve(folder, 'latest.json'), results }));
    return;
  }
  if (!['open', 'status', 'snapshot', 'batch'].includes(action)) {
    throw new Error('Usage: figcraft.mjs open <file> | status | audit [file] | export [file] | snapshot [node-id] [document-path] | batch <commands.json> <document-path>');
  }
  if (action === 'open' && !input) throw new Error('请指定本次目标稿：npm run design:open -- "design/目标.figcraft"');
  if (action === 'batch' && (!input || !extra)) throw new Error('批量修改必须指定命令文件和目标稿：npm run design:batch -- commands.json "design/目标.figcraft"');
  if (action === 'status') {
    const state = await appStatus();
    if (!state.running) { console.log(JSON.stringify({ ...state, documents: [], message: 'FigCraft 未运行；未启动应用或打开设计稿。' })); return; }
  }
  const target = action === 'open' ? file : extra ? resolve(extra) : undefined;
  const client = await connect({ document: target });
  try {
    if (action === 'open') {
      const opened = data(await call(client, 'open_file', { path: target }));
      if (opened.opened?.stale) throw new Error('The open document differs from disk. Save or explicitly reload it after reviewing changes.');
      console.log(JSON.stringify({ document: target, opened: opened.opened }));
    } else if (action === 'status') {
      const catalog = await client.listTools();
      console.log(JSON.stringify({ version: (await cli(['--version'])).stdout, tools: catalog.tools.length, documents: await command(client, 'doc.list') }, null, 2));
    } else if (action === 'snapshot') {
      await mkdir(resolve(output, 'design-preview'), { recursive: true });
      const path = resolve(output, 'design-preview/canvas.png');
      const manifest = resolve(output, 'design-preview/latest.json');
      let result;
      try {
        result = await call(client, 'screenshot', { ...(target ? { document: target } : {}), maxSize: 1800, ...(input ? { ids: [input] } : {}) });
      } catch (error) {
        if (input || !error.message.includes('the current page is empty: nothing to render')) throw error;
        await rm(path, { force: true });
        const skipped = { document: target ?? 'current', skipped: 'empty page', capturedAt: new Date().toISOString() };
        await writeFile(manifest, JSON.stringify(skipped, null, 2));
        console.log(JSON.stringify(skipped));
        return;
      }
      const png = result.content.find(part => part.type === 'image');
      if (!png) throw new Error('FigCraft returned no PNG');
      await writeFile(path, Buffer.from(png.data, 'base64'));
      await writeFile(manifest, JSON.stringify({ document: target ?? 'current', path, capturedAt: new Date().toISOString() }, null, 2));
      console.log(path);
    } else {
      if (!input) throw new Error('A JSON command file is required.');
      const commands = JSON.parse(await readFile(resolve(input), 'utf8'));
      if (!Array.isArray(commands) || !commands.length) throw new Error('Expected a nonempty array of {command, params, as?}.');
      // Explicit document targeting avoids silently editing whichever tab the user last clicked.
      const result = data(await call(client, 'batch', { document: target, label: basename(input), commands }));
      // Do not retry automatically after a transport error: the edit may already have succeeded.
      await call(client, 'save_file', { document: target });
      await mkdir(resolve(output, 'design-batch'), { recursive: true });
      await writeFile(resolve(output, 'design-batch/latest.json'), JSON.stringify(result, null, 2));
      console.log(JSON.stringify({ document: target, steps: commands.length, saved: true, result: resolve(output, 'design-batch/latest.json') }));
    }
  } finally { await client.close(); }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
