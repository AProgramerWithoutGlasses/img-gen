import { expect } from "@playwright/test";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export async function chooseDialogOption(page, control, label) {
  await control.click();
  await page.getByRole("option", { name: label, exact: true }).click();
  await expect(page.getByRole("listbox")).toHaveCount(0);
}

export async function removeDialogAttachment(creation, label) {
  const button = creation.getByRole("button", { name: label, exact: true, includeHidden: true });
  await button.locator("..").hover();
  await button.click();
}

// Read the actual preview provider's persisted result, without replacing its actions.
async function previewGeneration(page, prompt) {
  return page.evaluate(async (text) => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("ui-studio-preview-v1", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const request = db.transaction("state").objectStore("state").get("snapshot");
        request.onsuccess = () => resolve(request.result?.generations.find((item) => item.prompt === text));
        request.onerror = () => reject(request.error);
      });
    } finally { db.close(); }
  }, prompt);
}

async function imageFiles(page) {
  const samples = await page.evaluate(() => Array.from({ length: 6 }, (_, index) => {
    const canvas = document.createElement("canvas");
    canvas.width = index % 2 ? 48 : 96;
    canvas.height = index % 2 ? 96 : 48;
    const context = canvas.getContext("2d");
    context.fillStyle = ["#32936f", "#b55f45", "#5168b0", "#9569b0", "#d1a73b", "#387c9c"][index];
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#fff";
    context.fillRect(4 + index * 2, 4, 12, 20);
    return canvas.toDataURL("image/png").split(",")[1];
  }));
  return samples.map((buffer, index) => ({
    name: `dialog-reference-${index + 1}.png`, mimeType: "image/png", buffer: Buffer.from(buffer, "base64"),
  }));
}

async function removalNames(creation) {
  return creation.locator(".attachment-remove").evaluateAll((buttons) => buttons
    .filter((button) => Number(getComputedStyle(button).opacity) > .01 && getComputedStyle(button).visibility !== "hidden")
    .map((button) => button.getAttribute("aria-label")));
}

