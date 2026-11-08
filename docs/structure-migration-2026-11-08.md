# 2026-11-08 结构整理记录

本记录说明本批结构选择；日常操作仍从现行 README 和文档导航进入，不把记录当作新待办。

## 结果与路径

| 原位置 | 当前位置 |
| --- | --- |
| 根目录后端 Go 文件 | internal/studio/，main.go 保留薄入口 |
| 根 Go 测试与 testdata | tests/go/、tests/fixtures/ |
| 根 probe_* | tests/probes/；Go 探测直接导入实际适配器 |
| scripts/tests/ | tests/tools/ |
| frontend/scripts/ 浏览器检查 | frontend/tests/e2e/ |
| 设计浏览器检查、smoke、辅助代码与固定对照数据 | tests/design/ |
| frontend/src/App.tsx | app/App.tsx、Sidebar.tsx、navigation.ts 与图库 ImagePreview.tsx |
| SettingsPage.tsx 大文件 | 同目录 Account、Appearance、Credits、Users、Requests、Prices；页面入口保留 |
| GalleryPage.tsx 大文件 | 同目录 FolderPicker、GalleryImage、shared 与页面入口 |
| 前端模拟 Provider、认证、样例与持久化 | frontend/src/preview/，继续只在模拟模式加载 |
| style.css | styles/、app/layout.css 与功能局部 CSS，规则和级联顺序保持 |
| 混合适配说明 | 前端、后端 README 与唯一共享 docs/api-contract.md |

所有产品测试与样本已移出业务源码。Go 使用一个独立外部测试包：保留 49 个原测试入口，新增一项真实并发 HTTP 验证替代原直接持锁的测试方式；同包串行执行数据库流程，避免多包并发污染同一空测试库。未为了目录分层引入新的运行框架。

旧适配、目录和设计流程文档仅留迁移索引，历史交接继续保留日期。根 AGENTS 只维护共同底线，前端、后端、研究分别有局部规则；测试矩阵只在 tests/README.md。提交/推送/部署规则按本次用户要求改为 agent 自动判断，完成可验证小批次后提交。

后续调研放 research/日期-主题/；旧研究保留原位置并由索引链接，研究建议只有被采纳后才进入现行设计/工程约定。

## 验证证据

本地独立 MySQL 实例仅绑定 127.0.0.1:3317，专用空库 structure_test；未连接生产业务库。真实浏览器由 Go 测试启动本地服务，只有图片上游是本地 fixture；没有调用收费渠道。

- Go 全部测试、真实 MySQL/HTTP/CSP 浏览器：238 个测试项通过，0 失败、0 跳过；后端覆盖率 72.1%。
- go vet、构建、前端类型检查：通过。
- 模拟浏览器 7 条流程与图片调度/加载检查：通过。
- 设计连接 smoke 7 项、37 个设计/浏览器场景对照：通过；设计原稿保持不变。
- Node 工具行为测试 5 项；文档本地链接与结构边界检查：通过。结构检查用故意放错目录的测试文件做过负例，确实拒绝。
- Go 探测脚本离线构建与 dry-run、12 份 Python 探测脚本语法：通过。
- CI 使用 actionlint v1.7.9 校验通过；文档/研究不启动重型业务 CI，最终 result 检查覆盖执行与跳过情形。

详细执行日志、覆盖报告和截图放 outputs/ 与 frontend/outputs/，不进入 Git。Windows 当前未提供 CGO 编译器，race 检查需由 Linux CI 完成；本机 Docker daemon 未启动，未声称完成容器镜像运行验收。此结构重构没有产品外观或业务规则变更，是否部署由本批交付判断，不因目录搬迁自动重启线上。
