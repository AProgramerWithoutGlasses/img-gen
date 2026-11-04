'use strict';

// Reparent the existing controls so their business handlers and draft state stay intact.
(() => {
  const body = document.body;
  const make = (tag, className, html = '') => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (html) node.innerHTML = html;
    return node;
  };
  const icons = {
    panel: '<rect x="3" y="3" width="18" height="18"/><path d="M9 3v18"/>',
    image: '<rect x="3" y="3" width="18" height="18"/><circle cx="8" cy="8" r="2"/><path d="m21 15-5-5L3 21"/>',
    library: '<rect x="3" y="3" width="18" height="18"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>',
    folder: '<path d="M3 7V4h6l3 3h9v14H3z"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 0 1 6 0c0 2-3 2-3 4m0 3v1"/>',
    settings: '<path d="M3 6h18M3 12h18M3 18h18M8 3v6m8 0v6M9 15v6"/>',
    admin: '<path d="m12 2 8 4v6c0 5-8 10-8 10S4 17 4 12V6zM9 10h6m-6 4h6"/>',
    tasks: '<path d="m3 6 2 2 3-4m3 2h10M3 13l2 2 3-4m3 2h10M3 20l2 2 3-4m3 2h10"/>',
    expand: '<path d="M14 3h7v7m0-7-7 7M10 21H3v-7m0 7 7-7"/>',
    clear: '<path d="m14 3 7 7-11 11H6l-5-5zM8 9l7 7M10 21h12"/>',
    plus: '<path d="M12 4v16M4 12h16"/>'
  };
  const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true">${icons[name] || icons.image}</svg>`;
  const button = (id, label, name, className = '') => {
    const node = make('button', className, `${name ? icon(name) : ''}<span>${label}</span>`);
    node.type = 'button'; node.id = id; node.setAttribute('aria-label', label);
    return node;
  };
  const form = $('#create-form');
  const composer = $('.composer');
  const promptWrap = $('.prompt-wrap');
  const promptInput = $('#prompt');
  const promptLabel = $('label[for="prompt"]');
  const single = $('#single-model-controls');
  const count = $('#single-count');
  const gemini = $('#gemini-settings');
  const generate = $('#generate');
  const modelSelect = $('#single-model'), selectedModel = modelSelect.value;
  const gptModels = document.createElement('optgroup'), googleModels = document.createElement('optgroup');
  gptModels.label = 'GPT Image'; googleModels.label = 'Google';
  for (const option of [...modelSelect.options]) (option.value.startsWith('gemini-') ? googleModels : gptModels).append(option);
  modelSelect.replaceChildren(gptModels, googleModels); modelSelect.value = selectedModel;
  const controls = [...form.children];

  const sidebar = make('aside', 'ef-sidebar');
  sidebar.setAttribute('aria-label', '工作室导航');
  sidebar.innerHTML = `<div class="ef-sidebar-header"><strong class="ef-sidebar-brand">图像工作室</strong></div>
    <nav aria-label="工作区"><button type="button" class="nav-button active" data-view="studio">${icon('image')}<span class="ef-nav-text">图片创作</span></button></nav>
    <section class="ef-sidebar-section"><div class="ef-sidebar-label">资源 <button type="button" disabled aria-label="新建文件夹：暂未开放" title="文件夹功能暂未开放">＋</button></div>
    <button type="button" class="nav-button" data-view="history">${icon('library')}<span class="ef-nav-text">资源库</span></button>
    <button type="button" class="ef-nav-item" disabled aria-label="未分类：暂未开放">${icon('folder')}<span class="ef-nav-text">未分类 <small>暂未开放</small></span></button>
    <button type="button" class="ef-nav-item" disabled aria-label="文件夹：暂未开放">${icon('folder')}<span class="ef-nav-text">文件夹 <small>暂未开放</small></span></button></section>
    <section class="ef-sidebar-section"><div class="ef-sidebar-label">帮助</div><button type="button" class="ef-nav-item" id="ef-help">${icon('help')}<span class="ef-nav-text">使用说明</span></button></section>
    <div class="ef-sidebar-bottom"></div>`;
  const sidebarToggle = button('ef-sidebar-toggle', '收起侧边栏', 'panel');
  sidebarToggle.setAttribute('aria-expanded', 'true');
  $('.ef-sidebar-header', sidebar).append(sidebarToggle);
  const admin = $('#admin-nav');
  admin.innerHTML = `${icon('admin')}<span class="ef-nav-text">管理员面板</span>`;
  $('.ef-sidebar-bottom', sidebar).append(admin);
  const settings = button('ef-settings', '设置', 'settings', 'ef-nav-item');
  settings.disabled = true; settings.title = '设置功能暂未开放'; settings.setAttribute('aria-label', '设置：暂未开放');
  $('.ef-sidebar-bottom', sidebar).append(settings);
  body.insertBefore(sidebar, $('.topbar'));
  $('[data-view="history"]', sidebar).append($('#nav-count'));
  try { body.classList.toggle('sidebar-collapsed', localStorage.getItem('qiso-sidebar') === 'collapsed'); } catch { /* Optional layout preference. */ }
  const syncSidebar = () => {
    const collapsed = body.classList.contains('sidebar-collapsed');
    sidebarToggle.setAttribute('aria-expanded', String(!collapsed));
    sidebarToggle.setAttribute('aria-label', collapsed ? '展开侧边栏' : '收起侧边栏');
  };
  sidebarToggle.onclick = () => {
    body.classList.toggle('sidebar-collapsed'); syncSidebar();
    try { localStorage.setItem('qiso-sidebar', body.classList.contains('sidebar-collapsed') ? 'collapsed' : 'expanded'); } catch { /* Optional preference. */ }
  };
  syncSidebar();
  $('#ef-help').onclick = () => $('#capability-dialog').showModal();

  const theme = make('div', 'ef-theme-toggle', '<button type="button" class="theme-button" data-theme-choice="light" aria-pressed="false">浅色</button><button type="button" class="theme-button" data-theme-choice="dark" aria-pressed="false">暗色</button>');
  theme.setAttribute('role', 'group'); theme.setAttribute('aria-label', '切换外观');
  $('.topbar').prepend(theme);
  // Keep the original select as the single theme controller, including system mode.
  const themeSelect = $('#theme-mode'); themeSelect.setAttribute('aria-label', '外观偏好');
  $('#account-menu').append(themeSelect);
  themeSelect.options[1].textContent = '浅色'; themeSelect.options[2].textContent = '暗色';
  const actions = $('.header-actions');
  const balance = button('ef-balance', '—', null);
  balance.onclick = () => $('#profile-open').click();
  const creditsInfo = button('ef-credits-info', '积分说明', null);
  creditsInfo.onclick = () => $('#recharge-open').click();
  const tasks = button('ef-tasks', '任务', 'tasks');
  const library = button('ef-library', '资源库', 'library'); library.dataset.view = 'history';
  actions.prepend(balance, creditsInfo, tasks, library);

  const options = make('dialog', '', '<button type="button" class="dialog-close" aria-label="关闭创作参数">×</button><div class="ef-secondary-controls"><h2 id="ef-options-title">创作参数与工具</h2></div>');
  options.id = 'ef-options'; options.setAttribute('aria-labelledby', 'ef-options-title');
  const advanced = $('.ef-secondary-controls', options);
  for (const node of controls) advanced.append(node);
  body.append(options);
  const main = make('div', 'ef-prompt-main');
  const reference = button('ef-reference', '参考图', 'plus');
  reference.onclick = () => { setMode('edit'); options.showModal(); };
  reference.addEventListener('dragenter', event => {
    if (state.busy || ![...event.dataTransfer.types].some(type => type === 'Files' || type === galleryImageType)) return;
    event.preventDefault(); setMode('edit');
    if (!options.open) options.showModal();
  });
  const field = make('div', 'ef-prompt-field'); field.append(promptLabel, promptWrap);
  promptInput.setAttribute('form', 'create-form');
  promptInput.placeholder = '描述你想生成的画面…';
  const focus = button('ef-focus', '专注编辑提示词', 'expand'); focus.title = '专注编辑提示词';
  const expand = button('ef-expand', '展开输入区', null); expand.innerHTML = '<span aria-hidden="true">⌄</span>'; expand.setAttribute('aria-expanded', 'false');
  expand.onclick = () => {
    const expanded = body.classList.toggle('composer-expanded');
    expand.setAttribute('aria-expanded', String(expanded));
    expand.setAttribute('aria-label', expanded ? '收起输入区' : '展开输入区');
    expand.firstElementChild.textContent = expanded ? '⌃' : '⌄';
  };
  main.append(reference, field, expand, focus);
  const row = make('div', 'ef-parameter-row');
  const ratio = make('select'); ratio.id = 'ef-ratio'; ratio.setAttribute('aria-label', '画面比例');
  for (const value of ['auto', '1:1', '16:9', '9:16', '3:2']) ratio.add(new Option(value === 'auto' ? 'Auto' : value, value));
  const ratioControl = make('div', 'ef-ratio-control'); ratioControl.append(ratio);
  ratio.onchange = () => { setRatio(ratio.value); updateControls(); };
  const resolution = button('ef-resolution-label', '默认配置', null); resolution.disabled = true; resolution.title = 'GPT 使用默认分辨率';
  const thinking = make('div', 'ef-thinking-control', '<select id="ef-thinking" aria-label="思考档位：尚未接入" aria-describedby="ef-thinking-note" disabled></select><span class="ef-unavailable" id="ef-thinking-note">思考档位尚未接入</span>');
  const clear = button('ef-clear', '清空提示词和参考图', 'clear'); clear.title = '清空提示词和参考图，可在参数面板撤销';
  clear.onclick = () => { if (state.busy) return; preserveDraft(); setPrompt('', false); setEditImage('base', null); setEditImage('reference', null); toast('已清空，可在参数与工具中撤销替换'); };
  const tools = button('ef-tools', '参数与工具', 'settings'); tools.onclick = () => options.showModal();
  const estimate = make('span', 'ef-estimate', '待核算'); estimate.id = 'ef-estimate'; estimate.setAttribute('aria-live', 'polite');
  count.remove();
  row.append(single, ratioControl, resolution, gemini, thinking, count, clear, estimate, generate);
  const status = make('div', 'ef-composer-status'); status.append(tools, $('#generate-status'), $('#form-error'));
  form.append(main, row, status);
  // Controls in this modal still share the existing draft and submit implementation.
  options.addEventListener('input', () => saveDraft()); options.addEventListener('change', () => saveDraft());
  $('#gpt-settings').hidden = true;
  const oldGptSettings = $('#gpt-settings'); oldGptSettings.classList.add('ef-legacy-ratio');
  $('#inspire').textContent = '填入灵感示例';
  $('.panel-heading').hidden = true;

  const focusDialog = make('dialog', '', '<button type="button" class="dialog-close" aria-label="关闭专注编辑">×</button><div class="ef-focus-content"><h2>提示词</h2><div class="ef-focus-field"></div><button type="button" class="primary" id="ef-focus-done">完成</button></div>');
  focusDialog.id = 'ef-focus-dialog'; focusDialog.setAttribute('aria-label', '专注编辑提示词'); body.append(focusDialog);
  const fieldMarker = document.createComment('prompt field'); field.before(fieldMarker);
  focus.onclick = () => { $('.ef-focus-field', focusDialog).append(field); focusDialog.showModal(); $('#prompt').focus(); };
  $('#ef-focus-done').onclick = () => focusDialog.close();
  focusDialog.addEventListener('close', () => { fieldMarker.after(field); focus.focus(); });
  options.addEventListener('close', () => tools.focus());

  const historyHeading = make('div', 'ef-library-toolbar', '<div class="ef-library-tabs" role="group" aria-label="资源分类"><button type="button" class="ef-library-tab selected" aria-pressed="true">全部资源</button><button type="button" class="ef-library-tab" disabled>文件夹 · 暂未开放</button><button type="button" class="ef-library-tab" disabled>未分类 · 暂未开放</button><button type="button" class="ef-library-tab" disabled>标签 · 暂未开放</button></div>');
  const reload = button('ef-library-refresh', '刷新资源', null); reload.textContent = '↻'; reload.onclick = () => refreshHistory().catch(showConnectionError); historyHeading.append(reload);
  $('#history-view').prepend(historyHeading);
  const adminHeading = make('div', 'ef-admin-heading', '<span class="eyebrow">// ADMINISTRATION</span><h1>管理员面板</h1><p>用户、请求与模型价格</p>');
  $('#admin-view').prepend(adminHeading);

  const taskDialog = make('dialog', '', '<button type="button" class="dialog-close" aria-label="关闭任务">×</button><div class="ef-task-content"><h2>当前任务</h2><div id="ef-task-list"></div><button type="button" class="secondary" data-view="history">查看全部记录</button></div>');
  taskDialog.id = 'ef-task-dialog'; taskDialog.setAttribute('aria-label', '当前任务'); body.append(taskDialog);
  const renderTasks = () => {
    const list = $('#ef-task-list'); list.replaceChildren();
    if (!state.currentJobs.length) list.append(make('p', 'help', '当前没有任务。'));
    for (const job of state.currentJobs) {
      const item = button('', '', null, 'ef-task-row'); item.removeAttribute('id'); item.dataset.job = job.id;
      item.textContent = `${modelNames[job.model] || job.model} / ${statusNames[job.status]}`;
      list.append(item);
    }
  };
  tasks.onclick = () => { renderTasks(); taskDialog.showModal(); };
  taskDialog.addEventListener('click', event => { if (event.target.closest('[data-job], [data-view]')) taskDialog.close(); });

  const sync = () => {
    const selections = selectedModels(), gpt = selections.some(item => !item.model.startsWith('gemini-'));
    const google = selections.some(item => item.model.startsWith('gemini-'));
    const multiple = $('#multi-model').open;
    const model = $('#single-model').value;
    if (state.mode === 'generate') promptInput.placeholder = '描述你想生成的画面…';
    count.hidden = multiple; ratioControl.hidden = !gpt || google || state.mode === 'edit';
    ratio.value = effectiveSettings().ratio;
    resolution.hidden = google && !gpt && state.mode !== 'edit';
    oldGptSettings.hidden = true;
    thinking.hidden = !gpt || google || multiple;
    if ($('#ef-thinking').dataset.model !== model) {
      const values = model === 'gpt-image-2.5-sunburst' ? ['Max', 'ExtraHigh', 'High', 'Medium', 'Low', 'Auto'] : ['High', 'Medium', 'Low'];
      $('#ef-thinking').replaceChildren(...values.map(value => new Option(value, value)));
      $('#ef-thinking').value = model === 'gpt-image-2.5-sunburst' ? 'Auto' : 'Medium'; $('#ef-thinking').dataset.model = model;
    }
    const price = estimatedCredits(); estimate.textContent = price === null ? '待核算' : `${price} 积分`;
    balance.querySelector('span').textContent = state.user ? `${state.user.credits} 积分` : '—';
    balance.setAttribute('aria-label', state.user ? `可用积分 ${state.user.credits}，查看账户` : '查看账户积分');
    clear.disabled = state.busy || polishing;
    reference.querySelector('span').textContent = state.base || state.reference ? `${Number(!!state.base) + Number(!!state.reference)} 张参考图` : '参考图';
    if (taskDialog.open) renderTasks();
  };
  document.addEventListener('studio:controlschange', sync);
  document.addEventListener('studio:jobschange', sync);
  document.addEventListener('studio:viewchange', () => {
    if (options.open) options.close(); if (focusDialog.open) focusDialog.close();
    body.classList.toggle('ef-library-view', state.view === 'history');
  });
  // Keep original business descriptions accessible in the parameters modal.
  $('#credit-estimate').classList.add('ef-credit-detail');
  $('#model-note').before(make('h3', '', '模型与生成数量'));
  $('#upload-group').before(make('h3', '', '基础图与参考图'));
  const footer = $('.main-footer'); if (footer) footer.hidden = true;
  $('#capabilities').hidden = true;
  sync();
})();
