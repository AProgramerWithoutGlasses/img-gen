const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs');
const scope={creditText:()=> '0（已退还 1）',statusNames:{failed:'生成失败'},modelNames:{}};
vm.createContext(scope);vm.runInContext(fs.readFileSync('web/feedback.js','utf8'),scope);
test('ambiguous HTTP 400 does not assert permission or balance as the cause',()=>{
 const result=scope.failureAdvice({error:'上游返回 HTTP 400；请凭请求 ID 检查渠道、余额或模型权限',credits_state:'refunded',credits_cost:1});
 assert.match(result.message,/具体原因尚未确认/);assert.match(result.credits,/不代表上游退费/);
});
test('interrupted requests explain uncertain upstream billing without automatic retry',()=>{
 assert.match(scope.failureAdvice({error:'服务重启，请手动决定是否重试'}).message,/无法确认上游是否已完成或计费/);
});
test('diagnostic summary falls back to task id and excludes private content',()=>{
 const text=scope.diagnosticSummary({id:'task123',status:'failed',model:'test-model',mode:'edit',prompt:'private-prompt',error:'secret-response',input:'private-image',created_at:'2026-11-03'});
 assert.match(text,/任务 ID：task123/);assert.match(text,/上游未提供/);assert.doesNotMatch(text,/private|secret/);
});

test('charged and refunded tasks show separate frozen spent and returned amounts',()=>{
 assert.match(scope.creditBreakdown({credits_state:'charged',credits_cost:3}),/实际消耗<\/span><strong>3 积分/);
 assert.match(scope.creditBreakdown({credits_state:'refunded',credits_cost:3}),/已退还<\/span><strong>3 积分/);
 assert.match(scope.creditBreakdown({credits_state:'refunded',credits_cost:3}),/实际消耗<\/span><strong>0 积分/);
 assert.match(scope.ledgerDescription({kind:'charge',delta:0}),/不再扣减可用余额/);
});

test('HTTP status takes precedence over generic legacy permission hints',()=>{
 for (const status of [429,500,502,503,504]) {
  const advice=scope.failureAdvice({error:`上游返回 HTTP ${status}；请凭请求 ID 检查渠道、余额或模型权限`});
  assert.doesNotMatch(advice.message,/认证或权限检查未通过/);
  if(status===504)assert.match(advice.message,/请求超时/);
  if(status===429)assert.match(advice.message,/过于频繁/);
  if(status===503)assert.match(advice.message,/上游服务暂时/);
 }
 for(const status of [401,403])assert.match(scope.failureAdvice({error:`上游返回 HTTP ${status}`}).message,/认证或权限/);
});
