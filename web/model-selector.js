'use strict';

// This control follows the existing Penpot panels; the select remains the UI state source.
(() => {
  const select = document.getElementById('single-model');
  const models = [...select.options].map(option => ({
    value: option.value, name: option.textContent,
    family: option.value.startsWith('gemini-') ? 'google' : 'gpt',
    description: option.value === 'gemini-3.1-flash-image' ? '生图：默认或 16:9 / 1K / 2K / 4K'
      : option.value === 'gemini-3-pro-image' ? '生图：默认或 16:9 / 2K'
        : '默认配置 / 比例由提示词引导'
  }));
  const families = { gpt: { name: 'GPT Image', description: '3 个图像模型' }, google: { name: 'Google', description: 'Flash / Pro' } };
  const trigger = document.createElement('button');
  trigger.type = 'button'; trigger.id = 'ef-model-trigger';
  trigger.setAttribute('aria-haspopup', 'menu'); trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-controls', 'ef-model-menu');
  select.hidden = true; select.tabIndex = -1; select.after(trigger);
  const menu = document.createElement('div');
  menu.id = 'ef-model-menu'; menu.setAttribute('popover', 'auto'); menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', '选择模型'); menu.dataset.family = '';
  const familyPanel = document.createElement('div'); familyPanel.className = 'ef-model-families';
  const heading = document.createElement('div'); heading.className = 'ef-model-heading'; heading.textContent = '选择模型';
  familyPanel.append(heading);
  const familyButtons = {};
  for (const [family, data] of Object.entries(families)) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'ef-model-family';
    button.dataset.familyChoice = family; button.setAttribute('role', 'menuitem');
    button.setAttribute('aria-haspopup', 'menu'); button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-controls', 'ef-model-options');
    button.innerHTML = `${studioModelIcons[family]}<span><span class="name">${data.name}</span><span class="desc">${data.description}</span></span><span class="chevron" aria-hidden="true">›</span>`;
    familyButtons[family] = button; familyPanel.append(button);
  }
  const optionPanel = document.createElement('div');
  optionPanel.id = 'ef-model-options'; optionPanel.className = 'ef-model-options';
  optionPanel.setAttribute('role', 'menu'); optionPanel.hidden = true;
  menu.append(familyPanel, optionPanel); document.body.append(menu);
  const nativePopover = typeof menu.showPopover === 'function';
  if (!nativePopover) menu.hidden = true;
  const open = () => nativePopover ? menu.matches(':popover-open') : !menu.hidden;
  let activeFamily = '';
  let renderedSelection = select.value;
  function position() {
    if (!open()) return;
    const anchor = trigger.getBoundingClientRect(), box = menu.getBoundingClientRect();
    const left = Math.max(16, Math.min(anchor.left, innerWidth - box.width - 16));
    const above = anchor.top - box.height - 8;
    const top = above >= 16 ? above : Math.max(16, Math.min(anchor.bottom + 8, innerHeight - box.height - 16));
    menu.style.left = `${left}px`; menu.style.top = `${top}px`;
  }
  function close(restoreFocus = false) {
    if (open()) {
      if (nativePopover) menu.hidePopover(); else { menu.hidden = true; menu.classList.remove('is-open'); }
    }
    trigger.setAttribute('aria-expanded', 'false');
    if (restoreFocus) trigger.focus();
  }
  function renderOptions() {
    optionPanel.replaceChildren();
    if (!activeFamily) { optionPanel.hidden = true; return; }
    optionPanel.hidden = false;
    optionPanel.setAttribute('aria-label', activeFamily === 'gpt' ? 'GPT Image' : 'Google Gemini');
    const title = document.createElement('div'); title.className = 'ef-model-heading';
    title.textContent = activeFamily === 'gpt' ? 'GPT Image' : 'Google Gemini'; optionPanel.append(title);
    for (const model of models.filter(model => model.family === activeFamily)) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'ef-model-option';
      button.dataset.modelChoice = model.value; button.setAttribute('role', 'menuitemradio');
      button.setAttribute('aria-checked', String(model.value === select.value));
      button.innerHTML = `${studioModelIcons[model.family]}<span><span class="name">${model.name}</span><span class="desc">${model.description}</span></span><span class="check" aria-hidden="true">✓</span>`;
      button.addEventListener('click', () => {
        select.value = model.value; select.dispatchEvent(new Event('change', { bubbles: true })); close(true);
      });
      optionPanel.append(button);
    }
  }
  function family(value, moveFocus = false) {
    activeFamily = value; menu.dataset.family = value;
    for (const [key, button] of Object.entries(familyButtons)) {
      button.setAttribute('aria-expanded', String(key === value));
      button.setAttribute('aria-current', key === value ? 'true' : 'false');
    }
    renderOptions(); position();
    if (moveFocus) (optionPanel.querySelector('[aria-checked="true"]') || optionPanel.querySelector('button'))?.focus();
  }
  function show() {
    if (open()) { close(); return; }
    family('');
    if (nativePopover) menu.showPopover(); else { menu.hidden = false; menu.classList.add('is-open'); }
    trigger.setAttribute('aria-expanded', 'true'); position();
    familyButtons[select.value.startsWith('gemini-') ? 'google' : 'gpt'].focus();
  }
  function sync() {
    const model = models.find(model => model.value === select.value) || models[0];
    trigger.innerHTML = `${studioModelIcons[model.family]}<span>${model.name}</span><span aria-hidden="true">⌄</span>`;
    trigger.setAttribute('aria-label', `选择模型，当前 ${model.name}`);
    trigger.disabled = select.disabled;
    if (select.parentElement.hidden) close(); else if (activeFamily && renderedSelection !== select.value) renderOptions();
    renderedSelection = select.value;
  }
  trigger.addEventListener('click', show);
  trigger.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); if (!open()) show(); }
  });
  for (const [key, button] of Object.entries(familyButtons)) {
    button.addEventListener('pointerenter', () => { if (open()) family(key); });
    button.addEventListener('click', () => family(key));
  }
  menu.addEventListener('keydown', event => {
    const current = document.activeElement;
    if (event.key === 'Escape') { event.preventDefault(); close(true); return; }
    if (event.key === 'Tab') { close(true); return; }
    if (event.key === 'ArrowRight' && current.dataset.familyChoice) {
      event.preventDefault(); family(current.dataset.familyChoice, true); return;
    }
    if (event.key === 'ArrowLeft' && optionPanel.contains(current)) {
      event.preventDefault(); const prior = activeFamily; family(''); familyButtons[prior].focus(); return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const container = optionPanel.contains(current) ? optionPanel : familyPanel;
    const buttons = [...container.querySelectorAll('button')];
    const index = buttons.indexOf(current);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  });
  menu.addEventListener('toggle', () => trigger.setAttribute('aria-expanded', String(open())));
  if (!nativePopover) document.addEventListener('pointerdown', event => {
    if (open() && !menu.contains(event.target) && !trigger.contains(event.target)) close();
  });
  window.addEventListener('resize', position);
  document.addEventListener('scroll', position, true);
  document.addEventListener('studio:controlschange', sync);
  document.addEventListener('studio:viewchange', () => close());
  select.addEventListener('change', sync);
  sync();
})();
