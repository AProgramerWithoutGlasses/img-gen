'use strict';
// Text is saved synchronously; image blobs stay in IndexedDB rather than base64 localStorage.
let draftReady = false, draftRestoring = false, draftUndo = null, draftDB;
let draftImages = [undefined, undefined], draftWrites = Promise.resolve();
const draftKey = () => `qiso-draft:v1:${state.user.id}`;
function draftDatabase() {
  if (!draftDB) draftDB = new Promise((resolve, reject) => {
    const request = indexedDB.open('qiso-drafts', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('images');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return draftDB;
}
async function imageDraft(key, value, write = false) {
  const db = await draftDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('images', write ? 'readwrite' : 'readonly');
    const request = write ? tx.objectStore('images').put(value, key) : tx.objectStore('images').get(key);
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = tx.onabort = () => reject(tx.error || new Error('图片草稿保存失败'));
  });
}
function captureDraft() {
  return { version: 1, prompt: $('#prompt').value, mode: state.mode, ratio: state.ratio,
    preset: state.preferredPreset, model: $('#single-model').value, count: $('#single-count').value,
    multiple: $('#multi-model').open, selections: $$('[name="selected-model"]').map(input => ({ model: input.value,
      checked: input.checked, count: $(`[data-count="${input.value}"]`).value })),
    base: state.base, reference: state.reference };
}
function draftMessage(text) { $('#draft-status').textContent = text; }
function saveDraft() {
  if (!draftReady || draftRestoring || !state.user) return;
  const draft = captureDraft(), key = draftKey();
  const { base, reference, ...text } = draft;
  const changed = base !== draftImages[0] || reference !== draftImages[1];
  try { localStorage.setItem(key, JSON.stringify(text)); }
  catch { draftMessage('无法保存草稿，请在离开前自行复制提示词。'); return; }
  if (!changed) return;
  draftImages = [base, reference];
  draftMessage('正在保存图片草稿…');
  draftWrites = draftWrites.catch(() => {}).then(() => imageDraft(key, { base, reference }, true))
    .then(() => { if (draftKey() === key) draftMessage('草稿已自动保存在此浏览器'); })
    .catch(() => { draftImages = [undefined, undefined]; draftMessage('文字已保存，图片草稿保存失败；刷新后可能需要重新选择图片。'); });
}
function rememberDraft() {
  if (!draftReady || draftRestoring) return;
  draftUndo = captureDraft();
  $('#undo-draft').hidden = false;
  const key = draftKey(), snapshot = draftUndo;
  draftWrites = draftWrites.catch(() => {}).then(() => imageDraft(key + ':undo', snapshot, true)).catch(() => {});
}
function applyDraft(draft) {
  if (!draft || draft.version !== 1) return;
  draftRestoring = true;
  try {
    $('#single-model').value = modelNames[draft.model] ? draft.model : 'gpt-image-2';
    $('#single-count').value = ['1','2','3','4'].includes(String(draft.count)) ? draft.count : '1';
    multiModelInitialized = true;
    for (const input of $$('[name="selected-model"]')) {
      const selection = draft.selections?.find(item => item.model === input.value);
      input.checked = !!selection?.checked;
      $(`[data-count="${input.value}"]`).value = ['1','2','3','4'].includes(String(selection?.count)) ? selection.count : '1';
    }
    $('#multi-model').open = !!draft.multiple;
    setMode(draft.mode === 'edit' ? 'edit' : 'generate');
    setRatio(['auto','1:1','16:9','9:16','3:2'].includes(draft.ratio) ? draft.ratio : 'auto');
    state.preferredPreset = ['default','1K','2K','4K'].includes(draft.preset) ? draft.preset : 'default';
    $('#prompt').value = typeof draft.prompt === 'string' ? draft.prompt.slice(0, 6000) : '';
    setEditImage('base', draft.base || null); setEditImage('reference', draft.reference || null);
    updateCount(); updateControls();
  } finally { draftRestoring = false; }
}
async function restoreDraft() {
  let failed = false;
  try {
    const saved = localStorage.getItem(draftKey());
    if (saved) {
      const draft = JSON.parse(saved);
      try { Object.assign(draft, await imageDraft(draftKey()) || {}); }
      catch { failed = true; }
      applyDraft(draft);
    }
  } catch { failed = true; }
  try { draftUndo = await imageDraft(draftKey() + ':undo'); $('#undo-draft').hidden = !draftUndo; } catch { /* In-session undo still works without IndexedDB. */ }
  draftImages = [state.base, state.reference]; draftReady = true;
  $('.composer').inert = false;
  draftMessage(failed ? '草稿未完整恢复，请检查文字与图片后再提交。' : '草稿自动保存在此浏览器，仅当前账号可恢复');
}
$('#undo-draft').onclick = () => {
  if (!draftUndo || state.busy) return;
  const previous = draftUndo; draftUndo = null;
  const key = draftKey();
  draftWrites = draftWrites.catch(() => {}).then(() => imageDraft(key + ':undo', null, true)).catch(() => {});
  applyDraft(previous); saveDraft(); $('#undo-draft').hidden = true;
  setView('studio'); toast('已恢复替换前的草稿');
};
$('#create-form').addEventListener('input', saveDraft);
$('#create-form').addEventListener('change', saveDraft);
window.addEventListener('pagehide', saveDraft);

$('#new-creation').onclick = () => {
  if (state.busy || state.materialBusy || !draftReady) return;
  preserveDraft();
  applyDraft({ version: 1, prompt: '', mode: 'generate', ratio: 'auto', preset: 'default', model: 'gpt-image-2', count: '1',
    multiple: false, selections: [{model: 'gpt-image-2', checked: true, count: '1'}], base: null, reference: null });
  saveDraft(); setView('studio'); $('#prompt').focus();
  window.scrollTo({top: 0, behavior: 'smooth'});
  toast('已新建空白草稿，可点击“撤销替换”恢复上一份');
};
