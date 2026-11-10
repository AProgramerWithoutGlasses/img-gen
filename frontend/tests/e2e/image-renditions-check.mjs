// Synthetic API data exercises the real UI/image loader. This does not measure
// production compression ratios or substitute for Go format/auth/cache tests.
import { chromium, expect } from "@playwright/test";
import { createServer } from "vite";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const output = new URL("../../outputs/image-renditions/", import.meta.url);
const port = 5177, origin = `http://127.0.0.1:${port}`;
const raceOnly = process.argv.includes("--race-only");
const visualOnly = process.argv.includes("--visual-only");
await mkdir(output, { recursive: true });
const server = await createServer({ root, server: { host: "127.0.0.1", port, strictPort: true } });
await server.listen();
let browser;
const results = [], errors = [], expectedErrors = [];
const expectedErrorURLs = new Set();
const user = { id: "fixture-user", username: "fixture", role: "admin", status: "enabled", balance: 100, createdAt: "2026-11-10T00:00:00Z" };
const options = { modelId: "gpt-image-2", ratio: "自动", count: 1 };
const models = ["gpt-image-2", "gpt-image-1.5", "gpt-image-2.5-sunburst", "gemini-3.1-flash-image", "gemini-3-pro-image"]
  .map(id => ({ id, name: id, qualities: [], resolutions: [], ratios: ["自动", "1:1"] }));
const shapes = [
  { id: "landscape", name: "横图.png", width: 1600, height: 900 },
  { id: "portrait", name: "竖图.webp", width: 900, height: 1600 },
  { id: "square", name: "方图.jpeg", width: 1200, height: 1200 },
  { id: "small", name: "小图.gif", width: 120, height: 80 },
  { id: "long", name: "极长透明图片-名称需要单行省略而不能撑大整个浮窗.png", width: 100, height: 3000 },
  { id: "fallback", name: "衍生失败.png", width: 1200, height: 800 },
];
function attachment(shape) {
  const path = "/api/studio/attachments/" + shape.id;
  return { ...shape, url: path, thumbnailUrl: path + "/thumbnail/1", previewUrl: path + "/preview/1", previewLargeUrl: path + "/preview-large/1" };
}
const asset = { id: "output", name: "站内生成图.png", width: 1600, height: 900, url: "/api/images/output", thumbnailUrl: "/api/images/output/thumbnail/1", previewUrl: "/api/images/output/preview/1",
  userId: user.id, createdAt: user.createdAt, batchId: "fixture-batch", outputIndex: 0, prompt: "资源选择验证", options, folderIds: [] };
const state = { version: 1, assets: [asset], folders: [], generations: [{ id: asset.batchId, userId: user.id, username: user.username, prompt: asset.prompt,
  attachments: [attachment(shapes[0])], options, status: "completed", imageIds: [asset.id], createdAt: user.createdAt, cost: 1 }],
  users: [user], currentUserId: user.id, prices: Object.fromEntries(models.map(model => [model.id, 1])), priceUpdatedAt: {}, priceVersions: {} };
