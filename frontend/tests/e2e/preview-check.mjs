import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import { createServer } from "vite";
import { chooseDialogOption, removeDialogAttachment, verifyDialog } from "./dialog-check.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const output = new URL("../../outputs/preview/", import.meta.url);
const origin = "http://127.0.0.1:5175";
await mkdir(output, { recursive: true });
const server = await createServer({
  mode: "preview",
  root,
  server: { port: 5175, strictPort: true, host: "127.0.0.1" },
});
const errors = [];
const results = [];
let dialogChecks = [];
let browser;
let page;

async function screenshot(name) {
  const filename = name + ".png";
  await page.screenshot({
    path: fileURLToPath(new URL(filename, output)),
    fullPage: false,
  });
  return filename;
}

async function check(name, action) {
  await action();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > innerWidth,
  );
  expect(overflow, "Unexpected horizontal page overflow").toBe(false);
  results.push({
    name,
    status: "passed",
    screenshot: await screenshot(
      String(results.length + 1).padStart(2, "0") + "-" + name,
    ),
  });
}

async function attachGuards(context) {
  await context.addInitScript(() => {
    addEventListener("error", event => {
      if (event.message.includes("ResizeObserver loop")) console.error(event.message);
    });
  });
  context.on("page", (observedPage) => {
    observedPage.on("pageerror", (error) => errors.push(error.message));
    observedPage.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
  });
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (["data:", "blob:"].includes(url.protocol)) return route.continue();
    if (url.origin !== origin || /^\/api(?:\/|$)/.test(url.pathname)) {
      errors.push("Unexpected network request: " + url.origin + url.pathname);
      return route.abort();
    }
    return route.continue();
  });
}

async function signInAs(username) {
  await page.getByLabel("用户名", { exact: true }).fill(username);
  await page.getByLabel("密码", { exact: true }).fill("preview1234");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "登录", exact: true }),
  ).not.toBeVisible();
}

async function openPictureSection(name) {
  const navigation = page.getByRole("navigation", { name: "主导航", exact: true });
  const expandSidebar = page.getByRole("button", { name: "展开侧栏", exact: true });
  if (await expandSidebar.count()) await expandSidebar.click();
  const galleryToggle = navigation.getByRole("button", { name: "我的图片", exact: true });
  if ((await galleryToggle.getAttribute("aria-expanded")) !== "true") await galleryToggle.click();
  await expect(galleryToggle).toHaveAttribute("aria-expanded", "true");
  const target = navigation.getByRole("button", { name, exact: true });
  await target.click();
}

async function openFolder(name) {
  await openPictureSection("文件夹管理");
  await page.getByRole("button", { name: "打开文件夹 " + name, exact: true }).click();
}

async function verifyLogin() {
  const username = page.getByLabel("用户名", { exact: true });
  const password = page.getByLabel("密码", { exact: true });
  const submit = page.getByRole("button", { name: "登录", exact: true });
  await expect(username).toBeVisible();
  await expect(password).toHaveAttribute("type", "password");
  if (await submit.isEnabled()) await submit.click();
  await expect(username).toBeVisible();
  await expect(page.getByRole("navigation", { name: "主导航" })).toHaveCount(0);
  await username.fill("admin");
  if (await submit.isEnabled()) await submit.click();
  await expect(username).toBeVisible();
  await expect(page.getByRole("navigation", { name: "主导航" })).toHaveCount(0);
  await screenshot("login-empty-password");

  await password.fill("wrong-preview-password");
  await page.getByRole("button", { name: "显示密码", exact: true }).click();
  await expect(password).toHaveAttribute("type", "text");
  await expect(password).toHaveValue("wrong-preview-password");
  await page.getByRole("button", { name: "隐藏密码", exact: true }).click();
  await expect(password).toHaveAttribute("type", "password");
  await submit.click();
  await expect(page.getByRole("alert")).toContainText(/用户名|密码/);
  await expect(page.getByRole("navigation", { name: "主导航" })).toHaveCount(0);
  await expect(username).toBeVisible();
  await screenshot("login-invalid-password");
  await signInAs("admin");
  await expect(
    page.getByRole("textbox", { name: "提示词", exact: true }),
  ).toBeVisible();
}

