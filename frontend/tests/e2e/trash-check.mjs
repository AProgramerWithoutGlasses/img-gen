import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import { prepareEvidenceOutput } from './evidence-output.mjs';
import { checkTrashFlow } from './trash-flow.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const { url: output } = await prepareEvidenceOutput(process.argv.slice(2), { defaultDirectory: 'frontend/outputs/trash' });
const server = await createServer({ root, mode: 'preview', server: { host: '127.0.0.1', port: 5189, strictPort: true } });
const errors = [], results = [];
let browser, page;
try {
  await server.listen();
  browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined });
  page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('http://127.0.0.1:5189');
  await page.getByLabel('用户名', { exact: true }).fill('admin');
  await page.getByLabel('密码', { exact: true }).fill('preview1234');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('button', { name: '我的账户', exact: true })).toBeVisible();
  const readState = () => page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('ui-studio-preview-v1', 1);
    request.onerror = () => reject(new Error('preview database unavailable'));
    request.onsuccess = () => {
      const db = request.result;
      const read = db.transaction('state').objectStore('state').get('snapshot');
      read.onsuccess = () => { resolve(read.result); db.close(); };
      read.onerror = () => { reject(new Error('preview snapshot unavailable')); db.close(); };
    };
  }));
  const shot = async name => {
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await page.screenshot({ path: fileURLToPath(new URL(name + '.png', output)) });
    results.push(name);
  };
  const creation = page.getByRole('region', { name: '图像创作', exact: true });
  await expect(creation.locator('.result-card.is-ready')).toHaveCount(2);
  await creation.locator('.result-card.is-ready').first().hover();
  await creation.locator('.result-card.is-ready').first().getByRole('button', { name: '移入回收站', exact: true }).click();
  await expect(creation.getByText('已移入回收站', { exact: true })).toBeVisible();
  await expect(creation.locator('.result-open')).toHaveCount(1);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(creation.locator('.result-open.is-ready')).toHaveCount(2);
  await creation.locator('.result-card').first().hover();
  await creation.getByRole('checkbox', { name: '选择第 1 张图片', exact: true }).check();
  await creation.getByRole('checkbox', { name: '选择第 2 张图片', exact: true }).check();
  const workbenchBar = creation.getByRole('toolbar', { name: '已选图片操作', exact: true });
  await expect(workbenchBar.getByRole('button', { name: '取消全选', exact: true })).toHaveCount(0);
  await workbenchBar.getByRole('button', { name: '移入回收站', exact: true }).click();
  await expect(creation.getByText('已移入回收站', { exact: true })).toHaveCount(2);
  await shot('workbench-bulk-trash-preserves-output-slots');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(creation.locator('.result-card.is-ready')).toHaveCount(2);
  await checkTrashFlow(page, { readState, shot });
  expect(errors).toEqual([]);
  await writeFile(new URL('result.json', output), JSON.stringify({ status: 'passed', flows: results, errors }, null, 2));
  console.log(JSON.stringify({ passed: results.length, errors: errors.length }));
} catch (error) {
  await writeFile(new URL('result.json', output), JSON.stringify({ status: 'failed', flows: results, errors, error: String(error) }, null, 2));
  await page?.screenshot({ path: fileURLToPath(new URL('failure.png', output)) }).catch(() => {});
  throw error;
} finally {
  await browser?.close();
  await server.close();
}
