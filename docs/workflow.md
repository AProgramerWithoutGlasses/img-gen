# 两人协作与设计交付

## 日常协作

每人使用自己的 img-gen 检出，以 Local 模式工作；不共用一个可写目录切换分支。main 是共同基线，大任务使用 codex/ 前缀短期分支；合并前比较远端，避免覆盖另一人的工作。小改先完成本地修改与受影响验证，再统一提交；大任务按可验证批次提交。提交、推送、发布由 agent 按 [共同规则](../AGENTS.md) 判断，文档变化无需生产部署。

开工用 `npm run status`；需要联网确认时用 `npm run status:remote`，它只读取远端，不 fetch，领先/落后仍来自本地跟踪记录。同步前再 `git fetch --prune origin`，出现分歧先比较，不强推或重置。网络配置因机器不同，不能将某人的代理端口写成全员要求。

## GitHub MCP 与本地开发

GitHub 官方远程 MCP 配置在每台机器的 Codex 用户级 `~/.codex/config.toml`，供不同项目与调研聊天共用，本仓库不重复定义。服务地址为 `https://api.githubcopilot.com/mcp/`。仅开放 13 个只读查询工具，并同时使用服务端 `X-MCP-Readonly`、`X-MCP-Tools` 与客户端 `enabled_tools` 限定范围；不安装额外的本地服务、Docker 镜像或第三方代理包。项目级 `.codex/config.toml` 中的 FigCraft 配置继续使用。

agent 按任务需要查询，不把联网查询变成每次开工的必做项：

| 场景 | MCP 用途 | 后续动作 |
| --- | --- | --- |
| 与协作者对接 | 查询提交、PR 差异与审查意见 | 同步和判断分歧仍以 Git fetch 后的实际记录为准 |
| 排查自动检查失败 | 查询 Actions 状态、运行与日志 | 本地修复并执行受影响检查，不通过 MCP 触发重跑或发布 |
| 排查用户反馈 | 读取 Issue 和讨论背景 | 按任务实现，不自动发表评论或创建协作记录 |
| 调研成熟方案 | 检索公开仓库和代码 | 记录出处及适用边界，归入 research，不直接导入产品 |

MCP 只读不限制本地文件编辑、Git 或 SSH。用户要求微调并上线时，agent 负责设计稿同步、本地修改、验证、提交、推送与服务器部署，按本批适用授权和发布条件执行，用户无需手动逐项运行命令。直接通过 GitHub API 改文件不能替代这些验证和发布步骤，因此不启用重复的远程改文件入口。

本批首选工具：`get_me`、`get_file_contents`、`search_code`、`search_repositories`、`get_commit`、`list_commits`、`search_issues`、`issue_read`、`search_pull_requests`、`pull_request_read`、`actions_list`、`actions_get`、`get_job_logs`。实际可用工具以服务握手与 `tools/list` 为准，不能因文档列出了名称就认为已经可用。暂不开放仓库写入或删除、远程合并、Actions 触发、Copilot、Gist、通知和企业管理能力。

### 每台机器的授权与启用

用户级配置在授权前设为 `enabled = false`。每台机器分别使用自己的细粒度 PAT，通过 `GITHUB_MCP_TOKEN` 环境变量提供；不得将令牌写入仓库、项目 `.env`、报告或聊天。本机当前先配置公开项目调研：Repository access 选择 Public repositories，不额外增加账户权限；先验证登录身份和公开仓库读取，不把公开访问通过当作私有 img-gen 已授权。后续需要读取私有仓库时，再按账号实际可选范围单独处理；若可选择 `AProgramerWithoutGlasses/img-gen`，仅授予 Contents、Issues、Pull requests、Actions 的 Read 和 GitHub 自动包含的 Metadata Read。全局可用不等于取得所有私有仓库权限。

申请私有仓库权限前，先确认账号能够选择该仓库；协作者账号或端点兼容性存在限制时说明具体原因，不自动扩大为所有私有仓库权限。Git 的既有登录不等于 MCP 授权，Codex 支持 OAuth 也不代表 GitHub 托管服务在本客户端可以直接 OAuth 登录。

令牌就绪后，agent 在本机用户级配置启用服务并重载，必要时重新打开会话或重启 Codex 以继承环境变量。验收必须完成身份确认、实际工具目录核对、目标仓库读取和已有 Actions 查询；没有 Issue/PR/运行记录时记录为空，不创建测试记录。确认仅所列只读工具可调用，并核对 FigCraft 配置未被更改。全局 MCP 配置和令牌均不随本项目同步，其他协作者需在自己的机器独立配置与授权，不能把本机验收结果当成对方已连接的证据。

未授权、未启用或连接失败时，agent 明确说明实际状态，可使用既有 Git、网页或 API 继续完成任务；不能用缓存或配置文件冒充连接成功。MCP 不负责后台持续监控、不改变提交作者身份，也不替代 [发布检查与回滚](DEPLOYMENT.md)。配置变化本身无需生产部署。

## 设计到反馈

1. 用户按页面描述意图，agent 核对文档、选区与未保存状态，修改并保存指定设计稿。
2. 设计确认后持续完成前端和必要后端适配，按 [测试矩阵](../tests/README.md) 验证，避免逐文件重复确认。
3. 提供本地地址、相关截图和设计/代码同步情况；用户反馈进入同一批修改。
4. 可发布业务版本在本地验证、远端比较和发布条件满足后由 agent 完成提交、推送及 [部署流程](DEPLOYMENT.md)，交付线上地址、版本与健康检查结果。条件不满足时说明具体阻塞。
5. 线上 UI 反馈先进入设计稿，再适配代码；每轮只保留简短交付摘要，重要产品结论写回对应现行文档。

用户无需维护文件路径。agent 负责读取相关局部规则、定位代码、管理验证和交付，普通调研按 [研究规则](../research/AGENTS.md) 独立归档。

## 依赖、构建和本地发布包

首次或锁文件变化才安装相应依赖；前端输入变化后根 `npm run build` 一次同步 web/studio。相同输入通过证据可复用，输入包括未提交源码、配置与依赖，不能只依据提交号判断。

`npm run release:prepare` 从干净提交准备 Linux amd64 二进制，在 outputs/releases/ 写清单、校验和，缓存放 .local/release-cache/；它本身不推送、上传或重启。agent 先完成本批提交后再准备产物，不 stash 隐藏其他人的工作。备份、队列检查、原子切换和健康检查不能因缓存优化省略。

历史整理资料只用于追溯，不把旧聊天路径、旧网络配置和历史分支状态作为当前要求。现行目录见 [文档导航](README.md)。
