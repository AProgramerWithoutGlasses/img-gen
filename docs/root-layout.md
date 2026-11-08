# 根目录逐项说明

根目录保留项目入口与通用工具配置。现行说明放 docs/，项目研究放 research/，渠道实测放 [Qiso 报告目录](providers/qiso/README.md)；个人工具与流程笔记放仓库外，具体见 [资料归属](workflow.md#资料归属)。

## 根文件：逐项保留原因

| 文件 | 用途 | 为什么放在根目录 |
| --- | --- | --- |
| [README.md](../README.md) | 项目首页与操作入口 | GitHub 自动显示的首页 |
| [AGENTS.md](../AGENTS.md) | agent 的项目共同规则 | 共同规则与局部说明的入口 |
| [main.go](../main.go) | Go 的薄启动入口 | 保留 `go run .`、现有构建和发布入口 |
| [go.mod](../go.mod) | Go 模块与依赖版本 | 后端主模块的识别文件 |
| [go.sum](../go.sum) | Go 依赖校验记录 | 与 go.mod 配套，保证依赖可校验 |
| [package.json](../package.json) | 项目统一命令、设计工具依赖 | 从根目录运行 status、build、verify 等命令 |
| [package-lock.json](../package-lock.json) | 根 Node 依赖的精确版本 | 与根 package.json 配套，和前端依赖用途不同 |
| [figcraft.config.json](../figcraft.config.json) | 工作设计稿和设计工具连接配置 | 状态与设计工具共同读取的项目级入口 |
| [Dockerfile](../Dockerfile) | 容器构建配方 | Docker 默认构建入口，与整个项目构建上下文一致 |
| [compose.yaml](../compose.yaml) | 本地容器应用和 MySQL 编排 | Docker Compose 默认查找的位置 |
| [.dockerignore](../.dockerignore) | 排除容器不需要的文件 | 防止依赖、证据、设计、研究进入构建上下文 |
| [.env.example](../.env.example) | 环境变量示例 | 方便复制成仅本地保存的 .env，不含真实凭据 |
| [.gitignore](../.gitignore) | Git 忽略规则 | 防止缓存、日志、凭据和构建产物入库 |
| [.gitattributes](../.gitattributes) | 文本换行和二进制处理规则 | 保证两人及不同系统的 Git 行为一致 |

以上配置由工具读取，不是零散任务资料。无需为了让列表看起来更短而破坏默认入口。

## 根文件夹：逐项职责

| 文件夹 | 用途 |
| --- | --- |
| [.codex/](../.codex/) | 本项目的 agent 工具连接配置 |
| [.github/](../.github/) | CI 工作流和 PR 模板 |
| [frontend/](../frontend/README.md) | 前端页面、样式、模拟预览与前端测试入口 |
| [internal/](../internal/studio/README.md) | 后端业务实现 |
| [web/](../web/README.md) | Go 前端嵌入声明，studio 子目录是生成产物 |
| [design/](../design/README.md) | 当前可编辑设计稿、素材与设计命令 |
| [docs/](README.md) | 现行说明入口；历史资料放 history/，Qiso 实测放 providers/qiso/ |
| [tests/](../tests/README.md) | Go、工具、设计对照与接口探测测试 |
| [research/](../research/README.md) | 有共享价值的项目研究和必要参考素材 |
| [scripts/](../scripts/) | 日常状态、检查、发布准备和设计工具 |
| [deploy/](../deploy/README.md) | Nginx 等部署配置模板 |
| [archive/](../archive/README.md) | 旧设计迁移备份；有独立恢复用途，保留 |

## 只在本机出现的项目

| 本地位置 | 用途与处理 |
| --- | --- |
| .git/ | Git 提交与分支元数据，不是 GitHub 中的普通文件夹，不能随意移动或删除 |
| node_modules/、frontend/node_modules/ | 已安装依赖，不提交；本地运行需要，无需手动整理其中内容 |
| .local/ | 发布、构建缓存，不提交 |
| outputs/、frontend/outputs/ | 检查证据、截图、备份和中间产物，不提交；唯一备份不能整体清空 |
| NVIDIA Corporation/ | 本次发现的空本地驱动目录，已完整移到 outputs/local-cache/；不属于项目源码 |

历史报告保留日期、实验结论与原机器证据的边界。文件移动只修正可维护的引用，不把旧实验冒充新的验证。结构检查会拒绝根目录新增散装 Markdown 报告和单独的专题研究目录。
