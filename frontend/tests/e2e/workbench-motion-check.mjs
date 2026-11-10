// Real production frontend, local API/image fixtures only. No generation requests.
import { chromium, expect } from '@playwright/test';
import { preview } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const output = new URL('../../outputs/workbench-motion/', import.meta.url);
await mkdir(output, { recursive: true });
const server = await preview({ root, preview: { host: '127.0.0.1', port: 4184, strictPort: true } });
const origin = 'http://127.0.0.1:4184';
const fixture = '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><rect width="1600" height="900" fill="#b7c8b5"/><path d="M0 900L1600 0" stroke="#52614f" stroke-width="20"/></svg>';
const startedAt = Date.now();
const user = { id: 'fixture-user', username: 'fixture', role: 'admin', status: 'enabled', balance: 100, createdAt: new Date(startedAt).toISOString() };
const models = [
  ['gpt-image-2', 'GPT Image 2'], ['gpt-image-1.5', 'GPT Image 1.5'],
  ['gpt-image-2.5-sunburst', 'GPT Image 2.5 Sunburst'],
  ['gemini-3.1-flash-image', 'Gemini 3.1 Flash Image'], ['gemini-3-pro-image', 'Gemini 3 Pro Image'],
].map(([id, name]) => ({ id, name, qualities: [], resolutions: [], ratios: ['自动', '1:1', '16:9'] }));
const options = { modelId: 'gpt-image-2', ratio: '16:9', count: 2 };
const batch = {
  id: 'fixture-batch', userId: user.id, username: user.username, prompt: '清晨的山谷，柔和自然光',
  attachments: [], options, status: 'processing', imageIds: [],
  createdAt: new Date(startedAt - 10000).toISOString(), cost: 2,
};
const state = {
  version: 1, assets: [],
  folders: [{ id: 'folder-one', userId: user.id, name: '测试文件夹', createdAt: user.createdAt }],
  generations: [batch], users: [user], currentUserId: user.id,
  prices: Object.fromEntries(models.map(model => [model.id, 1])), priceUpdatedAt: {}, priceVersions: {},
};
const asset = {
  id: 'output-one', name: '本地结果.png', url: '/api/images/output-one',
  thumbnailUrl: '/api/images/output-one/thumbnail/1', previewUrl: '/api/images/output-one/preview/1',
  width: 1600, height: 900, userId: user.id, createdAt: user.createdAt,
  batchId: batch.id, outputIndex: 0, prompt: batch.prompt, options, folderIds: [],
};

