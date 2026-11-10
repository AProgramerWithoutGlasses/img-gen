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

export async function verifyCompactModelControls(control, menu) {
  const button = await control.evaluate(element => {
    const rect = element.getBoundingClientRect(), label = element.querySelector('.dialog-button-label');
    const range = document.createRange(); range.selectNodeContents(label);
    const text = range.getBoundingClientRect(), arrow = element.querySelector('.dialog-arrow').getBoundingClientRect();
    const middle = rect.top + rect.height / 2;
    return { left: rect.left, right: rect.right, width: rect.width, height: rect.height, textWidth: text.width,
      textLeftSpace: text.left - rect.left, textArrowGap: arrow.left - text.right,
      arrowRightSpace: rect.right - arrow.right,
      leftVisible: element.contains(document.elementFromPoint(rect.left + 1, middle)),
      rightVisible: element.contains(document.elementFromPoint(rect.right - 1, middle)) };
  });
  expect(button.height).toBeCloseTo(36, 0);
  expect(button.width, 'Model button should use the approved 166px length').toBeCloseTo(166, 1);
  expect(button.textLeftSpace).toBeGreaterThanOrEqual(10);
  expect(button.textArrowGap, 'Model text overlaps the arrow').toBeGreaterThanOrEqual(4);
  expect(button.arrowRightSpace).toBeGreaterThanOrEqual(4);
  expect(button.leftVisible && button.rightVisible, 'Model capsule is clipped').toBe(true);
  if (!menu) return { button };
  const options = await menu.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const rows = Array.from(element.querySelectorAll('[role="option"]')).map(row => {
      const label = row.querySelector('.dialog-option-label'), range = document.createRange();
      range.selectNodeContents(label);
      const text = range.getBoundingClientRect(), area = label.getBoundingClientRect();
      const dot = row.querySelector('.dialog-selected-dot')?.getBoundingClientRect();
      return { textWidth: text.width, availableWidth: area.width, left: text.left,
        dotGap: dot ? dot.left - text.right : null, height: row.getBoundingClientRect().height };
    });
    return { left: rect.left, right: rect.right, width: rect.width, viewportWidth: document.documentElement.clientWidth, rows };
  });
  const longest = Math.max(...options.rows.map(row => row.textWidth));
  expect(options.width, 'Model menu should be at least as wide as the approved button').toBeGreaterThanOrEqual(button.width - .1);
  const expectedLeft = Math.max(8, Math.min(button.left, options.viewportWidth - options.width - 8));
  expect(options.left, 'Model menu should align left with its button while staying inside the viewport').toBeCloseTo(expectedLeft, 1);
  expect(options.left).toBeGreaterThanOrEqual(8);
  expect(options.right).toBeLessThanOrEqual(options.viewportWidth - 8);
  for (const option of options.rows) {
    expect(option.availableWidth + .1, 'Model option text is clipped').toBeGreaterThanOrEqual(option.textWidth);
    expect(option.left).toBeCloseTo(options.rows[0].left, 1);
    if (option.dotGap !== null) expect(option.dotGap, 'Selection marker overlaps model text').toBeGreaterThanOrEqual(8);
  }
  return { button, menuWidth: options.width, longestOptionText: longest };
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

async function approvedAccent(page) {
  return (await page.locator("html").getAttribute("data-theme")) === "dark"
    ? { hex: "#9ab9ff", rgb: "154, 185, 255" }
    : { hex: "#315cbb", rgb: "49, 92, 187" };
}

