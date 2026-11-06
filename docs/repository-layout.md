# 仓库结构与分支

后续唯一本地开发目录为 `C:\Users\13556\Documents\ui-studio`。该目录已整合当前前后端、FigCraft设计稿和设计工具，并保持原GitHub `img-gen`远程关联。根目录npm脚本提供前端代理与设计命令，`design/`是当前设计源码，`archive/`与旧设计文档仅作历史资料。

查说明先从 [文档导航](README.md) 进入；查即时状态使用 `npm run status`，无需每次递归统计全部依赖和证据目录。日期报表只作为快照。

2026-11-07：将已上线的 `ebee61e` 及仓库清理提交收拢到 `main`，作为唯一长期分支；按需创建短期功能分支。推送与部署分别须用户对本次工作明确确认。仓库整理不修改线上服务。固定本地目录和发布优化见 [工作流程](workflow.md)。

| 位置 | 用途 |
| --- | --- |
| `frontend/` | 当前React界面、服务端适配、独立模拟预览和浏览器检查 |
| 根目录Go文件 | 后端、认证、任务、积分、图片处理及其测试 |
| `web/README.md` | 前端嵌入目录说明 |
| `web/studio/` | 前端构建产物，不提交 |
| `testdata/` | Go测试样本；原展示图仅作为缩略图压缩测试输入保留 |
| `docs/studio-integration.md` | 当前前后端适配和能力边界 |
| `docs/README.md` | 现行文档和历史资料的分类入口 |
| `docs/DEPLOYMENT.md` | 构建、备份和部署流程 |
| `docs/design/` | 用户要求保留的原生成控件设计图及配置快照 |
| 根目录Qiso报告与`probe_*` | 真实渠道探测历史和可复用脚本；保留原日期和验证边界 |
| `outputs/` | 本地证据、日志及临时文件，不提交 |
| `scripts/project-status.mjs` | 本地状态汇总；显式 `--remote` 才读取远程，不推送或部署 |
| `scripts/check-docs.mjs`、`scripts/tests/` | 现行文档链接检查与本地工具行为测试 |
| `.github/workflows/ci.yml` | 统一前端与Go/MySQL检查，复用一次前端安装和构建 |

移除旧版HTML/JS/CSS、Endfield字体和皮肤、旧前端专用测试，以及被替代的旧UI说明和双图页面计划。后端旧接口兼容、历史任务、图片压缩设定和Qiso探测资料保留。

删除的远程过渡分支：`codex/frontend-rewrite`（已合并）、`codex/studio-integration`（现用代码已收拢到main）、`codex/frontend-preview`（独立UI来源，所需UI改动已适配到现用前端）。UI来源完整历史通过归档标签 `archive/ui-studio-preview-2026-11-07` 保留；旧生产界面可在 `ebee61e` 及更早提交中查看，不需长期保留开发分支。

UI原本的模拟代码历史保留于本地 `archive/ui-local-before-consolidation-2026-11-07` 分支和 `outputs/consolidation-2026-11-07/ui-history.bundle`。后续推送只从UI目录的main进行，不再推送旧模拟分支布局。
