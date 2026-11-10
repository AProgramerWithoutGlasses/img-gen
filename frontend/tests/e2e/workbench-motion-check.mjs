// Real production frontend, local API/image fixtures only. No generation requests.
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { prepareEvidenceOutput } from './evidence-output.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const { url: output } = await prepareEvidenceOutput(process.argv.slice(2), {
  defaultDirectory: 'frontend/outputs/workbench-motion',
});
const [{ chromium, expect }, { preview }] = await Promise.all([
  import('@playwright/test'), import('vite'),
]);
const server = await preview({ root, preview: { host: '127.0.0.1', port: 4184, strictPort: true } });
const origin = 'http://127.0.0.1:4184';
// Fine edges make blur visible; 4:3 deliberately differs from the auto frame.
const fixture = '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900"><defs><linearGradient id="sky" x2="0" y2="1"><stop stop-color="#6f93ab"/><stop offset="1" stop-color="#d8ddcf"/></linearGradient><pattern id="grass" width="24" height="36" patternUnits="userSpaceOnUse"><path d="M3 36 8 9M15 36 20 18" stroke="#d5c887" stroke-width="3"/></pattern></defs><path fill="url(#sky)" d="M0 0h1200v900H0z"/><circle cx="900" cy="150" r="65" fill="#f6e7bd"/><path d="M0 380 180 160 390 370 600 190 880 410 1050 230 1200 400V900H0Z" fill="#6d7b7d"/><path d="m112 241 68-81 95 95-94-36ZM525 262l75-72 105 83-98-37Z" fill="#e5e8df"/><path d="M0 520 220 400 470 560 720 410 1200 510V900H0Z" fill="#647866"/><path d="M640 480C850 570 375 625 620 900H890C520 670 1030 600 700 480Z" fill="#90b9bc" stroke="#d0ddd4" stroke-width="8"/><path d="M0 720Q170 650 370 780L450 900H0ZM1200 690Q1080 665 930 800L950 900h250Z" fill="url(#grass)"/><g fill="#233b30" stroke="#79916f" stroke-width="5"><path d="m120 470-50 130h100Z"/><path d="m230 510-45 120h90Z"/><path d="m1050 460-65 165h130Z"/></g></svg>';
const startedAt = Date.now();
const user = { id: 'fixture-user', username: 'fixture', role: 'admin', status: 'enabled', balance: 100, createdAt: new Date(startedAt).toISOString() };
const models = [
  ['gpt-image-2', 'GPT Image 2'], ['gpt-image-1.5', 'GPT Image 1.5'],
  ['gpt-image-2.5-sunburst', 'GPT Image 2.5 Sunburst'],
  ['gemini-3.1-flash-image', 'Gemini 3.1 Flash Image'], ['gemini-3-pro-image', 'Gemini 3 Pro Image'],
].map(([id, name]) => ({ id, name, qualities: [], resolutions: [], ratios: ['自动', '1:1', '16:9'] }));
const options = { modelId: 'gpt-image-2', ratio: '自动', count: 4 };
const batch = {
  id: 'fixture-batch', userId: user.id, username: user.username, prompt: '清晨的山谷，柔和自然光',
  attachments: [], options, status: 'processing', imageIds: [],
  createdAt: new Date(startedAt - 20000).toISOString(), cost: 4,
  outputs: [
    { outputIndex: 0, status: 'running', startedAt: new Date(startedAt - 12000).toISOString() },
    { outputIndex: 1, status: 'running', startedAt: new Date(startedAt - 3000).toISOString() },
    { outputIndex: 2, status: 'queued' },
    { outputIndex: 3, status: 'queued' },
  ],
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
  width: 1200, height: 900, userId: user.id, createdAt: user.createdAt,
  batchId: batch.id, outputIndex: 0, prompt: batch.prompt, options, folderIds: [],
};

