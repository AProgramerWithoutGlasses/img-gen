# 本地设计自动化与工具选择

核对日期：2026-11-05。已查阅官方文档、GitHub 仓库与 npm 包元数据；本文将已落地能力与后续建议分开记录。当前仍为空白项目，尚未开始界面设计。

## 已完成：精简 OpenPencil MCP

项目白名单在 [`.codex/config.toml`](../.codex/config.toml)，连接命令继承本机已有配置。

- 本次会话原有 132 个 OpenPencil 工具，项目白名单保留 44 个、移除 88 个，数量减少约 67%。这是工具数量变化，不是实测耗时或 token 降幅。
- 保留文件与页面、局部读取、JSX render、batch_update、补丁、常用属性编辑、基础组件复用、SVG/图标、截图导出、重叠/可访问性/字体检查、撤销和视口定位。
- 暂不暴露变量与主题管理、评论、组件库插入、原型行为、布尔与路径编辑、PDF 导出、编辑器设置及重复的单属性工具。后续任务确实需要时，只补所需工具。
- 保留 `set_fill`、`set_stroke`、`set_effects` 等常用局部编辑，避免小改动也必须先生成补丁再应用。
- 不开放通用 `eval`。首屏创建用 `render`；布局批改用 `batch_update`；复杂属性改动可用 `diff_show` / `diff_apply`。

生效条件：Codex 必须从受信任的本项目加载配置。当前已启动会话的工具目录不会因编辑文件自动缩减，需要重新加载该项目会话。项目外配置仍保持原样。

验证方式：

```powershell
cd C:\Users\13556\Documents\ui-studio
codex mcp get open-pencil --json
```

本次实际读取到 `enabled_tools` 为 44 项；与本机 OpenPencil MCP 0.16.0 的工具清单逐项核对，无重名、无未知名称。项目外同一命令的 `enabled_tools` 仍为 `null`。在线 MCP 也成功读取了 `design/start.fig` 的文档信息。

