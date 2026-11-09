// Real browser and real frontend; only API metadata and image bytes are local
// fixtures. The HTTP fixture allows browser caching, unlike route interception.
import { chromium, expect } from "@playwright/test";
import { createServer } from "vite";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const output = new URL("../../outputs/big-preview/", import.meta.url);
const probe = process.argv.includes("--probe");
const origin = "http://127.0.0.1:5178";
await mkdir(output, { recursive: true });
const options = { modelId: "gpt-image-2", ratio: "自动", count: 1 };
const user = { id: "fixture-user", username: "fixture", role: "admin", status: "enabled", balance: 100, createdAt: "2026-11-10T00:00:00Z" };
const assets = [
  ["landscape", 1600, 900, "#b7c8b5"],
  ["portrait", 900, 1600, "#c8b7b5"],
  ["broken", 1600, 900, "#b5b7c8"],
].map(([id, width, height, color], outputIndex) => ({
  id, width, height, color, outputIndex, name: id + ".png", url: "/api/images/" + id,
  thumbnailUrl: "/api/images/" + id + "/thumbnail/1", previewUrl: "/api/images/" + id + "/preview/1",
  userId: user.id, createdAt: user.createdAt, batchId: "fixture-batch", prompt: "大图稳定展示验证", options, folderIds: [],
}));
const models = ["gpt-image-2", "gpt-image-1.5", "gpt-image-2.5-sunburst", "gemini-3.1-flash-image", "gemini-3-pro-image"]
  .map(id => ({ id, name: id, qualities: [], resolutions: [], ratios: ["自动", "1:1"] }));
const state = { version: 1, assets, folders: [], generations: [{ id: "fixture-batch", userId: user.id,
  username: user.username, prompt: assets[0].prompt, attachments: [], options, status: "completed", imageIds: assets.map(a => a.id),
  createdAt: user.createdAt, cost: 1 }], users: [user], currentUserId: user.id,
  prices: Object.fromEntries(models.map(model => [model.id, 1])), priceUpdatedAt: {}, priceVersions: {} };
let delay = 120;
const requests = [];
const apiFixture = (request, response, next) => {
  const path = new URL(request.url, origin).pathname;
  const json = data => { response.setHeader("Content-Type", "application/json"); response.setHeader("Cache-Control", "no-store"); response.end(JSON.stringify(data)); };
  if (path === "/api/studio/state") return json(state);
  if (path === "/api/studio/models") return json(models);
  if (!path.startsWith("/api/images/")) return next();
  const asset = assets.find(a => a.id === path.split("/")[3]);
  if (!asset) { response.statusCode = 404; return response.end(); }
  requests.push({ path, method: request.method });
  response.setHeader("Cache-Control", "private, max-age=600");
  response.setHeader("Content-Type", "image/svg+xml");
  if (request.method === "HEAD") return response.end();
  if (asset.id === "broken" && path.includes("/preview/")) return response.end("invalid image bytes");
  const limit = path.includes("/thumbnail/") ? 640 : path.includes("/preview/") ? 1600 : Infinity;
  const scale = Math.min(1, limit / Math.max(asset.width, asset.height));
  const width = Math.round(asset.width * scale), height = Math.round(asset.height * scale);
  const bytes = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${asset.color}"/><path d="M0 0L${width} ${height}" stroke="#52614f" stroke-width="2"/></svg>`;
  setTimeout(() => response.end(bytes), path.includes("/preview/") ? delay : 0);
};
const server = await createServer({ root, server: { host: "127.0.0.1", port: 5178, strictPort: true },
  plugins: [{ name: "big-preview-fixture", configureServer(server) { server.middlewares.use(apiFixture); } }] });
