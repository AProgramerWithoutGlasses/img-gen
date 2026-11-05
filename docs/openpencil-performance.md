# OpenPencil 卡顿初查

2026-11-05，只读检查。旧工作稿与 img-gen 保存副本 SHA-256 相同，没有打开或修改旧大文件。

| 项目 | 旧稿 | 新起稿 |
| --- | --- | --- |
| 文件 | `D:/workspace/img-gen/docs/design/Endfield-UI-OpenPencil.fig` | `design/start.fig` |
| 体积 | 1,302,219 字节 | 29,130 字节 |
| 页面 | 6 | 1 |
| 总节点，含文档/页面结构 | 29,564 | 2 |
| 主设计页内容节点 | 27,376 | 0 |
| 主设计页顶层对象 | 256 | 0 |

直接负担来自整屏状态大量复制。主设计页既有浅/暗完整页面，也有模型菜单、比例菜单等完整 1440×900 状态页。文件有 43 个组件，但统计中没有 INSTANCE，未体现实例复用。仅删除说明和规范页不能消除主设计页的主要负担。

软件层面：本机安装的 OpenPencil.exe 为 0.16.0。对应官方 core 0.16.0 的 `editor/history/atomic-tool.ts` 会对整份文档做事务快照，并在总节点超过 10,000 时拒绝部分原子 AI 编辑。它解释了此前的编辑报错；不是“任何超过 10,000 节点的图都无法显示”。

- [官方已合并的 #1639](https://github.com/open-pencil/open-pencil/pull/1639)：只记录改动涉及的图层，移除整份文档大小限制，改为每次最多修改 10,000 图层。上游提供的性能数字属于他们的测试，未在本机复现。
- [仍未合并的 #1794](https://github.com/open-pencil/open-pencil/pull/1794)：处理组件依赖导致多页加载、后台标签页停滞的问题，是相关线索，不能确认旧稿命中同一问题。
- [最新正式版](https://github.com/open-pencil/open-pencil/releases/tag/v0.16.0) 当前仍为 v0.16.0；没有安装开发版或更改软件。

本次按用户要求从空白开始：旧稿留在原项目，OpenPencil 当前只打开新起稿。后续先做一个代表性页面；交互状态尽量在组件内部表达，不为每个按钮状态复制整屏。需要时再把历史版本移到单独文件。

尚未验证：旧文件在 GUI 中的拖动/缩放帧率、显存、字体或特定效果各自的耗时；没有据节点统计断言唯一瓶颈或承诺卡顿全部解决。

复查命令：`npm run design:audit -- "D:/workspace/img-gen/docs/design/Endfield-UI-OpenPencil.fig"`。报告与后续截图保存在 `outputs/`。
