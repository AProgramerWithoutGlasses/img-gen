import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { connect, call, data, root } from '../../scripts/lib/figcraft.mjs';

const pageIds = [1157, 1418, 1622, 1957, 2174, 2247, 2508, 2647, 2766, 2969, 3285];
// Only these explicitly approved groups from the comparison page are implementation sources.
// Never inspect the whole comparison page: it also contains the old size and A/B references.
const approvedGroupIds = [3739, 3773, 3807];
const circleRoles = new Set(['button.upload', 'button.editor', 'button.close-editor', 'button.remove-attachment']);
const role = node => node?.pluginData?.handoffRole || '';
const radius = node => Array.isArray(node.cornerRadius) ? Math.max(...node.cornerRadius) : node.cornerRadius || 0;
const near = (actual, expected) => Math.abs(actual - expected) < 0.025;

export function innerErrors(outer, inner, inset = 2) {
  const edges = [inner.x, inner.y, outer.width - inner.x - inner.width, outer.height - inner.y - inner.height];
  const errors = [];
  if (!edges.every(edge => near(edge, inset))) errors.push(`四边内缩应为 ${inset}px，实际 ${edges.map(n => n.toFixed(3)).join('/')}`);
  const background = outer.children?.find(node => node.type === 'RECTANGLE' && near(node.x, 0) && near(node.y, 0) && near(node.width, outer.width) && near(node.height, outer.height) && radius(node) > 0);
  const visibleRadius = radius(outer) || radius(background || {});
  const outerRadius = circleRoles.has(role(outer)) ? Math.min(outer.width, outer.height) / 2 : Math.min(visibleRadius, outer.width / 2, outer.height / 2);
  if (!near(radius(inner), Math.max(0, outerRadius - inset))) errors.push(`内圆角应为外圆角减去内缩：${outerRadius - inset}，实际 ${radius(inner)}`);
  return errors;
}

export function validateTrees(trees) {
  const errors = [];
  let roundedRectangles = 0, innerBorders = 0;
  function walk(node, parent, annotation = false, hidden = false) {
    if (node.pluginData?.referenceOnly === true || node.pluginData?.referenceOnly === 'true') return;
    annotation ||= role(node) === 'annotation';
    hidden ||= node.visible === false;
    if (!hidden && !annotation && parent?.clip && role(node) === 'button.upload' &&
      (node.x < -.025 || node.y < -.025 || node.x + node.width > parent.width + .025 || node.y + node.height > parent.height + .025)) {
      errors.push(`${node.id} ${node.name}: 上传圆钮超出已裁切父框，可见轮廓会被截断`);
    }
    const circularInner = parent && circleRoles.has(role(parent)) && node.strokes?.length && node.x <= 5 && node.y <= 5 && node.width > parent.width * .7 && node.height > parent.height * .7;
    const rectangle = ['RECTANGLE', 'FRAME', 'COMPONENT', 'INSTANCE'].includes(node.type);
    if (!hidden && !annotation && rectangle && radius(node) > 0 && role(node) !== 'review-scene' && !circleRoles.has(role(node)) && !circularInner) {
      roundedRectangles++;
      if (!near(node.cornerSmoothing ?? 0, .6)) errors.push(`${node.id} ${node.name}: 圆角平滑应为 iOS 60%`);
    }
    if (!hidden && !annotation && node.type === 'RECTANGLE' && parent) {
      const buttonInner = role(parent).startsWith('button.') && node.strokes?.length && node.x <= 5 && node.y <= 5 && node.width > parent.width * .7 && node.height > parent.height * .7;
      const attachmentInner = node.name === '附件条内描边';
      if (buttonInner || attachmentInner) {
        innerBorders++;
        for (const error of innerErrors(parent, node, attachmentInner ? 3 : 2)) errors.push(`${node.id} ${node.name}: ${error}`);
      }
    }
    for (const child of node.children || []) walk(child, node, annotation, hidden);
  }
  for (const tree of trees) walk(tree);
  return { errors, roundedRectangles, innerBorders };
}

function verifyRegressionGuard() {
  const outer = { width: 216, height: 40, cornerRadius: 20 };
  const fixed = { x: 2, y: 2, width: 212, height: 36, cornerRadius: 18 };
  assert.deepEqual(innerErrors(outer, fixed), []);
  // The real previous resize mistake: fractional insets and the old 16px radius.
  const oldResize = { x: 2.5, y: 2.444, width: 211, height: 35.112, cornerRadius: 16 };
  assert.equal(innerErrors(outer, oldResize).length, 2, '旧缩放错误必须同时触发内缩及圆角错误');
  const shape = { id: 1, type: 'RECTANGLE', name: '回归样本', width: 100, height: 40, cornerRadius: 12, cornerSmoothing: .6 };
  assert.equal(validateTrees([shape]).errors.length, 0);
  assert.equal(validateTrees([{ ...shape, cornerSmoothing: 0 }]).errors.length, 1, '漏设平滑必须被发现');
  const circle = { id: 2, type: 'FRAME', name: 'B圆钮', x: 0, y: -1, width: 38, height: 38, cornerRadius: 19, pluginData: { handoffRole: 'button.upload' } };
  const toolbar = { id: 3, type: 'FRAME', name: '36px工具栏', width: 440, height: 36, clip: false, children: [circle] };
  assert.equal(validateTrees([toolbar]).errors.length, 0);
  assert.equal(validateTrees([{ ...toolbar, clip: true }]).errors.length, 1, '36px工具栏裁切38px圆钮的真实错误必须被发现');
}

async function main() {
  verifyRegressionGuard();
  if (process.argv.includes('--self-test')) {
    console.log('Dialog geometry guard: valid geometry accepted; previous resize, missing smoothing and clipped optical circle rejected.');
    return;
  }
  const document = resolve(root, 'design/对话框设计稿.figcraft').replaceAll('\\', '/');
  const client = await connect();
  try {
    const summary = data(await call(client, 'inspect_document', { document, depth: 0, fields: [] }));
    assert.equal(summary.path, document, '必须显式使用指定对话框稿');
    assert.equal(summary.dirty, false, '先保存设计稿，再校验');
    const trees = [];
    for (const id of [...pageIds, ...approvedGroupIds]) trees.push(data(await call(client, 'get_node', {
      document, id, depth: 18, maxBytes: 4_000_000,
      fields: ['name', 'type', 'visible', 'clip', 'x', 'y', 'width', 'height', 'cornerRadius', 'cornerSmoothing', 'strokes', 'pluginData'],
    })));
    const result = validateTrees(trees);
    assert(result.roundedRectangles > 0 && result.innerBorders > 0, '未找到本轮圆角组件或内框线');
    assert.deepEqual(result.errors, [], `缩放后几何不符合要求：\n${result.errors.slice(0, 30).join('\n')}`);
    console.log(JSON.stringify({ pages: pageIds.length, approvedComparisonGroups: approvedGroupIds.length, roundedRectangles: result.roundedRectangles, innerBorders: result.innerBorders, errors: 0, oldResizeRejected: true, clippedCircleRejected: true }));
  } finally { await client.close(); }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await main();