const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined });
const errors = [], results = [], screenshots = [];
let page, failure, imageRequests = 0, releaseImage;
const heldImage = new Promise(resolve => { releaseImage = resolve; });
const captureErrors = target => {
  target.on('pageerror', error => errors.push(error.message));
  target.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
};
const routeFixture = async (context, fixtureState) => {
  await context.route('**/api/**', async route => {
    const request = route.request();
    const url = new URL(request.url()), path = url.pathname;
    if (request.method() !== 'GET') {
      errors.push(`Unexpected write blocked: ${request.method()} ${path}`);
      return route.fulfill({ status: 405, json: { error: '本地验证禁止写请求' } });
    }
    if (path === '/api/studio/state') return route.fulfill({ json: fixtureState });
    if (path === '/api/studio/models') return route.fulfill({ json: models });
    if (path === '/api/studio/images') {
      const folderId = url.searchParams.get('folderId') || 'all';
      const images = fixtureState.assets.filter(image => folderId === 'all' || (folderId === 'unfiled'
        ? !image.folderIds.length : image.folderIds.includes(folderId)));
      const offset = Number(url.searchParams.get('cursor') || 0), page = images.slice(offset, offset + 50);
      return route.fulfill({ json: { images: page, total: images.length,
        ...(offset + page.length < images.length ? { nextCursor: String(offset + page.length) } : {}) } });
    }
    if (path.startsWith('/api/images/')) {
      imageRequests++;
      await heldImage;
      return route.fulfill({ contentType: 'image/svg+xml', body: fixture });
    }
    errors.push(`Unexpected API request: ${path}`);
    return route.fulfill({ status: 404, json: { error: 'Unknown fixture route' } });
  });
};
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 }, colorScheme: 'light', reducedMotion: 'no-preference',
  });
  await routeFixture(context, state);
  page = await context.newPage();
  captureErrors(page);
  await page.goto(origin);
  await page.evaluate(() => document.fonts.ready);
  const creation = page.getByRole('region', { name: '图像创作', exact: true });
  const cards = creation.locator('.result-card');
  await expect(cards).toHaveCount(4);
  await expect(creation.locator('.workbench-status')).toHaveCount(0);
  await expect(creation.getByRole('button', { name: '查看完整提示词', exact: true })).toHaveCount(0);
  await expect(cards.locator('.result-select-control input[type="checkbox"]')).toHaveCount(0);
  const first = cards.nth(0), second = cards.nth(1), third = cards.nth(2), fourth = cards.nth(3);
  const progress = first.getByRole('progressbar');
  const screenshot = async (name, target = page, moving = false) => {
    await target.screenshot({ path: fileURLToPath(new URL(name + '.png', output)), animations: moving ? 'allow' : 'disabled' });
    screenshots.push(name + '.png');
  };
  const readFrames = () => cards.evaluateAll(elements => elements.map(element => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  }));
  const unchangedFrames = (before, after) => before.forEach((rect, index) => {
    for (const key of ['left', 'top', 'width', 'height'])
      expect(after[index][key], `Returned image must keep slot ${index + 1} ${key}`).toBeCloseTo(rect[key], 1);
  });
  const seconds = async card => Number((await card.locator('.result-generation-number').innerText()).match(/(\d+)\s*秒/)?.[1]);
  const acceptState = async change => {
    const response = page.waitForResponse(item => new URL(item.url()).pathname === '/api/studio/state');
    change();
    await response;
  };
  for (const card of [first, second]) {
    await expect(card).toContainText('正在生成');
    await expect(card.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
    await expect(card.locator('.result-generation-meta')).not.toContainText('%');
  }
  for (const card of [third, fourth]) {
    await expect(card).toContainText('排队中');
    await expect(card.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
    await expect(card.locator('.result-generation-number')).toHaveCount(0);
  }
  const runningSeconds = await Promise.all([seconds(first), seconds(second)]);
  expect(runningSeconds.every(Number.isFinite)).toBe(true);
  expect(runningSeconds[0] - runningSeconds[1], 'Each image uses its own server start time').toBeGreaterThanOrEqual(8);
  await expect.poll(async () => (await readFrames()).every(rect => rect.width > 0 && rect.height > 0)).toBe(true);
  const initialFrames = await readFrames();
  const initialColumns = await creation.locator('.workbench-stage').getAttribute('data-columns');
  await screenshot('mixed-running-queued-light');
  results.push({ name: 'real-output-status-and-independent-running-times', runningSeconds, initialFrames, initialColumns });

  // A successful state response is insufficient: the image loader is still held.
  await acceptState(() => {
    state.assets.push(asset);
    batch.imageIds.push(asset.id);
    batch.outputs[0] = { ...batch.outputs[0], status: 'succeeded', finishedAt: new Date().toISOString() };
  });
  await expect(first.locator('img')).toHaveCount(1);
  await expect.poll(() => imageRequests).toBeGreaterThan(0);
  await expect(progress).not.toHaveAttribute('aria-valuenow', '100');
  await expect(first.locator('.result-open')).toBeDisabled();
  await expect(first.locator('.result-select-control input[type="checkbox"]')).toHaveCount(0);
  await expect(first).toContainText('正在载入');
  await page.waitForTimeout(250); // Let any unintended layout transition settle.
  unchangedFrames(initialFrames, await readFrames());
  results.push({ name: 'server-success-awaits-image-decode-with-stable-four-slot-layout' });

  // Observe decode, then sample actual wall-clock frames. A fake clock or
  // animation-disabled screenshot would conceal the brief-fade regression.
  await page.evaluate(() => {
    window.workbenchDecodedAt = undefined;
    const capture = () => {
      const card = document.querySelector('.result-card');
      if (window.workbenchDecodedAt === undefined && card?.classList.contains('is-returned'))
        window.workbenchDecodedAt = performance.now();
    };
    const observer = new MutationObserver(capture);
    observer.observe(document.querySelector('.workbench-stage'), { subtree: true, childList: true, attributes: true });
    window.stopWorkbenchMotionCapture = () => observer.disconnect();
    capture();
  });
  releaseImage();
  await page.waitForFunction(() => Number.isFinite(window.workbenchDecodedAt));
  const samples = [];
  for (const targetMs of [180, 900, 1600]) {
    await page.evaluate(async target => {
      const remaining = window.workbenchDecodedAt + target - performance.now();
      if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining));
    }, targetMs);
    const sample = await first.evaluate(element => {
      const image = element.querySelector('img'), layer = element.querySelector('.result-generation-layer');
      const track = element.querySelector('[role="progressbar"]');
      const actions = element.querySelector('.result-actions');
      const style = getComputedStyle(image);
      return {
        elapsed: performance.now() - window.workbenchDecodedAt,
        opacity: Number(style.opacity),
        blur: Number(style.filter.match(/blur\(([\d.]+)px\)/)?.[1] ?? 0),
        progress: Number(track?.getAttribute('aria-valuenow')),
        progressText: Number(element.querySelector('.result-generation-number')?.textContent.match(/(\d+)%/)?.[1]),
        fillPercent: track ? track.firstElementChild.getBoundingClientRect().width / track.getBoundingClientRect().width * 100 : 0,
        overlayOpacity: layer ? Number(getComputedStyle(layer).opacity) : 0,
        disabled: element.querySelector('.result-open').disabled,
        actionsVisible: !!actions && getComputedStyle(actions).visibility !== 'hidden' && Number(getComputedStyle(actions).opacity) > .01,
      };
    });
    samples.push(sample);
    expect(sample.elapsed).toBeGreaterThanOrEqual(targetMs - 20);
    expect(sample.progress, 'The decoded image must not claim 100% before it is clear').toBeLessThan(100);
    expect(sample.progress).toBeGreaterThanOrEqual(0);
    expect(sample.progressText, 'Displayed percentage and accessible progress share the same clock').toBe(sample.progress);
    expect(Math.abs(sample.fillPercent - sample.progress), 'The visible white fill must follow the displayed percentage').toBeLessThan(1.5);
    expect(sample.disabled, 'Actions wait until the image has visibly revealed').toBe(true);
    expect(sample.actionsVisible).toBe(false);
    expect(sample.overlayOpacity).toBeGreaterThan(.5);
    await screenshot(`motion-${String(targetMs).padStart(4, '0')}ms`, first, true);
  }
  expect(samples[0].progress, 'The initial blurred preview holds before progress starts').toBe(0);
  expect(samples[1].progress, 'Presentation progress should move visibly instead of jumping to 100%').toBeGreaterThan(samples[0].progress + 10);
  expect(samples[2].progress).toBeGreaterThan(samples[1].progress + 10);
  expect(samples[2].fillPercent).toBeGreaterThan(samples[1].fillPercent);
  expect(samples[0].blur, 'Blur must remain visible, not flash for two frames').toBeGreaterThanOrEqual(15);
  expect(samples[0].opacity).toBeGreaterThanOrEqual(.3);
  expect(samples[0].opacity).toBeLessThan(.8);
  expect(samples[1].blur, 'The middle frame should still visibly reveal').toBeGreaterThan(6);
  expect(samples[1].blur).toBeLessThan(samples[0].blur);
  expect(samples[2].blur, 'Reveal remains perceptible after one and a half seconds').toBeGreaterThan(1);
  expect(samples[2].blur).toBeLessThan(samples[1].blur);
  await page.waitForFunction(() => document.querySelector('.result-card [role="progressbar"][aria-valuenow="100"]'));
  const completion = await first.evaluate(element => {
    const image = element.querySelector('img'), track = element.querySelector('[role="progressbar"]');
    const style = getComputedStyle(image);
    return { elapsed: performance.now() - window.workbenchDecodedAt,
      blur: Number(style.filter.match(/blur\(([\d.]+)px\)/)?.[1] ?? 0),
      opacity: Number(style.opacity),
      fillPercent: track.firstElementChild.getBoundingClientRect().width / track.getBoundingClientRect().width * 100,
    };
  });
  expect(completion.elapsed, '100% follows the full visible reveal, not an immediate completion flash').toBeGreaterThanOrEqual(1950);
  expect(completion.blur, 'The image is clear when presentation reaches 100%').toBe(0);
  expect(completion.opacity).toBe(1);
  expect(completion.fillPercent).toBeCloseTo(100, 0);
  await expect(first.locator('.result-open')).toBeEnabled();
  await expect(first.locator('.result-select-control input[type="checkbox"]')).toBeEnabled();
  const readyAfterMs = await page.evaluate(() => performance.now() - window.workbenchDecodedAt);
  expect(readyAfterMs, 'Finish, reveal and overlay exit form one perceptible sequence').toBeGreaterThanOrEqual(2200);
  await expect(first.getByRole('progressbar')).toHaveCount(0);
  await expect(first.locator('img')).toHaveCSS('filter', 'none');
  await expect(first.locator('img')).toHaveCSS('opacity', '1');
  await expect(first.locator('img')).toHaveCSS('object-fit', 'contain');
  unchangedFrames(initialFrames, await readFrames());
  await page.evaluate(() => window.stopWorkbenchMotionCapture());
  await screenshot('motion-ready', first);
  await screenshot('first-image-revealed-light');
  results.push({ name: 'visible-reveal-linked-to-completion-without-frame-resize', samples, completion, readyAfterMs });

  // A failed output stops even while its batch has other queued/running outputs.
  await acceptState(() => {
    batch.outputs[1] = { ...batch.outputs[1], status: 'failed', finishedAt: new Date().toISOString() };
    batch.outputs[2] = { outputIndex: 2, status: 'running', startedAt: new Date().toISOString() };
    batch.error = '本地验证：第二张图片生成失败';
  });
  await expect(second.getByRole('alert')).toContainText('生成失败');
  await expect(second.getByRole('progressbar')).toHaveCount(0);
  await expect(third).toContainText('正在生成');
  await expect(fourth).toContainText('排队中');
  await expect(first.locator('.result-open')).toBeEnabled();
  await expect(first.locator('img')).toBeVisible();
  for (const card of [second, third, fourth])
    await expect(card.locator('.result-select-control input[type="checkbox"]')).toHaveCount(0);
  results.push({ name: 'individual-failure-keeps-success-while-batch-is-processing' });

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
  await first.getByRole('checkbox', { name: '选择第 1 张图片', exact: true }).check();
  const selection = creation.getByRole('toolbar', { name: '已选图片操作', exact: true });
  await expect(selection).toContainText('已选 1 张');
  await expect(selection.getByRole('button', { name: '继续修图', exact: true })).toBeEnabled();
  await expect(selection.getByRole('button', { name: '加入文件夹', exact: true })).toBeEnabled();
  await expect(first).toHaveClass(/is-selected/);
  await screenshot('partial-success-selects-only-ready-image');
  await selection.getByRole('button', { name: '退出多选', exact: true }).click();
  await expect(selection).toHaveCount(0);
  await page.mouse.move(0, 0);
  await expect(actions).toHaveCSS('visibility', 'hidden');
  await expect(actions).toHaveCSS('opacity', '0');
  const imageBox = await first.locator('.result-open').boundingBox();
  await first.locator('.result-open').click({ position: { x: imageBox.width / 2, y: imageBox.height / 2 } });
  await expect(page.getByRole('dialog', { name: '图片预览', exact: true })).toBeVisible();
  await screenshot('image-center-preview');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '图片预览', exact: true })).toHaveCount(0);
  await creation.getByRole('button', { name: '本轮提示词', exact: true }).click();
  const promptDetails = page.getByRole('dialog', { name: '本轮提示词', exact: true });
  await expect(promptDetails).toContainText(batch.prompt);
  await page.keyboard.press('Escape');
  await expect(promptDetails).toHaveCount(0);
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
  await expect(menu.getByRole('menuitem', { name: '查看大图', exact: true })).toHaveCount(0);
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
  const folderRow = sidebar.locator('.nav-folder-row');
  const newFolder = folderRow.getByRole('button', { name: '新建文件夹', exact: true });
  await expect(newFolder).toBeVisible();
  const foldersIcon = folderRow.getByRole('button', { name: '文件夹管理', exact: true }).locator('svg.lucide-folders');
  await expect(foldersIcon).toHaveCount(1);
  expect(await foldersIcon.locator('path').count(), 'The folder-management icon should visibly contain stacked folders').toBeGreaterThanOrEqual(2);
  const toggleBox = await foldersToggle.boundingBox(), newFolderBox = await newFolder.boundingBox();
  expect(toggleBox.x + toggleBox.width, 'Folder-list arrow should sit to the left of the new-folder action').toBeLessThanOrEqual(newFolderBox.x + 1);
  for (const [label, control] of [['arrow', foldersToggle], ['new-folder', newFolder]]) {
    const geometry = await control.evaluate(button => {
      const box = button.getBoundingClientRect(), icon = button.querySelector('svg').getBoundingClientRect();
      return { width: box.width, height: box.height, iconWidth: icon.width, iconHeight: icon.height };
    });
    expect(geometry.width, `${label} should use the same compact hit area`).toBeCloseTo(28, 0);
    expect(geometry.height).toBeCloseTo(28, 0);
    expect(geometry.iconWidth).toBeCloseTo(16, 0);
    expect(geometry.iconHeight).toBeCloseTo(16, 0);
  }
  const folderLink = folderRow.getByRole('button', { name: '文件夹管理', exact: true });
  const readFolderHover = () => folderRow.evaluate(row => {
    const transparent = color => color === 'rgba(0, 0, 0, 0)' || color === 'transparent';
    const background = element => getComputedStyle(element).backgroundColor;
    return { row: background(row), linkClear: transparent(background(row.querySelector('.nav-folder-link'))),
      arrowClear: transparent(background(row.querySelector('.nav-folder-toggle'))),
      addClear: transparent(background(row.querySelector('.sidebar-new-folder'))) };
  });
  const expectFolderHover = async (highlighted, rowColor) => {
    await expect.poll(async () => {
      const state = await readFolderHover();
      return state.linkClear && state.arrowClear === (highlighted !== 'arrow') && state.addClear === (highlighted !== 'add')
        && state.row !== 'rgba(0, 0, 0, 0)' && state.row !== 'transparent'
        && (!rowColor || state.row === rowColor);
    }, 'The whole folder row should highlight while only the hovered or focused control gets its own small background').toBe(true);
    return (await readFolderHover()).row;
  };
  await folderLink.hover();
  const rowHoverColor = await expectFolderHover(null);
  await screenshot('mobile-390-folder-row-link-hover');
  await foldersToggle.hover();
  await expectFolderHover('arrow', rowHoverColor);
  await screenshot('mobile-390-folder-row-arrow-hover');
  await newFolder.hover();
  await expectFolderHover('add', rowHoverColor);
  await screenshot('mobile-390-folder-row-add-hover');
  await page.mouse.move(350, 100);
  await foldersToggle.focus();
  await page.keyboard.press('Tab');
  await expect(newFolder).toBeFocused();
  await expectFolderHover('add', rowHoverColor);
  await page.keyboard.press('Shift+Tab');
  await expect(foldersToggle).toBeFocused();
  await expectFolderHover('arrow', rowHoverColor);
  await screenshot('mobile-390-folder-row-keyboard-focus');
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

  for (const scenario of ['history', 'reduced-motion']) {
    const directContext = await browser.newContext({
      viewport: { width: 1440, height: 900 }, reducedMotion: scenario === 'reduced-motion' ? 'reduce' : 'no-preference',
    });
    const singleOptions = { ...options, count: 1 };
    const singleBatch = { ...batch, options: singleOptions, status: scenario === 'history' ? 'completed' : 'processing',
      outputs: [{ ...batch.outputs[0] }], error: undefined };
    await routeFixture(directContext, { ...state, generations: [singleBatch], assets: [{ ...asset, options: singleOptions }] });
    const directPage = await directContext.newPage();
    captureErrors(directPage);
    await directPage.addInitScript(() => {
      window.directRevealSeen = false;
      const observer = new MutationObserver(() => {
        if (document.querySelector('.result-card [role="progressbar"][aria-valuenow="100"]'))
          window.directRevealSeen = true;
      });
      observer.observe(document, { subtree: true, childList: true, attributes: true });
    });
    await directPage.goto(origin);
    const directCard = directPage.locator('.result-card').first();
    await expect(directCard.locator('.result-open')).toBeEnabled();
    await expect(directCard.locator('img')).toHaveCSS('filter', 'none');
    await expect(directCard.locator('img')).toHaveCSS('opacity', '1');
    await expect(directCard.getByRole('progressbar')).toHaveCount(0);
    expect(await directPage.evaluate(() => window.directRevealSeen), 'Historical/reduced-motion images must not replay completion animation').toBe(false);
    await screenshot(scenario + '-direct-clear', directPage);
    results.push({ name: scenario + '-displays-clear-without-replaying-reveal' });
    await directContext.close();
  }
  const changingMotionContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'no-preference' });
  const changingOptions = { ...options, count: 1 };
  await routeFixture(changingMotionContext, { ...state,
    generations: [{ ...batch, options: changingOptions, status: 'processing', outputs: [{ ...batch.outputs[0] }], error: undefined }],
    assets: [{ ...asset, options: changingOptions }],
  });
  const changingMotionPage = await changingMotionContext.newPage();
  captureErrors(changingMotionPage);
  await changingMotionPage.goto(origin);
  const changingCard = changingMotionPage.locator('.result-card').first();
  await expect(changingCard.getByRole('progressbar')).toHaveAttribute('aria-valuenow', /^\d+$/);
  await changingMotionPage.emulateMedia({ reducedMotion: 'reduce' });
  await expect(changingCard.locator('.result-open')).toBeEnabled();
  await changingMotionPage.waitForTimeout(900);
  await expect(changingCard.locator('.result-open')).toBeEnabled();
  await expect(changingCard.getByRole('progressbar')).toHaveCount(0);
  await expect(changingCard.locator('img')).toHaveCSS('filter', 'none');
  await screenshot('reduced-motion-change-direct-clear', changingMotionPage);
  results.push({ name: 'reduced-motion-change-cancels-presentation' });
  await changingMotionContext.close();
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
