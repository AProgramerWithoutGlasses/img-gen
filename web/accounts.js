'use strict';
function localDateTime(date) {
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
function requestRange() {
  if (adminState.rangeDays !== null) {
    const end = new Date(), start = new Date(end);
    start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - adminState.rangeDays + 1);
    $('#request-start').value = localDateTime(start); $('#request-end').value = localDateTime(end);
    return { start: start.toISOString(), end: end.toISOString() };
  }
  const start = new Date($('#request-start').value), end = new Date($('#request-end').value);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start >= end) throw new Error('请选择有效的时间范围，结束时间须晚于开始时间');
  return { start: start.toISOString(), end: end.toISOString() };
}
function chooseDays(days, refresh = true) {
  adminState.rangeDays = days; adminState.requestPage = 1; requestRange();
  $$('[data-days]').forEach(button => { const selected = Number(button.dataset.days) === days; button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', String(selected)); });
  if (refresh) refreshAdmin().catch(showAdminError);
}
function requestRow(j) {
  const seconds = j.started_at && j.finished_at ? `${Math.max(0, (new Date(j.finished_at) - new Date(j.started_at)) / 1000).toFixed(1)} 秒` : '—';
  let result = `<span class="help">${escapeHTML(statusNames[j.status])}</span>`;
  if (j.status === 'failed') result = `<div class="request-failure">${escapeHTML(j.error || '生成失败')}</div>`;
  else if (j.images.length) result = `<div class="request-thumbnails">${j.images.map(p => `<button data-job="${j.id}" aria-label="查看生成图片"><img src="${p.url}" alt="生成结果缩略图" loading="lazy"></button>`).join('')}</div>`;
  return `<tr><td><strong>${escapeHTML(j.username)}</strong></td><td class="request-time">${escapeHTML(new Date(j.created_at).toLocaleString('zh-CN', {hour12:false}))}</td><td class="request-prompt"><button data-job="${j.id}" class="request-prompt-button" title="查看完整输入与结果">${escapeHTML(j.prompt)}</button><small>${escapeHTML(modelNames[j.model] || j.model)} · ${j.mode === 'edit' ? '参考图编辑' : '文字生图'}</small>${j.has_input ? `<button class="text-button" data-job="${j.id}">查看输入图片</button>` : ''}</td><td class="request-seconds">${seconds}</td><td class="request-credits">${escapeHTML(creditText(j))}</td><td><span class="request-status ${j.status}">${escapeHTML(statusNames[j.status])}</span></td><td class="request-result">${result}</td></tr>`;
}
function renderAccount() {
  if (!state.user) return;
  $('#menu-username').textContent = state.user.username;
  $('#menu-credits').textContent = `可用 ${state.user.credits} 积分`;
  $('#account-button').title = `${state.user.username} · ${state.user.credits} 积分`;
  $('#profile-info').innerHTML = [['用户名',state.user.username], ['角色',state.user.role === 'admin' ? '管理员' : '普通用户'], ['注册时间',new Date(state.user.created_at).toLocaleString('zh-CN')]].map(([k,v]) => `<dt>${k}</dt><dd>${escapeHTML(v)}</dd>`).join('');
  $('#profile-available').textContent = state.user.credits;
  $('#profile-held').textContent = state.user.credits_held ?? 0;
  $('#profile-spent').textContent = state.user.credits_spent ?? 0;
}
async function refreshWallet() {
  if (!state.user) return;
  const [u, prices] = await Promise.all([api('/api/auth/me'), api('/api/prices')]);
  state.user = u; state.prices = Object.fromEntries(prices.items.map(p => [p.model, p.credits]));
  renderAccount(); updateControls();
}
function closeAccountMenu() { $('#account-menu').hidden = true; $('#account-button').setAttribute('aria-expanded', 'false'); }
async function refreshLedger() {
  const data = await api(`/api/credits/ledger?page=${adminState.ledgerPage}`);
  const kinds = { reserve: '提交冻结', charge: '生成成功结算', refund: '失败退还', admin_adjustment: '管理员调整' };
  $('#ledger-body').innerHTML = data.items.map(e => `<tr><td>${escapeHTML(new Date(e.created_at).toLocaleString('zh-CN'))}</td><td>${kinds[e.kind] || escapeHTML(e.kind)}<small>${escapeHTML(e.note || (e.kind === 'charge' ? '从冻结积分结算' : ''))}</small></td><td>${e.delta > 0 ? '+' : ''}${e.delta}</td><td>${e.balance_after}</td></tr>`).join('');
  $('#ledger-empty').hidden = data.items.length > 0; paginate('ledger', data);
}
function openCredits(u) {
  adminState.creditUser = u; adminState.adjustment = null;
  $('#credits-form').reset(); $('#credits-error').hidden = true;
  $('#credits-user').textContent = `${u.username} · 可用 ${u.credits} 积分`;
  $('#credits-dialog').showModal();
}
async function savePrice(button) {
  const model = button.dataset.savePrice, input = $(`[data-price="${model}"]`);
  if (!input.reportValidity() || input.value === '') return;
  const credits = Number(input.value), previous = adminState.prices.find(p => p.model === model);
  button.disabled = true;
  try {
    await api(`/api/admin/prices/${encodeURIComponent(model)}`, jsonOptions('PATCH', { credits, version: previous.version }));
    toast('价格已保存，仅影响新提交的任务'); await refreshAdmin(); await refreshWallet();
  } finally { button.disabled = false; }
}
const adminState = { tab: 'users', users: [], userPage: 1, requestPage: 1, editID: null, userID: '', version: 0, rangeDays: 1, prices: [], creditUser: null, adjustment: null, ledgerPage: 1 };
function showAdminError(error) { $('#admin-error').textContent = error.message; $('#admin-error').hidden = false; }
function jsonOptions(method, body) { return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }; }
async function submitAccountForm(form, errorNode, action) {
  const button = $('button[type="submit"]', form); if (button.disabled) return;
  button.disabled = true; errorNode.hidden = true;
  try { await action(); } catch (error) { errorNode.textContent = error.message; errorNode.hidden = false; } finally { button.disabled = false; }
}
$('#login-form').onsubmit = event => {
  event.preventDefault();
  submitAccountForm(event.target, $('#login-error'), async () => {
    await api('/api/auth/login', jsonOptions('POST', { username: $('#login-username').value.trim(), password: $('#login-password').value }));
    location.reload();
  });
};
$('#logout').onclick = async () => { try { await api('/api/auth/logout', { method: 'POST' }); location.replace('/'); } catch (error) { toast(error.message); } };
$('#password-open').onclick = () => { closeAccountMenu(); $('#password-form').reset(); $('#password-username').value = state.user.username; $('#password-error').hidden = true; $('#password-dialog').showModal(); };
$('#password-form').onsubmit = event => {
  event.preventDefault();
  submitAccountForm(event.target, $('#password-error'), async () => {
    await api('/api/auth/password', jsonOptions('POST', { current_password: $('#current-password').value, password: $('#new-password').value }));
    location.replace('/');
  });
};
function paginate(prefix, data) {
  const pages = Math.max(1, Math.ceil(data.total / data.page_size));
  $(`#${prefix}-page`).textContent = `${data.page} / ${pages} · 共 ${data.total} 条`;
  $(`#${prefix}-prev`).disabled = data.page <= 1; $(`#${prefix}-next`).disabled = data.page >= pages;
}
function adminTab(tab) {
  adminState.tab = tab;
  $('#admin-users').hidden = tab !== 'users'; $('#admin-requests').hidden = tab !== 'requests'; $('#admin-prices').hidden = tab !== 'prices';
  $$('[data-admin-tab]').forEach(button => button.classList.toggle('selected', button.dataset.adminTab === tab));
  refreshAdmin().catch(showAdminError);
}
async function refreshAdmin() {
  if (state.user?.role !== 'admin') return;
  const version = ++adminState.version;
  $('#admin-error').hidden = true;
  if (adminState.tab === 'users') {
    const query = new URLSearchParams({ page: adminState.userPage, q: $('#user-search').value });
    const data = await api(`/api/admin/users?${query}`);
    if (version !== adminState.version) return;
    adminState.users = data.items;
    $('#users-body').innerHTML = data.items.map(u => `<tr><td><strong>${escapeHTML(u.username)}</strong>${u.id === state.user.id ? '<small>当前账号</small>' : ''}</td><td>${u.role === 'admin' ? '管理员' : '普通用户'}</td><td><span class="user-status ${u.active ? '' : 'inactive'}">${u.active ? '启用' : '已停用'}</span></td><td>${u.credits}</td><td>${escapeHTML(new Date(u.created_at).toLocaleString('zh-CN'))}</td><td><div class="user-actions"><button class="secondary" data-edit-user="${u.id}">管理</button><button class="secondary" data-user-credits="${u.id}">积分</button><button class="text-button" data-user-requests="${u.id}">请求记录 ↗</button></div></td></tr>`).join('');
    $('#users-empty').hidden = data.items.length > 0; paginate('users', data);
  } else if (adminState.tab === 'prices') {
    const data = await api('/api/admin/prices');
    if (version !== adminState.version) return;
    adminState.prices = data.items;
    $('#prices-body').innerHTML = data.items.map(p => `<tr><td><strong>${escapeHTML(modelNames[p.model] || p.model)}</strong><small>${escapeHTML(p.model)}</small></td><td><input type="number" min="0" max="1000000" step="1" value="${p.credits}" data-price="${p.model}" aria-label="${escapeHTML(modelNames[p.model])} 单张积分"></td><td>${escapeHTML(new Date(p.updated_at).toLocaleString('zh-CN'))}</td><td><button class="secondary" data-save-price="${p.model}">保存价格</button></td></tr>`).join('');
  } else {
    const range = requestRange();
    const query = new URLSearchParams({ page: adminState.requestPage, username: $('#request-user').value, q: $('#request-query').value, status: $('#request-status').value, user_id: $('#request-scope').value || adminState.userID, start: range.start, end: range.end });
    const data = await api(`/api/admin/jobs?${query}`);
    if (version !== adminState.version) return;
    const signature = JSON.stringify(data.items);
    if ($('#requests-body').dataset.signature !== signature) {
      $('#requests-body').innerHTML = data.items.map(requestRow).join('');
      $('#requests-body').dataset.signature = signature;
    }
    $('#requests-summary').textContent = `匹配 ${data.total} 条请求 · 已完成 ${data.stats.succeeded} · 处理中 ${data.stats.active} · 失败 ${data.stats.failed}。点击提示词或图片查看详情。`;
    $('#requests-empty').hidden = data.items.length > 0; paginate('requests', data);
  }
}
function userForm(u) {
  adminState.editID = u?.id || null;
  $('#user-form').reset(); $('#user-error').hidden = true;
  $('#user-title').textContent = u ? `管理 ${u.username}` : '创建用户';
  $('#user-username').value = u?.username || ''; $('#user-username').disabled = !!u;
  $('#user-role').value = u?.role || 'user'; $('#user-active').value = String(u?.active ?? true); $('#user-active').disabled = !u;
  $('#user-password-label').textContent = u ? '重置密码（留空则保留）' : '初始密码';
  $('#user-password').required = !u;
  $('#user-dialog').showModal();
}
$('#add-user').onclick = () => userForm(null);
$('#user-form').onsubmit = event => {
  event.preventDefault();
  submitAccountForm(event.target, $('#user-error'), async () => {
    const id = adminState.editID;
    const body = { role: $('#user-role').value };
    if (id) { body.active = $('#user-active').value === 'true'; if ($('#user-password').value) body.password = $('#user-password').value; }
    else { body.username = $('#user-username').value; body.password = $('#user-password').value; }
    await api(id ? `/api/admin/users/${id}` : '/api/admin/users', jsonOptions(id ? 'PATCH' : 'POST', body));
    $('#user-dialog').close(); $('#user-password').value = '';
    if (id === state.user.id) { location.reload(); return; }
    toast(id ? '用户已更新，旧登录会话已失效' : '用户已创建'); await refreshAdmin();
  });
};
document.addEventListener('click', event => {
  const button = event.target.closest('button'); if (!button) return;
  if (button.dataset.adminTab) adminTab(button.dataset.adminTab);
  if (button.dataset.editUser) userForm(adminState.users.find(u => u.id === button.dataset.editUser));
  if (button.dataset.userCredits) openCredits(adminState.users.find(u => u.id === button.dataset.userCredits));
  if (button.dataset.savePrice) savePrice(button).catch(showAdminError);
  if (button.dataset.days) chooseDays(Number(button.dataset.days));
  if (button.dataset.userRequests) {
    const u = adminState.users.find(u => u.id === button.dataset.userRequests);
    $('#requests-filter').reset(); chooseDays(1, false); $('#request-user').value = u.username;
    adminState.userID = u.id; adminState.requestPage = 1; adminTab('requests');
  }
});
$('#user-search-form').onsubmit = event => { event.preventDefault(); adminState.userPage = 1; refreshAdmin().catch(showAdminError); };
$('#requests-filter').onsubmit = event => { event.preventDefault(); adminState.userID = ''; adminState.requestPage = 1; refreshAdmin().catch(showAdminError); };
$('#requests-reset').onclick = () => { $('#requests-filter').reset(); chooseDays(1, false); adminState.userID = ''; adminState.requestPage = 1; refreshAdmin().catch(showAdminError); };
for (const [prefix, field] of [['users', 'userPage'], ['requests', 'requestPage']]) {
  $(`#${prefix}-prev`).onclick = () => { adminState[field]--; refreshAdmin().catch(showAdminError); };
  $(`#${prefix}-next`).onclick = () => { adminState[field]++; refreshAdmin().catch(showAdminError); };
}
// Refresh request status while the administrator is viewing the request log.
let adminRefreshing = false;
setInterval(async () => {
  if (document.hidden || state.view !== 'admin' || adminState.tab !== 'requests' || adminRefreshing) return;
  adminRefreshing = true;
  try { await refreshAdmin(); } catch (error) { showAdminError(error); } finally { adminRefreshing = false; }
}, 6000);
$('#account-button').onclick = () => {
  const open = $('#account-menu').hidden;
  $('#account-menu').hidden = !open; $('#account-button').setAttribute('aria-expanded', String(open));
  if (open) $('#profile-open').focus();
};
document.addEventListener('click', event => { if (!event.target.closest('.account-menu-wrap')) closeAccountMenu(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !$('#account-menu').hidden) { closeAccountMenu(); $('#account-button').focus(); } });
$('#profile-open').onclick = async () => {
  closeAccountMenu(); adminState.ledgerPage = 1;
  try { await refreshWallet(); await refreshLedger(); $('#profile-dialog').showModal(); } catch (error) { toast(error.message); }
};
for (const id of ['recharge-open', 'profile-recharge']) $( `#${id}`).onclick = () => { closeAccountMenu(); $('#recharge-dialog').showModal(); };
$('#ledger-prev').onclick = () => { adminState.ledgerPage--; refreshLedger().catch(error => toast(error.message)); };
$('#ledger-next').onclick = () => { adminState.ledgerPage++; refreshLedger().catch(error => toast(error.message)); };
$('#credits-form').onsubmit = event => {
  event.preventDefault();
  submitAccountForm(event.target, $('#credits-error'), async () => {
    const delta = Number($('#credits-delta').value), note = $('#credits-note').value.trim();
    if (!Number.isSafeInteger(delta) || delta === 0) throw new Error('请输入非零整数积分');
    const existing = adminState.adjustment;
    if (!existing || existing.delta !== delta || existing.note !== note) adminState.adjustment = { delta, note, request_id: Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('') };
    await api(`/api/admin/users/${adminState.creditUser.id}/credits`, jsonOptions('POST', adminState.adjustment));
    $('#credits-dialog').close(); toast('积分已调整，流水已保存'); await refreshAdmin(); await refreshWallet();
  });
};
$('#prices-refresh').onclick = () => refreshAdmin().catch(showAdminError);
for (const id of ['request-start','request-end']) $(`#${id}`).addEventListener('input', () => {
  adminState.rangeDays = null;
  $$('[data-days]').forEach(button => { button.classList.remove('selected'); button.setAttribute('aria-pressed', 'false'); });
});
chooseDays(1, false);
init();
