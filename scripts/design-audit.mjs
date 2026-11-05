import { readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { parseFigFile } from '@open-pencil/core/io/formats/fig';

// Read-only audit through OpenPencil's own parser; never modifies the design file.
const root = fileURLToPath(new URL('../', import.meta.url));
const input = resolve(process.argv[2] ?? resolve(root, 'design/start.fig'));
const started = performance.now();
const bytes = await readFile(input);
const graph = await parseFigFile(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), { populate: 'all' });
const nodes = [...graph.getAllNodes()];
const types = {};
let effects = 0;
for (const node of nodes) {
  types[node.type] = (types[node.type] ?? 0) + 1;
  effects += node.effects?.length ?? 0;
}
const pages = graph.getPages().map(page => ({
  name: page.name,
  nodes: graph.countDescendants(page.id),
  topLevel: page.childIds.length,
}));
const report = {
  input,
  sha256: createHash('sha256').update(bytes).digest('hex'),
  parserVersion: '0.16.0',
  bytes: (await stat(input)).size,
  totalNodes: nodes.length,
  pages,
  types,
  effects,
  parseAndCountMs: Math.round(performance.now() - started),
  warnings: nodes.length > 10000 ? ['超过此前 MCP 原子编辑触发的 10000 节点上限；这不是编辑器渲染极限。'] : [],
};
const output = resolve(root, 'outputs/design-audit');
await mkdir(output, { recursive: true });
await writeFile(resolve(output, basename(input) + '.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
