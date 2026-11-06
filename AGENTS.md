# UI Studio

- 用中文沟通，少讲说明，优先展示设计与截图。
- 这是独立的本地 UI 设计项目，从空白开始；不继承 img-gen 的规范、主题、token、组件皮肤或业务页面。React/Vite 只是预览基础。
- 主设计工具使用 FigCraft，工作稿是 `design/start.figcraft`。程序使用 `C:\Program Files\ArtCraft\FigCraft` 中的安装版，路径和端口统一在 `figcraft.config.json`。
- OpenPencil 旧项目仅作备份，位于 `archive/openpencil-2026-11-06.zip`；不对旧稿继续设计。
- 仅本地运行，不同步业务数据、不接后端、不 push、不部署。
- AI 负责主要设计操作，用户给方向与审阅。先确定首个界面，再做一张代表性画面；审阅后再扩展，不预先生成大量页面或规范板。
- 通过 FigCraft 桌面附加 MCP 操作同一份可见文档。MCP 会自动启动/复用项目应用，也可运行 `npm run design:open`。
- 操作前先用 `doc.list` 和浅层 `inspect_document` 核对目标文档、选区与未保存状态；每次编辑明确传 `document`，不依赖当前激活标签。
- 用 `list_commands {filter}` 小范围查参数；批量创建/修改优先用 `batch` 和 `as/$ref`，只在需要时读取更深节点。不要一次拉取整个命令目录。
- 原生 `batch` 默认遇错回滚，整批一个撤销步骤；不在普通批处理中开启 `onError: continue`。传输报错后先检查文档，不自动重放写操作。
- 重复批操作可保存 JSON 数组到 `design/commands/`，执行 `npm run design:batch -- <文件.json>`，作用于工作稿并保存。已有未保存人工改动时，先核对后再合并操作。
- MCP 编辑后保存，再运行 `npm run design:verify`；它审计磁盘工作稿并导出每页顶层画面。实时画布截图用 `npm run design:snapshot -- <可选节点ID>`，不能把旧磁盘导出误当实时画布。
- 当前工作稿只有空页时，导出会明确报告跳过；不要为填充截图而自行开始产品设计。
- 程序负责截图、批量导出、节点统计与回归检查；CLI/MCP 速度差异必须实测。视觉与交互质量仍需结合实际截图判断。
- 修改前读相关文件，简短说明最小改动点；不凭旧后端限制设计选项。
- 代码修改后运行 `npm run verify`。修改 FigCraft 连接/自动化时另跑 `npm run design:smoke`，它在临时文档中验证桌面 MCP、回滚、撤销、保存重开和导出一致性。
- 验证通过后本地 Git commit。截图、日志、临时测试稿均放 `outputs/`，不提交；不要提交密钥或缓存。
- 需要生成图像时使用 CLI/API 备用方式。
