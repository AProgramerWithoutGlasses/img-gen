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
