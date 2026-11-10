// Real browser and real frontend; only API metadata and image bytes are local
// fixtures. The HTTP fixture allows browser caching, unlike route interception.
import { chromium, expect } from "@playwright/test";
import { createServer } from "vite";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { prepareEvidenceOutput } from "./evidence-output.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const evidence = await prepareEvidenceOutput(process.argv.slice(2), {
  defaultDirectory: "frontend/outputs/big-preview",
  booleanFlags: ["--probe", "--negative-thumbnails", "--rail-only", "--negative-rail", "--pagination-only"],
});
const output = evidence.url;
const probe = evidence.flags.has("--probe");
const negativeThumbnails = evidence.flags.has("--negative-thumbnails");
const railOnly = evidence.flags.has("--rail-only");
const negativeRail = evidence.flags.has("--negative-rail");
const paginationOnly = evidence.flags.has("--pagination-only");
const origin = "http://127.0.0.1:5178";
await mkdir(output, { recursive: true });
const options = { modelId: "gpt-image-2", ratio: "自动", count: 3 };
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
// Hold original responses independently from compressed previews so the real
// browser must keep showing both the preview and a visible loading control.
const originalResponses = new Map();
const requests = [];
const pageRequests = [];
let failPageCursor, expectedPageFailures = 0;
const apiFixture = (request, response, next) => {
  const url = new URL(request.url, origin), path = url.pathname;
  const json = data => { response.setHeader("Content-Type", "application/json"); response.setHeader("Cache-Control", "no-store"); response.end(JSON.stringify(data)); };
  if (path === "/api/studio/state") return json(paginationOnly && url.searchParams.get("view") === "workspace" ? {
    ...state, assets: assets.slice(0, 4), generations: state.generations.slice(0, 4),
    imageSummary: { total: assets.length, folderCounts: Object.fromEntries(state.folders.map(folder =>
      [folder.id, assets.filter(image => image.folderIds.includes(folder.id)).length])) },
  } : state);
  if (path === "/api/studio/models") return json(models);
  if (path === "/api/studio/images") {
    const folderId = url.searchParams.get("folderId") || "all";
    const collection = assets.filter(image => folderId === "all" || (folderId === "unfiled"
      ? !image.folderIds.length : image.folderIds.includes(folderId)));
    const cursor = url.searchParams.get("cursor") || "", offset = Number(cursor.split(":")[1] || 0);
    const limit = Math.min(50, Number(url.searchParams.get("limit") || 50));
    const images = collection.slice(offset, offset + limit);
    const record = { folderId, cursor, limit, ids: images.map(image => image.id), failed: false };
    pageRequests.push(record);
    if (failPageCursor === cursor) {
      failPageCursor = undefined;
      expectedPageFailures++;
      record.failed = true;
      response.statusCode = 503;
      return json({ error: "本地分页读取暂时失败" });
    }
    return json({ images, total: collection.length,
      ...(offset + images.length < collection.length ? { nextCursor: `fixture:${offset + images.length}` } : {}) });
  }
  if (!path.startsWith("/api/images/")) return next();
  const asset = assets.find(a => a.id === path.split("/")[3]);
  if (!asset) { response.statusCode = 404; return response.end(); }
  const requestRecord = { path, method: request.method, closedEarly: false };
  requests.push(requestRecord);
  response.setHeader("Cache-Control", "private, max-age=600");
  response.setHeader("Content-Type", "image/svg+xml");
  if (request.method === "HEAD") return response.end();
  if (asset.id === "broken" && path.includes("/preview/")) return response.end("invalid image bytes");
  const original = path === asset.url ? originalResponses.get(asset.id) : undefined;
  if (original?.fail) response.setHeader("Cache-Control", "no-store");
  const limit = path.includes("/thumbnail/") ? 640 : path.includes("/preview/") ? 1600 : Infinity;
  const scale = Math.min(1, limit / Math.max(asset.width, asset.height));
  const width = Math.round(asset.width * scale), height = Math.round(asset.height * scale);
  const bytes = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${asset.color}"/><path d="M0 0L${width} ${height}" stroke="#52614f" stroke-width="2"/></svg>`;
  const timer = setTimeout(() => response.end(original?.fail ? "invalid original image bytes" : bytes),
    original?.delay ?? (path.includes("/preview/") ? delay : 0));
  response.on("close", () => {
    requestRecord.closedEarly = !response.writableEnded;
    clearTimeout(timer);
  });
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
  await expect.poll(() => image.evaluate(img => img.complete && img.naturalWidth > 0),
    { timeout: negativeThumbnails ? 3000 : 5000 }).toBe(true);
}
async function visibleControl(control) {
  await expect(control).toBeVisible();
  const visibility = await control.evaluate(element => {
    const box = element.getBoundingClientRect(), dialog = element.closest("dialog").getBoundingClientRect();
    return { width: box.width, height: box.height, left: box.left, top: box.top, right: box.right, bottom: box.bottom,
      dialog: { left: dialog.left, top: dialog.top, right: dialog.right, bottom: dialog.bottom },
      viewport: { width: innerWidth, height: innerHeight },
      hit: element.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)) };
  });
  expect(visibility.width).toBeGreaterThan(0);
  expect(visibility.height).toBeGreaterThan(0);
  expect(visibility.left).toBeGreaterThanOrEqual(Math.max(0, visibility.dialog.left));
  expect(visibility.top).toBeGreaterThanOrEqual(Math.max(0, visibility.dialog.top));
  expect(visibility.right).toBeLessThanOrEqual(Math.min(visibility.viewport.width, visibility.dialog.right));
  expect(visibility.bottom).toBeLessThanOrEqual(Math.min(visibility.viewport.height, visibility.dialog.bottom));
  expect(visibility.hit, "Original-image state is clipped or covered").toBe(true);
  return visibility;
}
async function readyThumbnails(modal) {
  const thumbnails = modal.locator(".preview-thumbnail img");
  await expect(thumbnails).toHaveCount(assets.length);
  for (const thumbnail of await thumbnails.all()) await ready(thumbnail);
  const metrics = await thumbnails.evaluateAll(images => images.map(image => {
    const box = image.getBoundingClientRect(), button = image.closest("button").getBoundingClientRect();
    const style = getComputedStyle(image);
    return { src: image.getAttribute("src"), width: box.width, height: box.height,
      inButton: box.left >= button.left && box.right <= button.right && box.top >= button.top && box.bottom <= button.bottom,
      inViewport: box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight,
      visible: style.visibility !== "hidden" && Number(style.opacity) > .1 };
  }));
  for (const thumbnail of metrics) {
    expect(thumbnail.width, "Navigation thumbnail never acquired a rendered width").toBeGreaterThan(0);
    expect(thumbnail.height, "Navigation thumbnail never acquired a rendered height").toBeGreaterThan(0);
    expect(thumbnail.inButton && thumbnail.inViewport && thumbnail.visible, "Navigation thumbnail is clipped or invisible").toBe(true);
  }
  return metrics;
}
const originalGets = asset => requests.filter(request => request.path === asset.url && request.method === "GET");
try {
  browser = await chromium.launch({ channel: process.platform === "win32" ? "msedge" : undefined });
  for (const dpr of railOnly || paginationOnly ? [] : probe ? [1] : [1, 2]) {
    originalResponses.clear();
    delay = 120;
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
    if (negativeThumbnails) await page.addStyleTag({ content: ".preview-thumbnail img { width:auto!important; height:auto!important; }" });
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
      const thumbnails = await readyThumbnails(modal);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const snapshots = await trace(page);
      const sources = [...new Set(snapshots.map(s => s.src).filter(Boolean))];
      const openingRequests = requests.slice(requestStart);
      results.push({ name: `${cache}-${dpr}x`, sources, requests: openingRequests, thumbnails, trace: snapshots });
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

      originalResponses.set("landscape", { delay: 1400 });
      await page.getByRole("button", { name: "查看landscape.png", exact: true }).click();
      await ready(image);
      const initialZoom = await modal.locator(".preview-zoom-value").textContent();
      const landscapeBefore = originalGets(assets[0]).length;
      await modal.getByRole("button", { name: "显示原图", exact: true }).click();
      const loading = modal.getByRole("button", { name: "原图加载中…", exact: true });
      await visibleControl(loading);
      await expect(modal.locator(".preview-zoom-value")).toHaveText(initialZoom);
      await expect(image).toHaveAttribute("src", assets[0].previewUrl);
      await ready(image);
      // Zoom controls share the same pending request; its loading state must
      // stay on screen even while the enlarged image is cropped by the stage.
      await modal.getByRole("button", { name: "原始尺寸 100%", exact: true }).click();
      await modal.getByRole("button", { name: "放大", exact: true }).click();
      await visibleControl(loading);
      await page.screenshot({ path: fileURLToPath(new URL(`original-loading-zoomed-${dpr}x.png`, output)) });
      await expect(modal.getByRole("button", { name: "原图已加载", exact: true })).toBeVisible();
      await expect(image).toHaveAttribute("src", assets[0].url);
      await ready(image);
      await visibleControl(modal.getByRole("button", { name: "原图已加载", exact: true }));
      await modal.getByRole("button", { name: "放大", exact: true }).click();
      expect(originalGets(assets[0]).length - landscapeBefore, "Original-image actions duplicated the same download").toBe(1);
      await page.screenshot({ path: fileURLToPath(new URL(`original-loaded-${dpr}x.png`, output)) });
      results.push({ name: `explicit-original-preserves-zoom-and-shares-request-${dpr}x`, status: "passed", initialZoom });
      await modal.getByRole("button", { name: "关闭", exact: true }).click();

      originalResponses.set("portrait", { delay: 850 });
      await page.getByRole("button", { name: "查看portrait.png", exact: true }).click();
      await ready(image);
      const switchBefore = originalGets(assets[1]).length;
      await modal.getByRole("button", { name: "放大", exact: true }).click();
      await visibleControl(loading);
      await expect.poll(() => originalGets(assets[1]).length).toBe(switchBefore + 1);
      await modal.getByRole("button", { name: "上一张", exact: true }).click();
      await expect(image).toHaveAttribute("alt", "landscape.png");
      await ready(image);
      await page.waitForTimeout(950);
      await expect(image).toHaveAttribute("alt", "landscape.png");
      await expect(image).not.toHaveAttribute("src", assets[1].url);
      await expect(loading).toHaveCount(0);
      expect(originalGets(assets[1]).slice(switchBefore).some(request => request.closedEarly), "Switching images did not cancel the pending original response").toBe(true);
      await modal.getByRole("button", { name: "关闭", exact: true }).click();

      await page.getByRole("button", { name: "查看portrait.png", exact: true }).click();
      await ready(image);
      const closeBefore = originalGets(assets[1]).length;
      await modal.getByRole("button", { name: "原始尺寸 100%", exact: true }).click();
      await visibleControl(loading);
      await expect.poll(() => originalGets(assets[1]).length).toBe(closeBefore + 1);
      await modal.getByRole("button", { name: "关闭", exact: true }).click();
      await expect(modal).toHaveCount(0);
      await page.getByRole("button", { name: "查看landscape.png", exact: true }).click();
      await ready(image);
      await page.waitForTimeout(950);
      await expect(image).toHaveAttribute("alt", "landscape.png");
      await expect(image).not.toHaveAttribute("src", assets[1].url);
      await expect(loading).toHaveCount(0);
      expect(originalGets(assets[1]).slice(closeBefore).some(request => request.closedEarly), "Closing the preview did not cancel the pending original response").toBe(true);
      results.push({ name: `zoom-requests-cancel-on-switch-and-close-${dpr}x`, status: "passed" });
      await modal.getByRole("button", { name: "关闭", exact: true }).click();

      originalResponses.set("portrait", { delay: 400, fail: true });
      await page.getByRole("button", { name: "查看portrait.png", exact: true }).click();
      await ready(image);
      const failureBefore = originalGets(assets[1]).length;
      await modal.locator(".preview-stage").hover();
      await page.mouse.wheel(0, -240);
      await visibleControl(loading);
      const retry = modal.getByRole("button", { name: "重试原图", exact: true });
      await visibleControl(retry);
      await expect(image).toHaveAttribute("src", assets[1].previewUrl);
      await ready(image);
      await page.waitForTimeout(450);
      expect(originalGets(assets[1]).length - failureBefore, "A failed original download retried without user action").toBe(1);
      await page.screenshot({ path: fileURLToPath(new URL(`original-failed-keeps-preview-${dpr}x.png`, output)) });
      originalResponses.set("portrait", { delay: 700 });
      await retry.click();
      await visibleControl(loading);
      await expect(image).toHaveAttribute("src", assets[1].previewUrl);
      await expect(modal.getByRole("button", { name: "原图已加载", exact: true })).toBeVisible();
      await expect(image).toHaveAttribute("src", assets[1].url);
      await ready(image);
      expect(originalGets(assets[1]).length - failureBefore).toBe(2);
      results.push({ name: `wheel-original-failure-manual-retry-${dpr}x`, status: "passed" });
      await page.screenshot({ path: fileURLToPath(new URL(`original-retry-loaded-${dpr}x.png`, output)) });
      await modal.getByRole("button", { name: "关闭", exact: true }).click();

      await page.getByRole("button", { name: "查看broken.png", exact: true }).click();
      await expect(image).toHaveAttribute("src", assets[2].url);
      await ready(image);
      expect(requests.slice(before).filter(r => r.path === assets[2].url && r.method === "GET")).toHaveLength(1);
      results.push({ name: `decode-failure-single-original-fallback-${dpr}x`, status: "passed" });
      await modal.getByRole("button", { name: "关闭", exact: true }).click();
      await page.getByRole("navigation", { name: "主导航", exact: true }).getByRole("button", { name: "全部图片", exact: true }).click();
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
  if (!probe && !paginationOnly) {
    originalResponses.clear();
    delay = 0;
    // Many independent single-image generations reproduce the real long rail
    // without exceeding the product's four-image limit for one generation.
    for (let index = assets.length; index < 36; index++) {
      const extra = { ...assets[0], id: `rail-${index + 1}`, name: `rail-${index + 1}.png`,
        url: `/api/images/rail-${index + 1}`, thumbnailUrl: `/api/images/rail-${index + 1}/thumbnail/1`,
        previewUrl: `/api/images/rail-${index + 1}/preview/1`, batchId: `rail-batch-${index + 1}`,
        options: { ...options, count: 1 }, outputIndex: 0 };
      assets.push(extra);
      state.generations.push({ ...state.generations[0], id: extra.batchId,
        options: extra.options, imageIds: [extra.id] });
    }
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      const mobile = viewport.width < 760;
      const context = await browser.newContext({ viewport, colorScheme: mobile ? "dark" : "light" });
      try {
        const page = await context.newPage();
        page.on("pageerror", e => errors.push(e.message));
        page.on("console", e => { if (e.type() === "error") errors.push(e.text()); });
        await page.goto(origin);
        await page.getByRole("navigation", { name: "主导航", exact: true }).getByRole("button", { name: "全部图片", exact: true }).click();
        const gallery = page.getByRole("region", { name: "我的图片", exact: true });
        await gallery.getByRole("button", { name: "查看 rail-15.png", exact: true }).click();
        const modal = page.getByRole("dialog", { name: "图片预览", exact: true });
        await expect(modal).toBeVisible();
        await ready(modal.locator(".preview-stage img"));
        const rail = modal.getByRole("navigation", { name: "图片切换", exact: true });
        const buttons = rail.getByRole("button");
        await expect.poll(() => buttons.count()).toBeGreaterThan(0);
        expect(await buttons.count(), "The long rail must only mount nearby thumbnails").toBeLessThanOrEqual(24);
        if (negativeRail) await page.addStyleTag({ content: ".image-preview .preview-thumbnails { overflow:auto!important; scrollbar-width:thin!important; } .image-preview .preview-thumbnails::-webkit-scrollbar { display:block!important; width:15px!important; height:15px!important; }" });
        const metrics = await rail.evaluate(element => {
          const style = getComputedStyle(element);
          return { clientWidth: element.clientWidth, scrollWidth: element.scrollWidth,
            clientHeight: element.clientHeight, scrollHeight: element.scrollHeight,
            overflowX: style.overflowX, overflowY: style.overflowY, scrollbarWidth: style.scrollbarWidth };
        });
        expect(metrics.scrollbarWidth, "Thumbnail navigation must hide its scrollbar without disabling scrolling").toBe("none");
        if (mobile) {
          expect(metrics.scrollWidth).toBeGreaterThan(metrics.clientWidth);
          expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.clientHeight + 1);
          expect(metrics.overflowX).toBe("auto");
          expect(metrics.overflowY).toBe("hidden");
        } else {
          expect(metrics.scrollWidth, "A vertical thumbnail rail must not create horizontal overflow").toBeLessThanOrEqual(metrics.clientWidth);
          expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);
          expect(metrics.overflowX).toBe("hidden");
          expect(metrics.overflowY).toBe("auto");
          await rail.hover();
          const before = await rail.evaluate(element => element.scrollTop);
          await page.mouse.wheel(0, 240);
          await expect.poll(() => rail.evaluate(element => element.scrollTop)).toBeGreaterThan(before);
        }
        const visibleInRail = button => button.evaluate(element => {
          const box = element.getBoundingClientRect();
          const parent = element.closest("nav").getBoundingClientRect();
          return box.left >= parent.left - 1 && box.right <= parent.right + 1
            && box.top >= parent.top - 1 && box.bottom <= parent.bottom + 1;
        });
        await rail.focus();
        await page.keyboard.press("Home");
        await expect(modal.locator(".preview-index")).toHaveText("1 / 36");
        await expect.poll(() => visibleInRail(rail.getByRole("button", { name: "查看第 1 张图片", exact: true }))).toBe(true);
        await rail.focus();
        await page.keyboard.press("End");
        await expect(modal.locator(".preview-index")).toHaveText("36 / 36");
        await expect.poll(() => visibleInRail(rail.getByRole("button", { name: "查看第 36 张图片", exact: true }))).toBe(true);
        expect(await buttons.count()).toBeLessThanOrEqual(24);
        await ready(modal.locator(".preview-stage img"));
        await page.screenshot({ path: fileURLToPath(new URL(`thumbnail-rail-36-${viewport.width}px.png`, output)), animations: "disabled" });
        results.push({ name: `36-image-rail-scroll-and-keyboard-${viewport.width}px`, metrics, status: "passed" });
      } finally { await context.close(); }
    }
  }
  if (paginationOnly) {
    delay = 0;
    const folderId = "pagination-folder";
    state.folders.push({ id: folderId, userId: user.id, name: "分页文件夹", createdAt: user.createdAt });
    const template = assets[0];
    assets.splice(0, assets.length, ...Array.from({ length: 125 }, (_, index) => ({
      ...template, id: `pagination-${index + 1}`, name: `pagination-${index + 1}.png`,
      url: `/api/images/pagination-${index + 1}`, thumbnailUrl: `/api/images/pagination-${index + 1}/thumbnail/1`,
      previewUrl: `/api/images/pagination-${index + 1}/preview/1`, batchId: `pagination-batch-${index + 1}`,
      createdAt: new Date(Date.parse(user.createdAt) - index * 1000).toISOString(),
      options: { ...options, count: 1 }, outputIndex: 0, folderIds: index < 75 ? [folderId] : [],
    })));
    state.generations.splice(0, state.generations.length, ...assets.map(asset => ({
      id: asset.batchId, userId: user.id, username: user.username, prompt: asset.prompt,
      attachments: [], options: asset.options, status: "completed", imageIds: [asset.id], createdAt: asset.createdAt, cost: 1,
    })));
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    try {
      const page = await context.newPage();
      page.on("pageerror", error => errors.push(error.message));
      page.on("console", message => {
        if (message.type() === "error" && !(expectedPageFailures && /503/.test(message.text())
          && message.location().url.includes("/api/studio/images"))) errors.push(message.text());
      });
      await page.goto(origin + "/#/gallery");
      const gallery = page.getByRole("region", { name: "我的图片", exact: true });
      const galleryImages = gallery.locator(".gallery-tile");
      await expect(galleryImages).toHaveCount(50);
      await expect(gallery.locator(".gallery-heading-title")).toContainText("125 张");
      expect(pageRequests.length).toBeGreaterThan(0);
      expect(pageRequests.every(request => request.cursor === "" && request.limit === 50),
        "Initial gallery reads must all request only the first 50-image page").toBe(true);
      for (const request of pageRequests) expect(request.ids).toEqual(assets.slice(0, 50).map(image => image.id));
      results.push({ name: "gallery-initial-page-50-and-global-total-125", status: "passed" });

      await gallery.getByRole("button", { name: "查看 pagination-1.png", exact: true }).click();
      const modal = page.getByRole("dialog", { name: "图片预览", exact: true });
      const rail = modal.getByRole("navigation", { name: "图片切换", exact: true });
      const index = modal.locator(".preview-index");
      const photo = modal.locator(".preview-stage img");
      await ready(photo);
      await expect(index).toHaveText("1 / 125");
      expect(await rail.getByRole("button").count()).toBeLessThanOrEqual(24);
      await rail.focus();
      await page.keyboard.press("End");
      await expect(index).toHaveText("50 / 125");
      await modal.getByRole("button", { name: "下一张", exact: true }).click();
      await expect(index).toHaveText("51 / 125");
      await expect(photo).toHaveAttribute("alt", "pagination-51.png");
      expect(pageRequests.find(request => request.cursor === "fixture:50")?.ids).toEqual(assets.slice(50, 100).map(image => image.id));
      results.push({ name: "preview-50-to-51-loads-next-page-without-skipping", status: "passed" });

      failPageCursor = "fixture:100";
      await rail.focus();
      await page.keyboard.press("End");
      await expect(index).toHaveText("100 / 125");
      const retry = rail.getByRole("button", { name: "重试", exact: true });
      await expect(retry).toBeVisible();
      expect(pageRequests.filter(request => request.cursor === "fixture:100")).toHaveLength(1);
      await modal.getByRole("button", { name: "下一张", exact: true }).click();
      await expect(index).toHaveText("100 / 125");
      expect(pageRequests.filter(request => request.cursor === "fixture:100")).toHaveLength(1);
      await retry.click();
      await expect(retry).toHaveCount(0);
      await modal.getByRole("button", { name: "下一张", exact: true }).click();
      await expect(index).toHaveText("101 / 125");
      await expect(photo).toHaveAttribute("alt", "pagination-101.png");
      expect(pageRequests.filter(request => request.cursor === "fixture:100")).toHaveLength(2);
      results.push({ name: "preview-100-to-101-read-failure-keeps-image-and-manual-retry", status: "passed" });

      await rail.focus();
      await page.keyboard.press("End");
      await expect(index).toHaveText("125 / 125");
      expect(await rail.getByRole("button").count()).toBeLessThanOrEqual(24);
      await expect(rail.getByRole("button", { name: "查看第 125 张图片", exact: true })).toBeInViewport();
      await rail.focus();
      await page.keyboard.press("Home");
      await expect(index).toHaveText("1 / 125");
      await expect(rail.getByRole("button", { name: "查看第 1 张图片", exact: true })).toBeInViewport();
      await page.screenshot({ path: fileURLToPath(new URL("pagination-preview-125-bounded-rail.png", output)), animations: "disabled" });
      results.push({ name: "virtual-rail-keeps-at-most-24-buttons-and-reaches-both-ends", status: "passed" });
      await modal.getByRole("button", { name: "关闭", exact: true }).click();

      await gallery.evaluate(element => { element.scrollTop = element.scrollHeight; });
      await expect(galleryImages).toHaveCount(100);
      await expect(gallery.locator(".gallery-heading-title")).toContainText("125 张");
      results.push({ name: "gallery-near-bottom-loads-next-50", status: "passed" });
      await page.getByRole("navigation", { name: "主导航", exact: true }).getByRole("button", { name: "分页文件夹", exact: true }).click();
      await expect(gallery.locator(".gallery-heading-title")).toContainText("75 张");
      await expect(galleryImages).toHaveCount(50);
      expect(pageRequests.at(-1).folderId).toBe(folderId);
      await gallery.evaluate(element => { element.scrollTop = element.scrollHeight; });
      await expect(galleryImages).toHaveCount(75);
      expect((await galleryImages.locator("img").evaluateAll(images => images.map(image => image.alt))))
        .toEqual(assets.slice(0, 75).map(image => image.name));
      await page.screenshot({ path: fileURLToPath(new URL("pagination-folder-total-75.png", output)), animations: "disabled" });
      results.push({ name: "folder-pagination-is-scoped-and-total-is-not-loaded-count", status: "passed" });
      expect(pageRequests.every(request => request.limit === 50)).toBe(true);
    } finally { await context.close(); }
  }
  expect(errors).toEqual([]);
  await writeFile(new URL(probe ? "before.json" : "regression.json", output), JSON.stringify({
    evidence: "real frontend + synthetic local HTTP API/image bytes; browser cache enabled; no production images or paid upstream",
    results, failures, errors, ...(paginationOnly ? { pageRequests, expectedPageFailures } : {}),
  }, null, 2));
  console.log(JSON.stringify({ results: results.map(({ trace, ...result }) => result), failures, errors }));
  if (!probe) expect(failures).toEqual([]);
} finally {
  await browser?.close();
  await server.close();
}
