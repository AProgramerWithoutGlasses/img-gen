# 测试与检查

测试源码与业务源码独立：Go 在 tests/go，Node 工具在 tests/tools，设计验证在 tests/design，接口探测在 tests/probes，Go 样本在 tests/fixtures；前端浏览器流程在 frontend/tests/e2e。后续组件单测也放 frontend/tests，不混进 src。

Go 测试保留在同一个外部测试包，文件名区分主题，既有 49 个入口保留；这样复用测试辅助代码且数据库流程顺序运行，避免多个测试包同时使用同一数据库。包导入内部真实实现，不复制业务逻辑。数据库流程由 TestMySQLWorkflow 和 TestStudioMySQLWorkflow 负责，其他原 integration 文件包含其子流程。

## 测试阶段快速默认

当前网站尚无用户使用，按用户授权优先快速迭代：只验证本次实际受影响的内容，能人工确认的小改可由用户复核，不把所有可用检查都跑一遍。本节优先于下方完整检查矩阵；正式对外上线前再集中全面验收，不在每次小改时提前重复。

| 本次改动 | 默认做到这里即可 |
| --- | --- |
| 小范围样式、尺寸、图标、文案或动效调整 | 保存指定稿的局部修改；构建一次（含类型检查），在本地或线上打开相关页面快速查看；外观细节由用户人工复核。无需默认新增自动化用例、遍历全部状态／DPR、制作故障负例或全站截图 |
| 普通前后端功能小修 | 构建受影响部分；运行一个覆盖本次行为的现有专项检查，或实际操作相关流程完成冒烟。默认不运行全套回归、race、vet或重复联调 |
| 计费、权限、数据库迁移、删除或持久化改动 | 按实际影响补专项验证，发布备份按部署流程处理，不因为是小补丁省略核心行为核对 |
| 仅文档 | npm run check:docs；不构建或部署业务 |

CI 保持现有自动触发；小改本地通过上述验证即可发布，无需等其结束。实际报告“本地通过／人工待复核／CI运行中”等状态，已发现会影响本次功能的失败先修复。构建、发布回退及上线健康检查按现行流程保留。下方矩阵用于需要扩大验证、复杂改动和正式运营时选择范围，不是每次小改的必跑清单。

## 检查矩阵（唯一维护位置）

| 改动 | 命令及范围 |
| --- | --- |
| 仅说明文档 | npm run check:docs |
| 根工具、状态命令、构建缓存 | npm run check:tools；实际执行相关安全命令；构建入口变化时再执行一次 npm run build 并核对复用摘要 |
| 前端 | node frontend/scripts/check-scripts.mjs；npm run build（内含类型检查）；受影响浏览器流程；需要完整模拟时改用 npm run verify，再用 npm --prefix frontend run sync:server 同步嵌入，不先重复检查与构建；同时改说明时补 check:docs |
| 工作区生成进度与图内操作 | node frontend/tests/e2e/workbench-motion-check.mjs；检查真实单图排队／生成与独立计时、解码后数字／白条随清晰化推进且清晰才100%、成图返回不改变画框、失败保图、悬浮与预览及390px导航；只用本地响应样本，过渡采样不禁用动画 |
| 后端 | 前端嵌入产物可用后 go test ./...、go vet ./...、go build ./... |
| 跨端、构建与 CI | npm run verify:all；真实数据库/浏览器按下节启用 |
| 设计稿变更 | 保存当前指定稿；按变动核对局部画面、字体及对应真实浏览器；需要时显式指定稿审计／导出，旧场景映射仍适用时才运行 design:compare |
| 现行创作对话框圆角或尺寸 | 保存指定稿后 node tests/design/check-dialog-corners.mjs；检查当前批准参数与适配组，浏览器只补受影响流程。新风格先更新相应规则与用例，其他区域不硬套旧参数和节点 ID |
| 对话框按钮轮廓或栅格绘制 | node frontend/tests/e2e/dialog-pixels-check.mjs；覆盖 0.9、1、1.1、1.125、1.25、1.5、2 DPR 的亮暗及输入增长，比较截图可见对边，并用旧 CSS 负例确认能发现不均；不以几何值代替截图 |
| 图片资源选择、附件自适应预览 | node frontend/tests/e2e/image-renditions-check.mjs；按实际尺寸/DPR核对压缩URL、当前卡片锚点、比例/小图/长图、输入增高、快速切换与失败回退；真实编码及权限由Go测试验证，不读生产图片 |
| 点击大图的打开时序、资源切换 | node frontend/tests/e2e/big-preview-check.mjs；DPR1/2的冷加载与暖缓存重开、导航缩略图实际加载、原图按钮及放大同步状态、失败保预览和手动重试、快速切图／关闭取消旧加载；36图桌面无横溢出且隐藏滚动条仍能滚动、窄屏首尾键盘可达。可用 --rail-only 只查长轨道、--output-dir 隔离证据；旧滚动条负例用 --negative-rail 并指定独立目录。隐藏dialog不得按1px先选缩略图 |
| 设计连接工具 | npm run design:smoke，相关命令实际验证 |
| 上游探测脚本 | Python 语法和安全 dry-run、Go 显式编译；不自动实际收费探测 |

检查针对一批累计改动，源码、配置或依赖变化后补受影响检查；输入完全相同才复用证据。根 `npm run check` 是包含前端及工具检查的聚合入口，适合同时影响两者的变化；纯前端小改按上表执行，不因根聚合命令重复运行未变的 Git fixture 等工具测试。npm run verify 包含一次前端构建、7 条模拟流程和加载检查；verify:all 再同步嵌入并做 Go 检查，不重复构建同一输入。

