'use strict';
const materialPicker = { slot: 'base', page: 1, version: 0, pictures: new Map() };
let materialSearchTimer;
async function loadMaterials() {
  const version = ++materialPicker.version;
  $('#material-status').textContent = '正在读取历史图片…';
  $('#material-grid').setAttribute('aria-busy', 'true');
  $('#material-prev').disabled = $('#material-next').disabled = true;
  try {
    const query = new URLSearchParams({ status: 'succeeded', page: materialPicker.page, q: $('#material-search').value });
    const data = await api(`/api/jobs?${query}`);
    if (version !== materialPicker.version || !$('#material-dialog').open) return;
    materialPicker.pictures = new Map();
    $('#material-grid').innerHTML = data.items.flatMap(job => job.images.map(picture => {
      materialPicker.pictures.set(picture.id, picture);
      const usable = ['image/png', 'image/jpeg'].includes(picture.mime) && picture.bytes <= 12 * 1024 * 1024;
      return `<button type="button" class="material-card" data-pick-image="${picture.id}" ${usable ? '' : 'disabled'}><img src="${escapeHTML(picture.thumbnail_url || picture.preview_url || picture.url)}" loading="lazy" alt="${escapeHTML(job.prompt)}"><span>${escapeHTML(job.prompt)}</span><small>${escapeHTML(modelNames[job.model])} · ${picture.width} × ${picture.height}</small><strong>${usable ? `用作${materialPicker.slot === 'base' ? '基础图' : '参考图'}` : '超过 12 MB 或格式不支持'}</strong></button>`;
    })).join('');
    const pages = Math.max(1, Math.ceil(data.total / data.page_size));
    $('#material-page').textContent = `${materialPicker.page} / ${pages}`;
    $('#material-prev').disabled = materialPicker.page <= 1;
    $('#material-next').disabled = materialPicker.page >= pages;
    $('#material-status').textContent = data.items.length ? '选择后仅载入素材，不会发起生成。' : '没有匹配的图片，请修改关键词或上传本地图片。';
  } catch (error) { if (version === materialPicker.version) $('#material-status').textContent = `读取失败：${error.message}，请点击重新加载。`; }
  finally { if (version === materialPicker.version) $('#material-grid').removeAttribute('aria-busy'); }
}
function openMaterialPicker(slot) {
  if (state.busy || state.materialBusy) return;
  materialPicker.slot = slot; materialPicker.page = 1;
  $('#material-title').textContent = `选择${slot === 'base' ? '基础图' : '参考图'}`;
  $('#material-grid').replaceChildren(); $('#material-search').value = '';
  $('#material-dialog').showModal(); void loadMaterials();
}
$('#choose-base-history').onclick = () => openMaterialPicker('base');
$('#choose-reference-history').onclick = () => openMaterialPicker('reference');
$('#material-dialog').addEventListener('close', () => { materialPicker.version++; clearTimeout(materialSearchTimer); if (state.materialBusy && referenceLoad) { referenceLoad.abort(); referenceLoad = null; $('#drop-zone').removeAttribute('aria-busy'); } });
$('#material-search').addEventListener('input', () => {
  clearTimeout(materialSearchTimer); materialPicker.version++;
  materialSearchTimer = setTimeout(() => { materialPicker.page = 1; void loadMaterials(); }, 300);
});
$('#material-reload').onclick = loadMaterials;
$('#material-prev').onclick = () => { materialPicker.page--; void loadMaterials(); };
$('#material-next').onclick = () => { materialPicker.page++; void loadMaterials(); };
$('#material-grid').onclick = async event => {
  const button = event.target.closest('[data-pick-image]');
  const picture = button && materialPicker.pictures.get(button.dataset.pickImage);
  if (!picture || state.materialBusy) return;
  state.materialBusy = true; updateControls(); button.disabled = true;
  const slot = materialPicker.slot;
  try {
    preserveDraft();
    if (await dropGalleryImage(slot, picture)) { $('#material-dialog').close(); setMode('edit'); }
  } finally { state.materialBusy = false; updateControls(); button.disabled = false; }
};
$('#swap-images').onclick = async () => {
  if (!state.base || !state.reference || state.busy || state.materialBusy || referenceLoad) return;
  const base = state.base, reference = state.reference;
  state.materialBusy = true; updateControls();
  try {
    const original = base.sourceID ? await fetchImageFile(`/api/images/${base.sourceID}`, 'reference') : base;
    if (state.base !== base || state.reference !== reference) throw new Error('素材已改变，请重新交换');
    preserveDraft(); setEditImage('base', reference); setEditImage('reference', original);
    toast('基础图与参考图已交换，请检查修改说明');
  } catch (error) { toast(error.message); }
  finally { state.materialBusy = false; updateControls(); }
};