async function dialogContrast(creation) {
  return creation.evaluate(async region => {
    // Sample the settled painted colours, rather than a frame halfway through
    // the existing enable/disable or theme transition.
    await Promise.all(region.querySelector(".composer-toolbar").getAnimations({ subtree: true })
      .map(animation => animation.finished.catch(() => {})));
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d");
    const luminance = color => {
      context.clearRect(0, 0, 1, 1); context.fillStyle = color; context.fillRect(0, 0, 1, 1);
      const rgb = Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3).map(value => {
        const channel = value / 255;
        return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
      });
      return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
    };
    const contrast = (first, second) => {
      const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
      return (values[0] + .05) / (values[1] + .05);
    };
    const button = selector => {
      const element = region.querySelector(selector);
      const fill = getComputedStyle(element.querySelector(".dialog-button-surface rect")).fill;
      const color = getComputedStyle(element).color;
      return { fill, color, textContrast: contrast(color, fill) };
    };
    const ordinary = button('[role="combobox"][aria-label="生成数量"]');
    const generate = button(".dialog-button-generate");
    const credits = button(".dialog-button-credits");
    const icon = region.querySelector(".dialog-button-credits > svg:not(.dialog-button-surface)");
    const iconStyle = getComputedStyle(icon), iconBox = icon.getBoundingClientRect();
    const arrow = region.querySelector(".dialog-select-model .dialog-arrow");
    const arrowStyle = getComputedStyle(arrow);
    const composer = getComputedStyle(region.querySelector(".dialog-composer")).backgroundColor;
    return { ordinary, generate, credits, composer,
      neutralSurfaceContrast: contrast(ordinary.fill, composer),
      icon: { width: iconBox.width, height: iconBox.height,
        contrast: contrast(iconStyle.stroke === "none" ? iconStyle.fill : iconStyle.stroke, credits.fill) },
      modelArrow: { fill: arrowStyle.backgroundColor, glyph: arrowStyle.color,
        glyphContrast: contrast(arrowStyle.color, arrowStyle.backgroundColor),
        surfaceContrast: contrast(arrowStyle.backgroundColor, ordinary.fill) } };
  });
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

  await check("generation-count-default-and-user-memory", async () => {
    const count = creation.getByRole("combobox", { name: "生成数量", exact: true });
    await expect(count).toHaveText("1张");
    await chooseDialogOption(page, count, "3张");
    await page.reload();
    await expect(count).toHaveText("3张");
    await chooseDialogOption(page, model, "Gemini Image 3.1F");
    await expect(count).toHaveText("3张");
    await creation.getByLabel("上传图片文件", { exact: true }).setInputFiles((await imageFiles(page)).slice(0, 1));
    await expect(creation.locator(".attachment-item")).toHaveCount(1);
    await expect(count).toHaveText("3张");
    await removeDialogAttachment(creation, "移除dialog-reference-1.png");
    await expect(count).toHaveText("3张");
    await page.reload();
    await expect(count).toHaveText("3张");
    // Bad saved settings can survive a browser upgrade or manual import. The
    // UI must recover to one image rather than submit an out-of-range count.
    for (const invalid of ["5", "not-a-number"]) {
      await page.evaluate(value => localStorage.setItem("imggen-generation-count:admin", value), invalid);
      await page.reload();
      await expect(count).toHaveText("1张");
    }
    await chooseDialogOption(page, count, "1张");
    return { defaultCount: 1, rememberedCount: 3, invalidSavedValues: 2 };
  });

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
    const accent = await approvedAccent(page);
    await prompt.fill("输入焦点检查");
    await prompt.evaluate(element => element.blur());
    await expect.poll(() => composer.evaluate(element => getComputedStyle(element).boxShadow)).not.toContain(accent.rgb);
    const beforeFocus = await composer.boundingBox();
    await prompt.focus();
    await expect.poll(() => composer.evaluate((element) => getComputedStyle(element).boxShadow)).toContain(accent.rgb);
    const focusShadow = await composer.evaluate(element => getComputedStyle(element).boxShadow);
    expect(focusShadow).not.toContain("inset");
    expect(focusShadow).toContain("0px 0px 0px 2px");
    expect((await composer.boundingBox()).height).toBeCloseTo(beforeFocus.height, 0);
    const optical = await creation.getByRole("button", { name: "上传图片", exact: true }).evaluate(element => {
      const rect = element.getBoundingClientRect();
      const model = document.querySelector('[role="combobox"][aria-label="模型"]').getBoundingClientRect();
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
    await expect(model).toHaveCSS("font-size", "13px");
    await verifyCompactModelControls(model, page.getByRole("listbox"));
    const wideFont = await page.addStyleTag({ content: '.dialog-menu-model { font-family: monospace; }' });
    try {
      const wideMenu = await verifyCompactModelControls(model, page.getByRole("listbox"));
      expect(wideMenu.menuWidth, "Wider fallback fonts should grow the menu without resizing its button").toBeGreaterThan(wideMenu.button.width);
      await screenshot("dialog-model-menu-wide-font");
    } finally {
      await wideFont.evaluate(element => element.remove());
    }
    await moveAway();
    const fills = await model.evaluate(element => {
      const ordinary = document.querySelector('[role="combobox"][aria-label="生成数量"]');
      const generate = document.querySelector('.dialog-button-generate');
      const fill = node => getComputedStyle(node).getPropertyValue('--dialog-button-fill').trim();
      return { model: fill(element), ordinary: fill(ordinary), generate: fill(generate) };
    });
    expect(fills.model, "Model selector should use the ordinary button colour").toBe(fills.ordinary);
    expect(fills.model.toLowerCase()).not.toBe(accent.hex);
    expect(fills.generate.toLowerCase(), "Generate should use the approved blue emphasis").toBe(accent.hex);
    const geometry = await model.evaluate(element => {
      const outer = getComputedStyle(element), inner = element.querySelector('.dialog-button-surface rect:nth-child(2)');
      return { outerRadius: outer.borderTopLeftRadius, innerRadius: Number(inner.getAttribute('rx')),
        inset: Number(inner.getAttribute('y')) };
    });
    expect(geometry.outerRadius).toBe("18px");
    expect(geometry.innerRadius).toBe(16);
    expect(geometry.inset).toBe(2);
    expect(menu.y + menu.height).toBeLessThan(box.y + 1);
    await expect.poll(() => composer.evaluate((element) => getComputedStyle(element).boxShadow)).not.toContain(accent.rgb);
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
    const resultStage = await creation.locator('.workbench-stage').boundingBox();
    expect(baseline.x, 'Composer and results should share the same left edge').toBeCloseTo(resultStage.x, 0);
    expect(baseline.width, 'Composer and results should share the available width').toBeCloseTo(resultStage.width, 0);
    expect(baseline.height).toBeCloseTo(148, 0);
    await expect(prompt).toHaveCSS("font-size", "16px");
    await expect(prompt).toHaveCSS("line-height", "24px");
    const area = await creation.locator(".dialog-prompt-area").boundingBox();
    const text = await prompt.boundingBox();
    expect(baseline.width - area.width).toBeCloseTo(118, 0);
    expect(area.height).toBeCloseTo(68, 0);
    expect(area.width - text.width).toBeCloseTo(28, 0);
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
      const arrow = getComputedStyle(element, "::before");
      const range = document.createRange(); range.selectNodeContents(element);
      return {
        font: style.fontSize, lineHeight: style.lineHeight, border: style.borderTopWidth,
        shadow: style.boxShadow, height: rect.height, width: rect.width,
        textWidth: range.getBoundingClientRect().width,
        left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
        viewportWidth: innerWidth, viewportHeight: innerHeight,
        placement: element.getAttribute("data-placement"),
        arrowOutside: Math.max(0, -Number.parseFloat(element.getAttribute("data-placement") === "above" ? arrow.bottom : arrow.top)),
        hit: element.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)),
      };
    });
    const anchor = await control.boundingBox();
    const gap = metrics.placement === "above" ? anchor.y - metrics.bottom : metrics.top - anchor.y - anchor.height;
    expect(metrics.font).toBe("11px"); expect(metrics.lineHeight).toBe("16px");
    expect(metrics.border).toBe("0px"); expect(metrics.shadow).toBe("none");
    expect(metrics.height).toBeCloseTo(24, 0);
    expect(metrics.width - metrics.textWidth).toBeCloseTo(18, 0);
    expect(metrics.left).toBeGreaterThanOrEqual(0); expect(metrics.top).toBeGreaterThanOrEqual(0);
    expect(metrics.right).toBeLessThanOrEqual(metrics.viewportWidth);
    expect(metrics.bottom).toBeLessThanOrEqual(metrics.viewportHeight);
    expect(metrics.hit, "Tooltip is covered or clipped").toBe(true);
    expect(metrics.placement).toMatch(/^(above|below)$/);
    expect(gap, "Tooltip body must stay clear of its button").toBeGreaterThanOrEqual(11.5);
    expect(gap - metrics.arrowOutside, "Tooltip arrow must leave a visible gap above its button").toBeGreaterThanOrEqual(7.5);
    expect(await control.evaluate(element => {
      const box = element.getBoundingClientRect();
      return element.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2));
    }), "Tooltip covers its triggering button").toBe(true);
    const coveredControls = await toolbar.locator("button").evaluateAll((buttons, tip) => buttons.filter(button => {
      const box = button.getBoundingClientRect();
      const top = tip.top - (tip.placement === "below" ? tip.arrowOutside : 0);
      const bottom = tip.bottom + (tip.placement === "above" ? tip.arrowOutside : 0);
      return box.width > 0 && box.height > 0 && box.left < tip.right && box.right > tip.left && box.top < bottom && box.bottom > top;
    }).map(button => button.getAttribute("aria-label") || button.textContent), metrics);
    expect(coveredControls, "Tooltip body or arrow covers another toolbar button").toEqual([]);
    return { ...metrics, gap, netGap: gap - metrics.arrowOutside };
  };

  await check("compact-tooltips-and-bottom-space", async () => {
    const short = await verifyTooltip(model);
    await screenshot("dialog-tooltip-model");
    const long = await verifyTooltip(creation.getByRole("button", { name: "上传图片", exact: true }));
    expect(long.width).toBeGreaterThan(short.width);
    const box = await composer.boundingBox();
    expect(page.viewportSize().height - box.y - box.height).toBeCloseTo(16, 0);
    expect(page.viewportSize().height - long.bottom).toBeGreaterThanOrEqual(8);
    await screenshot("dialog-tooltip-upload");
    await page.keyboard.press("Escape");
    await expect(tooltip).toHaveCount(0);
    await moveAway();
    await page.setViewportSize({ width: 390, height: 844 });
    const generate = creation.getByRole("button", { name: "生成", exact: true });
    const narrow = await verifyTooltip(generate);
    expect(narrow.placement, "A bottom-row tooltip should flip above when the page bottom has no space").toBe("above");
    await screenshot("dialog-tooltip-390px-flips-above");
    await page.keyboard.press("Escape");
    await moveAway();
    await page.setViewportSize({ width: 1440, height: 900 });
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
    await chooseDialogOption(page, creation.getByRole("combobox", { name: "生成数量", exact: true }), "1张");
    await moveAway();
    await page.clock.install();
    await page.clock.pauseAt(new Date(Date.now() + 1000));
    await creation.getByRole("button", { name: "生成", exact: true }).click();
    await expect(creation.locator(".workbench-status")).toHaveCount(0);
    await expect(creation.locator(".result-slot-placeholder")).toHaveCount(1);
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
      const accent = await approvedAccent(page);
      await expect(creation.locator(".dialog-prompt-area")).toHaveCSS("background-color", await composer.evaluate(element => getComputedStyle(element).backgroundColor));
      await prompt.fill("");
      await prompt.evaluate(element => element.blur());
      await moveAway();
      const generate = creation.getByRole("button", { name: "生成", exact: true });
      await expect(generate).toBeDisabled();
      const disabled = await dialogContrast(creation);
      expect(disabled.ordinary.textContrast, `${theme} neutral controls need readable labels`).toBeGreaterThanOrEqual(4.5);
      expect(disabled.generate.textContrast, `${theme} disabled Generate label disappears into its fill`).toBeGreaterThanOrEqual(3);
      expect(disabled.icon.width, "Credits icon is too small to recognise").toBeGreaterThanOrEqual(16);
      expect(disabled.icon.height, "Credits icon is too small to recognise").toBeGreaterThanOrEqual(16);
      expect(disabled.icon.contrast, `${theme} credits icon disappears into its button`).toBeGreaterThanOrEqual(3);
      if (theme === "light") {
        await expect(composer).toHaveCSS("background-color", "rgb(255, 255, 255)");
        await expect(creation.locator(".dialog-prompt-area")).toHaveCSS("background-color", "rgb(255, 255, 255)");
        await expect.poll(() => composer.evaluate(element => getComputedStyle(element).boxShadow)).not.toContain(accent.rgb);
        expect(disabled.neutralSurfaceContrast, "Light controls must remain distinct from the white input surface").toBeGreaterThanOrEqual(1.15);
        expect(disabled.modelArrow.surfaceContrast, "The blue model arrow circle is not distinct from its capsule").toBeGreaterThanOrEqual(3);
      }
      expect(disabled.modelArrow.glyphContrast, `${theme} model arrow glyph is not readable`).toBeGreaterThanOrEqual(3);
      await screenshot(`dialog-${theme}-idle-control-contrast`);
      await toolbar.screenshot({ path: fileURLToPath(new URL(`../../outputs/preview/dialog-${theme}-toolbar-idle.png`, import.meta.url)) });
      await prompt.fill("亮暗主题与动效核对");
      await prompt.focus();
      await expect(generate).toBeEnabled();
      const enabled = await dialogContrast(creation);
      expect(enabled.generate.fill, "Enabled and disabled Generate must remain visually distinct").not.toBe(disabled.generate.fill);
      expect(enabled.generate.textContrast, `${theme} enabled Generate label is not readable`).toBeGreaterThanOrEqual(4.5);
      await toolbar.screenshot({ path: fileURLToPath(new URL(`../../outputs/preview/dialog-${theme}-toolbar-enabled.png`, import.meta.url)) });
      await expect.poll(() => composer.evaluate((element) => getComputedStyle(element).boxShadow)).toContain(accent.rgb);
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
  });

  await check("account-menu-sidebar-width-and-responsive-access", async () => {
    const sidebar = page.locator(".sidebar"), account = page.locator(".account-menu");
    const accessible = async (locator) => {
      await expect(locator).toBeVisible();
      const metrics = await locator.evaluate(element => {
        const box = element.getBoundingClientRect();
        const buttons = [...element.querySelectorAll("button")].filter(button => button.getBoundingClientRect().width > 0);
        return { left: box.left, top: box.top, width: box.width, right: box.right, bottom: box.bottom,
          viewport: { width: innerWidth, height: innerHeight },
          reachable: buttons.every(button => {
            const rect = button.getBoundingClientRect();
            return rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight
              && button.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2));
          }) };
      });
      expect(metrics.left).toBeGreaterThanOrEqual(0); expect(metrics.top).toBeGreaterThanOrEqual(0);
      expect(metrics.right).toBeLessThanOrEqual(metrics.viewport.width); expect(metrics.bottom).toBeLessThanOrEqual(metrics.viewport.height);
      expect(metrics.reachable, "Account actions are clipped, covered or outside the viewport").toBe(true);
      return metrics;
    };
    const openAccount = async () => {
      await page.getByRole("button", { name: "我的账户", exact: true }).click();
      await expect(account).toHaveCSS("opacity", "1");
      const metrics = await accessible(account);
      expect(metrics.width, "Account popup should match the 224px expanded sidebar").toBeCloseTo(224, 0);
      return metrics;
    };
    const closeAccount = async () => {
      await page.keyboard.press("Escape");
      await expect(account).toHaveCount(0);
    };
    await page.setViewportSize({ width: 1280, height: 900 });
    const expand = page.getByRole("button", { name: "展开侧栏", exact: true });
    if (await expand.count()) await expand.click();
    await expect.poll(async () => (await sidebar.boundingBox()).width).toBeCloseTo(224, 0);
    const accountTrigger = sidebar.getByRole("button", { name: "我的账户", exact: true });
    const sidebarBalance = accountTrigger.locator(".account-trigger-balance");
    await expect(sidebarBalance).toBeVisible();
    await expect(sidebarBalance).toHaveText(/^[\d,]+$/);
    await expect(sidebarBalance).toHaveAttribute("aria-label", /^积分余额 [\d,]+$/);
    await expect(sidebarBalance).toHaveAttribute("title", /^[\d,]+ 积分$/);
    await expect(accountTrigger.locator("svg.lucide-chevron-down")).toHaveCount(0);
    const triggerBox = await accountTrigger.boundingBox(), balanceBox = await sidebarBalance.boundingBox();
    expect(balanceBox.x + balanceBox.width, "Sidebar balance is clipped by the account trigger").toBeLessThanOrEqual(triggerBox.x + triggerBox.width + 1);
    const expanded = await openAccount();
    expect(expanded.left, "Expanded account popup must align with the sidebar's left edge").toBeCloseTo((await sidebar.boundingBox()).x, 0);
    await screenshot("dialog-account-popup-expanded-sidebar");
    await account.getByRole("button", { name: /^主题/ }).click();
    await accessible(page.getByRole("radiogroup", { name: "主题", exact: true }));
    await page.keyboard.press("Escape");
    await closeAccount();
    await page.getByRole("button", { name: "收起侧栏", exact: true }).click();
    await expect.poll(async () => (await sidebar.boundingBox()).width).toBeCloseTo(72, 0);
    const collapsed = await openAccount();
    await screenshot("dialog-account-popup-collapsed-sidebar");
    await closeAccount();
    await page.setViewportSize({ width: 390, height: 844 });
    const narrow = await openAccount();
    await account.getByRole("button", { name: /^主题/ }).click();
    await accessible(page.getByRole("radiogroup", { name: "主题", exact: true }));
    await screenshot("dialog-account-popup-390px-theme-access");
    await page.keyboard.press("Escape");
    await closeAccount();
    await page.getByRole("button", { name: "展开侧栏", exact: true }).click();
    await expect(sidebar).toHaveClass(/is-mobile-open/);
    const mobileExpanded = await openAccount();
    expect(mobileExpanded.left).toBeCloseTo((await sidebar.boundingBox()).x, 0);
    await screenshot("dialog-account-popup-390px-expanded-sidebar");
    await page.getByRole("button", { name: "关闭账户菜单", exact: true }).click({ position: { x: 300, y: 60 } });
    await expect(account).toHaveCount(0);
    await page.getByRole("button", { name: "收起侧栏", exact: true }).click();
    await page.setViewportSize({ width: 1440, height: 900 });
    if (await expand.count()) await expand.click();
    await expect.poll(async () => (await sidebar.boundingBox()).width).toBeCloseTo(224, 0);
    return { expanded, collapsed, narrow, mobileExpanded };
  });

  return results;
}
