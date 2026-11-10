# 测试与检查

测试源码与业务源码独立：Go 在 tests/go，Node 工具在 tests/tools，设计验证在 tests/design，接口探测在 tests/probes，Go 样本在 tests/fixtures；前端浏览器流程在 frontend/tests/e2e。后续组件单测也放 frontend/tests，不混进 src。

Go 测试保留在同一个外部测试包，文件名区分主题，既有 49 个入口保留；这样复用测试辅助代码且数据库流程顺序运行，避免多个测试包同时使用同一数据库。包导入内部真实实现，不复制业务逻辑。数据库流程由 TestMySQLWorkflow 和 TestStudioMySQLWorkflow 负责，其他原 integration 文件包含其子流程。

## 检查矩阵（唯一维护位置）

| 改动 | 命令及范围 |
| --- | --- |
| 仅说明文档 | npm run check:docs |
| 根工具、状态命令 | npm run check:tools；实际执行相关安全命令 |
| 前端 | npm --prefix frontend run check；npm run build；受影响浏览器流程，完整模拟用 npm run verify；同时改说明时补 check:docs |
| 工作区生成进度与图内操作 | node frontend/tests/e2e/workbench-motion-check.mjs；检查真实单图排队／生成与独立计时、解码后100%和持续可见的渐显／进度收尾、成图返回不改变画框、失败保图、悬浮与预览及390px导航；只用本地响应样本，过渡采样不禁用动画 |
| 后端 | 前端嵌入产物可用后 go test ./...、go vet ./...、go build ./... |
| 跨端、构建与 CI | npm run verify:all；真实数据库/浏览器按下节启用 |
| 设计稿变更 | 保存当前指定稿；按变动核对局部画面、字体及对应真实浏览器；需要时显式指定稿审计／导出，旧场景映射仍适用时才运行 design:compare |
| 现行创作对话框圆角或尺寸 | 保存指定稿后 node tests/design/check-dialog-corners.mjs；检查当前批准参数与适配组，浏览器只补受影响流程。新风格先更新相应规则与用例，其他区域不硬套旧参数和节点 ID |
| 对话框按钮轮廓或栅格绘制 | node frontend/tests/e2e/dialog-pixels-check.mjs；覆盖 0.9、1、1.1、1.125、1.25、1.5、2 DPR 的亮暗及输入增长，比较截图可见对边，并用旧 CSS 负例确认能发现不均；不以几何值代替截图 |
| 图片资源选择、附件自适应预览 | node frontend/tests/e2e/image-renditions-check.mjs；按实际尺寸/DPR核对压缩URL、当前卡片锚点、比例/小图/长图、输入增高、快速切换与失败回退；真实编码及权限由Go测试验证，不读生产图片 |
| 点击大图的打开时序、资源切换 | node frontend/tests/e2e/big-preview-check.mjs；DPR1/2的冷加载与暖缓存重开、快速切图及失败回退；隐藏dialog不得按1px先选缩略图，原实现须能触发回归失败 |
| 设计连接工具 | npm run design:smoke，相关命令实际验证 |
| 上游探测脚本 | Python 语法和安全 dry-run、Go 显式编译；不自动实际收费探测 |

检查针对一批累计改动，源码、配置或依赖变化后补受影响检查；输入完全相同才复用证据。根 `npm run check` 是包含前端及工具检查的聚合入口，适合同时影响两者的变化；纯前端小改按上表执行，不因根聚合命令重复运行未变的 Git fixture 等工具测试。npm run verify 包含一次前端构建、7 条模拟流程和加载检查；verify:all 再同步嵌入并做 Go 检查，不重复构建同一输入。

并行任务指定一位执行者统一验收；其他执行者只提供改动范围、输入是否变化和已有结果，避免重复运行同一检查。截图等待图片和动画稳定；几何数值不能单独代替视觉及可见性检查。仅文档与历史文件清理不构建业务，不启动测试数据库。

多个 Vite 开发模式浏览器脚本串行执行，避免共享依赖优化缓存互相失效；production preview 脚本可使用独立端口并行。

设计工具有用户未保存编辑时，保留现场；对话框几何命令可加 `--saved` 在独立 headless 会话读取已保存文件，不重载或替用户保存桌面文档。该结果仅证明磁盘稿，不代表用户未保存修改已验收。

`frontend/tests/e2e/dialog-check.mjs` 随原有模拟流程另执行 8 组对话框检查：模型显示名与持久化 ID、菜单键盘／36px上传圆钮与加号居中／展开编辑入口已移除、16px／24px正文与顶边14px／两至八行增长和自然折行／超限滚动、提示尺寸和底部留白、积分点击无消息、重复文件与站内拖图、四格起自动增宽至六附件上限／逐卡悬停与删除后缩回／无展开按钮及黄条、亮暗同色输入区及减少动态效果。仅修改对话框时可运行 `node frontend/tests/e2e/preview-check.mjs --dialog-only`，保留原 7 条全站流程但不重复执行。它检查真实 UI 与模拟 Provider 的保存结果；真实 Go/CSP 和数据库仍由下节联调覆盖，不据此宣称收费上游参数已实测。

## 真实 MySQL 与 Go/CSP 浏览器联调

只使用空的专用 `_test` 数据库，不用生产库或已有数据。测试会拒绝其他名称或非空库，并在结束时清理自己创建的表。数据库测试必须串行，不能使用 t.Parallel，不能让两份检查共用同一测试库。

```powershell
$env:TEST_MYSQL_DSN = '测试账号:测试密码@tcp(127.0.0.1:3306)/studio_test?parseTime=true'
$env:STUDIO_BROWSER_CHECK = '1'
npm run verify:all
```

无 TEST_MYSQL_DSN 时数据库测试跳过，必须明确报告；上游仅为本地响应 fixture，不代表真实 Qiso 支持全部参数。实际覆盖迁移、权限、六附件、积分结算、失败退款、文件夹多归属/删除保图、下载和账户管理。浏览器使用真实 Go/CSP；Windows 用 Edge，Linux 用 Playwright Chromium。

截图保存在 frontend/outputs/preview、integration、performance，设计证据在 outputs/design-browser-check；缓存、日志和数据不进入 Git。Go 跨包覆盖统计用 `go test '-coverpkg=./internal/...' '-coverprofile=outputs/coverage.out' ./tests/go/...`，数据库覆盖仍需启用专用库。

完整模拟流程另检查390px窄屏下工具栏按钮可点击、长文本增高及窗口来回缩放。浏览器初始化时单独捕获 ResizeObserver 循环错误，避免开发服务器拦截全局错误后漏报；旧同步回写实现已作为负例验证该检查会失败。

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
