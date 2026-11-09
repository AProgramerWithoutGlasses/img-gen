import { expect } from "@playwright/test";

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
  const preview = creation.getByRole("region", { name: "参考图预览", exact: true });
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
    await prompt.focus();
    await expect.poll(() => composer.evaluate((element) => getComputedStyle(element).boxShadow)).toContain("255, 250, 0");
    await model.click();
    await expect(page.getByRole("listbox")).toBeVisible();
    const box = await model.boundingBox(), menu = await page.getByRole("listbox").boundingBox();
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
  });

  await check("input-grows-up-and-scrolls", async () => {
    const lines = Array.from({ length: 12 }, (_, index) => `第${index + 1}行：树林、薄雾与柔和光线。`);
    await prompt.fill(lines.slice(0, 2).join("\n"));
    const baseline = await composer.boundingBox(), bottom = baseline.y + baseline.height;
    expect(baseline.width).toBeCloseTo(840, 0);
    expect(baseline.height).toBeCloseTo(140, 0);
    expect((await prompt.boundingBox()).width).toBeCloseTo(682, 0);
    const toolbarBaseline = await toolbar.boundingBox();
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
    await prompt.fill(lines.join("\n"));
    await expect.poll(async () => (await composer.boundingBox()).height).toBeCloseTo(capped.height, 0);
    const scrolling = await prompt.evaluate((element) => ({ scroll: element.scrollHeight, client: element.clientHeight, overflow: getComputedStyle(element).overflowY }));
    expect(scrolling.scroll).toBeGreaterThan(scrolling.client);
    expect(scrolling.overflow).toMatch(/auto|scroll/);
    await screenshot("dialog-input-eight-line-cap");
    await prompt.fill("");
    await expect.poll(async () => (await composer.boundingBox()).height).toBeCloseTo(baseline.height, 0);
    return { stages, cappedHeight: capped.height };
  });

  const verifyTooltip = async (control) => {
    await moveAway();
    await expect(tooltip).toHaveCount(0);
    await control.hover();
    await expect(tooltip).toBeVisible();
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
    expect(metrics.font).toBe("10px"); expect(metrics.lineHeight).toBe("14px");
    expect(metrics.border).toBe("0px"); expect(metrics.shadow).toBe("none");
    expect(metrics.height).toBeCloseTo(20, 0);
    expect(metrics.width - metrics.textWidth).toBeCloseTo(16, 0);
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

  await check("six-attachments-hover-and-expanded-order", async () => {
    await chooseDialogOption(page, model, "Gemini Image 3.1F");
    await chooseDialogOption(page, creation.getByRole("combobox", { name: "清晰度", exact: true }), "0.5K");
    await chooseDialogOption(page, creation.getByRole("combobox", { name: "图像比例", exact: true }), "21:9");
    await creation.getByLabel("上传图片文件", { exact: true }).setInputFiles(await imageFiles(page));
    const row = creation.locator(".attachment-row"), cards = row.locator(".attachment-item");
    await expect(cards).toHaveCount(3);
    await expect(creation.getByRole("combobox", { name: "图像比例", exact: true })).toHaveCount(0);
    await expect(creation.getByRole("combobox", { name: "清晰度", exact: true })).toHaveCount(0);
    await moveAway();
    await expect.poll(() => removalNames(creation)).toEqual([]);
    await expect(preview).toHaveCount(0);
    await expect(row.getByText(/^\+\d+$/, { exact: true })).toHaveCount(0);
    const compactBox = await row.boundingBox();
    expect(compactBox.width).toBeCloseTo(312, 0);
    await cards.first().hover({ position: { x: 8, y: 48 } });
    await expect(preview).toBeVisible();
    await expect.poll(() => removalNames(creation)).toEqual(["移除dialog-reference-1.png"]);
    await expect(preview.getByRole("img")).toHaveAttribute("src", await cards.first().getByRole("img").getAttribute("src"));
    const previewBox = await preview.boundingBox();
    expect(previewBox.y + previewBox.height).toBeLessThan(compactBox.y);
    await screenshot("dialog-attachment-hover-first");
    await creation.getByRole("button", { name: "展开参考图", exact: true }).hover();
    await expect(preview).toHaveCount(0);
    await expect.poll(() => removalNames(creation)).toEqual([]);
    await page.waitForTimeout(250);
    await expect(preview).toHaveCount(0);
    await creation.getByRole("button", { name: "展开参考图", exact: true }).click();
    await expect(cards).toHaveCount(6);
    await expect.poll(async () => (await row.boundingBox()).width).toBeCloseTo((await composer.boundingBox()).width, 0);
    expect((await row.boundingBox()).x).toBeCloseTo(compactBox.x, 0);
    expect((await row.boundingBox()).y).toBeCloseTo(compactBox.y, 0);
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
      await expect(card.getByRole("img")).toHaveCSS("object-fit", "cover");
    }
    await screenshot("dialog-six-attachments-hover-last");
    await removeDialogAttachment(creation, "移除dialog-reference-6.png");
    await moveAway();
    await expect(cards).toHaveCount(5);
    await expect(preview).toHaveCount(0);
    for (let index = 1; index <= 5; index++) await removeDialogAttachment(creation, `移除dialog-reference-${index}.png`);
    await expect(row).toHaveCount(0);
    await expect(preview).toHaveCount(0);
    await creation.getByLabel("上传图片文件", { exact: true }).setInputFiles((await imageFiles(page)).slice(0, 2));
    await expect(cards).toHaveCount(2);
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
      await prompt.fill("亮暗主题与动效核对");
      await prompt.focus();
      await expect.poll(() => composer.evaluate((element) => getComputedStyle(element).boxShadow)).toContain("255, 250, 0");
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
  });

  return results;
}
