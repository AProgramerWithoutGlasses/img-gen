# 固定流程与成熟工具

核对日期：2026-11-05。源码和文档已核对；没有做 CLI 与 MCP 的速度对比实验。

| 工具 | 适用工作 | 本项目状态 |
| --- | --- | --- |
| [Playwright](https://github.com/microsoft/playwright) | 固定浏览器检查、桌面/手机截图、捕获报错和意外请求 | 已接入 `npm run preview:check`；`npm run verify` 串联检查、构建与截图 |
| [OpenPencil 官方 core / CLI](https://github.com/open-pencil/open-pencil/tree/master/packages/cli) | 离线读文件、统计节点、批处理、导出；减少逐个 MCP 调用 | 已用官方 core 0.16.0 做只读 `npm run design:audit`；完整 CLI 未安装 |
| [Storybook](https://github.com/storybookjs/storybook) | 在独立页面审阅按钮、输入框等组件的交互状态，少复制整屏 | 暂不安装；有实际组件后再决定，不预设组件库 |

AI 判断视觉方向、阅读反馈、做局部设计。程序执行重复的检查、统计、截图和导出。确定的画布操作优先一次 JSX render / batch_update；不能仅凭换成 CLI 就承诺更快。

OpenPencil CLI 的官方文档支持 `info 文件.fig --json`、`eval` 和多种格式导出。后续需要批量设计操作时再按实际任务接入，不必为了空白起稿先装一整套。

当前浏览器检查只覆盖加载、报错、网络边界、横向溢出和两种尺寸截图。交互功能出现后，补相应的点击与状态断言；截图本身不能证明界面美观或功能正确。
