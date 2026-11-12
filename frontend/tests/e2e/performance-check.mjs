// Browser regression for image scheduling. API data is synthetic; the production
// frontend and the browser's actual image loader/viewport decide what to fetch.
import { chromium, expect } from '@playwright/test';
import { preview } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const output = new URL('../../outputs/performance/', import.meta.url);
await mkdir(output, { recursive: true });
const server = await preview({ root, preview: { host: '127.0.0.1', port: 4176, strictPort: true } });
const origin = 'http://127.0.0.1:4176';
const fixture = '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="1280" height="720" fill="#d8e0db"/><path d="M0 720 900 0h380L380 720Z" fill="#b2c2b8"/></svg>';
const user = { id: 'fixture-user', username: 'fixture', role: 'admin', status: 'enabled', balance: 100, createdAt: '2026-11-07T00:00:00Z' };
const models = [
  ['gpt-image-2', 'GPT Image 2'], ['gpt-image-1.5', 'GPT Image 1.5'],
  ['gpt-image-2.5-sunburst', 'GPT Image 2.5 Sunburst'],
  ['gemini-3.1-flash-image', 'Gemini 3.1 Flash Image'], ['gemini-3-pro-image', 'Gemini 3 Pro Image'],
].map(([id, name]) => ({ id, name, qualities: [], resolutions: [], ratios: ['自动', '1:1'] }));
const options = { modelId: 'gpt-image-2', ratio: '自动', count: 1 };
const assets = Array.from({ length: 60 }, (_, i) => ({
  id: String(i), name: `fixture-${i}.jpg`, url: `/api/images/${i}`,
  thumbnailUrl: `/api/images/${i}/thumbnail/1`, previewUrl: `/api/images/${i}/preview/1`,
  width: 1280, height: 720, userId: user.id, createdAt: new Date(Date.UTC(2026, 10, 7, 0, i)).toISOString(),
  batchId: `batch-${i}`, outputIndex: 0, prompt: `fixture prompt ${i}`, options, folderIds: [],
}));
const state = { version: 1, assets, folders: [], generations: assets.map(a => ({
  id: a.batchId, userId: user.id, username: user.username, prompt: a.prompt, attachments: [],
  options, status: 'completed', imageIds: [a.id], createdAt: a.createdAt, cost: 1,
})), users: [user], currentUserId: user.id, prices: Object.fromEntries(models.map(m => [m.id, 1])), priceUpdatedAt: {}, priceVersions: {} };
const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined });
const errors = [], results = [];
try {
  for (const scale of [1, 2]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: scale });
    const page = await context.newPage();
    const images = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await context.route('**/api/**', async route => {
      const path = new URL(route.request().url()).pathname;
      if (path.startsWith('/api/images/')) {
        images.push(path);
        return route.fulfill({ contentType: 'image/svg+xml', body: fixture });
      }
      if (path === '/api/studio/state') return route.fulfill({ json: state });
      if (path === '/api/studio/models') return route.fulfill({ json: models });
      throw new Error('Unexpected API request: ' + path);
    });
    await page.goto(origin);
    const creation = page.getByRole('region', { name: '图像创作', exact: true });
    await expect(creation.getByTestId('generation-turn')).toHaveCount(1);
    await expect(creation.getByTestId('generation-turn')).toHaveAttribute('data-generation-id', 'batch-59');
    await expect(creation.locator('.workbench-prompt')).toHaveText('fixture prompt 59');
    await expect(creation.locator('.result-card img')).toHaveCount(1);
    const latest = creation.locator('.result-card img');
    await expect.poll(() => latest.evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
    await expect(latest).toBeInViewport();
    expect(images.length, 'opening the current batch must not download historical images').toBeLessThanOrEqual(2);
    expect(images.every(path => /^\/api\/images\/59\/(thumbnail|preview)\/1$/.test(path))).toBe(true);
    const displayed = await latest.boundingBox();
    const requiredEdge = 1280 * Math.min(displayed.width / 1280, displayed.height / 720) * scale;
    await expect(latest).toHaveAttribute('src', `/api/images/59/${requiredEdge <= 641 ? 'thumbnail' : 'preview'}/1`);
    results.push({ name: `history-${scale}x`, loaded: images.length, total: assets.length });
    await page.screenshot({ path: fileURLToPath(new URL(`history-${scale}x.png`, output)) });
    await latest.click();
    const previewImage = page.getByRole('dialog', { name: '图片预览', exact: true }).locator('.preview-stage img');
    await expect.poll(() => previewImage.evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
    expect(images.some(path => path.endsWith('/59/preview/1'))).toBe(true);
    await page.screenshot({ path: fileURLToPath(new URL(`preview-${scale}x.png`, output)) });
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '我的账户', exact: true }).click();
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('button', { name: '请求记录', exact: true }).click();
    const rows = page.locator('.request-thumbnails img');
    await expect(rows.first()).toBeVisible();
    expect(await rows.evaluateAll(imgs => imgs.every(img => img.src.endsWith('/thumbnail/1')))).toBe(true);
    expect(images.every(path => /\/(thumbnail|preview)\/1$/.test(path))).toBe(true);
    await page.screenshot({ path: fileURLToPath(new URL(`requests-${scale}x.png`, output)) });
    results.push({ name: `admin-thumbnails-${scale}x`, originalsRequested: 0 });
    await context.close();
  }
  // A slow unauthenticated read must finish before a fresh login is possible;
  // otherwise its late 401 can erase the new user's workspace.
  const guest = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const guestPage = await guest.newPage();
  guestPage.on('pageerror', e => errors.push(e.message));
  let releaseModels;
  const heldModels = new Promise(resolve => { releaseModels = resolve; });
  await guest.route('**/api/**', async route => {
    if (new URL(route.request().url()).pathname === '/api/studio/models') await heldModels;
    await route.fulfill({ status: 401, json: { error: '请先登录' } });
  });
  const stateRejected = guestPage.waitForResponse(r => new URL(r.url()).pathname === '/api/studio/state');
  await guestPage.goto(origin);
  expect((await stateRejected).status()).toBe(401);
  await guestPage.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  try { await expect(guestPage.getByRole('status')).toHaveText('正在载入…'); }
  finally { releaseModels(); }
  await expect(guestPage.getByRole('button', { name: '登录', exact: true })).toBeVisible();
  await guestPage.screenshot({ path: fileURLToPath(new URL('guest-ready.png', output)) });
  results.push({ name: 'guest-startup-settles-before-login', status: 'passed' });
  await guest.close();
  expect(errors).toEqual([]);
  await writeFile(new URL('regression.json', output), JSON.stringify({ results, errors }, null, 2));
  console.log(JSON.stringify({ results, errors }));
} finally { await browser.close(); await new Promise(resolve => server.httpServer.close(resolve)); }
