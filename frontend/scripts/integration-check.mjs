// Run by TestStudioMySQLWorkflow against the actual Go HTTP server and empty MySQL fixture.
// The upstream image provider alone is replaced; no browser API routes are mocked.
import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const origin = process.argv[2];
if (!origin?.startsWith('http://127.0.0.1:')) throw new Error('requires the local Go test server');
const output = new URL('../outputs/integration/', import.meta.url);
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
try {
  const response = await page.goto(origin);
  expect(response.headers()['content-security-policy']).toContain("style-src 'self'");
  await login('admin');
  expect(await page.locator('.preview-badge').count()).toBe(0);
  await shot('01-authenticated');
  const creation = page.getByRole('region', { name: '图像创作', exact: true });
  const before = await creation.getByTestId('generation-turn').count();
  await creation.getByRole('combobox', { name: '模型', exact: true }).selectOption('gemini-3.1-flash-image');
  await creation.getByRole('combobox', { name: '清晰度', exact: true }).selectOption('0.5K');
  await creation.getByRole('combobox', { name: '图像比例', exact: true }).selectOption('21:9');
  await creation.getByRole('combobox', { name: '生成数量', exact: true }).selectOption('1');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  await page.getByLabel('上传图片文件').setInputFiles(Array.from({ length: 6 }, (_, i) => ({ name: `browser-${i}.png`, mimeType: 'image/png', buffer: png })));
  await expect(creation.locator('.attachment-item')).toHaveCount(6);
  await shot('02-six-attachments');
  await creation.getByRole('textbox', { name: '提示词', exact: true }).fill('six-inputs browser');
  await creation.getByRole('button', { name: '发送', exact: true }).click();
  await expect(creation.getByTestId('generation-turn')).toHaveCount(before + 1);
  await expect(creation.locator('.attachment-row')).toHaveCount(0);
  const result = creation.getByTestId('generation-turn').filter({ hasText: 'six-inputs browser' });
  await expect(result.locator('.result-card')).toHaveCount(1, { timeout: 15000 });
  const width = await result.locator('.result-card').evaluate(el => el.getBoundingClientRect().width);
  expect(width).toBeGreaterThan(300); // React CSSOM geometry under the actual Go CSP.
  await result.getByRole('button', { name: '添加', exact: true }).click();
  await expect(creation.locator('.attachment-item')).toHaveCount(1);
  await expect(result.locator('.result-card')).toHaveCount(1);
  await creation.locator('.attachment-remove').click();
  await expect(creation.locator('.attachment-row')).toHaveCount(0);
  const downloadEvent = page.waitForEvent('download');
  await result.getByRole('button', { name: '下载', exact: true }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toMatch(/\.png$/);
  expect(await download.failure()).toBeNull();
  await shot('03-generated-and-download');
  await page.getByRole('button', { name: '我的图片', exact: true }).click();
  const gallery = page.getByRole('region', { name: '我的图片', exact: true });
  const originalCount = await gallery.locator('.gallery-tile').count();
  for (const name of ['浏览器 A', '浏览器 B']) {
    await page.getByRole('button', { name: '新建文件夹', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '新建文件夹', exact: true });
    await dialog.getByLabel('文件夹名称', { exact: true }).fill(name);
    await dialog.getByRole('button', { name: '创建', exact: true }).click();
    await expect(dialog).not.toBeVisible();
  }
  await page.getByRole('button', { name: '全部图片', exact: true }).click();
  await gallery.getByRole('button', { name: '选择图片', exact: true }).click();
  await gallery.getByRole('checkbox', { name: /^选中 / }).first().check();
  await gallery.getByRole('toolbar', { name: '图片整理' }).getByRole('button', { name: '加入文件夹', exact: true }).click();
  const picker = page.getByRole('dialog', { name: '加入文件夹', exact: true });
  for (const name of ['浏览器 A', '浏览器 B']) await picker.getByRole('checkbox', { name, exact: true }).check();
  await picker.getByRole('button', { name: '加入', exact: true }).click();
  await expect(picker).not.toBeVisible();
  await page.getByRole('button', { name: '浏览器 A', exact: true }).click();
  await expect(gallery.locator('.gallery-tile')).toHaveCount(1);
  await page.reload();
  await expect(gallery.locator('.gallery-tile')).toHaveCount(1);
  await gallery.getByRole('button', { name: '文件夹管理', exact: true }).click();
  await gallery.getByRole('menuitem', { name: '删除文件夹', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '删除文件夹', exact: true }).click();
  await expect(gallery.locator('.gallery-tile')).toHaveCount(originalCount);
  await page.getByRole('button', { name: '浏览器 B', exact: true }).click();
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
  await page.getByRole('button', { name: '我的图片', exact: true }).click();
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
