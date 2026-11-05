import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = new URL('../outputs/preview/', import.meta.url);
await mkdir(output, { recursive: true });
const server = await createServer({
  root,
  server: { port: 5175, strictPort: true, host: '127.0.0.1' },
});
let browser;
const errors = [];
const results = [];
try {
  await server.listen();
  browser = await chromium.launch({
    channel: process.platform === 'win32' ? 'msedge' : undefined,
  });
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport });
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error') errors.push(message.text());
    });
    // This is a local design preview: external resources and business APIs need no network.
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (['data:', 'blob:'].includes(url.protocol)) return route.continue();
      if (url.origin !== 'http://127.0.0.1:5175' || /^\/api(?:\/|$)/.test(url.pathname)) {
        errors.push(`Unexpected network request: ${url.origin}${url.pathname}`);
        return route.abort();
      }
      return route.continue();
    });
    const response = await page.goto('http://127.0.0.1:5175/');
    if (!response?.ok()) throw new Error('Preview did not load');
    await page.locator('#root > *').first().waitFor();
    await page.evaluate(() => document.fonts.ready);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    if (overflow) errors.push(`Horizontal overflow at ${viewport.width}px`);
    const screenshot = `${viewport.width}x${viewport.height}.png`;
    await page.screenshot({ path: fileURLToPath(new URL(screenshot, output)), fullPage: true });
    results.push({ viewport, status: response.status(), screenshot });
    await page.close();
  }
  await writeFile(new URL('result.json', output), JSON.stringify({ results, errors }, null, 2));
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(`Browser check passed: ${results.length} viewports; screenshots: outputs/preview/`);
} finally {
  await browser?.close();
  await server.close();
}
