# FigCraft 自动化工作流

2026-11-06：主工具从 OpenPencil 切换为用户安装的 FigCraft 0.15.1。旧工作稿、配置、依赖锁和文档完整归档，见 [archive/README.md](../archive/README.md)。

## 连接方式

[figcraft.config.json](../figcraft.config.json) 是可执行文件路径、工作稿和控制端口的唯一项目配置。MCP 通过 [scripts/figcraft-mcp.mjs](../scripts/figcraft-mcp.mjs) 启动：检查本地控制端口，启动或复用匹配的 FigCraft 桌面应用，再直接运行官方 `figcraft-cli mcp --attach`，不翻译或重写 MCP 协议。

默认控制地址为 `127.0.0.1:47800`。若端口属于其他进程，或已有 FigCraft 的文件访问目录不同，启动器报错而不关闭用户应用。需要先保存后关闭该会话，或在配置中选择空闲端口。

工具保留原生 19 项。确定性的重复操作通过官方 MCP JavaScript SDK 和 CLI 执行；不依赖逐个点击。命令语法以安装版 `list_commands {filter}` 为准。通用 `run_command` 能访问更多内部动作，19 个入口不等于只有 19 项设计能力。

## 日常流程

1. 确定首个界面的用户、任务和设备，再开始设计。当前空白文件不是错误，不建立空白页视觉基准。
2. `npm run design:open`；读取 `doc.list` 和指定文档的浅层 `inspect_document`，核对选区、脏状态。后续调用明确传 `document`。
3. 查少量需要的命令参数，使用一次 `batch` 完成已确定的父子节点结构；用 `as/$ref` 连接步骤。复杂设计拆成可审阅的小批次。
4. 编辑完成后 `save_file`。重复操作可写入 `design/commands/*.json`，用 `npm run design:batch -- design/commands/文件.json` 执行并保存。批次或保存报错时先检查当前文档，不自动重试。
5. 运行 `npm run design:verify`，审计已保存文件，并按页导出 PNG。空页明确跳过；导出每次使用独立目录，`latest.json` 指向本次结果，避免混入旧截图。
6. 需要检查未保存画布时用 `npm run design:snapshot -- [节点ID]`。只拿有关区域给 AI 审阅，减少全页图和节点输出。
7. 实现网页后运行 `npm run verify`：保留 Playwright 的 1440×900、390×844 浏览器检查、报错/溢出/异常请求检测，并串联设计审计和导出。
8. 审阅证据后本地提交。连接或脚本改动另跑 `npm run design:smoke`，临时测试内容只进入 `outputs/`。

## 文件与执行边界

- 画布主文件是 `design/start.figcraft`；不把实验性的 `.fig` 往返当作主存储路径。
- GUI 与 CLI 使用同一安装目录中的二进制和本机字体。升级 FigCraft 后跑一次 `design:smoke`。
- MCP 附加模式在 GUI 内执行；文件读写目录通过 GUI 启动参数设置。CLI 离线审计/导出也传入同样的目录参数。
- 审计报告会记录版本、内容节点数、字体问题、修复提示、文件 SHA-256 和耗时。文件在审计期间发生改变会报错；有缺失字体或导入警告时返回非零。
- 审计检查已保存文件。实时画布是否存在未保存编辑由 `inspect_document` 判断，不把磁盘结果解释为实时结果。
- 原生 batch 的失败回滚与撤销粒度用于减少半完成状态；实际视觉质量仍需查看截图。
- 当前没有与 OpenPencil 的同任务性能对照，不承诺切换后的速度倍数。

## 按实际需要接入的成熟工具

| 步骤 | 方案 | 当前采用方式 |
| --- | --- | --- |
| 浏览器操作、截图、错误检查 | [Playwright](https://github.com/microsoft/playwright) | 已接入；有实际交互后添加点击/状态断言 |
| 像素差异图 | [Playwright screenshot assertions](https://playwright.dev/docs/test-snapshots) | 首屏审阅通过后建基准，固定字体、视口和数据；不自动接受差异 |
| 可访问性初筛 | [axe-core/Playwright](https://github.com/dequelabs/axe-core-npm/tree/develop/packages/playwright) | 首屏有内容后整合，仍需人工键盘检查 |
| 组件状态与交互复现 | [Storybook](https://github.com/storybookjs/storybook) | 开始复用组件时加入，暂不建立大量规范板 |
| 本地图标资产 | [Iconify](https://github.com/iconify/iconify) | 选定方向后固定一套 SVG/图标包；通过 FigCraft 文件导入 |
| 截图对照拼板与压缩 | [sharp](https://github.com/lovell/sharp) | 画面增多时加入 |
| MCP 客户端 | [官方 TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) | 已使用 SDK 1.32.2 进行连接、工具调用和连通性测试 |

来源：[FigCraft MCP](https://github.com/storytold/figcraft/blob/main/docs/mcp.md)、[CLI](https://github.com/storytold/figcraft/blob/main/docs/cli.md)、[桌面控制协议](https://github.com/storytold/figcraft/blob/main/docs/control-protocol.md)、[Codex MCP 配置](https://developers.openai.com/codex/mcp/)。