小修在开始验证前选定受影响流程，全部通过即收尾；只有新增改动、失败或尚未解决的风险才扩大范围。需要构建时复用构建内的 `tsc --noEmit`，不再先跑前端 `check`；暂不构建时才用 `npm --prefix frontend run check`。同一输入已构建后，需要补浏览器检查就直接运行对应脚本，不追加会再次构建的 `verify`。

并行任务指定一位执行者统一验收；其他执行者只提供改动范围、输入是否变化和已有结果，避免重复运行同一检查。截图等待图片和动画稳定；几何数值不能单独代替视觉及可见性检查。仅文档与历史文件清理不构建业务，不启动测试数据库。

多个 Vite 开发模式浏览器脚本串行执行，避免共享依赖优化缓存互相失效；production preview 脚本可使用独立端口并行。

### CI 按变更范围触发

`scripts/ci-scope.mjs` 根据真实 Git 差异选择检查；PR 使用相对目标分支的累计差异，push 使用前后提交差异。移动文件同时检查原位置和新位置，混合改动取并集。

| 变更范围 | 自动检查 |
| --- | --- |
| 普通说明文档、设计稿、研究资料 | 文档链接与仓库结构；不启动 MySQL 或业务构建 |
| 普通根工具、tests/tools、设计验证脚本 | 工具检查（包含文档检查）；不运行前后端业务检查 |
| 前端源码、资源、配置、依赖或浏览器测试 | 完整前端验证与嵌入同步，真实 Go/MySQL/CSP 页面联调，Go 构建；跳过后端全套竞态测试 |
| Go 源码、后端测试与样本、Go 依赖或 web 嵌入入口 | 构建嵌入前端，Go vet、全套竞态及数据库／真实浏览器联调、Go 构建；跳过未改动的前端模拟与加载检查 |
| 前后端混合、CI 配置、根 package、共享构建脚本、接口契约、未知路径或差异基线不可用 | 取并集或保守全套，不能因分类失败跳过检查 |

纯前端联调使用 `go test ./tests/go -run '^TestStudioMySQLWorkflow$' -count=1 -timeout 5m`，设置与完整联调相同的专用库和 `STUDIO_BROWSER_CHECK=1`；仍编译整个测试包，实际执行真实 Go/CSP 与数据库页面流程，不执行其他后端测试。后端分支的全套竞态已包含此流程，不重复执行。各分支只构建前端一次。

设计工具有用户未保存编辑时，保留现场；对话框几何命令可加 `--saved` 在独立 headless 会话读取已保存文件，不重载或替用户保存桌面文档。该结果仅证明磁盘稿，不代表用户未保存修改已验收。

`frontend/tests/e2e/dialog-check.mjs` 随原有模拟流程另执行 10 组对话框检查：模型显示名与持久化 ID、菜单键盘／36px上传圆钮与加号居中／展开编辑入口已移除、16px／24px正文与顶边14px／两至八行增长和自然折行／超限滚动、提示尺寸和底部留白、积分点击无消息、重复文件与站内拖图、四格起自动增宽至六附件上限／逐卡悬停与删除后缩回／无展开按钮及黄条、亮暗同色输入区及减少动态效果、默认一张／张数记忆及账号隔离、等宽账户菜单和侧栏新建入口、Tooltip避让整组按钮。仅修改对话框时可运行 `node frontend/tests/e2e/preview-check.mjs --dialog-only`，保留原 7 条全站流程但不重复执行。完整创作流程覆盖结果多选、批量加入文件夹后刷新、顶部反馈3／6秒关闭；工作区动效流程继续验证单图大图与生成时序。它检查真实 UI 与模拟 Provider 的保存结果；真实 Go/CSP 和数据库仍由下节联调覆盖，不据此宣称收费上游参数已实测。

## 真实 MySQL 与 Go/CSP 浏览器联调

只使用空的专用 `_test` 数据库，不用生产库或已有数据。测试会拒绝其他名称或非空库，并在结束时清理自己创建的表。数据库测试必须串行，不能使用 t.Parallel，不能让两份检查共用同一测试库。

```powershell
$env:TEST_MYSQL_DSN = '测试账号:测试密码@tcp(127.0.0.1:3306)/studio_test?parseTime=true'
$env:STUDIO_BROWSER_CHECK = '1'
npm run verify:all
```

无 TEST_MYSQL_DSN 时数据库测试跳过，必须明确报告；上游仅为本地响应 fixture，不代表真实 Qiso 支持全部参数。实际覆盖迁移、权限、六附件、积分结算、失败退款、文件夹多归属/删除保图、下载和账户管理。浏览器使用真实 Go/CSP；Windows 用 Edge，Linux 用 Playwright Chromium。

截图默认保存在 frontend/outputs/preview、integration、performance，设计证据在 outputs/design-browser-check；缓存、日志和数据不进入 Git。`preview-check.mjs` 和 `workbench-motion-check.mjs` 支持 `--output-dir <目录>`，绝对路径及仓库根相对路径均可；preview 入口还可组合 `--dialog-only`。故障负例必须指定独立目录，例如 `node frontend/tests/e2e/preview-check.mjs --output-dir outputs/本批任务/negative`，不得覆盖已通过的 result.json；不用为恢复正例报告重跑未变输入。参数错误在创建目录、启动服务器及浏览器之前拒绝。

Go 跨包覆盖统计用 `go test '-coverpkg=./internal/...' '-coverprofile=outputs/coverage.out' ./tests/go/...`，数据库覆盖仍需启用专用库。

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
