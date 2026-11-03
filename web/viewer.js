'use strict';
const viewer = { items: [], index: 0, scale: 'fit', loader: null, version: 0, compare: false, original: false };
function previewItems(job, key) {
  const entry = (picture, label, owner = job) => ({ picture: { ...picture, preview_url: picture.preview_url || `/api/images/${picture.id}/preview/1` }, label,
    comparison: owner.input_picture && owner.images.length ? { before: owner.input_picture, after: picture } : null });
  if (key === 'input' || key === 'reference') return [[job.input_picture, '基础图'], [job.reference_picture, '参考图'], ...job.images.map(p => [p, '生成结果'])]
    .filter(([p]) => p).map(([p, label]) => ({ ...entry(p, label), comparison: null }));
  const pool = state.view === 'history' ? state.jobs : state.view === 'admin' ? (adminState.requestJobs || []) : [...state.currentJobs, ...state.recent];
  const jobs = pool.some(item => item.id === job.id) ? pool.map(item => item.id === job.id ? job : item) : [job];
  const seen = new Set();
  return jobs.flatMap(item => item.images.map(p => entry(p, `${modelNames[item.model]} · ${item.prompt}`, item)))
    .filter(item => { if (seen.has(item.picture.id)) return false; seen.add(item.picture.id); return true; });
}
function cancelOriginalLoad() {
  if (viewer.loader) { viewer.loader.onload = viewer.loader.onerror = null; viewer.loader.removeAttribute('src'); viewer.loader = null; }
}
function fitPreview() {
  const img = $('#image-preview-picture'), stage = $('#preview-stage');
  if (!img.naturalWidth || stage.hidden) return;
  const scale = viewer.scale === 'fit' ? Math.min(1, (stage.clientWidth - 24) / img.naturalWidth, (stage.clientHeight - 24) / img.naturalHeight) : viewer.scale;
  img.style.width = `${Math.max(1, img.naturalWidth * scale)}px`; img.style.height = `${Math.max(1, img.naturalHeight * scale)}px`;
  $('#preview-scale').textContent = `${Math.round(scale * 100)}%${viewer.scale === 'fit' ? ' · 适应窗口' : ''}`;
}
function setPreviewScale(value) {
  viewer.scale = value; fitPreview();
  const stage = $('#preview-stage'); stage.scrollLeft = Math.max(0, (stage.scrollWidth - stage.clientWidth) / 2); stage.scrollTop = Math.max(0, (stage.scrollHeight - stage.clientHeight) / 2);
}
function zoomPreview(direction) {
  const img = $('#image-preview-picture');
  const current = viewer.scale === 'fit' ? img.clientWidth / (img.naturalWidth || 1) : viewer.scale;
  setPreviewScale(Math.min(4, Math.max(.1, current * (direction > 0 ? 1.25 : .8))));
}
function setComparison(compare) {
  const item = viewer.items[viewer.index];
  viewer.compare = compare && !!item?.comparison;
  $('#preview-stage').hidden = viewer.compare; $('#comparison-grid').hidden = !viewer.compare;
  $('#preview-compare').setAttribute('aria-pressed', String(viewer.compare));
  $('#preview-compare').textContent = viewer.compare ? '返回单图' : '对比基础图与结果';
  $('#view-original').hidden = viewer.compare; $('#preview-scale').hidden = viewer.compare;
  $('#image-preview-status').textContent = viewer.compare ? '基础图与生成结果对比 · 高清预览' : viewer.original ? '当前展示原图；100% 为原图像素大小' : '当前展示高清预览；放大后可拖动查看细节';
  for (const id of ['preview-zoom-in','preview-zoom-out','preview-fit','preview-actual']) $(`#${id}`).disabled = viewer.compare;
  if (viewer.compare) {
    $('#comparison-before').src = item.comparison.before.preview_url;
    $('#comparison-after').src = item.comparison.after.preview_url;
  } else { $('#comparison-before').removeAttribute('src'); $('#comparison-after').removeAttribute('src'); fitPreview(); }
}
function renderPreview() {
  cancelOriginalLoad(); viewer.version++; viewer.original = false; viewer.scale = 'fit';
  const item = viewer.items[viewer.index], {picture, label} = item;
  const img = $('#image-preview-picture'), button = $('#view-original');
  $('#preview-label').textContent = label;
  $('#preview-position').textContent = `${viewer.index + 1} / ${viewer.items.length}`;
  $('#preview-prev').disabled = viewer.index === 0; $('#preview-next').disabled = viewer.index === viewer.items.length - 1;
  $('#preview-compare').hidden = !item.comparison;
  setComparison(false);
  img.onload = fitPreview;
  img.onerror = () => { $('#image-preview-status').textContent = '预览加载失败，可尝试查看原图或关闭后重新打开。'; };
  img.src = picture.preview_url; img.alt = label;
  button.textContent = `查看原图（${(picture.bytes / 1048576).toFixed(2)} MB）`; button.disabled = false;
  $('#image-preview-status').textContent = '当前展示高清预览；放大后可拖动查看细节';
  fitPreview();
}
function showImagePreview(picture, prompt, items) {
  viewer.items = items?.length ? items : [{picture, label:prompt}];
  viewer.index = Math.max(0, viewer.items.findIndex(item => item.picture.url === picture.url && item.label === prompt));
  if (items?.length) { const index = viewer.items.findIndex(item => item.picture.id === picture.id && item.picture.url === picture.url); if (index >= 0) viewer.index = index; }
  if (!$('#image-preview').open) $('#image-preview').showModal();
  renderPreview();
}
function movePreview(step) {
  const next = viewer.index + step;
  if (next < 0 || next >= viewer.items.length) return;
  viewer.index = next; renderPreview();
}
$('#preview-prev').onclick = () => movePreview(-1);
$('#preview-next').onclick = () => movePreview(1);
$('#preview-fit').onclick = () => setPreviewScale('fit');
$('#preview-actual').onclick = () => setPreviewScale(1);
$('#preview-zoom-in').onclick = () => zoomPreview(1);
$('#preview-zoom-out').onclick = () => zoomPreview(-1);
$('#preview-compare').onclick = () => setComparison(!viewer.compare);
$('#view-original').onclick = () => {
  const button = $('#view-original'); if (button.disabled) return;
  const version = viewer.version, item = viewer.items[viewer.index], loader = new Image();
  viewer.loader = loader; button.disabled = true; button.textContent = '正在加载原图…';
  $('#image-preview-status').textContent = '原图加载中，暂时保留高清预览';
  loader.onload = () => {
    if (viewer.loader !== loader || version !== viewer.version || !$('#image-preview').open) return;
    viewer.loader = null; viewer.original = true;
    $('#image-preview-picture').src = item.picture.url;
    button.textContent = '已显示原图'; if (!viewer.compare) $('#image-preview-status').textContent = '当前展示原图；100% 为原图像素大小';
  };
  loader.onerror = () => {
    if (viewer.loader !== loader || version !== viewer.version) return;
    viewer.loader = null; button.disabled = false; button.textContent = '重新加载原图';
    $('#image-preview-status').textContent = '原图加载失败，仍展示高清预览；未自动重试';
  };
  loader.src = item.picture.url;
};
$('#image-preview').addEventListener('close', () => {
  if ($('#image-preview').open) return;
  cancelOriginalLoad(); viewer.version++;
  for (const id of ['image-preview-picture','comparison-before','comparison-after']) $(`#${id}`).removeAttribute('src');
});
$('#image-preview').addEventListener('keydown', event => {
  if (event.target.matches('input,textarea,select') || event.altKey || event.ctrlKey || event.metaKey) return;
  const action = { ArrowLeft: () => movePreview(-1), ArrowRight: () => movePreview(1), '+': () => zoomPreview(1), '=': () => zoomPreview(1), '-': () => zoomPreview(-1), '0': () => setPreviewScale('fit') }[event.key];
  if (action && (!viewer.compare || ['ArrowLeft', 'ArrowRight'].includes(event.key))) { event.preventDefault(); action(); }
});
let previewDrag;
$('#preview-stage').addEventListener('pointerdown', event => {
  if (event.pointerType !== 'mouse' || event.button !== 0) return;
  const stage = event.currentTarget;
  previewDrag = {x:event.clientX,y:event.clientY,left:stage.scrollLeft,top:stage.scrollTop};
  stage.setPointerCapture(event.pointerId); event.preventDefault();
});
$('#preview-stage').addEventListener('pointermove', event => {
  if (!previewDrag) return;
  event.currentTarget.scrollLeft = previewDrag.left - event.clientX + previewDrag.x;
  event.currentTarget.scrollTop = previewDrag.top - event.clientY + previewDrag.y;
});
for (const event of ['pointerup','pointercancel','lostpointercapture']) $('#preview-stage').addEventListener(event, () => { previewDrag = null; });
new ResizeObserver(() => { if ($('#image-preview').open) fitPreview(); }).observe($('#preview-stage'));