function svg(width, height) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#b7c8b5"/><path d="M0 0L${width} ${height}" stroke="#52614f" stroke-width="2"/></svg>`;
}
function rendition(shape, path) {
  if (path.includes("/thumbnail/") && !path.startsWith("/api/images/")) {
    const edge = Math.min(256, shape.width, shape.height);
    return svg(edge, edge);
  }
  const limit = path.includes("/preview-large/") || path.includes("/preview/") && path.startsWith("/api/images/") ? 1600 : path.includes("/preview/") || path.includes("/thumbnail/") ? 640 : Infinity;
  const scale = Math.min(1, limit / Math.max(shape.width, shape.height));
  return svg(Math.max(1, Math.round(shape.width * scale)), Math.max(1, Math.round(shape.height * scale)));
}
async function register(context, requests) {
  context.on("page", page => {
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => {
      if (message.type() !== "error") return;
      if (expectedErrorURLs.has(message.location().url)) expectedErrors.push(message.text());
      else errors.push(message.text());
    });
  });
  let uploadIndex = 0;
  await context.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/studio/state") return route.fulfill({ json: state });
    if (path === "/api/studio/models") return route.fulfill({ json: models });
    if (path === "/api/studio/attachments" && route.request().method() === "POST") return route.fulfill({ status: 201, json: attachment(shapes[uploadIndex++ % shapes.length]) });
    if (path.startsWith("/api/images/") || path.startsWith("/api/studio/attachments/")) {
      requests.push({ path, method: route.request().method() });
      const id = path.split("/")[path.startsWith("/api/images/") ? 3 : 4];
      const shape = id === "output" ? asset : shapes.find(item => item.id === id);
      if (!shape) throw new Error("Unknown fixture image: " + path);
      if (id === "fallback" && path.includes("/preview")) return route.fulfill({ contentType: "image/webp", body: "invalid image bytes" });
      return route.fulfill({ contentType: "image/svg+xml", body: rendition(shape, path) });
    }
    throw new Error("Unexpected API request: " + path);
  });
}
async function loaded(locator) {
  try {
    await expect.poll(() => locator.evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
  } catch (error) {
    console.error("Image load diagnostic", await locator.evaluate(image => ({
      src: image.getAttribute("src"), complete: image.complete, naturalWidth: image.naturalWidth,
      box: image.getBoundingClientRect().toJSON(), parent: image.parentElement?.getBoundingClientRect().toJSON(),
    })));
    throw error;
  }
}
async function upload(page, count = shapes.length) {
  const buffer = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
  await page.getByLabel("上传图片文件", { exact: true }).setInputFiles(shapes.slice(0, count).map(shape => ({ name: shape.name, mimeType: "image/gif", buffer })));
  await expect(page.locator(".dialog-attachment-card")).toHaveCount(count);
  await expect(page.locator(".dialog-attachment-placeholder")).toHaveCount(0);
}
async function hover(page, id) {
  const card = page.locator(`.dialog-attachment-card[data-attachment-id="${id}"]`);
  await card.hover({ position: { x: 8, y: 48 } });
  const floating = page.locator(".dialog-attachment-preview");
  await expect(floating).toBeVisible();
  await expect(floating).toHaveCSS("opacity", "1");
  const image = floating.locator("img");
  await expect(image).toHaveAttribute("alt", shapes.find(shape => shape.id === id).name);
  await loaded(image);
  await expect(image).toHaveCSS("opacity", "1");
  return { card, floating, image };
}
async function geometry(page, id) {
  const { card, floating, image } = await hover(page, id);
  const anchor = await card.boundingBox(), frame = await floating.boundingBox(), picture = await image.boundingBox();
  const shape = shapes.find(item => item.id === id);
  expect(anchor.y - frame.y - frame.height).toBeCloseTo(10, 0);
  const viewport = page.viewportSize();
  const leftEdge = 8;
  const rightEdge = viewport.width - 8;
  expect(frame.x).toBeGreaterThanOrEqual(leftEdge - 0.1);
  expect(frame.x + frame.width).toBeLessThanOrEqual(rightEdge + 0.1);
  if (anchor.x + 31 - frame.width / 2 >= leftEdge && anchor.x + 31 + frame.width / 2 <= rightEdge) {
    expect(frame.x + frame.width / 2).toBeCloseTo(anchor.x + anchor.width / 2, 0);
  }
  expect(await floating.evaluate(element => {
    const box = element.getBoundingClientRect();
    return element.contains(document.elementFromPoint(box.left + 2, box.top + box.height / 2));
  }), "The preview must not be clipped by the workspace beside the sidebar").toBe(true);
  expect(frame.y).toBeGreaterThanOrEqual(7.5);
  expect(frame.width).toBeLessThanOrEqual(324);
  expect(frame.height).toBeLessThanOrEqual(324);
  expect(picture.width).toBeLessThanOrEqual(Math.min(316, shape.width) + 0.1);
  expect(picture.height).toBeLessThanOrEqual(Math.min(288, shape.height) + 0.1);
  expect(picture.width / picture.height).toBeCloseTo(shape.width / shape.height, 2);
  expect(frame.height - picture.height).toBeCloseTo(36, 0);
  const filename = floating.locator(".dialog-attachment-preview-name span");
  await expect(filename).toHaveCSS("text-overflow", "ellipsis");
  return { frame, picture, floating, image, card };
}
try {
  browser = await chromium.launch({ channel: process.platform === "win32" ? "msedge" : undefined });
  for (const dpr of raceOnly ? [] : visualOnly ? [1] : [0.9, 1, 1.25, 2, 3]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: dpr });
    const requests = [];
    await register(context, requests);
    const page = await context.newPage();
    await page.goto(origin);
    const result = page.locator(".result-card img");
    await loaded(result);
    const displayed = await result.boundingBox();
    const fittedEdge = Math.max(asset.width, asset.height) * Math.min(displayed.width / asset.width, displayed.height / asset.height) * dpr;
    await expect(result).toHaveAttribute("src", fittedEdge <= 641 ? asset.thumbnailUrl : asset.previewUrl);
    await expect(page.locator(".workbench-prompt")).toHaveText(asset.prompt);
    await expect(page.locator(".sent-attachments img")).toHaveCount(0);
    await upload(page);
    for (const id of ["landscape", "portrait", "square", "small", "long"]) {
      const snapshot = await geometry(page, id);
      const small = snapshot.card.locator("img");
      await expect(small).toHaveAttribute("src", attachment(shapes.find(shape => shape.id === id)).thumbnailUrl);
      if (id === "landscape") await expect(snapshot.image).toHaveAttribute("src", attachment(shapes[0])[dpr <= 2 ? "previewUrl" : "previewLargeUrl"]);
      if (dpr === 1 && ["landscape", "portrait", "small"].includes(id)) {
        await page.screenshot({ path: fileURLToPath(new URL(`hover-${id}.png`, output)) });
        const row = await page.locator(".attachment-row").boundingBox();
        const left = Math.min(snapshot.frame.x, row.x) - 8, top = snapshot.frame.y - 8;
        await page.screenshot({ path: fileURLToPath(new URL(`detail-${id}.png`, output)), clip: {
          x: left, y: top, width: Math.max(snapshot.frame.x + snapshot.frame.width, row.x + row.width) - left + 8,
          height: row.y + row.height - top + 8,
        } });
      }
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    const sidebarOverlap = await geometry(page, "landscape");
    const workspace = await page.locator(".workspace").boundingBox();
    expect(sidebarOverlap.frame.x).toBeLessThan(workspace.x);
    await page.setViewportSize({ width: 1440, height: 900 });
    const { floating } = await hover(page, "landscape");
    await floating.hover();
    await page.waitForTimeout(180);
    await expect(floating).toBeVisible();
    await page.locator(".dialog-attachment-card[data-attachment-id='portrait']").hover({ position: { x: 8, y: 48 } });
    await page.locator(".dialog-attachment-card[data-attachment-id='square']").hover({ position: { x: 8, y: 48 } });
    await expect(floating.locator("img")).toHaveAttribute("alt", shapes[2].name);
    await loaded(floating.locator("img"));
    await page.getByRole("textbox", { name: "提示词", exact: true }).fill(Array.from({ length: 8 }, (_, i) => "输入延展测试 " + i).join("\n"));
    await geometry(page, "portrait");
    await page.setViewportSize({ width: 1440, height: 600 });
    const constrained = await geometry(page, "portrait");
    expect(constrained.frame.height).toBeLessThan(324);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole("textbox", { name: "提示词", exact: true }).fill("");
    const degraded = await hover(page, "fallback");
    await expect(degraded.image).toHaveAttribute("src", attachment(shapes[5]).url);
    expect(requests.filter(request => request.path === attachment(shapes[5]).url && request.method === "GET")).toHaveLength(1);
    await degraded.card.hover({ position: { x: 8, y: 48 } });
    await degraded.card.getByRole("button", { name: "移除" + shapes[5].name, exact: true }).click();
    await expect(floating).toHaveCount(0);
    for (const id of ["landscape", "portrait", "square", "small", "long"]) {
      const card = page.locator(`.dialog-attachment-card[data-attachment-id="${id}"]`);
      await card.hover({ position: { x: 8, y: 48 } });
      await card.getByRole("button", { name: "移除" + shapes.find(shape => shape.id === id).name, exact: true }).click();
    }
    await page.locator(".result-card").hover();
    await page.locator(".result-actions").getByRole("button", { name: "继续修图", exact: true }).click();
    const outputCard = page.locator(".dialog-attachment-card");
    await loaded(outputCard.locator("img"));
    await expect(outputCard.locator("img")).toHaveAttribute("src", asset.thumbnailUrl);
    await outputCard.hover({ position: { x: 8, y: 48 } });
    await expect(floating).toBeVisible();
    await loaded(floating.locator("img"));
    await expect(floating.locator("img")).toHaveAttribute("src", dpr <= 2 ? asset.thumbnailUrl : asset.previewUrl);
    expect(requests.filter(request => request.path === asset.url)).toHaveLength(0);
    results.push({ name: `adaptive-attachments-${dpr}x`, status: "passed", requests: requests.length });
    await context.close();
  }
  if (!raceOnly) {
  const deniedContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const deniedRequests = [];
  await register(deniedContext, deniedRequests);
  const deniedPath = attachment(shapes[0]).previewUrl;
  expectedErrorURLs.add(origin + deniedPath);
  await deniedContext.route("**" + deniedPath, async route => {
    deniedRequests.push({ path: deniedPath, method: route.request().method() });
    return route.fulfill({ status: 403, json: { error: "没有权限" } });
  });
  const deniedPage = await deniedContext.newPage();
  await deniedPage.goto(origin);
  await upload(deniedPage, 1);
  await deniedPage.locator(".dialog-attachment-card").hover({ position: { x: 8, y: 48 } });
  await expect(deniedPage.locator(".dialog-attachment-preview").getByRole("status")).toHaveText("预览暂时无法加载");
  expect(deniedRequests.filter(request => request.path === attachment(shapes[0]).url)).toHaveLength(0);
  expect(deniedRequests.filter(request => request.path === deniedPath && request.method === "HEAD")).toHaveLength(1);
  results.push({ name: "forbidden-preview-does-not-fetch-original", status: "passed" });
  await deniedContext.close();
  const sheet = await browser.newPage({ viewport: { width: 1450, height: 580 }, deviceScaleFactor: 1 });
  const panels = await Promise.all(["landscape", "portrait", "small"].map(async (id, index) => {
    const bytes = await readFile(new URL(`detail-${id}.png`, output));
    return `<section><h2>${["横图：浮窗高度收紧", "竖图：浮窗宽度收紧", "小图：保持原尺寸"][index]}</h2><img src="data:image/png;base64,${bytes.toString("base64")}"/></section>`;
  }));
  await sheet.setContent(`<html><head><meta charset="utf-8"/><style>body{margin:0;padding:20px;background:#e7e7e7;font-family:'Microsoft YaHei',sans-serif;display:flex;gap:16px}section{width:454px}h2{font-size:16px;margin:0 0 16px;font-weight:500}img{display:block;max-width:454px;height:auto}</style></head><body>${panels.join("")}</body></html>`);
  await sheet.locator("img").evaluateAll(images => Promise.all(images.map(image => image.decode())));
  await sheet.screenshot({ path: fileURLToPath(new URL("adaptive-preview-sheet.png", output)) });
  await sheet.close();
  }
  const raceContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const raceRequests = [];
  await register(raceContext, raceRequests);
  let releaseHead, headStarted = false;
  const heldHead = new Promise(resolve => { releaseHead = resolve; });
  const racePath = attachment(shapes[0]).previewUrl;
  await raceContext.route("**" + racePath, async route => {
    raceRequests.push({ path: racePath, method: route.request().method() });
    if (route.request().method() === "HEAD") {
      headStarted = true;
      await heldHead;
      return route.fulfill({ status: 200, contentType: "image/webp", body: "" });
    }
    return route.fulfill({ status: 200, contentType: "image/webp", body: "invalid image bytes" });
  });
  const racePage = await raceContext.newPage();
  try {
    await racePage.goto(origin);
    await upload(racePage, 1);
    await racePage.locator(".dialog-attachment-card").hover({ position: { x: 8, y: 48 } });
    await expect.poll(() => headStarted).toBe(true);
    const session = await raceContext.newCDPSession(racePage);
    await session.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 3, mobile: false });
    await expect.poll(() => racePage.evaluate(() => window.devicePixelRatio)).toBe(3);
    await racePage.evaluate(() => window.dispatchEvent(new Event("resize")));
    const raceImage = racePage.locator(".dialog-attachment-preview img");
    await expect(raceImage).toHaveAttribute("src", attachment(shapes[0]).previewLargeUrl);
    await loaded(raceImage);
    releaseHead();
    await racePage.waitForTimeout(200);
    await expect(raceImage).toHaveAttribute("src", attachment(shapes[0]).previewLargeUrl);
    expect(raceRequests.filter(request => request.path === attachment(shapes[0]).url)).toHaveLength(0);
    results.push({ name: "late-failed-head-cannot-replace-new-dpr-image", status: "passed" });
    const initialCard = racePage.locator(".dialog-attachment-card");
    await initialCard.hover({ position: { x: 8, y: 48 } });
    await initialCard.getByRole("button", { name: "移除" + shapes[0].name, exact: true }).click();
    await raceContext.route("**/api/studio/attachments", route => route.fulfill({ status: 201, json: attachment(shapes[5]) }));
    await upload(racePage, 1);
    await racePage.mouse.move(16, 80);
    const fallbackPreview = await hover(racePage, "fallback");
    await expect(fallbackPreview.image).toHaveAttribute("src", attachment(shapes[5]).url);
    await session.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await expect.poll(() => racePage.evaluate(() => window.devicePixelRatio)).toBe(1);
    await racePage.evaluate(() => window.dispatchEvent(new Event("resize")));
    await racePage.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(fallbackPreview.image).toHaveAttribute("src", attachment(shapes[5]).url);
    await expect(fallbackPreview.image).toHaveCSS("opacity", "1");
    await expect(fallbackPreview.floating.getByRole("status")).toHaveCount(0);
    expect(raceRequests.filter(request => request.path === attachment(shapes[5]).url && request.method === "GET")).toHaveLength(1);
    results.push({ name: "fallback-image-stays-ready-after-dpr-change", status: "passed" });
  } finally {
    releaseHead();
    await raceContext.close();
  }
  expect(errors).toEqual([]);
  await writeFile(new URL(raceOnly ? "race-regression.json" : visualOnly ? "visual-regression.json" : "regression.json", output), JSON.stringify({ evidence: "real frontend with synthetic API and image resources; no production images or paid upstream", results, errors, expectedErrors }, null, 2));
  console.log(JSON.stringify({ results, errors, expectedErrors }));
} finally {
  await browser?.close();
  await server.close();
}