export async function verifyDialog({ page, screenshot }) {
  const results = [];
  const creation = page.getByRole("region", { name: "图像创作", exact: true });
  const prompt = creation.getByRole("textbox", { name: "提示词", exact: true });
  const composer = creation.locator(".composer");
  const toolbar = creation.locator(".composer-toolbar");
  const model = creation.getByRole("combobox", { name: "模型", exact: true });
  const preview = page.getByRole("region", { name: "参考图预览", exact: true });
  const tooltip = page.getByRole("tooltip");
  const moveAway = async () => { await page.mouse.move(16, 80); };
  const check = async (name, action) => {
    const details = await action();
    results.push({ name, status: "passed", screenshot: await screenshot("dialog-" + name), ...details });
  };

  await check("model-aliases-and-persisted-identities", async () => {
    await chooseDialogOption(page, creation.getByRole("combobox", { name: "生成数量", exact: true }), "1张");
    const aliases = [
      ["gpt-image-2", "GPT Image 2"], ["gpt-image-1.5", "GPT Image 1.5"],
      ["gpt-image-2.5-sunburst", "GPT Image 2.5S"], ["gemini-3.1-flash-image", "Gemini Image 3.1F"],
      ["gemini-3-pro-image", "Gemini Image 3Pro"],
    ];
    for (const [id, label] of aliases) {
      await chooseDialogOption(page, model, label);
      await expect(model).toHaveText(label);
      await expect(creation.getByRole("combobox", { name: "档位", exact: true })).toHaveCount(0);
      await expect(creation.getByRole("combobox", { name: "清晰度", exact: true })).toHaveCount(id.startsWith("gemini-") ? 1 : 0);
      const text = "dialog identity " + id;
      await prompt.fill(text);
      await creation.getByRole("button", { name: "生成", exact: true }).click();
      await expect.poll(async () => (await previewGeneration(page, text))?.options.modelId).toBe(id);
      await expect(prompt).toHaveValue("", { timeout: 15000 });
      const record = await previewGeneration(page, text);
      expect(record.status).toBe("completed");
      expect(record.options.count).toBe(1);
    }
    return { aliases: aliases.length, persistedModelIds: aliases.map(([id]) => id) };
  });

  await check("menus-keyboard-and-input-focus", async () => {
    await prompt.fill("输入焦点检查");
    await prompt.evaluate(element => element.blur());
    await expect.poll(() => composer.evaluate(element => getComputedStyle(element).boxShadow)).not.toContain("255, 250, 0");
    const beforeFocus = await composer.boundingBox();
    await prompt.focus();
    await expect.poll(() => composer.evaluate((element) => getComputedStyle(element).boxShadow)).toContain("255, 250, 0");
    const focusShadow = await composer.evaluate(element => getComputedStyle(element).boxShadow);
    expect(focusShadow).not.toContain("inset");
    expect(focusShadow).toContain("0px 0px 0px 2px");
    expect((await composer.boundingBox()).height).toBeCloseTo(beforeFocus.height, 0);
    const optical = await creation.getByRole("button", { name: "上传图片", exact: true }).evaluate(element => {
      const rect = element.getBoundingClientRect();
      const model = document.querySelector('.dialog-select-accent').getBoundingClientRect();
      const inner = element.querySelector('.dialog-button-surface rect:nth-child(2)');
      const surface = element.querySelector('.dialog-button-surface rect').getBoundingClientRect();
      const plus = element.querySelector('.dialog-button-surface-icon').getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      return { width: rect.width, height: rect.height, center: rect.top + rect.height / 2,
        modelHeight: model.height, modelCenter: model.top + model.height / 2,
        plusOffsetX: plus.left + plus.width / 2 - (surface.left + surface.width / 2),
        plusOffsetY: plus.top + plus.height / 2 - (surface.top + surface.height / 2),
        innerRadius: Number(inner.getAttribute('rx')), inset: Number(inner.getAttribute('y')),
        topVisible: element.contains(document.elementFromPoint(centerX, rect.top + .5)),
        bottomVisible: element.contains(document.elementFromPoint(centerX, rect.bottom - .5)) };
    });
    expect(optical.width).toBeCloseTo(36, 0); expect(optical.height).toBeCloseTo(36, 0);
    expect(optical.modelHeight).toBeCloseTo(36, 0);
    expect(optical.center).toBeCloseTo(optical.modelCenter, 1);
    expect(optical.plusOffsetX, "Upload plus must be horizontally centered").toBeCloseTo(0, 2);
    expect(optical.plusOffsetY, "Upload plus must be vertically centered").toBeCloseTo(0, 2);
    expect(optical.innerRadius).toBe(16);
    expect(optical.inset).toBe(2);
    expect(optical.topVisible, "The toolbar clips the upload circle's top").toBe(true);
    expect(optical.bottomVisible, "The toolbar clips the upload circle's bottom").toBe(true);
    await model.click();
    await expect(page.getByRole("listbox")).toBeVisible();
    const box = await model.boundingBox(), menu = await page.getByRole("listbox").boundingBox();
    expect(box.width).toBeCloseTo(194, 0);
    await expect(model).toHaveCSS("font-size", "13px");
    expect(menu.width).toBeCloseTo(246, 0);
    const geometry = await model.evaluate(element => {
      const outer = getComputedStyle(element), inner = element.querySelector('.dialog-button-surface rect:nth-child(2)');
      return { outerRadius: outer.borderTopLeftRadius, innerRadius: Number(inner.getAttribute('rx')),
        inset: Number(inner.getAttribute('y')) };
    });
    expect(geometry.outerRadius).toBe("18px");
    expect(geometry.innerRadius).toBe(16);
    expect(geometry.inset).toBe(2);
    expect(menu.y + menu.height).toBeLessThan(box.y + 1);
    await expect.poll(() => composer.evaluate((element) => getComputedStyle(element).boxShadow)).not.toContain("255, 250, 0");
    await page.keyboard.press("End");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await expect(model).toBeFocused();
    await model.press("ArrowDown");
    await expect(page.getByRole("listbox")).toBeVisible();
    await page.keyboard.press("Home");
    await page.keyboard.press("Enter");
    await expect(model).toHaveText("GPT Image 2");
    await expect(model).toBeFocused();
    await prompt.fill("");
    await expect(creation.getByRole("button", { name: "展开提示词", exact: true, includeHidden: true })).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: "编辑提示词", exact: true, includeHidden: true })).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: "完整提示词", exact: true, includeHidden: true })).toHaveCount(0);
  });

  await check("input-grows-up-and-scrolls", async () => {
    const lines = Array.from({ length: 12 }, (_, index) => `第${index + 1}行：树林、薄雾与柔和光线。`);
    await prompt.fill(lines.slice(0, 2).join("\n"));
    const baseline = await composer.boundingBox(), bottom = baseline.y + baseline.height;
    expect(baseline.width).toBeCloseTo(900, 0);
    expect(baseline.height).toBeCloseTo(148, 0);
    await expect(prompt).toHaveCSS("font-size", "16px");
    await expect(prompt).toHaveCSS("line-height", "24px");
    const area = await creation.locator(".dialog-prompt-area").boundingBox();
    const text = await prompt.boundingBox();
    expect(area.width).toBeCloseTo(782, 0);
    expect(area.height).toBeCloseTo(68, 0);
    expect(text.width).toBeCloseTo(754, 0);
    expect(text.height).toBeCloseTo(48, 0);
    expect(text.x - baseline.x).toBeCloseTo(28, 0);
    expect(text.y - baseline.y, "Text must start 14px below the composer top").toBeCloseTo(14, 0);
    expect((await toolbar.boundingBox()).height).toBeCloseTo(36, 0);
    const toolbarBaseline = await toolbar.boundingBox();
    expect(toolbarBaseline.y - baseline.y).toBeCloseTo(98, 0);
    const stages = [];
    for (const count of [3, 4, 6, 8]) {
      await prompt.fill(lines.slice(0, count).join("\n"));
      await expect.poll(async () => (await composer.boundingBox()).height).toBeCloseTo(baseline.height + (count - 2) * 24, 0);
      const actual = await composer.boundingBox();
      expect(actual.y + actual.height).toBeCloseTo(bottom, 0);
      expect((await toolbar.boundingBox()).y).toBeCloseTo(toolbarBaseline.y, 0);
      stages.push({ lines: count, height: actual.height });
    }
    const capped = await composer.boundingBox();
    expect(capped.height).toBeCloseTo(292, 0);
    await prompt.fill(lines.join("\n"));
    await expect.poll(async () => (await composer.boundingBox()).height).toBeCloseTo(capped.height, 0);
    const scrolling = await prompt.evaluate((element) => ({ scroll: element.scrollHeight, client: element.clientHeight, overflow: getComputedStyle(element).overflowY }));
    expect(scrolling.scroll).toBeGreaterThan(scrolling.client);
    expect(scrolling.client).toBe(192);
    expect(scrolling.overflow).toMatch(/auto|scroll/);
    await screenshot("dialog-input-eight-line-cap");
    await prompt.fill("");
    await expect.poll(async () => (await composer.boundingBox()).height).toBeCloseTo(baseline.height, 0);
    const paragraph = "森林薄雾、晨光与林间小径，画面自然通透，细节清晰。".repeat(6);
    await prompt.fill(paragraph);
    await expect.poll(async () => (await composer.boundingBox()).height).toBeGreaterThan(baseline.height);
    const wrapped = await composer.boundingBox();
    expect(wrapped.height).toBeLessThanOrEqual(capped.height);
    expect(wrapped.y + wrapped.height).toBeCloseTo(bottom, 0);
    expect((await toolbar.boundingBox()).y).toBeCloseTo(toolbarBaseline.y, 0);
    expect((await prompt.boundingBox()).height).toBeGreaterThan(48);
    await screenshot("dialog-input-natural-wrapping");
    await prompt.fill("");
    await expect.poll(async () => (await composer.boundingBox()).height).toBeCloseTo(baseline.height, 0);
    return { stages, cappedHeight: capped.height, naturalWrappedHeight: wrapped.height };
  });

  const verifyTooltip = async (control) => {
    await moveAway();
    await expect(tooltip).toHaveCount(0);
    await control.hover();
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toHaveCSS("opacity", "1");
    const metrics = await tooltip.evaluate((element) => {
      const style = getComputedStyle(element), rect = element.getBoundingClientRect();
      const range = document.createRange(); range.selectNodeContents(element);
      return {
        font: style.fontSize, lineHeight: style.lineHeight, border: style.borderTopWidth,
        shadow: style.boxShadow, height: rect.height, width: rect.width,
        textWidth: range.getBoundingClientRect().width,
        left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
        viewportWidth: innerWidth, viewportHeight: innerHeight,
        hit: element.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)),
      };
    });
    expect(metrics.font).toBe("11px"); expect(metrics.lineHeight).toBe("16px");
    expect(metrics.border).toBe("0px"); expect(metrics.shadow).toBe("none");
    expect(metrics.height).toBeCloseTo(24, 0);
    expect(metrics.width - metrics.textWidth).toBeCloseTo(18, 0);
    expect(metrics.left).toBeGreaterThanOrEqual(0); expect(metrics.top).toBeGreaterThanOrEqual(0);
    expect(metrics.right).toBeLessThanOrEqual(metrics.viewportWidth);
    expect(metrics.bottom).toBeLessThanOrEqual(metrics.viewportHeight);
    expect(metrics.hit, "Tooltip is covered or clipped").toBe(true);
    return metrics;
  };

  await check("compact-tooltips-and-bottom-space", async () => {
    const short = await verifyTooltip(model);
    await screenshot("dialog-tooltip-model");
    const long = await verifyTooltip(creation.getByRole("button", { name: "上传图片", exact: true }));
    expect(long.width).toBeGreaterThan(short.width);
    const box = await composer.boundingBox();
    expect(page.viewportSize().height - box.y - box.height).toBeCloseTo(40, 0);
    expect(page.viewportSize().height - long.bottom).toBeGreaterThanOrEqual(18);
    await screenshot("dialog-tooltip-upload");
    await page.keyboard.press("Escape");
    await expect(tooltip).toHaveCount(0);
    await moveAway();
    return { shortWidth: short.width, longWidth: long.width, bottomSpace: page.viewportSize().height - box.y - box.height };
  });

  await check("credits-click-without-message", async () => {
    const credits = creation.locator(".dialog-button-credits");
    await credits.click();
    await expect(page.getByText(/^本次预计消耗.*可用.*积分/)).toHaveCount(0);
    await verifyTooltip(credits);
    await expect(tooltip).toContainText("预计消耗");
    await moveAway();
  });

  await check("duplicate-file-and-result-drops", async () => {
    const sample = (await imageFiles(page))[0];
    const folder = new URL("../../outputs/preview/", import.meta.url);
    await mkdir(folder, { recursive: true });
    const path = fileURLToPath(new URL("dialog-duplicate.png", folder));
    await writeFile(path, sample.buffer);
    const modified = Math.floor((await stat(path)).mtimeMs);
    const input = creation.getByLabel("上传图片文件", { exact: true });
    const cards = creation.locator(".attachment-item");
    const drop = () => composer.evaluate((target, file) => {
      const bytes = Uint8Array.from(atob(file.base64), character => character.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], "dialog-duplicate.png", { type: "image/png", lastModified: file.modified }));
      target.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
    }, { base64: sample.buffer.toString("base64"), modified });
    await input.setInputFiles([path, path]);
    await expect(cards).toHaveCount(1);
    await expect(cards.getByRole("img")).toBeVisible();
    expect((await creation.locator(".attachment-row").boundingBox()).width).toBeCloseTo(285, 0);
    await input.setInputFiles(path);
    await drop();
    await expect(cards).toHaveCount(1);
    await removeDialogAttachment(creation, "移除dialog-duplicate.png");
    await expect(cards).toHaveCount(0);
    await drop();
    await expect(cards).toHaveCount(1);
    await expect(cards.getByRole("img")).toBeVisible();
    await removeDialogAttachment(creation, "移除dialog-duplicate.png");
    const result = creation.locator(".result-open img").first();
    await result.dragTo(composer);
    await expect(cards).toHaveCount(1);
    await result.dragTo(composer);
    await expect(cards).toHaveCount(1);
    const attachmentName = await cards.locator(".attachment-remove").getAttribute("aria-label");
    await removeDialogAttachment(creation, attachmentName);
    await expect(cards).toHaveCount(0);
  });

  await check("attachments-auto-width-hover-and-capacity", async () => {
    await chooseDialogOption(page, model, "Gemini Image 3.1F");
    await chooseDialogOption(page, creation.getByRole("combobox", { name: "清晰度", exact: true }), "0.5K");
    await chooseDialogOption(page, creation.getByRole("combobox", { name: "图像比例", exact: true }), "21:9");
    const files = await imageFiles(page);
    const input = creation.getByLabel("上传图片文件", { exact: true });
    const upload = creation.getByRole("button", { name: "上传图片", exact: true });
    await input.setInputFiles(files.slice(0, 4));
    const row = creation.locator(".attachment-row"), cards = row.locator(".attachment-item");
    await expect(cards).toHaveCount(4);
    await expect(creation.getByRole("combobox", { name: "图像比例", exact: true })).toHaveCount(0);
    await expect(creation.getByRole("combobox", { name: "清晰度", exact: true })).toHaveCount(0);
    await moveAway();
    await expect.poll(() => removalNames(creation)).toEqual([]);
    await expect(preview).toHaveCount(0);
    await expect(row.getByText(/^\+\d+$/, { exact: true })).toHaveCount(0);
    await expect(creation.getByRole("button", { name: /^(展开|收起)参考图$/, includeHidden: true })).toHaveCount(0);
    expect(await creation.locator(".dialog-attachments").evaluate(element => getComputedStyle(element, "::after").content)).toBe("none");
    const compactBox = await row.boundingBox();
    expect(compactBox.width).toBeCloseTo(285, 0);
    expect(compactBox.height).toBeCloseTo(78, 0);
    expect((await composer.boundingBox()).y - compactBox.y - compactBox.height).toBeCloseTo(6, 0);
    expect((await cards.first().boundingBox()).width).toBeCloseTo(62, 0);
    await expect(upload).toBeEnabled();
    await screenshot("dialog-four-attachments-default-width");
    await input.setInputFiles(files.slice(4, 5));
    await expect(cards).toHaveCount(5);
    await expect.poll(async () => (await row.boundingBox()).width).toBeCloseTo(354, 0);
    await expect(upload).toBeEnabled();
    await input.setInputFiles(files.slice(5));
    await expect(cards).toHaveCount(6);
    await expect(cards.getByRole("img")).toHaveCount(6);
    await expect.poll(async () => (await row.boundingBox()).width).toBeCloseTo(423, 0);
    await expect(upload).toBeDisabled();
    await input.setInputFiles([{ ...files[0], name: "dialog-over-capacity.png" }]);
    await expect(cards).toHaveCount(6);
    await expect(cards.getByRole("img", { name: "dialog-over-capacity.png", exact: true })).toHaveCount(0);
    expect((await row.boundingBox()).x).toBeCloseTo(compactBox.x, 0);
    expect((await row.boundingBox()).y).toBeCloseTo(compactBox.y, 0);
    await cards.first().hover({ position: { x: 8, y: 48 } });
    await expect(preview).toBeVisible();
    await expect(preview).toHaveCSS("opacity", "1");
    await expect.poll(() => removalNames(creation)).toEqual(["移除dialog-reference-1.png"]);
    await expect(preview.getByRole("img")).toHaveAttribute("src", await cards.first().getByRole("img").getAttribute("src"));
    const previewBox = await preview.boundingBox();
    expect(previewBox.width).toBeLessThanOrEqual(324);
    expect(previewBox.width).toBeGreaterThanOrEqual(128);
    expect(previewBox.height).toBeLessThanOrEqual(324);
    const imageArea = await preview.locator(".dialog-attachment-preview-image").boundingBox();
    expect(imageArea.width).toBeCloseTo(previewBox.width - 8, 0);
    expect(imageArea.height).toBeCloseTo(previewBox.height - 36, 0);
    const filename = await preview.locator(".dialog-attachment-preview-name").boundingBox();
    expect(filename.width).toBeCloseTo(previewBox.width - 16, 0);
    expect(filename.height).toBeCloseTo(20, 0);
    const firstCard = await cards.first().boundingBox();
    expect(firstCard.y - previewBox.y - previewBox.height).toBeCloseTo(10, 1);
    expect(previewBox.x).toBeGreaterThanOrEqual(7.5);
    if (firstCard.x + firstCard.width / 2 - previewBox.width / 2 >= 8) {
      expect(previewBox.x + previewBox.width / 2).toBeCloseTo(firstCard.x + firstCard.width / 2, 0);
    }
    await screenshot("dialog-attachment-hover-first");
    for (let index = 0; index < 6; index++) {
      const card = cards.nth(index), name = `dialog-reference-${index + 1}.png`;
      await card.hover({ position: { x: 8, y: 48 } });
      await expect.poll(() => removalNames(creation)).toEqual(["移除" + name]);
      await expect(preview.getByRole("img", { name, exact: true })).toBeVisible();
      await expect(preview.getByRole("img")).toHaveAttribute("src", await card.getByRole("img").getAttribute("src"));
      await expect(preview.getByRole("img")).toHaveCSS("object-fit", "contain");
      await expect(preview.locator(".dialog-attachment-preview-image")).toHaveCSS("background-image", "none");
      const picture = preview.getByRole("img");
      const ratio = await picture.evaluate(image => image.naturalWidth / image.naturalHeight);
      const pictureBox = await picture.boundingBox();
      expect(pictureBox.width / pictureBox.height).toBeCloseTo(ratio, 2);
      const cardBox = await card.boundingBox(), floatingBox = await preview.boundingBox();
      expect(cardBox.y - floatingBox.y - floatingBox.height).toBeCloseTo(10, 1);
      if (cardBox.x + cardBox.width / 2 - floatingBox.width / 2 >= 8) {
        expect(floatingBox.x + floatingBox.width / 2).toBeCloseTo(cardBox.x + cardBox.width / 2, 0);
      }
      await expect(card.getByRole("img")).toHaveCSS("object-fit", "cover");
    }
    await screenshot("dialog-six-attachments-hover-last");
    await removeDialogAttachment(creation, "移除dialog-reference-6.png");
    await moveAway();
    await expect(cards).toHaveCount(5);
    await expect.poll(async () => (await row.boundingBox()).width).toBeCloseTo(354, 0);
    await expect(upload).toBeEnabled();
    await expect(preview).toHaveCount(0);
    await removeDialogAttachment(creation, "移除dialog-reference-5.png");
    await expect(cards).toHaveCount(4);
    await expect.poll(async () => (await row.boundingBox()).width).toBeCloseTo(285, 0);
    for (let index = 1; index <= 4; index++) await removeDialogAttachment(creation, `移除dialog-reference-${index}.png`);
    await expect(row).toHaveCount(0);
    await expect(preview).toHaveCount(0);
    await creation.getByLabel("上传图片文件", { exact: true }).setInputFiles((await imageFiles(page)).slice(0, 2));
    await expect(cards).toHaveCount(2);
    await expect.poll(async () => (await row.boundingBox()).width).toBeCloseTo(285, 0);
    await page.reload();
    await expect(prompt).toBeVisible();
    await creation.getByLabel("上传图片文件", { exact: true }).setInputFiles((await imageFiles(page)).slice(0, 2));
    await expect(cards).toHaveCount(2);
    await expect.poll(async () => (await row.boundingBox()).width).toBeCloseTo(285, 0);
    await prompt.fill("dialog attachments disabled visibility");
    await moveAway();
    await page.clock.install();
    await page.clock.pauseAt(new Date(Date.now() + 1000));
    await creation.getByRole("button", { name: "生成", exact: true }).click();
    await expect(creation.getByText("正在生成…", { exact: true })).toBeVisible();
    await expect(row.locator(".attachment-remove").first()).toBeDisabled();
    await expect.poll(() => removalNames(creation)).toEqual([]);
    await screenshot("dialog-attachments-submitting");
    await page.clock.resume();
    await expect(prompt).toHaveValue("", { timeout: 15000 });
    await expect(row).toHaveCount(0);
  });

  await check("light-dark-and-reduced-motion", async () => {
    const origin = new URL(page.url()).origin;
    for (const [theme, label] of [["light", "浅色"], ["dark", "深色"]]) {
      await page.goto(origin + "/#/settings/appearance");
      await page.getByRole("button", { name: label, exact: true }).click();
      await page.getByRole("button", { name: "返回创作", exact: true }).click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect(creation.locator(".dialog-prompt-area")).toHaveCSS("background-color", await composer.evaluate(element => getComputedStyle(element).backgroundColor));
      if (theme === "light") {
        await expect(composer).toHaveCSS("background-color", "rgb(242, 242, 242)");
        await expect(creation.locator(".dialog-prompt-area")).toHaveCSS("background-color", "rgb(242, 242, 242)");
        await prompt.fill("");
        await prompt.evaluate(element => element.blur());
        await expect.poll(() => composer.evaluate(element => getComputedStyle(element).boxShadow)).not.toContain("255, 250, 0");
        await expect(creation.getByRole("button", { name: "生成", exact: true }).locator('.dialog-button-surface rect').first()).toHaveCSS("fill", "rgb(214, 214, 214)");
        await screenshot("dialog-light-idle-neutral-colors");
      }
      await prompt.fill("亮暗主题与动效核对");
      await prompt.focus();
      await expect.poll(() => composer.evaluate((element) => getComputedStyle(element).boxShadow)).toContain("255, 250, 0");
      const shadow = await composer.evaluate(element => getComputedStyle(element).boxShadow);
      expect(shadow).not.toContain("inset");
      expect(shadow).toContain("0px 0px 0px 2px");
      await verifyTooltip(model);
      await screenshot("dialog-" + theme + "-tooltip");
      await moveAway(); await page.keyboard.press("Escape");
    }
    await page.emulateMedia({ reducedMotion: "reduce" });
    await model.click();
    await expect(page.getByRole("listbox")).toHaveCSS("animation-name", "none");
    await page.keyboard.press("Escape");
    await verifyTooltip(model);
    await expect(tooltip).toHaveCSS("animation-name", "none");
    await page.keyboard.press("Escape");
    await moveAway();
    await creation.getByLabel("上传图片文件", { exact: true }).setInputFiles((await imageFiles(page)).slice(0, 2));
    await expect(creation.locator(".attachment-item")).toHaveCount(2);
    await expect(creation.locator(".attachment-row")).toHaveCSS("transition-duration", "0s");
    await creation.locator(".attachment-item").first().hover({ position: { x: 8, y: 48 } });
    await expect(preview).toBeVisible();
    await expect(preview).toHaveCSS("animation-name", "none");
    await screenshot("dialog-reduced-motion-attachments");
    await removeDialogAttachment(creation, "移除dialog-reference-1.png");
    await removeDialogAttachment(creation, "移除dialog-reference-2.png");
    await prompt.fill("");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByRole("button", { name: "我的账户", exact: true }).click();
    const account = page.locator(".account-menu");
    await expect(account).toBeVisible();
    const hits = await account.evaluate(menu => {
      const floating = menu.getBoundingClientRect();
      const composer = document.querySelector(".dialog-composer").getBoundingClientRect();
      const left = Math.max(floating.left, composer.left), right = Math.min(floating.right, composer.right);
      const top = Math.max(floating.top, composer.top), bottom = Math.min(floating.bottom, composer.bottom);
      if (right <= left || bottom <= top) return { overlap: false, accountHit: false };
      return { overlap: true, accountHit: menu.contains(document.elementFromPoint((left + right) / 2, (top + bottom) / 2)) };
    });
    expect(hits.overlap, "Use a desktop viewport with a real account-menu/composer overlap").toBe(true);
    expect(hits.accountHit, "Composer obscures the account popup").toBe(true);
    await screenshot("dialog-account-popup-above-composer");
    await page.keyboard.press("Escape");
    await expect(account).toHaveCount(0);
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  return results;
}
