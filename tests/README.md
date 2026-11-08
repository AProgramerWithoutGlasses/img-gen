# 测试与检查

测试源码与业务源码独立：Go 在 tests/go，Node 工具在 tests/tools，设计验证在 tests/design，接口探测在 tests/probes，Go 样本在 tests/fixtures；前端浏览器流程在 frontend/tests/e2e。后续组件单测也放 frontend/tests，不混进 src。

Go 测试保留在同一个外部测试包，文件名区分主题，既有 49 个入口保留；这样复用测试辅助代码且数据库流程顺序运行，避免多个测试包同时使用同一数据库。包导入内部真实实现，不复制业务逻辑。数据库流程由 TestMySQLWorkflow 和 TestStudioMySQLWorkflow 负责，其他原 integration 文件包含其子流程。

## 检查矩阵（唯一维护位置）

| 改动 | 命令及范围 |
| --- | --- |
| 仅说明文档 | npm run check:docs |
| 根工具、状态命令 | npm run check:tools；实际执行相关安全命令 |
| 前端 | npm run check；npm run build；受影响浏览器流程，完整模拟用 npm run verify |
| 后端 | 前端嵌入产物可用后 go test ./...、go vet ./...、go build ./... |
| 跨端、构建与 CI | npm run verify:all；真实数据库/浏览器按下节启用 |
| 设计稿变更 | 保存后 npm run design:verify、相关画面及 design:compare |
| 设计连接工具 | npm run design:smoke，相关命令实际验证 |
| 上游探测脚本 | Python 语法和安全 dry-run、Go 显式编译；不自动实际收费探测 |

检查针对一批累计改动，源码、配置或依赖变化后补受影响检查；输入完全相同才复用证据。npm run verify 包含一次前端构建、7 条模拟流程和加载检查；verify:all 再同步嵌入并做 Go 检查，不重复构建同一输入。

## 真实 MySQL 与 Go/CSP 浏览器联调

只使用空的专用 `_test` 数据库，不用生产库或已有数据。测试会拒绝其他名称或非空库，并在结束时清理自己创建的表。数据库测试必须串行，不能使用 t.Parallel，不能让两份检查共用同一测试库。

```powershell
$env:TEST_MYSQL_DSN = '测试账号:测试密码@tcp(127.0.0.1:3306)/studio_test?parseTime=true'
$env:STUDIO_BROWSER_CHECK = '1'
npm run verify:all
```

无 TEST_MYSQL_DSN 时数据库测试跳过，必须明确报告；上游仅为本地响应 fixture，不代表真实 Qiso 支持全部参数。实际覆盖迁移、权限、六附件、积分结算、失败退款、文件夹多归属/删除保图、下载和账户管理。浏览器使用真实 Go/CSP；Windows 用 Edge，Linux 用 Playwright Chromium。

截图保存在 frontend/outputs/preview、integration、performance，设计证据在 outputs/design-browser-check；缓存、日志和数据不进入 Git。Go 跨包覆盖统计用 `go test '-coverpkg=./internal/...' '-coverprofile=outputs/coverage.out' ./tests/go/...`，数据库覆盖仍需启用专用库。

## 保留的关键行为

| 行为 | 证据入口 |
| --- | --- |
| 文件夹刷新、多归属、删除保图 | TestStudioMySQLWorkflow 与真实浏览器 |
| Go 嵌入前端和 CSP | STUDIO_BROWSER_CHECK=1 |
| 设计与浏览器对应 | design:compare 的固定合成状态 |
| 现行入口链接 | check:docs |
| 远程查询真实联网、失败不伪装成功 | tests/tools/project-status.test.mjs |
| 测试与研究不混入源码、规则无个人路径 | check:tools 的结构检查 |

## 探测工具

[tests/probes/README.md](probes/README.md) 记录迁移后的调用方式。历史报告保留当时记录，旧路径如需重现先使用新命令；不为验证重构而向收费上游发送请求。