async function verifyCreation() {
  const creation = page.getByRole("region", { name: "图像创作", exact: true });
  const model = creation.getByRole("combobox", { name: "模型", exact: true });
  const prompt = creation.getByRole("textbox", { name: "提示词", exact: true });
  await expect(prompt).toBeVisible();
  await chooseDialogOption(page, model, "Gemini Image 3.1F");
  await expect(
    creation.getByRole("combobox", { name: "档位", exact: true }),
  ).toHaveCount(0);
  await expect(
    creation.getByRole("combobox", { name: "清晰度", exact: true }),
  ).toBeVisible();
  await chooseDialogOption(page, model, "GPT Image 1.5");
  await expect(
    creation.getByRole("combobox", { name: "档位", exact: true }),
  ).toHaveCount(0);
  await expect(
    creation.getByRole("combobox", { name: "清晰度", exact: true }),
  ).toHaveCount(0);
  await chooseDialogOption(page, model, "GPT Image 2.5S");
  await chooseDialogOption(page, creation.getByRole("combobox", { name: "生成数量", exact: true }), "2张");
  const testPrompt = "线框预览自动检查：一张灰色几何图形，保持横向构图。";
  await expect(creation.getByRole("button", { name: "展开提示词", exact: true })).toHaveCount(0);
  await prompt.fill(testPrompt);
  await expect(prompt).toHaveValue(testPrompt);
  const beforeUpload = await prompt.boundingBox();
  const pixel = Buffer.from(
    "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
    "base64",
  );
  await creation.getByLabel("上传图片文件", { exact: true }).setInputFiles([
    { name: "reference-a.gif", mimeType: "image/gif", buffer: pixel },
    { name: "reference-b.gif", mimeType: "image/gif", buffer: pixel },
  ]);
  await expect(
    creation.locator(".attachment-row .attachment-item"),
  ).toHaveCount(2);
  const afterUpload = await prompt.boundingBox();
  expect(afterUpload.height).toBeCloseTo(beforeUpload.height, 0);
  expect(afterUpload.y).toBeCloseTo(beforeUpload.y, 0);
  await screenshot("creation-two-attachments");
  await removeDialogAttachment(creation, "移除reference-a.gif");
  await removeDialogAttachment(creation, "移除reference-b.gif");
  await expect(creation.locator(".attachment-row")).toHaveCount(0);
  const originalBatch = await creation.getByTestId("generation-turn").getAttribute("data-generation-id");
  const originalImage = await creation.locator(".result-open img").first().getAttribute("alt");
  await creation
    .getByRole("button", { name: "继续修图", exact: true })
    .first()
    .click();
  await expect(
    creation.locator(".attachment-row .attachment-item"),
  ).toHaveCount(1);
  const attachment = creation.locator(".attachment-row");
  await attachment.locator(".attachment-item").first().hover();
  await attachment.getByRole("button", { name: /^移除/ }).click();
  await expect(attachment).toHaveCount(0);
  const downloadEvent = page.waitForEvent("download");
  await creation
    .getByRole("button", { name: "下载", exact: true })
    .first()
    .click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toMatch(/\.(svg|png|webp|jpe?g)$/i);
  expect(await download.failure()).toBeNull();
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  await creation.getByRole("button", { name: "生成", exact: true }).click();
  await expect(creation.getByTestId("generation-turn")).not.toHaveAttribute("data-generation-id", originalBatch);
  await expect(creation.getByTestId("generation-turn")).toHaveCount(1);
  await expect(creation.locator(".workbench-prompt")).toHaveText(testPrompt);
  await expect(creation.locator(".workbench-status")).toHaveText("已完成 0 / 2 张");
  await expect(creation.locator(".result-card")).toHaveCount(2);
  await expect(creation.locator(".result-slot-placeholder")).toHaveCount(2);
  await expect(creation.locator(".result-open")).toHaveCount(0);
  await expect(creation.locator(".result-actions")).toHaveCount(0);
  await page.clock.resume();
  await expect(creation.locator(".result-open")).toHaveCount(2, { timeout: 15000 });
  await expect(creation.locator(".workbench-status")).toHaveText("2 张已完成");
  await expect(prompt).toHaveValue("");
  await page.reload();
  await expect(creation.getByTestId("generation-turn")).toHaveCount(1);
  await expect(creation.locator(".result-open")).toHaveCount(2);
  await expect(creation.getByText(testPrompt, { exact: true })).toBeVisible();
  await openPictureSection("全部图片");
  await expect(page.getByRole("region", { name: "我的图片", exact: true }).getByRole("img", { name: originalImage, exact: true })).toHaveCount(1);
  await page.getByRole("button", { name: "图像创作", exact: true }).click();
}

