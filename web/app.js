'use strict';
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const state = { mode: 'generate', ratio: 'auto', view: 'studio', page: 1, filter: '', search: '', jobs: [], recent: [], currentIDs: [], currentJobs: [], configured: false, busy: false, reference: null, previewURL: null, historyVersion: 0, refreshing: false };
const ideas = [
  '一只在竹林里悠闲喝茶的熊猫，午后的光穿过竹叶，石桌上摆着小茶壶，水彩插画风格，安静而松弛。',
  '雨后街角的一家小咖啡馆，暖黄色灯光透过玻璃，窗边放着一杯拿铁和一本翻开的书，电影感摄影，细腻光影。',
  '漂浮在云海之上的小岛，一座玻璃植物温室，螺旋阶梯连接星空，微缩景观，梦幻柔和的薄荷绿与奶油色。'
];
const modelNames = { 'gpt-image-2': 'GPT Image 2', 'gpt-image-1.5': 'GPT Image 1.5', 'gpt-image-2.5-sunburst': 'GPT Image 2.5 Sunburst', 'gemini-3.1-flash-image': 'Gemini Flash', 'gemini-3-pro-image': 'Gemini Pro' };
const statusNames = { queued: '排队中', running: '正在创作', succeeded: '已完成', failed: '生成失败' };
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dateText = date => new Date(date).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
const dimensions = j => j.images.length ? `${j.images[0].width} × ${j.images[0].height}` : statusNames[j.status];
let toastTimer;
let polishing = false, promptVersion = 0, polishUndo = null;
function toast(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 4200); }
async function api(path, options) {
  const response = await fetch(path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `请求失败 (${response.status})`);
  return data;
}
function setView(view) {
  state.view = view;
  $('#studio-view').hidden = view !== 'studio'; $('#history-view').hidden = view !== 'history';
  document.body.classList.toggle('history-mode', view === 'history');
  $$('.nav-button').forEach(button => button.classList.toggle('active', button.dataset.view === view));
  if (view === 'history') refreshHistory().catch(showConnectionError);
  history.replaceState(null, '', view === 'history' ? '#history' : location.pathname);
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
  $$('[name="selected-model"]').forEach(input => { input.checked = input.value === model; });
  $$('[data-count]').forEach(input => { input.value = '1'; });
}
function updateControls() {
  const edit = state.mode === 'edit';
  const multiple = $('#multi-model').open;
  $('#single-model-controls').hidden = multiple;
  for (const option of $('#single-model').options) option.disabled = edit && !['gpt-image-2', 'gemini-3.1-flash-image'].includes(option.value);
  if ($('#single-model').selectedOptions[0].disabled) $('#single-model').value = 'gpt-image-2';
  $$('[name="selected-model"]').forEach(input => {
    input.disabled = edit && !['gpt-image-2', 'gemini-3.1-flash-image'].includes(input.value);
    if (input.disabled) input.checked = false;
    $(`[data-count="${input.value}"]`).disabled = input.disabled || !input.checked;
    input.closest('.model-row').classList.toggle('unavailable', input.disabled);
  });
  const selections = selectedModels();
  const hasGPT = selections.some(item => !item.model.startsWith('gemini-'));
  const hasGemini = selections.some(item => item.model.startsWith('gemini-'));
  const mixed = hasGPT && hasGemini;
  const total = selections.reduce((sum, item) => sum + item.count, 0);
  $('#upload-group').hidden = !edit;
  $('#gpt-settings').hidden = !hasGPT || mixed || edit;
  $('#gemini-settings').hidden = !hasGemini || mixed || edit;
  if (edit || mixed || !hasGPT) setRatio('auto');
  if (edit || mixed || !hasGemini) $('#gemini-preset').value = 'default';
  $('#generate-label').textContent = state.busy ? '正在提交…' : edit ? `开始编辑 · ${total} 张` : `生成图片 · ${total} 张`;
  $('#generate').disabled = state.busy || polishing || !state.configured || !selections.length;
  updatePromptActions();
  $('#batch-summary').textContent = `${selections.length} 个模型 · 共 ${total} 张`;
  $('.count-note').textContent = multiple ? '每个模型 1–4 张，每批最多 20 张。每张单独请求、分别计费；失败不会自动重试。' : '每次 1–4 张。每张单独请求、分别计费；失败不会自动重试。';
  $('#size-note').textContent = edit ? '所有模型共用参考图与默认画面配置，不保证逐像素保留。' : mixed ? 'GPT 与 Gemini 混选时，统一使用自动画面 / 默认分辨率（共同已验证配置）。' : hasGemini ? '2K 是接口档位；实测 2752 × 1536，非精确像素承诺。' : '所有模型共用比例提示；最终以实际图片尺寸为准。';
  $('#model-note').textContent = !selections.length ? '请至少选择一个模型。' : (multiple ? '所有模型共用下方提示词与画面设定。' : '选择一个模型开始创作。') + (selections.some(item => item.model === 'gemini-3-pro-image') ? ' Pro 名称测试曾返回 Flash 版本，不能确认底层 Pro 身份。' : '') + (edit ? ' 编辑仅支持 GPT Image 2 / Gemini Flash。' : '');
  $$('[data-mode]').forEach(button => button.classList.toggle('selected', button.dataset.mode === state.mode));
}
function setMode(mode) { if (state.mode !== mode) { promptVersion++; polishUndo = null; $('#polish-status').textContent = ''; } state.mode = mode; $('#prompt').placeholder = mode === 'edit' ? '描述你希望修改的内容，以及需要保留的部分…' : '一只在竹林里悠闲喝茶的熊猫，午后的光穿过竹叶，水彩质感，安静而松弛……'; updateControls(); }
function setReference(file) {
  if (file && (!['image/png', 'image/jpeg'].includes(file.type) || file.size > 12 * 1024 * 1024)) { toast('请选择 12 MB 以内的 PNG / JPEG 图片'); return false; }
  if (state.previewURL) URL.revokeObjectURL(state.previewURL);
  state.reference = file; state.previewURL = file ? URL.createObjectURL(file) : null;
  $('#reference-preview').hidden = !file; $('#upload-copy').hidden = !!file; $('#clear-reference').hidden = !file;
  if (file) $('#reference-preview').src = state.previewURL; else { $('#reference-preview').removeAttribute('src'); $('#reference').value = ''; }
  return true;
}
function card(j) {
  const image = j.images[0];
  let media;
  if (image) media = `<img src="${image.url}" alt="${escapeHTML(j.prompt)}" loading="lazy"><span class="card-badge">${escapeHTML(modelNames[j.model])}</span>`;
  else if (j.status === 'failed') media = `<span class="error-mark">↻</span><small>生成失败 · ${escapeHTML(modelNames[j.model])}</small>`;
  else media = `<span class="${j.status === 'running' ? 'spinner' : 'queued-icon'}">${j.status === 'running' ? '' : '◷'}</span><small>${statusNames[j.status]} · ${escapeHTML(modelNames[j.model])}</small>`;
  return `<article class="art-card" tabindex="0" role="button" aria-label="查看作品：${escapeHTML(j.prompt)}" data-job="${j.id}"><div class="card-media ${j.status === 'failed' ? 'card-error' : ''}">${media}</div><div class="card-info"><p>${escapeHTML(j.prompt)}</p><div class="card-meta"><span>${escapeHTML(dimensions(j))}</span><span>${dateText(j.created_at)}</span></div></div></article>`;
}
function renderGallery(target, jobs) {
  const node = $(target);
  const signature = JSON.stringify(jobs.map(j => [j.id, j.status, j.error, j.images.map(i => i.id)]));
  if (node.dataset.signature !== signature) { node.innerHTML = jobs.map(card).join(''); node.dataset.signature = signature; }
}
async function refreshHistory() {
  const version = ++state.historyVersion;
  const query = new URLSearchParams({ page: String(state.page), status: state.filter, q: state.search });
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
async function refreshRecent() {
  const data = await api('/api/jobs');
  state.recent = data.items;
  renderGallery('#recent-grid', data.items.slice(0, 6));
  $('#recent-empty').hidden = !!data.items.length;
  $('#recent-count').textContent = data.total ? ` / ${data.total}` : '';
  $('#nav-count').textContent = data.stats.total;
}
async function refreshCurrent() {
  if (!state.currentIDs.length) return;
  const jobs = await Promise.all(state.currentIDs.map(id => api(`/api/jobs/${id}`)));
  state.currentJobs = jobs;
  $('#welcome').hidden = true; $('#current-section').hidden = false;
  $('#current-count').textContent = `${jobs.filter(j => j.status === 'succeeded').length} / ${jobs.length}`;
  renderGallery('#current-grid', jobs);
}
function showConnectionError(error) { $('#connection').textContent = '连接异常'; $('#banner').textContent = `读取服务失败：${error.message}。页面会自动重连。`; $('#banner').hidden = false; }
async function refresh() {
  if (state.refreshing || document.hidden) return;
  state.refreshing = true;
  try {
    await Promise.all([refreshRecent(), refreshCurrent(), ...(state.view === 'history' ? [refreshHistory()] : [])]);
    if (state.configured) { $('#connection').textContent = '服务已连接'; $('#banner').hidden = true; }
  } catch (error) { showConnectionError(error); } finally { state.refreshing = false; }
}
async function showDetail(id) {
  try {
    const j = await api(`/api/jobs/${id}`);
    const seconds = j.started_at && j.finished_at ? `${((new Date(j.finished_at) - new Date(j.started_at)) / 1000).toFixed(1)} 秒` : '—';
    const pictures = j.images.map(p => `<img src="${p.url}" alt="${escapeHTML(j.prompt)}">`).join('');
    const metadata = [['创作模式', j.mode === 'edit' ? '参考图编辑' : '文字生图'], ['请求模型', j.model], ['返回模型', j.actual_model || '—'], ['画面设定', j.ratio === 'auto' ? '自动 / 默认' : `${j.ratio} · ${j.resolution === 'default' ? '默认分辨率' : j.resolution}`], ['实际图片', j.images.map(p => `${p.width} × ${p.height} · ${p.mime.split('/')[1].toUpperCase()} · ${(p.bytes / 1048576).toFixed(2)} MB`).join('；') || '—'], ['生成耗时', seconds], ['创建时间', new Date(j.created_at).toLocaleString('zh-CN')], ['响应质量', j.quality || '—'], ['请求 ID', j.request_id || '—'], ['任务 ID', j.id]];
    $('#detail-body').innerHTML = `<div class="detail-layout"><div class="detail-image">${pictures || `<span class="queued-icon">${j.status === 'failed' ? '↻' : '◷'}</span><span>${statusNames[j.status]}</span>`}</div><div class="detail-info"><span class="eyebrow">${statusNames[j.status]}</span><h3>一瞬灵感，一张作品。</h3><p>${escapeHTML(j.prompt)}</p>${j.error ? `<div class="detail-error">${escapeHTML(j.error)}</div>` : ''}<dl class="detail-meta">${metadata.map(([k, v]) => `<dt>${k}</dt><dd>${escapeHTML(v)}</dd>`).join('')}</dl><details><summary>实际发送的提示词与接口</summary><p>${escapeHTML(j.effective_prompt)}</p><p>${escapeHTML(j.endpoint || '尚未调用')}</p></details><div class="detail-actions">${j.images.map((p, index) => `<a class="primary" href="${p.url}?download=1" download>↓ 下载原图${j.images.length > 1 ? index + 1 : ''}</a>`).join('')}<button class="secondary" id="reuse-job">${j.status === 'failed' ? '重试这次创作' : '复用参数'}</button>${j.images.length ? '<button class="secondary" id="edit-result">▧ 继续编辑</button>' : ''}</div></div></div>`;
    if (!$('#detail').open) $('#detail').showModal();
    $('#reuse-job').onclick = () => reuseJob(j);
    if ($('#edit-result')) $('#edit-result').onclick = () => editResult(j);
  } catch (error) { toast(error.message); }
}
async function fetchImageFile(url, name) {
  const response = await fetch(url); if (!response.ok) throw new Error('读取参考图失败');
  const blob = await response.blob(); return new File([blob], name, { type: blob.type });
}
async function reuseJob(j) {
  try {
    const file = j.mode === 'edit' ? await fetchImageFile(`/api/jobs/${j.id}/input`, 'reference') : null;
    state.mode = j.mode; selectSingleModel(j.model); updateControls(); setRatio(j.ratio); $('#gemini-preset').value = j.resolution;
    setReference(file); setView('studio'); setPrompt(j.prompt); $('#detail').close();
    toast('已填入参数，点击生成后才会发起新请求'); window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (error) { toast(error.message); }
}
async function editResult(j) {
  try {
    const file = await fetchImageFile(j.images[0].url, 'reference');
    if (!setReference(file)) return;
    selectSingleModel(j.model.startsWith('gemini-') ? 'gemini-3.1-flash-image' : 'gpt-image-2');
    setMode('edit'); setView('studio'); setPrompt('');
    $('#detail').close(); toast('已载入参考图，请描述需要修改的内容'); window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (error) { toast(error.message); }
}
$('#create-form').addEventListener('submit', async event => {
  event.preventDefault(); if (state.busy || polishing) return;
  $('#form-error').hidden = true;
  if (state.mode === 'edit' && !state.reference) { $('#form-error').textContent = '请先上传参考图片'; $('#form-error').hidden = false; return; }
  const selections = selectedModels();
  if (!selections.length) { toast('请至少选择一个模型'); return; }
  const gemini = selections.every(item => item.model.startsWith('gemini-'));
  const resolution = gemini && state.mode !== 'edit' ? $('#gemini-preset').value : 'default';
  const ratio = state.mode === 'edit' ? 'auto' : gemini ? resolution === '2K' ? '16:9' : 'auto' : state.ratio;
  const form = new FormData();
  for (const [key, value] of Object.entries({ mode: state.mode, models: JSON.stringify(selections), prompt: $('#prompt').value, ratio, resolution })) form.append(key, value);
  if (state.mode === 'edit') form.append('image', state.reference);
  state.busy = true; updateControls();
  try {
    const data = await api('/api/jobs', { method: 'POST', body: form });
    state.currentIDs = data.ids;
    try { localStorage.setItem('qiso-current-jobs', JSON.stringify(data.ids)); } catch { /* Storage is optional. */ }
    setView('studio'); toast('创作已加入队列，历史记录已保存');
    await refresh();
    if (innerWidth <= 640) $('#current-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) { $('#form-error').textContent = error.message; $('#form-error').hidden = false; }
  finally { state.busy = false; updateControls(); }
});
document.addEventListener('click', event => {
  const button = event.target.closest('button');
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
$('#multi-model').addEventListener('toggle', () => {
  if ($('#multi-model').open) {
    $$('[name="selected-model"]').forEach(input => { input.checked = input.value === $('#single-model').value; });
    $$('[data-count]').forEach(input => { input.value = input.dataset.count === $('#single-model').value ? $('#single-count').value : '1'; });
  }
  updateControls();
});
$('#inspire').onclick = () => setPrompt(ideas[Math.floor(Math.random() * ideas.length)]);
$('#try-example').onclick = () => { setMode('generate'); setPrompt(ideas[0]); if (innerWidth <= 640) window.scrollTo({ top: 0, behavior: 'smooth' }); };
$('#reference').onchange = event => { const file = event.target.files[0]; if (file && !setReference(file)) event.target.value = ''; };
$('#clear-reference').onclick = () => setReference(null);
$('#drop-zone').addEventListener('dragover', event => { event.preventDefault(); $('#drop-zone').classList.add('dragging'); });
$('#drop-zone').addEventListener('dragleave', () => $('#drop-zone').classList.remove('dragging'));
$('#drop-zone').addEventListener('drop', event => { event.preventDefault(); $('#drop-zone').classList.remove('dragging'); if (event.dataTransfer.files[0]) setReference(event.dataTransfer.files[0]); });
$('#previous-page').onclick = () => { state.page--; refreshHistory().catch(showConnectionError); };
$('#next-page').onclick = () => { state.page++; refreshHistory().catch(showConnectionError); };
let searchTimer;
$('#search').addEventListener('input', event => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { state.search = event.target.value; state.page = 1; refreshHistory().catch(showConnectionError); }, 300); });
$('#capabilities').onclick = () => $('#capability-dialog').showModal();
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
async function init() {
  try {
    const config = await api('/api/config'); state.configured = config.configured;
    $('#connection').textContent = config.configured ? '服务已连接' : '待配置密钥';
    if (!config.configured) { $('#banner').textContent = '网站已就绪。请在服务端 .env 中配置 QISO_API_KEY 并重启，即可开始真实创作。'; $('#banner').hidden = false; }
    try { const ids = JSON.parse(localStorage.getItem('qiso-current-jobs') || '[]'); if (Array.isArray(ids)) state.currentIDs = ids.filter(id => /^[a-f0-9]{32}$/.test(id)).slice(0, 20); } catch { /* Ignore invalid local preferences. */ }
    if (state.currentIDs.length) { const results = await Promise.all(state.currentIDs.map(id => api(`/api/jobs/${id}`).then(() => id).catch(() => null))); state.currentIDs = results.filter(Boolean); }
    updateControls(); if (location.hash === '#history') setView('history'); await refresh();
  } catch (error) { showConnectionError(error); }
  setInterval(async () => { if (!state.configured) { try { const config = await api('/api/config'); state.configured = config.configured; updateControls(); } catch {} } await refresh(); }, 4000);
}
updateControls();
init();
