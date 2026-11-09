import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
// Reuse the PNG decoder shipped with the pinned Playwright version.
import utils from "../../node_modules/playwright-core/lib/utilsBundle.js";
import { createServer } from "vite";
import { chooseDialogOption } from "./dialog-check.mjs";

const output = fileURLToPath(new URL("../../outputs/dialog-pixels/", import.meta.url));
await mkdir(output, { recursive: true });
const server = await createServer({ mode: "preview", root: fileURLToPath(new URL("../../", import.meta.url)),
  server: { host: "127.0.0.1", port: 5176, strictPort: true } });
const errors = [], results = [];
let browser;

// Measure the visible bright band and line, not computed CSS or a saved baseline.
function symmetry(png, bounds, ratio) {
  const x = Math.round(bounds.x * ratio), y = Math.round(bounds.y * ratio);
  const w = Math.round(bounds.width * ratio), h = Math.round(bounds.height * ratio);
  const centerX = x + Math.floor(w / 2), centerY = y + Math.floor(h / 2);
  const pixel = (x, y) => [...png.data.subarray((y * png.width + x) * 4, (y * png.width + x) * 4 + 3)];
  let maximum = 0;
  for (let i = 0; i < Math.ceil(4 * ratio); i++) {
    const pairs = [[pixel(centerX, y + i), pixel(centerX, y + h - 1 - i)],
      [pixel(x + i, centerY), pixel(x + w - 1 - i, centerY)]];
    for (const [a, b] of pairs) for (let c = 0; c < 3; c++) maximum = Math.max(maximum, Math.abs(a[c] - b[c]));
  }
  return maximum;
}

async function settle(page) {
  await page.mouse.move(8, 8);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await page.waitForTimeout(160); // Fill transitions must finish before reading pixels.
}

try {
  await server.listen();
  browser = await chromium.launch({ channel: process.platform === "win32" ? "msedge" : undefined });
  for (const ratio of [1, 1.1, 1.25, 1.5, 2, .9, 1.125]) {
    const context = await browser.newContext({ viewport: { width: 1441, height: 901 }, deviceScaleFactor: ratio });
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    await page.goto("http://127.0.0.1:5176");
    await page.getByLabel("用户名", { exact: true }).fill("admin");
    await page.getByLabel("密码", { exact: true }).fill("preview1234");
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await chooseDialogOption(page, page.getByRole("combobox", { name: "模型", exact: true }), "Gemini Image 3Pro");
    for (const [theme, label] of [["light", "浅色"], ["dark", "深色"]]) {
      await page.goto("http://127.0.0.1:5176/#/settings/appearance");
      await page.getByRole("button", { name: label, exact: true }).click();
      await page.getByRole("button", { name: "返回创作", exact: true }).click();
      const prompt = page.getByRole("textbox", { name: "提示词", exact: true });
      // Growth moves the same controls onto a different device-pixel phase.
      for (const lines of [2, 3]) {
        await prompt.fill(lines === 2 ? "" : "第一行\n第二行\n第三行");
        await prompt.blur();
        await settle(page);
        const png = utils.PNG.sync.read(await page.screenshot({ path: `${output}/${ratio}-${theme}-${lines}.png` }));
        const surfaces = await page.locator(".composer-toolbar .dialog-button-surface").evaluateAll(elements => elements.map(svg => {
          const bounds = svg.querySelector("rect").getBoundingClientRect();
          return { label: svg.parentElement.getAttribute("aria-label") || svg.parentElement.textContent,
            rects: [...svg.querySelectorAll('rect')].map(rect => ({x:rect.getAttribute('x'),y:rect.getAttribute('y'),width:rect.getAttribute('width'),height:rect.getAttribute('height'),rx:rect.getAttribute('rx')})),
            bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height } };
        }));
        assert(surfaces.length >= 6);
        for (const surface of surfaces) {
          const difference = symmetry(png, surface.bounds, ratio);
          assert(difference <= 12, `${ratio}/${theme}/${lines}/${surface.label}: opposite visible edges differ by ${difference}; ${JSON.stringify(surface)}`);
        }
        results.push({ ratio, theme, lines, buttons: surfaces.length, status: "passed" });
      }
    }
    if (ratio === 1.25) {
      // Put the actual old CSS back: this pixel check must reject the reported bug.
      await page.locator(".dialog-select-accent").evaluate(el => {
        el.style.position = "fixed";
        el.style.left = "529px";
        el.style.top = "537px";
      });
      await page.evaluate(() => dispatchEvent(new Event("resize")));
      await settle(page);
      const old = await page.addStyleTag({ content: `.dialog-button-surface { display:none }
        .dialog-button { background:var(--dialog-button-fill) }
        .dialog-button::before { content:"";position:absolute;inset:2px;border:1px solid #333;
        border-radius:calc(var(--dialog-control-height,36px)/2 - 2px);pointer-events:none }` });
      await settle(page);
      const png = utils.PNG.sync.read(await page.screenshot({ path: `${output}/old-css-rejected.png` }));
      const model = await page.locator(".dialog-select-accent").boundingBox();
      assert(symmetry(png, model, ratio) > 12, "The old independently painted border must fail the visual check");
      await old.evaluate(el => el.remove());
      await settle(page);
      const fixed = utils.PNG.sync.read(await page.screenshot({ path: `${output}/fractional-position-fixed.png` }));
      const bounds = await page.locator(".dialog-select-accent .dialog-button-surface rect").first().boundingBox();
      assert(symmetry(fixed, bounds, ratio) <= 12);
    }
    if (ratio === 1) {
      // A zoom/display-scale change in an already open page must repaint too.
      const session = await context.newCDPSession(page);
      for (const nextRatio of [1.25, 2]) {
        await session.send("Emulation.setDeviceMetricsOverride", { width: 1441, height: 901,
          deviceScaleFactor: nextRatio, mobile: false });
        await settle(page);
        assert.equal(await page.evaluate(() => devicePixelRatio), nextRatio);
        // Playwright screenshot normalizes to the context's initial DPR; use CDP
        // directly to keep the new, live device scale in the captured bitmap.
        const capture = await session.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
        const buffer = Buffer.from(capture.data, "base64");
        await writeFile(`${output}/live-scale-${nextRatio}.png`, buffer);
        const png = utils.PNG.sync.read(buffer);
        const bounds = await page.locator(".dialog-select-accent .dialog-button-surface rect").first().boundingBox();
        assert(symmetry(png, bounds, nextRatio) <= 12);
        results.push({ ratio: nextRatio, liveScaleChange: true, status: "passed" });
      }
    }
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log(`Button pixel check: ${results.length} scale/theme/growth cases passed; old CSS rejected; errors 0.`);
} catch (error) {
  errors.push(error.message);
  throw error;
} finally {
  await writeFile(`${output}/result.json`, JSON.stringify({ results, errors }, null, 2));
  await browser?.close();
  await server.close();
}
