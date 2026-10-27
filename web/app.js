'use strict';
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const state = { user: null, prices: null, mode: 'generate', ratio: 'auto', view: 'studio', page: 1, filter: '', historyModel: '', search: '', jobs: [], recent: [], currentIDs: [], currentJobs: [], configured: false, busy: false, base: null, basePreviewURL: null, reference: null, previewURL: null, historyVersion: 0, refreshing: false };
const ideas = [
  '一只在竹林里悠闲喝茶的熊猫，午后的光穿过竹叶，石桌上摆着小茶壶，水彩插画风格，安静而松弛。',
  '雨后街角的一家小咖啡馆，暖黄色灯光透过玻璃，窗边放着一杯拿铁和一本翻开的书，电影感摄影，细腻光影。',
  '漂浮在云海之上的小岛，一座玻璃植物温室，螺旋阶梯连接星空，微缩景观，梦幻柔和的薄荷绿与奶油色。'
];
const modelNames = { 'gpt-image-2': 'GPT Image 2', 'gpt-image-1.5': 'GPT Image 1.5', 'gpt-image-2.5-sunburst': 'GPT Image 2.5 Sunburst', 'gemini-3.1-flash-image': 'Gemini Flash', 'gemini-3-pro-image': 'Gemini Pro' };
const statusNames = { queued: '排队中', running: '正在创作', succeeded: '已完成', failed: '生成失败' };
const retriedJobs = new Set();
let retryingJob = null;
let loadingEdit = false;
const galleryImageType = 'application/x-qiso-image';
let draggedPicture = null;
let referenceLoad = null;
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dateText = date => new Date(date).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
const dimensions = j => j.images.length ? `${j.images[0].width} × ${j.images[0].height}` : statusNames[j.status];
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let pendingFlights = null, flightFrame = 0, flightLayer = null;
function clearGenerationFlights() {
  pendingFlights = null;
  cancelAnimationFrame(flightFrame);
  flightFrame = 0;
  flightLayer?.remove();
  flightLayer = null;
}
function captureGenerationSources(selections) {
  const multiple = $('#multi-model').open;
  return selections.flatMap(({ model, count }) => {
    const node = multiple ? $(`[data-count="${model}"]`) : $('#single-count');
    const rect = node.getBoundingClientRect();
    const source = { node, x: rect.left + rect.width / 2 + scrollX, y: rect.top + rect.height / 2 + scrollY };
    return Array.from({ length: count }, () => source);
  });
}
function playGenerationFlights(flights) {
  clearGenerationFlights();
  if (reducedMotion.matches || document.hidden || state.view !== 'studio') return;
  const layer = document.createElement('div');
  layer.className = 'generation-flights';
  layer.setAttribute('aria-hidden', 'true');
  const particles = flights.map((flight, index) => {
    const dot = document.createElement('span');
    dot.className = 'generation-dot';
    layer.append(dot);
    return { ...flight, dot, delay: index * 55 };
  });
  flightLayer = layer;
  document.body.append(layer);
  const started = performance.now();
  function frame(now) {
    if (document.hidden || state.view !== 'studio' || reducedMotion.matches) { clearGenerationFlights(); return; }
    let active = false;
    // Resolve cards each frame: polling can replace the gallery during flight.
    const targets = new Map($$('#current-grid [data-job]').map(card => [card.dataset.job, $('.card-media', card)]));
    const positions = particles.map(({ id, source, delay }) => {
      const target = targets.get(id);
      const elapsed = now - started - delay;
      if (!target || elapsed >= 1100) return null;
      const rect = source.node.getBoundingClientRect();
      return { elapsed, startX: rect.width ? rect.left + rect.width / 2 : source.x - scrollX,
        startY: rect.height ? rect.top + rect.height / 2 : source.y - scrollY, target: target.getBoundingClientRect() };
    });
    particles.forEach(({ dot }, index) => {
      const position = positions[index];
      if (!position) { dot.remove(); return; }
      active = true;
      const { elapsed, startX, startY, target } = position;
      if (elapsed < 0) return;
      const progress = Math.min(1, elapsed / 900);
      const t = progress * progress * (3 - 2 * progress);
      const endX = target.left + target.width / 2, endY = target.top + target.height / 2;
      const arc = Math.min(140, Math.hypot(endX - startX, endY - startY) * .18);
      const x = startX + (endX - startX) * t;
      const y = startY + (endY - startY) * t - 4 * arc * t * (1 - t);
      const arrival = Math.max(0, (elapsed - 900) / 200);
      dot.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${1 + arrival * 2.5})`;
      dot.style.opacity = String(Math.min(1, elapsed / 80) * (1 - arrival));
    });
    if (active) flightFrame = requestAnimationFrame(frame); else clearGenerationFlights();
  }
  flightFrame = requestAnimationFrame(frame);
}
reducedMotion.addEventListener('change', clearGenerationFlights);
document.addEventListener('visibilitychange', () => { if (document.hidden) clearGenerationFlights(); });
let toastTimer;
let polishing = false, promptVersion = 0, polishUndo = null;
function toast(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 4200); }
async function api(path, options) {
  const response = await fetch(path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) { if (response.status === 401 && state.user) { location.reload(); } const error = new Error(data.error || `请求失败 (${response.status})`); error.status = response.status; throw error; }
  return data;
}
function setView(view) {
  if (view === 'admin' && state.user?.role !== 'admin') return;
  if (view !== 'studio') clearGenerationFlights();
  state.view = view;
  $('#admin-view').hidden = view !== 'admin';
  document.body.classList.toggle('admin-mode', view === 'admin');
  if (view === 'admin') refreshAdmin().catch(showAdminError);
  $('#studio-view').hidden = view !== 'studio'; $('#history-view').hidden = view !== 'history';
  document.body.classList.toggle('history-mode', view === 'history');
  $$('.nav-button').forEach(button => button.classList.toggle('active', button.dataset.view === view));
  if (view === 'history') refreshHistory().catch(showConnectionError);
  history.replaceState(null, '', view === 'studio' ? location.pathname : `#${view}`);
}
function updateCount() {
  promptVersion++; polishUndo = null;
  $('#char-count').textContent = [...$('#prompt').value].length;
  $('#polish-status').textContent = ''; $('#polish-error').hidden = true;
  updatePromptActions();
}
function updatePromptActions() {
  const prompt = $('#prompt').value.trim();
  $('#polish-prompt').disabled = polishing || state.busy || !state.configured || !prompt || [...prompt].length > 6000;
  $('#polish-prompt').textContent = polishing ? '润色中…' : '✧ 润色提示词';
  $('#polish-prompt').setAttribute('aria-busy', String(polishing));
  $('#undo-polish').hidden = polishUndo === null;
  $('#undo-polish').disabled = polishing || state.busy;
}
async function polishPrompt() {
  if ($('#polish-prompt').disabled) return;
  const original = $('#prompt').value, mode = state.mode, version = promptVersion;
  polishing = true; updateControls();
  $('#polish-error').hidden = true; $('#polish-status').textContent = '正在润色，请稍候…';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 55000);
  try {
    const data = await api('/api/prompt/polish', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: original, mode }), signal: controller.signal });
    if (typeof data.prompt !== 'string' || !data.prompt.trim() || [...data.prompt].length > 6000) throw new Error('润色结果无效，原提示词已保留');
    if (version !== promptVersion || mode !== state.mode || original !== $('#prompt').value) {
      $('#polish-status').textContent = '内容或模式已修改，本次润色结果未覆盖当前提示词。';
      return;
    }
    setPrompt(data.prompt);
    polishUndo = original;
    $('#polish-status').textContent = '已润色，可继续修改或撤销。';
  } catch (error) {
    $('#polish-status').textContent = '';
    $('#polish-error').textContent = error.name === 'AbortError' ? '润色超时；未自动重试，原提示词已保留。' : error.message.includes('未自动重试') ? error.message : `${error.message}（未自动重试）`;
    $('#polish-error').hidden = false;
  } finally { clearTimeout(timeout); polishing = false; updateControls(); }
}
function setPrompt(prompt) { $('#prompt').value = prompt; updateCount(); $('#prompt').focus(); }
function setRatio(ratio) { state.ratio = ratio; $$('[data-ratio]').forEach(button => button.classList.toggle('selected', button.dataset.ratio === ratio)); }
function selectedModels() {
  if (!$('#multi-model').open) return [{ model: $('#single-model').value, count: Number($('#single-count').value) }];
  return $$('[name="selected-model"]:checked').filter(input => !input.disabled).map(input => ({ model: input.value, count: Number($(`[data-count="${input.value}"]`).value) }));
}
function selectSingleModel(model) {
  $('#single-model').value = model; $('#single-count').value = '1'; $('#multi-model').open = false;
}
function estimatedCredits() {
  if (!state.prices) return null;
  const selections = selectedModels();
  if (selections.some(item => !Number.isSafeInteger(state.prices[item.model]))) return null;
  return selections.reduce((sum, item) => sum + state.prices[item.model] * item.count, 0);
}
function creditText(j) {
  if (j.credits_state === 'charged') return `${j.credits_cost} 积分`;
  if (j.credits_state === 'reserved') return `0（冻结 ${j.credits_cost}）`;
  if (j.credits_state === 'refunded') return `0（已退还 ${j.credits_cost}）`;
  return '0（历史记录）';
}
function updateGenerationStatus(total, estimate) {
  let label = state.mode === 'edit' ? `开始编辑 · ${total} 张` : `生成图片 · ${total} 张`;
  let message = '', attention = false;
  if ($('#generate').disabled) {
    if (state.busy) {
      label = '正在提交…'; message = '正在提交本次创作，请稍候，不要重复提交。';
    } else if (referenceLoad && state.mode === 'edit') {
      label = '正在读取参考图…'; message = '原图读取完成后即可开始编辑；可重新拖入、上传或移除。';
    } else if (polishing) {
      label = '提示词润色中…'; message = '润色完成后即可生成，请稍候。';
    } else if (!state.configured) {
      label = '未配置生图服务'; message = '请联系管理员配置生图服务密钥，配置完成后即可生成。'; attention = true;
    } else if (!selectedModels().length) {
      label = '请先选择模型'; message = '请至少选择一个模型，再开始创作。'; attention = true;
    } else if (estimate == null) {
      label = '积分价格未就绪'; message = '请等待价格读取完成；若持续未就绪，请查看页面顶部的连接提示。';
    } else {
      label = '积分不足'; attention = true;
      message = `本次需要 ${estimate} 积分，当前可用 ${state.user?.credits ?? 0} 积分。` + (state.user?.role === 'admin' ? '请在管理后台为账号增加积分，或减少生成张数。' : '请联系管理员充值，或减少生成张数。');
    }
  }
  $('#generate-label').textContent = label;
  const status = $('#generate-status');
  status.textContent = message; status.hidden = !message;
  status.classList.toggle('inline-error', attention);
}
function updateControls() {
  updateRetryButtons();
  const edit = state.mode === 'edit';
  const multiple = $('#multi-model').open;
  $('#single-model-controls').hidden = multiple;
  for (const option of $('#single-model').options) option.disabled = edit && option.value !== 'gpt-image-2';
  if ($('#single-model').selectedOptions[0].disabled) $('#single-model').value = 'gpt-image-2';
  $$('[name="selected-model"]').forEach(input => {
    input.disabled = edit && input.value !== 'gpt-image-2';
    $(`[data-count="${input.value}"]`).disabled = input.disabled || !input.checked;
    input.closest('.model-row').classList.toggle('unavailable', input.disabled);
  });
  const selections = selectedModels();
  const hasGPT = selections.some(item => !item.model.startsWith('gemini-'));
  const hasGemini = selections.some(item => item.model.startsWith('gemini-'));
  const mixed = hasGPT && hasGemini;
  const total = selections.reduce((sum, item) => sum + item.count, 0);
  $('#upload-group').hidden = !edit;
  $('#prompt-label').textContent = edit ? '描述你想修改的内容' : '描述你的画面';
  $('#gpt-settings').hidden = !hasGPT || mixed || edit;
  $('#gemini-settings').hidden = !hasGemini || mixed || edit;
  if (edit || mixed || !hasGPT) setRatio('auto');
  const flashOnly = selections.length > 0 && selections.every(item => item.model === 'gemini-3.1-flash-image');
  const preset = $('#gemini-preset');
  $$('option', preset).forEach(option => {
    option.disabled = ['1K', '4K'].includes(option.value) && !flashOnly;
    option.hidden = option.disabled;
  });
  if (edit || mixed || !hasGemini || preset.selectedOptions[0]?.disabled) preset.value = 'default';
  const estimate = estimatedCredits();
  $('#generate').disabled = state.busy || (state.mode === 'edit' && !!referenceLoad) || polishing || !state.configured || !selections.length || estimate === null || (state.user && state.user.credits < estimate);
  updateGenerationStatus(total, estimate);
  $('#credit-estimate').textContent = estimate === null ? '正在读取积分价格…' : `预计冻结 ${estimate} 积分 · 可用 ${state.user?.credits ?? 0} 积分${state.user && state.user.credits < estimate ? '，余额不足，请联系管理员充值' : '；失败退还'}`;
  updatePromptActions();
  $('#batch-summary').textContent = `${selections.length} 个模型 · 共 ${total} 张`;
  $('.count-note').textContent = multiple ? '每个模型 1–4 张，每批最多 20 张。每张单独请求、分别计费；失败不会自动重试。' : '每次 1–4 张。每张单独请求、分别计费；失败不会自动重试。';
  $('#mixed-model-help').hidden = !mixed;
  $('#size-note').hidden = mixed;
  const sizeNotes = {
    default: flashOnly ? '可选横向 16:9 的 1K、2K 或 4K；日常推荐 2K，放大或裁剪可选 4K。' : '可选默认画面或横向 16:9 + 2K；1K、4K 仅支持 Gemini Flash。',
    '1K': '横向 16:9 · 实测 1376 × 768，适合预览；实际尺寸以生成结果为准。',
    '2K': '横向 16:9 · 实测 2752 × 1536，日常推荐；实际尺寸以生成结果为准。',
    '4K': '横向 16:9 · 实测 5504 × 3072，适合放大或裁剪；生成更慢、文件更大，实际尺寸以生成结果为准。'
  };
  $('#size-note').textContent = edit ? '以基础图为画面，用参考图中的对象或外观进行修改；不保证逐像素保留。' : hasGemini ? sizeNotes[preset.value] : '所有模型共用比例提示；最终以实际图片尺寸为准。';
  $('#model-note').textContent = !selections.length ? '请至少选择一个模型。' : edit ? '双图修图使用 GPT Image 2：基础图 + 参考图 + 修改说明。' : (multiple ? '所有模型共用下方提示词与画面设定。' : '选择一个模型开始创作。') + (selections.some(item => item.model === 'gemini-3-pro-image') ? ' Pro 名称测试曾返回 Flash 版本，不能确认底层 Pro 身份。' : '');
  $$('[data-mode]').forEach(button => button.classList.toggle('selected', button.dataset.mode === state.mode));
}
function setMode(mode) {
  if (state.mode !== mode) {
    promptVersion++; polishUndo = null; $('#polish-status').textContent = ''; $('#form-error').hidden = true;
    if (mode === 'edit' && !selectedModels().some(item => item.model === 'gpt-image-2')) selectSingleModel('gpt-image-2');
  }
  state.mode = mode;
  $('#prompt').placeholder = mode === 'edit' ? '例如：把画面中间的小猫换成参考图里的小猫，保留基础图的背景和其他物体。' : '一只在竹林里悠闲喝茶的熊猫，午后的光穿过竹叶，水彩质感，安静而松弛……';
  updateControls();
}
function setEditImage(slot, file) {
  if (file && (!['image/png', 'image/jpeg'].includes(file.type) || file.size > 12 * 1024 * 1024)) { toast('请选择 12 MB 以内的 PNG / JPEG 图片'); return false; }
  if (slot === 'reference' && referenceLoad) {
    referenceLoad.abort(); referenceLoad = null;
    $('#drop-zone').removeAttribute('aria-busy');
    updateControls();
  }
  const base = slot === 'base', urlKey = base ? 'basePreviewURL' : 'previewURL';
  const input = $(base ? '#base-image' : '#reference'), preview = $(base ? '#base-preview' : '#reference-preview');
  if (state[urlKey]?.startsWith('blob:')) URL.revokeObjectURL(state[urlKey]);
  state[slot] = file; state[urlKey] = file ? file.sourceID ? file.url : URL.createObjectURL(file) : null;
  input.value = '';
  $('#form-error').hidden = true;
  preview.hidden = !file; $(base ? '#base-upload-copy' : '#upload-copy').hidden = !!file; $(base ? '#clear-base' : '#clear-reference').hidden = !file;
  if (file) preview.src = state[urlKey]; else preview.removeAttribute('src');
  return true;
}
function card(j) {
  const image = j.images[0];
  let media;
  if (image) media = `<img src="${escapeHTML(image.thumbnail_url || image.url)}" alt="${escapeHTML(j.prompt)}" draggable="true" data-drag-image="${image.id}" title="拖入左侧基础图或参考图" loading="lazy" decoding="async"><span class="card-badge">${escapeHTML(modelNames[j.model])}</span>`;
  else if (j.status === 'failed') media = `<button type="button" class="error-mark retry-button" data-retry="${j.id}" aria-label="重试这张图片" title="按原参数重试这一张，重新计费">↻</button><small>生成失败 · ${escapeHTML(modelNames[j.model])}</small><p class="card-error-message">${escapeHTML(j.error?.trim() || '未返回具体错误信息，请稍后手动重试。')}</p>`;
  else media = `<span class="${j.status === 'running' ? 'spinner' : 'queued-icon'}">${j.status === 'running' ? '' : '◷'}</span><small>${statusNames[j.status]} · ${escapeHTML(modelNames[j.model])}</small>`;
  return `<article class="art-card" tabindex="0" role="button" aria-label="查看作品：${escapeHTML(j.prompt)}" data-job="${j.id}"><div class="card-media ${j.status === 'failed' ? 'card-error' : ''}">${media}</div><div class="card-info"><p>${escapeHTML(j.prompt)}</p><div class="card-meta"><span>${escapeHTML(dimensions(j))}</span><span>${dateText(j.created_at)}</span></div>${image ? `<button type="button" class="secondary card-edit" data-edit="${j.id}" title="载入原图，填写修改说明后开始编辑">▧ 一键修图</button>` : ''}</div></article>`;
}
function renderGallery(target, jobs) {
  const node = $(target);
  const signature = JSON.stringify(jobs.map(j => [j.id, j.status, j.error, j.images.map(i => i.id)]));
  if (node.dataset.signature !== signature) { node.innerHTML = jobs.map(card).join(''); node.dataset.signature = signature; }
  updateRetryButtons();
}
function updateRetryButtons() {
  $$('[data-retry]').forEach(button => {
    const id = button.dataset.retry, pending = retryingJob === id, submitted = retriedJobs.has(id);
    button.disabled = state.busy || submitted;
    button.classList.toggle('is-retrying', pending);
    button.setAttribute('aria-busy', String(pending));
    button.setAttribute('aria-label', pending ? '正在提交重试' : submitted ? '已提交重试' : '重试这张图片');
    button.title = pending ? '正在提交重试…' : submitted ? '已提交重试，请查看新任务' : '按原参数重试这一张，重新计费';
  });
}
async function retryJob(id) {
  if (state.busy || retriedJobs.has(id)) return;
  state.busy = true; retryingJob = id; updateControls();
  try {
    const j = await api(`/api/jobs/${id}`);
    if (j.status !== 'failed') throw new Error('仅失败的图片可以重试');
    await refreshWallet();
    const price = state.prices?.[j.model];
    if (!Number.isSafeInteger(price) || price < 0) throw new Error('暂时无法读取模型价格，请稍后再试');
    const form = new FormData();
    for (const [key, value] of Object.entries({ mode: j.mode, models: JSON.stringify([{ model: j.model, count: 1 }]), prompt: j.prompt, ratio: j.ratio, resolution: j.resolution, expected_credits: price })) form.append(key, value);
    if (j.mode === 'edit') {
      form.append('image', await fetchImageFile(`/api/jobs/${id}/input`, 'base'));
      if (j.has_reference) form.append('reference', await fetchImageFile(`/api/jobs/${id}/reference`, 'reference'));
    }
    const data = await api('/api/jobs', { method: 'POST', body: form });
    retriedJobs.add(id);
    state.currentIDs = state.currentIDs.includes(id) ? state.currentIDs.flatMap(current => current === id ? data.ids : [current]) : data.ids;
    try { localStorage.setItem(`qiso-current-jobs:${state.user.id}`, JSON.stringify(state.currentIDs)); } catch { /* Storage is optional. */ }
    setView('studio'); toast('已按原参数重试这一张图片，新任务已加入队列');
    // A refresh failure must not resubmit a task that was already accepted.
    await Promise.all([refreshRecent(), refreshCurrent()]).catch(showConnectionError);
  } catch (error) {
    toast(`${error.message}（未自动重试；如提交结果不明，请先查看历史记录）`);
  } finally {
    retryingJob = null; state.busy = false;
    updateControls();
    await refreshWallet().catch(() => {});
  }
}
async function refreshHistory() {
  const version = ++state.historyVersion;
  const query = new URLSearchParams({ page: String(state.page), status: state.filter, model: state.historyModel, q: state.search });
  const data = await api(`/api/jobs?${query}`);
  if (version !== state.historyVersion) return;
  state.jobs = data.items;
  renderGallery('#history-grid', data.items);
  $('#history-empty').hidden = !!data.items.length;
  const pages = Math.max(1, Math.ceil(data.total / data.page_size));
  $('#page-label').textContent = `${state.page} / ${pages}`;
  $('#previous-page').disabled = state.page <= 1; $('#next-page').disabled = state.page >= pages;
  for (const key of ['total', 'succeeded', 'active', 'failed']) $(`#stat-${key}`).textContent = data.stats[key];
  $('#nav-count').textContent = data.stats.total;
}
let recentVersion = 0;
async function refreshRecent() {
  const version = ++recentVersion, ids = state.currentIDs;
  const currentIDs = new Set(ids);
  const data = await api('/api/jobs');
  if (version !== recentVersion || ids !== state.currentIDs) return;
  const recent = data.items.filter(job => !currentIDs.has(job.id));
  // A full 20-image batch can leave fewer than six older works on page one.
  for (let page = 2; recent.length < 6 && (page - 1) * data.page_size < data.total; page++) {
    const more = await api(`/api/jobs?page=${page}`);
    if (version !== recentVersion || ids !== state.currentIDs) return;
    recent.push(...more.items.filter(job => !currentIDs.has(job.id)));
  }
  state.recent = recent.slice(0, 6);
  renderGallery('#recent-grid', state.recent);
  $('#recent-empty').hidden = !!state.recent.length;
  const total = Math.max(0, data.total - currentIDs.size);
  $('#recent-count').textContent = total ? ` / ${total}` : '';
  $('#nav-count').textContent = data.stats.total;
}
async function refreshCurrent() {
  if (!state.currentIDs.length) return;
  const ids = state.currentIDs;
  const jobs = await Promise.all(ids.map(id => api(`/api/jobs/${id}`)));
  if (ids !== state.currentIDs) return;
  state.currentJobs = jobs;
  $('#welcome').hidden = true; $('#current-section').hidden = false;
  $('#current-count').textContent = `${jobs.filter(j => j.status === 'succeeded').length} / ${jobs.length}`;
  renderGallery('#current-grid', jobs);
  if (pendingFlights?.ids === ids) playGenerationFlights(pendingFlights.flights);
}
function showConnectionError(error) { $('#banner').textContent = `读取服务失败：${error.message}。页面会自动重连。`; $('#banner').hidden = false; }
async function refresh() {
  if (!state.user || state.refreshing || document.hidden) return;
  state.refreshing = true;
  try {
    await Promise.all([refreshWallet(), refreshRecent(), refreshCurrent(), ...(state.view === 'history' ? [refreshHistory()] : [])]);
    if (state.configured) { $('#banner').hidden = true; }
  } catch (error) { showConnectionError(error); } finally { state.refreshing = false; }
}
async function showDetail(id) {
  try {
    const j = await api(`/api/jobs/${id}`);
    const seconds = j.started_at && j.finished_at ? `${((new Date(j.finished_at) - new Date(j.started_at)) / 1000).toFixed(1)} 秒` : '—';
    const pictures = j.images.map((p, index) => `<button type="button" class="detail-preview" data-preview="${index}" aria-label="查看大图${j.images.length > 1 ? ` ${index + 1}` : ''}"><img src="${escapeHTML(p.thumbnail_url)}" alt="${escapeHTML(j.prompt)}" decoding="async"><span>点击查看大图</span></button>`).join('');
    const metadata = [['用户', j.username || '历史共享记录'], ['消耗积分', creditText(j)], ['创作模式', j.mode === 'edit' ? '参考图编辑' : '文字生图'], ['请求模型', j.model], ['返回模型', j.actual_model || '—'], ['画面设定', j.ratio === 'auto' ? '自动 / 默认' : `${j.ratio} · ${j.resolution === 'default' ? '默认分辨率' : j.resolution}`], ['实际图片', j.images.map(p => `${p.width} × ${p.height} · ${p.mime.split('/')[1].toUpperCase()} · ${(p.bytes / 1048576).toFixed(2)} MB`).join('；') || '—'], ['生成耗时', seconds], ['创建时间', new Date(j.created_at).toLocaleString('zh-CN')], ['响应质量', j.quality || '—'], ['请求 ID', j.request_id || '—'], ['任务 ID', j.id]];
    $('#detail-body').innerHTML = `<div class="detail-layout"><div class="detail-image">${j.has_input ? `<figure><figcaption>基础图 · 待修改的画面</figcaption><img src="/api/jobs/${j.id}/input" alt="基础图"></figure>` : ''}${j.has_reference ? `<figure><figcaption>参考图 · 借用的对象或外观</figcaption><img src="/api/jobs/${j.id}/reference" alt="参考图"></figure>` : ''}${pictures ? '<span>生成结果</span>' : ''}${pictures || `<span class="queued-icon">${j.status === 'failed' ? '↻' : '◷'}</span><span>${statusNames[j.status]}</span>`}</div><div class="detail-info"><span class="eyebrow">${statusNames[j.status]}</span><h3>一瞬灵感，一张作品。</h3><p>${escapeHTML(j.prompt)}</p>${j.error ? `<div class="detail-error">${escapeHTML(j.error)}</div>` : ''}<dl class="detail-meta">${metadata.map(([k, v]) => `<dt>${k}</dt><dd>${escapeHTML(v)}</dd>`).join('')}</dl><details><summary>实际发送的提示词与接口</summary><p>${escapeHTML(j.effective_prompt)}</p><p>${escapeHTML(j.endpoint || '尚未调用')}</p></details><div class="detail-actions">${j.images.map((p, index) => `<a class="primary" href="${p.url}?download=1" download>↓ 下载原图${j.images.length > 1 ? index + 1 : ''}</a>`).join('')}<button class="secondary" id="reuse-job">${j.status === 'failed' ? '重试这次创作' : '复用参数'}</button>${j.images.length ? '<button class="secondary" id="edit-result">▧ 继续编辑</button>' : ''}</div></div></div>`;
    if (!$('#detail').open) $('#detail').showModal();
    $$('[data-preview]', $('#detail-body')).forEach(button => {
      button.onclick = () => showImagePreview(j.images[Number(button.dataset.preview)], j.prompt);
    });
    $('#reuse-job').onclick = () => reuseJob(j);
    if ($('#edit-result')) $('#edit-result').onclick = () => editResult(j);
  } catch (error) { toast(error.message); }
}
let originalLoader = null;
function clearImagePreview() {
  if (originalLoader) {
    originalLoader.onload = originalLoader.onerror = null;
    originalLoader.removeAttribute('src');
    originalLoader = null;
  }
  $('#image-preview-picture').removeAttribute('src');
  $('#view-original').onclick = null;
}
$('#image-preview').addEventListener('close', clearImagePreview);
function showImagePreview(picture, prompt) {
  clearImagePreview();
  const dialog = $('#image-preview'), img = $('#image-preview-picture');
  const button = $('#view-original'), status = $('#image-preview-status');
  const label = `查看原图（${(picture.bytes / 1048576).toFixed(2)} MB）`;
  img.src = picture.thumbnail_url;
  img.alt = prompt;
  button.textContent = label;
  button.disabled = false;
  status.textContent = '当前展示缩略图';
  button.onclick = () => {
    if (button.disabled) return;
    button.disabled = true;
    button.textContent = '正在加载原图…';
    status.textContent = '原图加载中，暂时保留缩略图';
    const loader = new Image();
    originalLoader = loader;
    loader.onload = () => {
      if (originalLoader !== loader || !dialog.open) return;
      loader.id = img.id;
      loader.alt = prompt;
      img.replaceWith(loader);
      button.textContent = '已显示原图';
      status.textContent = '当前展示原图';
      originalLoader = null;
    };
    loader.onerror = () => {
      if (originalLoader !== loader || !dialog.open) return;
      originalLoader = null;
      button.disabled = false;
      button.textContent = label;
      status.textContent = '原图加载失败，仍展示缩略图，请点击按钮重试';
    };
    loader.src = picture.url;
  };
  if (!dialog.open) dialog.showModal();
}
async function fetchImageFile(url, name) {
  const response = await fetch(url); if (!response.ok) throw new Error('读取参考图失败');
  const blob = await response.blob(); return new File([blob], name, { type: blob.type });
}
async function reuseJob(j) {
  try {
    const [base, reference] = await Promise.all([
      j.mode === 'edit' ? fetchImageFile(`/api/jobs/${j.id}/input`, 'base') : null,
      j.has_reference ? fetchImageFile(`/api/jobs/${j.id}/reference`, 'reference') : null
    ]);
    selectSingleModel(j.model); setMode(j.mode); setRatio(j.ratio); $('#gemini-preset').value = j.resolution;
    updateControls();
    setEditImage('base', base); setEditImage('reference', reference); setView('studio'); setPrompt(j.prompt); $('#detail').close();
    toast('已填入参数，点击生成后才会发起新请求'); window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (error) { toast(error.message); }
}
async function editResult(j) {
  if (loadingEdit || state.busy) { toast(loadingEdit ? '正在读取作品，请稍候' : '正在提交创作，请稍后再选择基础图'); return; }
  loadingEdit = true;
  try {
    if (typeof j === 'string') {
      const id = j;
      j = [...state.currentJobs, ...state.recent, ...state.jobs].find(item => item.id === id);
      if (!j) {
        toast('正在读取作品…');
        j = await api(`/api/jobs/${id}`, { signal: AbortSignal.timeout(15000) });
      }
    }
    const picture = j.images?.[0];
    if (!picture || !/^[a-f0-9]{32}$/.test(picture.id)) throw new Error('未找到可编辑的原图，请刷新作品列表');
    const file = { sourceID: picture.id, url: picture.url, type: picture.mime, size: picture.bytes };
    if (!setEditImage('base', file)) return;
    selectSingleModel('gpt-image-2');
    if (state.mode !== 'edit') setPrompt('');
    setMode('edit'); setView('studio');
    $('#detail').close(); toast(state.reference ? '已更换基础图，请填写修改说明' : '已载入基础图，请添加参考图并填写修改说明');
    $('#prompt').focus({ preventScroll: true }); $('#upload-group').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) { toast(error.name === 'TimeoutError' ? '读取作品超时，请稍后重新点击' : error.message); } finally { loadingEdit = false; }
}
$('#create-form').addEventListener('submit', async event => {
  event.preventDefault(); if ($('#generate').disabled) return;
  $('#form-error').hidden = true;
  if (state.mode === 'edit' && (!state.base || !state.reference)) { $('#form-error').textContent = !state.base ? '请先上传基础图，或从历史作品选择' : '请添加参考图，说明要用其中的什么内容修改基础图'; $('#form-error').hidden = false; return; }
  const selections = selectedModels();
  if (!selections.length) { toast('请至少选择一个模型'); return; }
  const gemini = selections.every(item => item.model.startsWith('gemini-'));
  const resolution = gemini && state.mode !== 'edit' ? $('#gemini-preset').value : 'default';
  const ratio = state.mode === 'edit' ? 'auto' : gemini ? resolution !== 'default' ? '16:9' : 'auto' : state.ratio;
  const form = new FormData();
  for (const [key, value] of Object.entries({ mode: state.mode, models: JSON.stringify(selections), prompt: $('#prompt').value, ratio, resolution, expected_credits: estimatedCredits() })) form.append(key, value);
  if (state.mode === 'edit') {
    if (state.base.sourceID) form.append('base_image_id', state.base.sourceID); else form.append('image', state.base);
    form.append('reference', state.reference);
  }
  const sources = captureGenerationSources(selections);
  state.busy = true; updateControls();
  try {
    const data = await api('/api/jobs', { method: 'POST', body: form });
    clearGenerationFlights();
    state.currentIDs = data.ids;
    pendingFlights = { ids: data.ids, flights: data.ids.map((id, index) => ({ id, source: sources[index] })) };
    try { localStorage.setItem(`qiso-current-jobs:${state.user.id}`, JSON.stringify(data.ids)); } catch { /* Storage is optional. */ }
    setView('studio'); toast('创作已加入队列，历史记录已保存');
    // Refresh the new batch even if an older polling cycle is still in flight.
    await Promise.all([refreshRecent(), refreshCurrent()]);
    if (innerWidth <= 640) $('#current-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) { $('#form-error').textContent = error.message; $('#form-error').hidden = false; }
  finally { state.busy = false; await refreshWallet().catch(() => {}); updateControls(); }
});
document.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (button?.dataset.retry) { event.preventDefault(); event.stopPropagation(); retryJob(button.dataset.retry); return; }
  if (button?.dataset.edit) { event.preventDefault(); event.stopPropagation(); editResult(button.dataset.edit); return; }
  if (button?.dataset.view) setView(button.dataset.view);
  if (button?.dataset.mode) setMode(button.dataset.mode);
  if (button?.dataset.ratio) setRatio(button.dataset.ratio);
  if (button?.dataset.style) { const prompt = $('#prompt'); prompt.value = `${prompt.value.trim()}${prompt.value.trim() ? '，' : ''}${button.dataset.style}`.slice(0, 6000); updateCount(); }
  if (button?.dataset.idea !== undefined) { setView('studio'); setMode('generate'); setPrompt(ideas[Number(button.dataset.idea)]); if (innerWidth <= 640) window.scrollTo({ top: 0, behavior: 'smooth' }); }
  if (button?.dataset.filter !== undefined) { state.filter = button.dataset.filter; state.page = 1; $$('[data-filter]').forEach(b => b.classList.toggle('selected', b === button)); refreshHistory().catch(showConnectionError); }
  const art = event.target.closest('[data-job]'); if (art) showDetail(art.dataset.job);
  if (button?.classList.contains('dialog-close')) button.closest('dialog').close();
});
document.addEventListener('keydown', event => { if (['Enter', ' '].includes(event.key) && event.target.matches('[data-job]')) { event.preventDefault(); showDetail(event.target.dataset.job); } });
$('#prompt').addEventListener('input', updateCount);
$('#polish-prompt').onclick = polishPrompt;
$('#undo-polish').onclick = () => { if (polishUndo !== null && !polishing && !state.busy) { setPrompt(polishUndo); $('#polish-status').textContent = '已恢复润色前的提示词。'; } };
$('#model-picker').addEventListener('change', updateControls);
$('#single-model').addEventListener('change', updateControls);
$('#single-count').addEventListener('change', updateControls);
$('#gemini-preset').addEventListener('change', updateControls);
let multiModelInitialized = false;
$('#multi-model').addEventListener('toggle', () => {
  if ($('#multi-model').open && !multiModelInitialized) {
    $$('[name="selected-model"]').forEach(input => { input.checked = input.value === $('#single-model').value; });
    $$('[data-count]').forEach(input => { input.value = input.dataset.count === $('#single-model').value ? $('#single-count').value : '1'; });
    multiModelInitialized = true;
  }
  updateControls();
});
$('#inspire').onclick = () => setPrompt(ideas[Math.floor(Math.random() * ideas.length)]);
$('#try-example').onclick = () => { setMode('generate'); setPrompt(ideas[0]); if (innerWidth <= 640) window.scrollTo({ top: 0, behavior: 'smooth' }); };
document.addEventListener('dragstart', event => {
  const image = event.target.closest('[data-drag-image]');
  if (!image) return;
  draggedPicture = [...state.currentJobs, ...state.recent, ...state.jobs].flatMap(job => job.images).find(picture => picture.id === image.dataset.dragImage);
  if (state.busy || !draggedPicture) { event.preventDefault(); draggedPicture = null; return; }
  event.dataTransfer.clearData();
  event.dataTransfer.setData(galleryImageType, draggedPicture.id);
  event.dataTransfer.effectAllowed = 'copy';
  if (state.mode !== 'edit') setMode('edit');
});
document.addEventListener('dragend', () => {
  draggedPicture = null;
  $$('.upload-zone').forEach(zone => zone.classList.remove('dragging'));
});
async function dropGalleryImage(slot, picture) {
  if (!/^[a-f0-9]{32}$/.test(picture.id) || !['image/png', 'image/jpeg'].includes(picture.mime) || picture.bytes > 12 * 1024 * 1024) {
    toast('请选择 12 MB 以内的 PNG / JPEG 图片'); return;
  }
  if (slot === 'base') {
    setEditImage('base', { sourceID: picture.id, url: picture.url, type: picture.mime, size: picture.bytes });
    toast('已选为基础图，修改说明已保留'); return;
  }
  referenceLoad?.abort();
  const controller = new AbortController();
  referenceLoad = controller;
  $('#drop-zone').setAttribute('aria-busy', 'true');
  $('#clear-reference').hidden = false;
  updateControls();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    // Read the original only on drop; never use the card's WebP thumbnail as edit input.
    const response = await fetch(`/api/images/${picture.id}`, { signal: controller.signal });
    if (!response.ok) throw new Error('读取参考图失败，请重新拖入');
    const blob = await response.blob();
    if (referenceLoad !== controller) return;
    if (setEditImage('reference', new File([blob], `reference-${picture.id}`, { type: blob.type }))) toast('已选为参考图，修改说明已保留');
  } catch (error) {
    if (referenceLoad === controller) toast(error.name === 'AbortError' ? '读取参考图超时，请重新拖入' : error.message);
  } finally {
    clearTimeout(timeout);
    if (referenceLoad === controller) {
      referenceLoad = null;
      $('#drop-zone').removeAttribute('aria-busy');
      $('#clear-reference').hidden = !state.reference;
      updateControls();
    }
  }
}
for (const [slot, inputID, dropID, clearID] of [['base', '#base-image', '#base-drop-zone', '#clear-base'], ['reference', '#reference', '#drop-zone', '#clear-reference']]) {
  $(inputID).onchange = event => { const file = event.target.files[0]; if (file && !setEditImage(slot, file)) event.target.value = ''; };
  $(clearID).onclick = () => setEditImage(slot, null);
  const zone = $(dropID);
  zone.addEventListener('dragover', event => {
    event.preventDefault();
    const accepted = !state.busy && [...event.dataTransfer.types].some(type => type === 'Files' || (type === galleryImageType && draggedPicture));
    event.dataTransfer.dropEffect = accepted ? 'copy' : 'none';
    zone.classList.toggle('dragging', accepted);
  });
  zone.addEventListener('dragleave', event => { if (!zone.contains(event.relatedTarget)) zone.classList.remove('dragging'); });
  zone.addEventListener('drop', event => {
    event.preventDefault(); zone.classList.remove('dragging');
    if (state.busy) return;
    const id = event.dataTransfer.getData(galleryImageType);
    if (id && draggedPicture?.id === id) { void dropGalleryImage(slot, draggedPicture); return; }
    if (event.dataTransfer.files[0]) setEditImage(slot, event.dataTransfer.files[0]);
  });
}
$('#choose-base-history').onclick = () => { setView('history'); toast('点击作品上的“一键修图”，将它用作基础图'); };
$('#previous-page').onclick = () => { state.page--; refreshHistory().catch(showConnectionError); };
$('#next-page').onclick = () => { state.page++; refreshHistory().catch(showConnectionError); };
$('#history-model').replaceChildren(new Option('全部模型', ''), ...Object.entries(modelNames).map(([value, label]) => new Option(label, value)));
$('#history-model').addEventListener('change', event => { state.historyModel = event.target.value; state.page = 1; refreshHistory().catch(showConnectionError); });
let searchTimer;
$('#search').addEventListener('input', event => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { state.search = event.target.value; state.page = 1; refreshHistory().catch(showConnectionError); }, 300); });
$('#capabilities').onclick = () => $('#capability-dialog').showModal();
const mixedHelp = $('#mixed-model-help');
mixedHelp.addEventListener('pointerenter', () => delete mixedHelp.dataset.dismissed);
mixedHelp.addEventListener('focusin', () => delete mixedHelp.dataset.dismissed);
mixedHelp.addEventListener('keydown', event => {
  if (event.key === 'Escape') { mixedHelp.dataset.dismissed = 'true'; event.stopPropagation(); }
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
async function init() {
  try {
    state.user = await api('/api/auth/me');
    document.body.classList.remove('signed-out');
    $('#login-view').hidden = true;
    $('#admin-nav').hidden = state.user.role !== 'admin';
    renderAccount();
    $('#password-username').value = state.user.username;
    $('#account-name').textContent = `${state.user.username} · ${state.user.role === 'admin' ? '管理员' : '普通用户'}`;
    const config = await api('/api/config'); state.configured = config.configured;
    await refreshWallet();
    if (!config.configured) { $('#banner').textContent = '网站已就绪。请在服务端 .env 中配置 QISO_API_KEY 并重启，即可开始真实创作。'; $('#banner').hidden = false; }
    try { const ids = JSON.parse(localStorage.getItem(`qiso-current-jobs:${state.user.id}`) || '[]'); if (Array.isArray(ids)) state.currentIDs = ids.filter(id => /^[a-f0-9]{32}$/.test(id)).slice(0, 20); } catch { /* Ignore invalid local preferences. */ }
    if (state.currentIDs.length) { const results = await Promise.all(state.currentIDs.map(id => api(`/api/jobs/${id}`).then(() => id).catch(() => null))); state.currentIDs = results.filter(Boolean); }
    updateControls(); if (location.hash === '#history') setView('history'); if (location.hash === '#admin' && state.user.role === 'admin') setView('admin'); await refresh();
  } catch (error) { if (!state.user) { if (error.status !== 401) { $('#login-error').textContent = error.message; $('#login-error').hidden = false; } return; } showConnectionError(error); }
  setInterval(async () => { if (!state.configured) { try { const config = await api('/api/config'); state.configured = config.configured; updateControls(); } catch {} } await refresh(); }, 4000);
}
updateControls();
// Account UI starts initialization after its event handlers are installed.