async function verifyScroll(locator) {
  const metrics = await locator.evaluate((element) => ({
    scroll: element.scrollHeight,
    height: element.clientHeight,
    top: element.scrollTop,
  }));
  if (metrics.scroll <= metrics.height + 1) return;
  await locator.hover({ position: { x: 120, y: 120 } });
  await page.mouse.wheel(0, -10000);
  await expect
    .poll(() => locator.evaluate((element) => element.scrollTop))
    .toBe(0);
  await page.mouse.wheel(0, 400);
  await expect
    .poll(() => locator.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
  await page.mouse.wheel(0, -10000);
  await expect
    .poll(() => locator.evaluate((element) => element.scrollTop))
    .toBe(0);
}

async function verifyRequestsAndKeyboard() {
  await page
    .getByRole("navigation", { name: "设置导航", exact: true })
    .getByRole("button", { name: "请求记录", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "提示词", exact: true })
    .fill("线框预览自动检查");
  await page
    .getByRole("combobox", { name: "状态", exact: true })
    .selectOption("completed");
  await page.getByRole("button", { name: "筛选", exact: true }).click();
  const table = page.locator(".requests-table");
  await expect(table.getByRole("row")).toHaveCount(2);
  await table
    .getByRole("button", { name: "查看 admin 的请求详情", exact: true })
    .click();
  const detail = page.getByRole("dialog", { name: "请求详情", exact: true });
  await expect(
    detail.getByText("线框预览自动检查：一张灰色几何图形，保持横向构图。", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(detail.locator(".request-detail-images img")).toHaveCount(2);
  await screenshot("request-detail");
  await detail.getByRole("button", { name: "关闭", exact: true }).click();
  await page
    .getByRole("textbox", { name: "提示词", exact: true })
    .fill("no-such-preview-request");
  await page.getByRole("button", { name: "筛选", exact: true }).click();
  await expect(
    page.getByRole("cell", { name: "没有匹配的请求", exact: true }),
  ).toBeVisible();
  await verifyScroll(page.locator(".settings-content"));
  await page.getByRole("button", { name: "返回创作", exact: true }).click();
  const creation = page.getByRole("region", { name: "图像创作", exact: true });
  const prompt = creation.getByRole("textbox", { name: "提示词", exact: true });
  const current = creation.getByTestId("generation-turn");
  const before = await current.getAttribute("data-generation-id");
  await prompt.fill("中文输入法候选");
  await prompt.dispatchEvent("compositionstart");
  await prompt.press("Enter");
  await expect(prompt).toBeEnabled();
  await expect(current).toHaveAttribute("data-generation-id", before);
  await prompt.dispatchEvent("compositionend");
  await prompt.fill("键盘发送检查");
  await prompt.press("Shift+Enter");
  await expect(prompt).toHaveValue("键盘发送检查\n");
  await expect(current).toHaveAttribute("data-generation-id", before);
  await prompt.press("Enter");
  await expect(current).not.toHaveAttribute("data-generation-id", before);
  await expect(current).toHaveCount(1);
  await expect(creation.locator(".workbench-prompt")).toHaveText("键盘发送检查");
  await expect(prompt).toHaveValue("", { timeout: 15000 });
  expect(await creation.locator(".conversation").evaluate(element => element.scrollHeight <= element.clientHeight + 1), "The current result area must fit without a history scrollbar").toBe(true);
}

async function verifyRoleBoundary() {
  await page.getByRole("button", { name: "我的账户", exact: true }).click();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "模型价格", exact: true }).click();
  const price = page.getByRole("spinbutton", {
    name: "GPT Image 2 单张积分",
    exact: true,
  });
  const pendingPrice = String(Number(await price.inputValue()) + 9);
  await price.fill(pendingPrice);
  await page.getByRole("button", { name: "我的账户", exact: true }).click();
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  const guard = page.getByRole("dialog", {
    name: "放弃未保存的修改？",
    exact: true,
  });
  await guard.getByRole("button", { name: "继续编辑", exact: true }).click();
  await expect(price).toHaveValue(pendingPrice);
  await expect(page).toHaveURL(/#\/settings\/prices$/);
  await page.getByRole("button", { name: "我的账户", exact: true }).click();
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await guard.getByRole("button", { name: "放弃修改", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "登录", exact: true }),
  ).toBeVisible();
  await signInAs("user1");
  await openPictureSection("全部图片");
  await expect(
    page.getByRole("heading", { name: "还没有生成的图片", exact: true }),
  ).toBeVisible();
  await openPictureSection("文件夹管理");
  await expect(page.getByRole("region", { name: "文件夹管理", exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "打开文件夹 预览测试 A", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "图像创作", exact: true }).click();
  const creation = page.getByRole("region", { name: "图像创作", exact: true });
  const failedBatch = await creation.getByTestId("generation-turn").getAttribute("data-generation-id");
  await creation.getByRole("button", { name: "查看错误", exact: true }).click();
  const failure = page.getByRole("dialog", { name: "生成未全部完成", exact: true });
  const retry = failure.getByRole("button", { name: "重新编辑", exact: true });
  await expect(retry).toBeEnabled();
  await retry.click();
  await expect(failure).not.toBeVisible();
  const prompt = creation.getByRole("textbox", { name: "提示词", exact: true });
  await expect(prompt).toHaveValue("一张安静的海边照片");
  await prompt.fill("普通用户处理中检查");
  await creation.getByRole("button", { name: "生成", exact: true }).click();
  await expect(creation.getByTestId("generation-turn")).not.toHaveAttribute("data-generation-id", failedBatch);
  await expect(creation.getByTestId("generation-turn")).toHaveCount(1);
  await expect(creation.getByRole("button", { name: "查看错误", exact: true })).toHaveCount(0);
  await expect(prompt).toHaveValue("", { timeout: 15000 });
  await page.getByRole("button", { name: "我的账户", exact: true }).click();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  const navigation = page.getByRole("navigation", {
    name: "设置导航",
    exact: true,
  });
  await expect(
    navigation.getByRole("button", { name: "用户管理", exact: true }),
  ).toHaveCount(0);
  await expect(
    navigation.getByRole("button", { name: "模型价格", exact: true }),
  ).toHaveCount(0);
  await page.goto(origin + "/#/settings/users");
  await expect(
    page.getByRole("heading", { name: "没有访问权限", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "返回账户设置", exact: true }).click();
}

async function verifyGallery() {
  await openPictureSection("全部图片");
  const gallery = page.getByRole("region", { name: "我的图片", exact: true });
  await expect(
    gallery.getByRole("heading", { name: "全部图片", exact: true }),
  ).toBeVisible();
  const originalCount = await gallery.locator(".gallery-tile").count();
  expect(originalCount).toBeGreaterThan(0);
  const folderA = "预览测试 A";
  const folderB = "预览测试 B";
  for (const name of [folderA, folderB]) {
    await openPictureSection("文件夹管理");
    await page.getByRole("button", { name: "新建文件夹", exact: true }).click();
    const dialog = page.getByRole("dialog", {
      name: "新建文件夹",
      exact: true,
    });
    await dialog.getByLabel("文件夹名称", { exact: true }).fill(name);
    await dialog.getByRole("button", { name: "创建", exact: true }).click();
    await expect(dialog).not.toBeVisible();
  }
  await openPictureSection("全部图片");
  await gallery.getByRole("button", { name: "选择图片", exact: true }).click();
  const imageName = (
    await gallery
      .getByRole("checkbox", { name: /^选中 / })
      .first()
      .getAttribute("aria-label")
  ).replace(/^选中 /, "");
  await gallery
    .getByRole("checkbox", { name: "选中 " + imageName, exact: true })
    .check();
  await gallery
    .getByRole("toolbar", { name: "图片整理" })
    .getByRole("button", { name: "加入文件夹", exact: true })
    .click();
  const picker = page.getByRole("dialog", { name: "加入文件夹", exact: true });
  await picker.getByRole("checkbox", { name: folderA, exact: true }).check();
  await picker.getByRole("checkbox", { name: folderB, exact: true }).check();
  await picker.getByRole("button", { name: "加入", exact: true }).click();
  await expect(picker).not.toBeVisible();
  await expect(gallery.locator(".gallery-tile")).toHaveCount(originalCount);
  await openFolder(folderA);
  await expect(gallery.locator(".gallery-tile")).toHaveCount(1);
  await expect(
    gallery.getByRole("img", { name: imageName, exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    gallery.getByRole("heading", { name: folderA, exact: true }),
  ).toBeVisible();
  await expect(gallery.locator(".gallery-tile")).toHaveCount(1);
  await gallery.getByRole("button", { name: "选择图片", exact: true }).click();
  await gallery
    .getByRole("checkbox", { name: "选中 " + imageName, exact: true })
    .check();
  await gallery
    .getByRole("button", { name: "移出此文件夹", exact: true })
    .click();
  await expect(
    gallery.getByRole("heading", { name: "这个文件夹还没有图片", exact: true }),
  ).toBeVisible();
  await openFolder(folderB);
  await expect(
    gallery.getByRole("img", { name: imageName, exact: true }),
  ).toBeVisible();
  await gallery.locator(".gallery-folder-more").click();
  await gallery
    .getByRole("menuitem", { name: "删除文件夹", exact: true })
    .click();
  const confirm = page.getByRole("dialog", {
    name: "删除“" + folderB + "”？",
    exact: true,
  });
  await expect(
    confirm.getByText("只删除文件夹，其中的图片仍保留在图库和其他文件夹中。"),
  ).toBeVisible();
  await confirm
    .getByRole("button", { name: "删除文件夹", exact: true })
    .click();
  await expect(confirm).not.toBeVisible();
  await expect(
    gallery.getByRole("heading", { name: "全部图片", exact: true }),
  ).toBeVisible();
  await expect(gallery.locator(".gallery-tile")).toHaveCount(originalCount);
  await openPictureSection("文件夹管理");
  await expect(page.getByRole("button", { name: "打开文件夹 " + folderA, exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "打开文件夹 " + folderB, exact: true }),
  ).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("button", { name: "打开文件夹 " + folderA, exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "打开文件夹 " + folderB, exact: true }),
  ).toHaveCount(0);
  await openPictureSection("全部图片");
  await expect(gallery.locator(".gallery-tile")).toHaveCount(originalCount);
  await verifyScroll(gallery);
}

async function verifySettings() {
  await page.getByRole("button", { name: "我的账户", exact: true }).click();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "外观与输入", exact: true }).click();
  await page.getByRole("button", { name: "深色", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "深色", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("switch", { name: "Enter 发送", exact: true }).click();
  await expect(
    page.getByRole("switch", { name: "Enter 发送", exact: true }),
  ).toBeChecked();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "深色", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("switch", { name: "Enter 发送", exact: true }),
  ).toBeChecked();
  await screenshot("settings-dark-theme");
  await page.getByRole("button", { name: "浅色", exact: true }).click();
  await page.getByRole("button", { name: "模型价格", exact: true }).click();
  const price = page.getByRole("spinbutton", {
    name: "GPT Image 2 单张积分",
    exact: true,
  });
  const row = page.getByRole("row").filter({ has: price });
  const nextPrice = String(Number(await price.inputValue()) + 1);
  await price.fill(nextPrice);
  await expect(
    row.getByRole("button", { name: "保存价格", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "刷新价格", exact: true }).click();
  const discard = page.getByRole("dialog", {
    name: "放弃未保存的修改？",
    exact: true,
  });
  await discard.getByRole("button", { name: "继续编辑", exact: true }).click();
  await expect(price).toHaveValue(nextPrice);
  await row.getByRole("button", { name: "保存价格", exact: true }).click();
  await expect(
    row.getByRole("button", { name: "保存价格", exact: true }),
  ).toBeDisabled();
  await page.reload();
  await expect(price).toHaveValue(nextPrice);
  await page.getByRole("button", { name: "用户管理", exact: true }).click();
  await page.getByRole("button", { name: "创建用户", exact: true }).click();
  const create = page.getByRole("dialog", { name: "创建用户", exact: true });
  await create.getByRole("textbox", { name: /^用户名/ }).fill("preview_test");
  await create.getByLabel(/^初始密码/).fill("test-only-password");
  await create.getByRole("button", { name: "创建用户", exact: true }).click();
  await expect(create).not.toBeVisible();
  await page
    .getByRole("textbox", { name: "搜索用户名", exact: true })
    .fill("preview_test");
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await expect(
    page.getByRole("cell", { name: "preview_test", exact: true }),
  ).toBeVisible();
  await page.reload();
  await page
    .getByRole("textbox", { name: "搜索用户名", exact: true })
    .fill("preview_test");
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await expect(
    page.getByRole("cell", { name: "preview_test", exact: true }),
  ).toBeVisible();
}

try {
  await server.listen();
  browser = await chromium.launch({
    channel: process.platform === "win32" ? "msedge" : undefined,
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
  });
  await attachGuards(context);
  page = await context.newPage();
  const response = await page.goto(origin);
  expect(response?.ok()).toBe(true);
  await page.locator("#root > *").first().waitFor();
  await page.evaluate(() => document.fonts.ready);
  if (!process.argv.includes("--dialog-only")) {
    await check("login-form", verifyLogin);
    await check("creation-generation-and-attachments", verifyCreation);
    await check("gallery-folder-memberships", verifyGallery);
    await check("settings-preferences-and-prices", verifySettings);
    await check("requests-and-ime-keyboard", verifyRequestsAndKeyboard);
    await check("ordinary-user-boundary", verifyRoleBoundary);
    const desktop = await browser.newContext({
      viewport: { width: 1280, height: 900 },
    });
    await attachGuards(desktop);
    page = await desktop.newPage();
    await page.goto(origin);
    await signInAs("admin");
    await check("desktop-1280", async () => {
      await expect(
        page.getByRole("textbox", { name: "提示词", exact: true }),
      ).toBeVisible();
      const clipped = await page
        .locator(".composer-toolbar")
        .evaluate((element) => {
          const bounds = element.getBoundingClientRect();
          return Array.from(element.children)
            .filter((child) => child.tagName !== "INPUT")
            .some((child) => {
              const rect = child.getBoundingClientRect();
              return (
                rect.width > 0 &&
                (rect.left < bounds.left - 1 || rect.right > bounds.right + 1)
              );
            });
        });
      expect(clipped, "Composer controls clipped at 1280px").toBe(false);
      await page.setViewportSize({ width: 390, height: 844 });
      const narrowPrompt = page.getByRole("textbox", { name: "提示词", exact: true });
      await narrowPrompt.fill("窄屏输入与换行检查。\n".repeat(8));
      await expect.poll(() => page.locator(".composer-toolbar").evaluate(element =>
        Array.from(element.querySelectorAll("button")).every(button => {
          const rect = button.getBoundingClientRect();
          return rect.left >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight &&
            button.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2));
        }),
      ), "Every composer button stays reachable on a narrow viewport").toBe(true);
      await screenshot("narrow-390-input-growth");
      await narrowPrompt.fill("");
      await page.setViewportSize({ width: 1280, height: 900 });
    });
  }
  const dialogContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await attachGuards(dialogContext);
  page = await dialogContext.newPage();
  await page.goto(origin);
  await signInAs("admin");
  dialogChecks = await verifyDialog({ page, screenshot });
  if (errors.length) throw new Error(errors.join("\n"));
  console.log(
    "Browser check passed: " +
      results.length +
      " flows + " + dialogChecks.length + " dialog checks; screenshots: outputs/preview/",
  );
} catch (error) {
  errors.push(error instanceof Error ? error.message : String(error));
  if (page && !page.isClosed()) await screenshot("failure").catch(() => {});
  throw error;
} finally {
  await writeFile(
    new URL("result.json", output),
    JSON.stringify({ results, dialogChecks, errors }, null, 2),
  );
  await browser?.close();
  await server.close();
}