配置依据：[Codex MCP](https://developers.openai.com/codex/mcp/)、[配置参考](https://developers.openai.com/codex/config-reference/)、[配置优先级](https://developers.openai.com/codex/config-basic/)。

## 哪些步骤交给程序

| 步骤 | 成熟方案 | 自动化内容与收益 | 本项目采用时机 |
| --- | --- | --- | --- |
| 浏览器验收与截图 | [Playwright](https://github.com/microsoft/playwright) | 一次命令覆盖多尺寸、加载/控制台错误、溢出、异常网络请求，自动产出截图与 JSON；省去逐页点击 | **已接入** `npm run verify`，覆盖 1440×900 和 390×844 |
| 修改前后视觉比较 | [Playwright screenshot assertions](https://playwright.dev/docs/test-snapshots) | 自动生成实际图、基准图和差异图，定位局部样式回归 | 第一个画面审阅通过后建立基准；当前空白页不建立视觉基准 |
| 可访问性初筛 | [axe-core / Playwright](https://github.com/dequelabs/axe-core-npm/tree/develop/packages/playwright) | 批量检查标签、名称、语义和可检测的对比度问题，减少反复人工排查 | 第一个有内容的界面加入现有浏览器检查；不替代键盘与人工体验检查 |
| 设计稿统计、批改与导出 | [OpenPencil core / CLI](https://github.com/open-pencil/open-pencil/tree/master/packages/cli) | 程序统计节点、查询层级、批量导出和执行确定的编辑；MCP 的 JSX render / batch_update 合并已确认操作 | **已有** core 0.16.0 只读审计；常规设计用 MCP 批操作，出现多画面批处理需求时引入 CLI |
| 组件状态预览与交互复现 | [Storybook React/Vite](https://storybook.js.org/docs/get-started/frameworks/react-vite) | 用 stories 保存默认、禁用、错误、长文本等状态；play 函数自动执行输入与点击 | 出现可复用组件时引入；无需先建一整套规范板 |
| 图标查找与缓存 | [Iconify](https://github.com/iconify/iconify) + OpenPencil 内置工具 | 一次搜索、批量预取、批量插入矢量图标，避免逐个网络往返 | 选定视觉方向后选一套图标；代码侧使用本地 SVG/包，预览不依赖远程 API |
| 截图拼板与资产处理 | [sharp](https://github.com/lovell/sharp) | 批量裁切、缩放、压缩、拼接设计/浏览器对照图，供一次审阅 | 截图变多时加入脚本，输出放 `outputs/` |

## 落地顺序

1. **当前**：精简 MCP，复用 `verify` 和 `design:audit`，从截图/JSON 中集中读取结果。
2. **确定首屏后**：先检查当前文档与选区，限定读取深度；用一次 JSX 创建已确定的结构。生成的示例数据固定种子或直接采用本地固定数据，便于重复截图。
3. **首屏实现时**：给实际交互添加 Playwright 操作与状态断言，并整合 axe。检查打开菜单、错误提示等展开后的状态。
4. **首屏审阅通过后**：固定浏览器、系统、字体、视口与测试数据，再建立视觉基准。基准更新单独执行，失败时不自动接受新截图；本地基准、差异图和报告统一放 `outputs/`。
5. **组件开始复用时**：加入 Storybook，把状态矩阵放到组件 story 中；真实业务交互仍由浏览器断言验证。
6. **画面数量增加后**：再接 CLI 批量导出、sharp 对照拼板。若采用设计变量，可先评估 OpenPencil 自带 token 导出，避免手动维护重复数值。

AI 负责决定界面结构、阅读反馈、判断视觉与体验。程序负责重复执行、采集证据、计数与比较。截图和自动检查都不能独自证明设计好看或交互合理。

## 对比后暂不采用

- **[Histoire](https://github.com/histoire-dev/histoire)**：当前文档已支持 React 18/19、Vite 7/8，也有 MCP；可作为组件工作台备选。项目已经在收敛工具入口，优先选择文档与测试生态更完整的 Storybook，不同时引入两个工作台。
- **[reg-suit](https://github.com/reg-viz/reg-suit)**：成熟的图像回归 CLI，也能本地比较；其仓库提供云端快照和通知插件。本项目已有 Playwright，先用内置截图比较即可，暂不增加另一套基准与报告流程。
- **云端视觉审阅服务**：本项目只在本地工作，当前不需要上传设计或接外部发布流程。

兼容性核对：查询时 `@storybook/react-vite` 10.6.5 的 peer dependencies 包含 React 19、Vite 8；`@axe-core/playwright` 4.14.0 支持 Playwright。这里只完成元数据核对，尚未安装或验证它们与本项目的组合。

## 测量原则与边界

- 未做 CLI/MCP 的同任务速度对比，不承诺 CLI 更快。CLI 本地文件模式与在线 RPC 模式也不能混为一谈。
- 真正出现批处理需求时，用同一份设计文件副本、相同操作和相同输出测量；区分冷启动与暖运行，分别记录总耗时、调用次数、输出字节数与结果一致性。
- CLI 文件模式的字体环境可能与桌面 App 不同；导出时核对字体，必要时使用 `--font-policy strict`。两端字体不一致会污染视觉差异结果。
- `lint` 初期使用 accessibility 预设；间距、圆角、颜色变量等规范检查，等视觉方向确定后再配置，避免工具反向决定设计。
- 所有截图、抓取的资料、诊断与本次白名单核对结果保存在 `outputs/`，不提交到 Git。配置与流程文档本地提交。

补充来源：[CLI 检查与在线模式](https://openpencil.dev/programmable/cli/inspecting)、[CLI 脚本](https://openpencil.dev/programmable/cli/scripting)、[导出与字体策略](https://openpencil.dev/programmable/cli/exporting)、[Playwright 可访问性](https://playwright.dev/docs/accessibility-testing)、[Storybook play 函数](https://storybook.js.org/docs/writing-stories/play-function)。
