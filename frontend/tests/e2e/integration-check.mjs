// Run by TestStudioMySQLWorkflow against the actual Go HTTP server and empty MySQL fixture.
// The upstream image provider alone is replaced; no browser API routes are mocked.
import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { chooseDialogOption } from './dialog-check.mjs';

const origin = process.argv[2];
if (!origin?.startsWith('http://127.0.0.1:')) throw new Error('requires the local Go test server');
const output = new URL('../../outputs/integration/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await context.newPage();
const errors = [], results = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => {
  if (message.type() === 'error' && !/Failed to load resource: the server responded with a status of (401|409)/.test(message.text())) errors.push(message.text());
});
async function shot(name) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: fileURLToPath(new URL(name + '.png', output)) });
  results.push(name);
}
async function login(username, password = process.env.STUDIO_TEST_PASSWORD) {
  await page.getByLabel('用户名', { exact: true }).fill(username);
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('button', { name: '我的账户', exact: true })).toBeVisible();
}
async function logout() {
  await page.getByRole('button', { name: '我的账户', exact: true }).click();
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible();
}
async function openPictureSection(name) {
  const navigation = page.getByRole('navigation', { name: '主导航', exact: true });
  const expandSidebar = page.getByRole('button', { name: '展开侧栏', exact: true });
  if (await expandSidebar.count()) await expandSidebar.click();
  const galleryToggle = navigation.getByRole('button', { name: '我的图片', exact: true });
  if ((await galleryToggle.getAttribute('aria-expanded')) !== 'true') await galleryToggle.click();
  await expect(galleryToggle).toHaveAttribute('aria-expanded', 'true');
  const target = navigation.getByRole('button', { name, exact: true });
  await target.click();
}
async function openFolder(name) {
  await openPictureSection('文件夹管理');
  await page.getByRole('button', { name: '打开文件夹 ' + name, exact: true }).click();
}
try {
  const response = await page.goto(origin);
  expect(response.headers()['content-security-policy']).toContain("style-src 'self'");
  await login('admin');
  expect(await page.locator('.preview-badge').count()).toBe(0);
  await expect(page.locator('.balance-card')).toHaveCount(0);
  const estimate = page.getByRole('button', { name: '预计 2 积分', exact: true });
  await expect(estimate).toHaveText('2');
  await estimate.click();
  await expect(estimate).toHaveText('2');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await shot('01-authenticated');
  const creation = page.getByRole('region', { name: '图像创作', exact: true });
  const before = await creation.getByTestId('generation-turn').evaluateAll(nodes => nodes[0]?.getAttribute('data-generation-id') ?? null);
  await chooseDialogOption(page, creation.getByRole('combobox', { name: '模型', exact: true }), 'Gemini Image 3.1F');
  await chooseDialogOption(page, creation.getByRole('combobox', { name: '清晰度', exact: true }), '0.5K');
  await chooseDialogOption(page, creation.getByRole('combobox', { name: '图像比例', exact: true }), '21:9');
  await chooseDialogOption(page, creation.getByRole('combobox', { name: '生成数量', exact: true }), '1张');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  await page.getByLabel('上传图片文件').setInputFiles(Array.from({ length: 6 }, (_, i) => ({ name: `browser-${i}.png`, mimeType: 'image/png', buffer: png })));
  await expect(creation.locator('.attachment-item')).toHaveCount(6);
  for (const card of await creation.locator('.attachment-item').all()) await expect(card).toBeVisible();
  await shot('02-six-attachments');
  await creation.getByRole('textbox', { name: '提示词', exact: true }).fill('six-inputs browser');
  await creation.getByRole('button', { name: '生成', exact: true }).click();
  await expect(creation.getByTestId('generation-turn')).toHaveCount(1);
  await expect(creation.getByTestId('generation-turn')).toHaveAttribute('data-generation-id', /\S+/);
  if (before) await expect(creation.getByTestId('generation-turn')).not.toHaveAttribute('data-generation-id', before);
  await expect(creation.locator('.workbench-prompt')).toHaveText('six-inputs browser');
  await expect(creation.locator('.attachment-row')).toHaveCount(0);
  const result = creation.getByTestId('generation-turn').filter({ hasText: 'six-inputs browser' });
  await expect(result.locator('.result-open img')).toHaveCount(1, { timeout: 15000 });
  const width = await result.locator('.result-card').evaluate(el => el.getBoundingClientRect().width);
  expect(width).toBeGreaterThan(300); // React CSSOM geometry under the actual Go CSP.
  await result.getByRole('button', { name: '继续修图', exact: true }).click();
  await expect(creation.locator('.attachment-item')).toHaveCount(1);
  await expect(result.locator('.result-card')).toHaveCount(1);
  await creation.locator('.attachment-item').hover();
  await creation.locator('.attachment-remove').click();
  await expect(creation.locator('.attachment-row')).toHaveCount(0);
  const downloadEvent = page.waitForEvent('download');
  await result.getByRole('button', { name: '下载', exact: true }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toMatch(/\.png$/);
  expect(await download.failure()).toBeNull();
  await shot('03-generated-and-download');
  // Exercise the new display URLs through the real upload API, encoder, cache
  // and CSP, using a repository fixture rather than production image data.
  await page.getByLabel('上传图片文件', { exact: true }).setInputFiles(
    fileURLToPath(new URL('../../../tests/fixtures/thumbnail-sample.jpg', import.meta.url)));
  const uploaded = creation.locator('.dialog-attachment-card');
  await expect(uploaded).toHaveCount(1);
  const uploadedThumbnail = uploaded.locator('img');
  await expect(uploadedThumbnail).toHaveAttribute('src', /\/thumbnail\/1$/);
  await expect.poll(() => uploadedThumbnail.evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
  await uploaded.hover({ position: { x: 8, y: 48 } });
  const attachmentPreview = page.getByRole('region', { name: '参考图预览', exact: true });
  await expect(attachmentPreview).toHaveCSS('opacity', '1');
  await expect(attachmentPreview.locator('img')).toHaveAttribute('src', /\/preview\/1$/);
  await expect(attachmentPreview.locator('img')).toHaveCSS('opacity', '1');
  await shot('attachment-adaptive-real-go');
  await uploaded.getByRole('button', { name: '移除thumbnail-sample.jpg', exact: true }).click();
  await expect(creation.locator('.attachment-row')).toHaveCount(0);
  // Exercise real persisted personal usage, including partial settlement and pagination.
  const readState = async () => {
    const response = await context.request.get(origin + '/api/studio/state');
    expect(response.status()).toBe(200);
    return response.json();
  };
  let snapshot = await readState();
  const ownHistory = state => state.generations.filter(g => g.userId === state.currentUserId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  for (let i = ownHistory(snapshot).length; i < 11; i++) {
    const response = await context.request.post(origin + '/api/studio/generations', { data: {
      prompt: 'usage history browser fixture', attachmentIds: [],
      options: { modelId: 'gpt-image-2', ratio: '自动', count: 1 },
      requestId: randomBytes(16).toString('hex'), expectedCredits: snapshot.prices['gpt-image-2'],
    } });
    expect(response.status()).toBe(202);
  }
  await expect.poll(async () => {
    snapshot = await readState();
    return ownHistory(snapshot).some(g => g.status === 'processing');
  }, { timeout: 15000 }).toBe(false);
  await page.getByRole('button', { name: '我的账户', exact: true }).click();
  await page.getByRole('button', { name: '管理账户', exact: true }).click();
  const submenu = page.locator('#account-management-submenu');
  await expect(submenu.locator('svg')).toHaveCount(0);
  await expect(submenu.getByRole('button', { name: '账号设置', exact: true })).toBeVisible();
  await shot('07-account-history-menu');
  await submenu.getByRole('button', { name: '积分历史', exact: true }).click();
  await page.reload();
  await expect(page.locator('.settings-heading').getByRole('heading', { name: '积分历史', exact: true })).toBeVisible();
  const usage = page.getByRole('region', { name: '历史用量', exact: true });
  const expectedHistory = ownHistory(snapshot);
  const usageRows = usage.locator('tbody tr');
  await expect(usageRows).toHaveCount(10);
  for (let i = 0; i < 10; i++) {
    await expect(usageRows.nth(i).getByRole('cell').nth(2)).toHaveText(`${expectedHistory[i].imageIds.length} 张`);
    await expect(usageRows.nth(i).getByRole('cell').nth(3)).toHaveText(`${expectedHistory[i].cost} 积分`);
  }
  await expect(page.getByText('图片生成价格', { exact: true })).toHaveCount(0);
  await shot('08-personal-history-first-page');
  await usage.getByRole('button', { name: '下一页用量', exact: true }).click();
  await expect(usageRows).toHaveCount(1);
  await expect(usageRows.first().getByRole('cell').nth(3)).toHaveText(`${expectedHistory[10].cost} 积分`);
  await expect(usage.getByRole('button', { name: '下一页用量', exact: true })).toBeDisabled();
  await shot('09-personal-history-second-page');
  await usage.getByRole('button', { name: '上一页用量', exact: true }).click();
  await expect(usageRows).toHaveCount(10);
  const partialIndex = expectedHistory.findIndex(g => g.status === 'failed' && g.imageIds.length > 0);
  expect(partialIndex).toBeGreaterThanOrEqual(0);
  if (partialIndex >= 10) await usage.getByRole('button', { name: '下一页用量', exact: true }).click();
  const partialRow = usageRows.nth(partialIndex % 10);
  await expect(partialRow).toContainText('部分完成');
  await expect(partialRow.getByRole('cell').nth(3)).toHaveText('1 积分');
  await page.getByRole('button', { name: '返回创作', exact: true }).click();
  await openPictureSection('全部图片');
  const gallery = page.getByRole('region', { name: '我的图片', exact: true });
  const originalCount = await gallery.locator('.gallery-tile').count();
  for (const name of ['浏览器 A', '浏览器 B']) {
    await openPictureSection('文件夹管理');
    await page.getByRole('button', { name: '新建文件夹', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '新建文件夹', exact: true });
    await dialog.getByLabel('文件夹名称', { exact: true }).fill(name);
    await dialog.getByRole('button', { name: '创建', exact: true }).click();
    await expect(dialog).not.toBeVisible();
  }
  await openPictureSection('全部图片');
  await gallery.getByRole('button', { name: '选择图片', exact: true }).click();
  await gallery.getByRole('checkbox', { name: /^选中 / }).first().check();
  await gallery.getByRole('toolbar', { name: '图片整理' }).getByRole('button', { name: '加入文件夹', exact: true }).click();
  const picker = page.getByRole('dialog', { name: '加入文件夹', exact: true });
  for (const name of ['浏览器 A', '浏览器 B']) await picker.getByRole('checkbox', { name, exact: true }).check();
  await picker.getByRole('button', { name: '加入', exact: true }).click();
  await expect(picker).not.toBeVisible();
  await openFolder('浏览器 A');
  await expect(gallery.locator('.gallery-tile')).toHaveCount(1);
  await page.reload();
  await expect(gallery.locator('.gallery-tile')).toHaveCount(1);
  await gallery.locator('.gallery-folder-more').click();
  await gallery.getByRole('menuitem', { name: '删除文件夹', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '删除文件夹', exact: true }).click();
  await expect(gallery.locator('.gallery-tile')).toHaveCount(originalCount);
  await openFolder('浏览器 B');
  await expect(gallery.locator('.gallery-tile')).toHaveCount(1);
  await shot('04-folder-persistence');
  await page.getByRole('button', { name: '我的账户', exact: true }).click();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '模型价格', exact: true }).click();
  const price = page.getByRole('spinbutton', { name: 'GPT Image 2 单张积分', exact: true });
  await price.fill('3');
  // A second operator updates the price after this form has captured its version.
  const concurrent = await context.request.patch(origin + '/api/admin/prices/gpt-image-2', { data: { credits: 2, version: 1 } });
  expect(concurrent.status()).toBe(200);
  await price.locator('xpath=ancestor::tr').getByRole('button', { name: '保存价格', exact: true }).click();
  await expect(price.locator('xpath=ancestor::tr').getByRole('alert')).toContainText('价格已被修改');
  await expect(price).toHaveValue('3');
  await page.reload();
  await expect(price).toHaveValue('2');
  await price.fill('3');
  await price.locator('xpath=ancestor::tr').getByRole('button', { name: '保存价格', exact: true }).click();
  await expect(price.locator('xpath=ancestor::tr').getByRole('button', { name: '保存价格', exact: true })).toBeDisabled();
  await page.reload();
  await expect(price).toHaveValue('3');
  await page.getByRole('button', { name: '用户管理', exact: true }).click();
  await page.getByRole('button', { name: '创建用户', exact: true }).click();
  const create = page.getByRole('dialog', { name: '创建用户', exact: true });
  await create.getByRole('textbox', { name: /^用户名/ }).fill('browser_user');
  await create.getByLabel(/^初始密码/).fill('browser-password');
  await create.getByRole('button', { name: '创建用户', exact: true }).click();
  await expect(create).not.toBeVisible();
  const userRow = page.getByRole('row').filter({ has: page.getByText('browser_user', { exact: true }) });
  await userRow.getByRole('button', { name: '积分', exact: true }).click();
  const adjustment = page.getByRole('dialog', { name: '调整积分 · browser_user', exact: true });
  await adjustment.getByRole('spinbutton').fill('50');
  await adjustment.getByRole('button', { name: '确认调整', exact: true }).click();
  await expect(adjustment).not.toBeVisible();
  await expect(userRow.getByRole('cell', { name: '50', exact: true })).toBeVisible();
  await shot('05-admin-users');
  await logout();
  await login('browser_user', 'browser-password');
  await page.goto(origin + '/#/settings/credits');
  await expect(page.locator('.settings-heading').getByRole('heading', { name: '积分历史', exact: true })).toBeVisible();
  await expect(usage).toContainText('暂无用量记录');
  await expect(usage).toContainText('共 0 条记录');
  await expect(usage.getByRole('button', { name: '下一页用量', exact: true })).toBeDisabled();
  await shot('10-personal-history-empty-account');
  await page.goto(origin + '/#/settings/users');
  await expect(page.getByRole('heading', { name: '没有访问权限', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '返回账户设置', exact: true }).click();
  await page.getByRole('button', { name: '修改密码', exact: true }).click();
  const passwordDialog = page.getByRole('dialog', { name: '修改密码', exact: true });
  await passwordDialog.getByLabel('当前密码', { exact: true }).fill('browser-password');
  await passwordDialog.getByLabel(/^新密码/).fill('browser-password-new');
  await passwordDialog.getByLabel('确认新密码', { exact: true }).fill('browser-password-new');
  await passwordDialog.getByRole('button', { name: '修改密码', exact: true }).click();
  await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible();
  await login('browser_user', 'browser-password-new');
  await openPictureSection('全部图片');
  await expect(page.getByRole('heading', { name: '还没有生成的图片', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 900 });
  await shot('06-user-boundary-1280');
  expect(errors).toEqual([]);
  await writeFile(new URL('result.json', output), JSON.stringify({ status: 'passed', flows: results, errors }, null, 2));
  console.log(`Go + MySQL browser check passed: ${results.length} flows; errors=0`);
} catch (error) {
  await writeFile(new URL('result.json', output), JSON.stringify({ status: 'failed', flows: results, errors, error: String(error) }, null, 2));
  await page.screenshot({ path: fileURLToPath(new URL('failure.png', output)) }).catch(() => {});
  throw error;
} finally { await browser.close(); }
