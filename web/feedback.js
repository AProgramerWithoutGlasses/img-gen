'use strict';
function failureAdvice(job) {
  const error = job.error || '';
  let message = '本次未能完成，暂时无法确认具体原因。请将诊断摘要交给管理员排查后，再决定是否重新提交。';
  if (/PROHIBITED_CONTENT|内容.*(拦截|检查)|安全.*拦截/i.test(error)) message = '内容检查未通过。请调整提示词或更换图片，再手动提交。';
  else if (/HTTP\s*(401|403)|权限|密钥/i.test(error) && !/HTTP\s*400/i.test(error)) message = '上游认证或权限检查未通过，请联系管理员检查服务配置。';
  else if (/HTTP\s*429|限流|请求过多/i.test(error)) message = '上游请求过于频繁。请稍后再手动提交，避免连续重复操作。';
  else if (/超时|timeout|deadline|重启|中断/i.test(error)) message = '请求超时或处理中断，无法确认上游是否已完成或计费。请先核对任务记录，再决定是否重新提交。';
  else if (/HTTP\s*400/i.test(error)) message = '上游未接受本次请求，具体原因尚未确认。请检查图片和提示词，或将诊断摘要交给管理员；不要连续重复提交相同内容。';
  else if (/保存.*失败|持久化|数据库|磁盘/i.test(error)) message = '结果保存失败，上游可能已经完成并计费。请联系管理员检查存储后再决定是否重新提交。';
  const credits = job.credits_state === 'refunded' ? `本站已退还 ${job.credits_cost} 积分；不代表上游退费。`
    : job.credits_state === 'reserved' ? `本站仍冻结 ${job.credits_cost} 积分，请刷新查看结算状态。`
    : creditText(job);
  return { message, credits };
}
function diagnosticSummary(job) {
  // Deliberately omit prompts, image URLs, credentials and upstream response bodies.
  return [`任务 ID：${job.id}`, `请求 ID：${job.request_id || '上游未提供，请使用任务 ID 排查'}`,
    `状态：${statusNames[job.status] || job.status}`, `模型：${modelNames[job.model] || job.model}`,
    `模式：${job.mode === 'edit' ? '参考图编辑' : '文字生图'}`, `创建时间：${job.created_at}`,
    `积分：${creditText(job)}`].join('\n');
}
function failureMarkup(job) {
  const advice = failureAdvice(job);
  return `<div class="detail-error"><strong>本次创作未完成</strong><p>${escapeHTML(advice.message)}</p><p>${escapeHTML(advice.credits)}</p><p>没有自动重试。重新提交可能产生新的费用。</p><details><summary>技术信息</summary><p>${escapeHTML(job.error || "未提供详细错误")}</p></details></div>`;
}
async function copyDiagnostic(job) {
  const summary = diagnosticSummary(job);
  try { await navigator.clipboard.writeText(summary); toast('诊断摘要已复制，不包含提示词或图片'); }
  catch {
    const field = $('#diagnostic-text'); field.hidden = false; field.value = summary; field.focus(); field.select();
    toast('请手动复制下方诊断摘要');
  }
}