await server.listen();
let browser;
const results = [], failures = [], errors = [];
async function startTrace(page) {
  await page.evaluate(() => { window.previewTrace = []; });
}
async function trace(page) {
  return page.evaluate(() => window.previewTrace);
}
async function ready(image) {
  await expect.poll(() => image.evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
}
try {
  browser = await chromium.launch({ channel: process.platform === "win32" ? "msedge" : undefined });
  for (const dpr of probe ? [1] : [1, 2]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: dpr });
    const page = await context.newPage();
    page.on("pageerror", e => errors.push(e.message));
    page.on("console", e => { if (e.type() === "error") errors.push(e.text()); });
    await page.addInitScript(() => {
      window.previewTrace = [];
      const snapshot = event => {
        const dialog = document.querySelector("dialog.image-preview"), image = dialog?.querySelector(".preview-stage img");
        if (!image) return;
        const box = image.getBoundingClientRect();
        const value = { event, src: image.getAttribute("src"), alt: image.alt, open: dialog.open,
          complete: image.complete, naturalWidth: image.naturalWidth, width: box.width, height: box.height };
        const last = window.previewTrace.at(-1);
        if (!last || Object.keys(value).some(key => key !== "event" && value[key] !== last[key])) {
          window.previewTrace.push({ at: performance.now(), ...value });
        }
      };
      new MutationObserver(() => snapshot("mutation")).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ["src", "open"] });
      const frame = () => { snapshot("frame"); requestAnimationFrame(frame); };
      requestAnimationFrame(frame);
    });
    const before = requests.length;
    await page.goto(origin);
    await ready(page.locator(".result-card img").first());
    const modal = page.getByRole("dialog", { name: "图片预览", exact: true });
    const image = modal.locator(".preview-stage img");
    // At DPR2 the visible result list already needs the 1600px resource. The
    // first modal therefore exercises its warmed cache, not a cold download.
    for (const cache of [dpr === 1 ? "cold-open" : "first-open-list-prewarmed", "warm-reopen"]) {
      await startTrace(page);
      const requestStart = requests.length;
      await page.getByRole("button", { name: "查看landscape.png", exact: true }).click();
      await expect(modal).toBeVisible();
      await expect(image).toHaveAttribute("src", assets[0].previewUrl);
      await ready(image);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const snapshots = await trace(page);
      const sources = [...new Set(snapshots.map(s => s.src).filter(Boolean))];
      const openingRequests = requests.slice(requestStart);
      results.push({ name: `${cache}-${dpr}x`, sources, requests: openingRequests, trace: snapshots });
      if (sources.length !== 1 || sources[0] !== assets[0].previewUrl) failures.push(`${cache}-${dpr}x first chooses ${sources.join(" → ")}`);
      if (cache === "warm-reopen" && openingRequests.length) failures.push(`${cache}-${dpr}x refetched a cached image`);
      await page.screenshot({ path: fileURLToPath(new URL(`${cache}-${dpr}x.png`, output)) });
      await modal.getByRole("button", { name: "关闭", exact: true }).click();
      await expect(modal).toHaveCount(0);
    }
    if (!probe) {
      await page.getByRole("button", { name: "查看landscape.png", exact: true }).click();
      await expect(modal).toBeVisible();
      await ready(image);
      delay = 350;
      await startTrace(page);
      await modal.getByRole("button", { name: "下一张", exact: true }).click();
      await expect(image).toHaveAttribute("alt", "portrait.png");
      await modal.getByRole("button", { name: "上一张", exact: true }).click();
      await expect(image).toHaveAttribute("alt", "landscape.png");
      await expect(image).toHaveAttribute("src", assets[0].previewUrl);
      await ready(image);
      await page.waitForTimeout(400);
      await expect(image).toHaveAttribute("src", assets[0].previewUrl);
      results.push({ name: `rapid-next-previous-${dpr}x`, status: "passed", trace: await trace(page) });
      await modal.getByRole("button", { name: "关闭", exact: true }).click();
      await page.getByRole("button", { name: "查看broken.png", exact: true }).click();
      await expect(image).toHaveAttribute("src", assets[2].url);
      await ready(image);
      expect(requests.slice(before).filter(r => r.path === assets[2].url && r.method === "GET")).toHaveLength(1);
      results.push({ name: `decode-failure-single-original-fallback-${dpr}x`, status: "passed" });
      await modal.getByRole("button", { name: "关闭", exact: true }).click();
      await page.getByRole("button", { name: "我的图片", exact: true }).click();
      const gallery = page.getByRole("region", { name: "我的图片", exact: true });
      const galleryImages = gallery.locator(".gallery-tile img");
      await expect(galleryImages).toHaveCount(3);
      await ready(galleryImages.first());
      expect(await galleryImages.first().evaluate(img => img.getBoundingClientRect().width)).toBeGreaterThan(0);
      await expect(galleryImages.first()).toHaveAttribute("src", /\/(thumbnail|preview)\/1$/);
      results.push({ name: `gallery-images-load-after-activation-${dpr}x`, status: "passed" });
    }
    await context.close();
  }
  expect(errors).toEqual([]);
  await writeFile(new URL(probe ? "before.json" : "regression.json", output), JSON.stringify({
    evidence: "real frontend + synthetic local HTTP API/image bytes; browser cache enabled; no production images or paid upstream",
    results, failures, errors,
  }, null, 2));
  console.log(JSON.stringify({ results: results.map(({ trace, ...result }) => result), failures, errors }));
  if (!probe) expect(failures).toEqual([]);
} finally {
  await browser?.close();
  await server.close();
}