const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined });
const errors = [], results = [], screenshots = [];
let page, failure, imageRequests = 0, releaseImage;
const heldImage = new Promise(resolve => { releaseImage = resolve; });
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 }, colorScheme: 'light', reducedMotion: 'no-preference',
  });
  page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await context.route('**/api/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() !== 'GET') {
      errors.push(`Unexpected write blocked: ${request.method()} ${path}`);
      return route.fulfill({ status: 405, json: { error: '本地验证禁止写请求' } });
    }
    if (path === '/api/studio/state') return route.fulfill({ json: state });
    if (path === '/api/studio/models') return route.fulfill({ json: models });
    if (path.startsWith('/api/images/')) {
      imageRequests++;
      await heldImage;
      return route.fulfill({ contentType: 'image/svg+xml', body: fixture });
    }
    errors.push(`Unexpected API request: ${path}`);
    return route.fulfill({ status: 404, json: { error: 'Unknown fixture route' } });
  });
  // Accelerate the wait without issuing extra image-generation requests.
  await page.clock.install({ time: new Date(startedAt) });
  await page.goto(origin);
  const creation = page.getByRole('region', { name: '图像创作', exact: true });
  const cards = creation.locator('.result-card');
  await expect(cards).toHaveCount(2);
  const first = cards.nth(0), second = cards.nth(1);
  const progress = first.getByRole('progressbar');
  const percent = async () => Number(await progress.getAttribute('aria-valuenow'));
  const screenshot = async name => {
    await page.screenshot({ path: fileURLToPath(new URL(name + '.png', output)), animations: 'disabled' });
    screenshots.push(name + '.png');
  };
  const initial = await percent();
  expect(initial).toBeGreaterThan(0);
  expect(initial).toBeLessThan(95);
  await page.clock.fastForward(20000);
  await expect.poll(percent).toBeGreaterThan(initial);
  const advanced = await percent();
  await page.clock.fastForward(120000);
  await expect(progress).toHaveAttribute('aria-valuenow', '95');
  await page.clock.fastForward(300000);
  await expect(progress).toHaveAttribute('aria-valuenow', '95');
  await screenshot('waiting-95-light');
  results.push({ name: 'waiting-progress-increases-and-caps', initial, advanced, maximum: await percent() });

  // A successful state response is insufficient: the image loader is still held.
  state.assets.push(asset);
  batch.imageIds.push(asset.id);
  const imageState = page.waitForResponse(response => response.url().endsWith('/api/studio/state'));
  await page.clock.fastForward(2000);
  await imageState;
  await expect(first.locator('img')).toHaveCount(1);
  await expect.poll(() => imageRequests).toBeGreaterThan(0);
  await expect(progress).toHaveAttribute('aria-valuenow', '95');
  await expect(first.locator('.result-open')).toBeDisabled();
  await expect(first).toContainText('正在载入');
  results.push({ name: 'undecoded-image-does-not-complete', progress: await percent() });

  // Record actual visible transition states so the short 100% phase cannot be
  // missed by a polling assertion. The final frame must become clear and usable.
  await page.evaluate(() => {
    window.workbenchMotionEvidence = [];
    const capture = () => {
      const card = document.querySelector('.result-card');
      if (!card) return;
      const image = card.querySelector('img');
      const style = image && getComputedStyle(image);
      const sample = {
        percent: card.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow') ?? null,
        opacity: style ? Number(style.opacity) : null,
        filter: style?.filter ?? null,
      };
      const evidence = window.workbenchMotionEvidence;
      if (JSON.stringify(evidence.at(-1)) !== JSON.stringify(sample)) evidence.push(sample);
    };
    const observer = new MutationObserver(capture);
    observer.observe(document.querySelector('.workbench-stage'), { subtree: true, childList: true, attributes: true });
    window.stopWorkbenchMotionCapture = () => { capture(); observer.disconnect(); };
    capture();
  });
  releaseImage();
  await expect(first.locator('.result-open')).toBeEnabled();
  await expect(first.getByRole('progressbar')).toHaveCount(0);
  await expect(first.locator('img')).toHaveCSS('filter', 'none');
  await expect(first.locator('img')).toHaveCSS('opacity', '1');
  const motion = await page.evaluate(() => {
    window.stopWorkbenchMotionCapture();
    return window.workbenchMotionEvidence;
  });
  expect(motion.some(sample => sample.percent === '100'), 'decoded image reaches 100 before progress exits').toBe(true);
  expect(motion.some(sample => sample.percent === '100' && sample.opacity < 1 && sample.filter?.includes('blur')),
    'decoded image passes through a blurred translucent frame').toBe(true);
  await screenshot('first-image-revealed-light');
  results.push({ name: 'image-reveals-then-progress-exits', motion });

  batch.status = 'failed';
  batch.completedAt = new Date(startedAt + 450000).toISOString();
  batch.error = '本地验证：第二张图片生成失败';
  const failedState = page.waitForResponse(response => response.url().endsWith('/api/studio/state'));
  await page.clock.fastForward(2000);
  await failedState;
  await expect(second.getByRole('alert')).toContainText('生成失败');
  await expect(second.getByRole('progressbar')).toHaveCount(0);
  await page.clock.fastForward(60000);
  await expect(second.getByRole('progressbar')).toHaveCount(0);
  await expect(first.locator('.result-open')).toBeEnabled();
  await expect(first.locator('img')).toBeVisible();
  results.push({ name: 'failure-stops-progress-and-preserves-successful-image' });

  const actions = first.locator('.result-actions');
  await page.mouse.move(0, 0);
  await expect(actions).toHaveCSS('visibility', 'hidden');
  await expect(actions).toHaveCSS('opacity', '0');
  await first.hover();
  await expect(actions).toHaveCSS('opacity', '1');
  await expect(first.getByRole('button', { name: '继续修图', exact: true })).toBeVisible();
  await expect(first.getByRole('button', { name: '加入文件夹', exact: true })).toBeVisible();
  await expect(first.getByRole('button', { name: '下载', exact: true })).toBeVisible();
  await screenshot('hover-actions-light');
  await page.mouse.move(0, 0);
  await expect(actions).toHaveCSS('visibility', 'hidden');
  await expect(actions).toHaveCSS('opacity', '0');
  const imageBox = await first.locator('.result-open').boundingBox();
  await first.locator('.result-open').click({ position: { x: imageBox.width / 2, y: imageBox.height / 2 } });
  await expect(page.getByRole('dialog', { name: '图片预览', exact: true })).toBeVisible();
  await screenshot('image-center-preview');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '图片预览', exact: true })).toHaveCount(0);
  results.push({ name: 'hover-shows-leave-hides-and-center-opens-preview' });

  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('.nav-item').first()).toHaveCSS('color', 'rgb(242, 242, 242)');
  await page.mouse.move(0, 0);
  await screenshot('partial-success-dark');
  // A narrow result uses one overflow menu; its core actions remain reachable.
  await page.setViewportSize({ width: 320, height: 844 });
  await expect(first).toHaveClass(/result-card-compact/);
  await first.hover();
  await first.getByRole('button', { name: '更多图片操作', exact: true }).click();
  const menu = page.getByRole('menu', { name: '图片操作', exact: true });
  await expect(menu).toBeVisible();
  for (const name of ['继续修图', '加入文件夹', '下载'])
    await expect(menu.getByRole('menuitem', { name, exact: true })).toBeEnabled();
  await screenshot('compact-image-menu');
  await menu.getByRole('menuitem', { name: '加入文件夹', exact: true }).click();
  const folderPicker = page.getByRole('dialog', { name: '加入文件夹', exact: true });
  await expect(folderPicker).toBeVisible();
  await expect(folderPicker.getByRole('checkbox', { name: '测试文件夹', exact: true })).toBeEnabled();
  await folderPicker.getByRole('button', { name: '取消', exact: true }).click();
  results.push({ name: 'compact-result-menu-keeps-edit-folder-download' });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: '展开侧栏', exact: true }).click();
  const sidebar = page.getByRole('complementary', { name: '工作空间导航', exact: true });
  await expect(sidebar).toHaveClass(/is-mobile-open/);
  const foldersToggle = sidebar.getByRole('button', { name: '文件夹列表', exact: true });
  await expect(foldersToggle).toHaveAttribute('aria-expanded', 'true');
  await foldersToggle.click();
  await expect(foldersToggle).toHaveAttribute('aria-expanded', 'false');
  await foldersToggle.click();
  await expect(foldersToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(sidebar.getByRole('button', { name: '测试文件夹', exact: true })).toBeInViewport();
  await screenshot('mobile-390-folder-drawer');
  await sidebar.getByRole('button', { name: '测试文件夹', exact: true }).click();
  await expect(page).toHaveURL(/#\/gallery\/folder-one$/);
  await expect(sidebar).not.toHaveClass(/is-mobile-open/);
  await expect(page.getByRole('heading', { name: '测试文件夹', exact: true })).toBeVisible();
  await screenshot('mobile-390-folder-content');
  await page.getByRole('button', { name: '展开侧栏', exact: true }).click();
  await sidebar.getByRole('button', { name: '图像创作', exact: true }).click();
  await expect(page).toHaveURL(/#\/create$/);
  await expect(creation).toBeVisible();
  await expect(first.locator('.result-open')).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await screenshot('mobile-390-workbench');
  results.push({ name: 'mobile-390-drawer-folder-navigation-and-return' });
  expect(errors).toEqual([]);
} catch (cause) {
  failure = cause;
  if (page && !page.isClosed()) {
    try { await page.screenshot({ path: fileURLToPath(new URL('failure.png', output)) }); }
    catch { /* Preserve the original assertion when screenshot capture is unavailable. */ }
  }
} finally {
  releaseImage();
  await writeFile(new URL('regression.json', output), JSON.stringify({
    results, errors, screenshots, failure: failure ? String(failure.stack || failure) : null,
  }, null, 2));
  await browser.close();
  await new Promise(resolve => server.httpServer.close(resolve));
}
if (failure) throw failure;
console.log(JSON.stringify({ results, errors, screenshots }));
