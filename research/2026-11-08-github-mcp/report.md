# GitHub MCP 精简接入报告

日期：2026-11-08。状态：公开项目接入已完成。用户已批准全局使用、完成本机令牌设置并重启 Codex；当前聊天实际加载 13 个只读 GitHub 工具，身份、项目搜索和代码搜索调用通过。已整合到 [工作流程](../../docs/workflow.md) 和 [共同规则](../../AGENTS.md)，用户级配置已启用，项目不重复定义。私有 img-gen 访问未验证。

授权范围更新：用户页面显示资源所有者为 `hh5123`，与目标仓库所有者不同。当前先按 Public repositories 配置公开项目调研，不要求用户使用其他人的账号；本机保存脚本改为验证登录身份和公开的 `github/github-mcp-server`。私有 img-gen 访问待单独处理，公开仓库验证不能作为该私有仓库已获授权的证据。下文限定 img-gen 的权限设计仅在账号可选择该仓库时适用。

## 实际接入结果

- GitHub 官方托管 MCP 的 Streamable HTTP 握手成功，协商协议为 `2025-03-26`。
- `tools/list` 恰好返回所选 13 个工具，无缺失、无额外工具；13 个工具均标注 `readOnlyHint = true`。
- `get_me` 实测身份为 `hh5123`。
- `get_file_contents` 成功读取公开仓库 `github/github-mcp-server` 的 README。
- `search_repositories`、`search_code` 和 `actions_list` 实际调用成功；其他工具本轮仅核对目录与只读标注，没有逐个调用，也未验证 Actions 日志读取。
- 用户级配置 `enabled = true`，其他全局配置保持不变；项目 FigCraft 配置与接入前逐字节一致。
- 本机证据在忽略的 `outputs/github-mcp/verification.json`，不保存令牌或完整仓库响应。
- 用户重启后，当前聊天实际暴露的 GitHub 工具与所选 13 个工具一致；直接通过会话工具调用 `get_me`、`search_repositories`、`search_code` 均通过，账号为 `hh5123`。查询返回了官方 `github/github-mcp-server` 仓库和代码文件结果，已完成桌面加载验收。

## 建议

接入一个 GitHub 官方托管的远程 MCP 服务，地址为 `https://api.githubcopilot.com/mcp/`。首批只开放下面的 13 个查询工具，不安装本地 GitHub MCP 服务、Docker 镜像、第三方代理包或额外的 GitHub CLI。

这适合目前两人维护的 img-gen：本地修改、验证、Git 推送和 SSH 发布已经有独立流程，MCP 补充远程协作和检查信息。

## 当前检查结果

- 项目：`D:\ai-work\img-gen`，`main @ 1db8068`；开始检查时工作区干净。
- 用户级和项目级显式 MCP 配置均未发现 GitHub 服务，当前会话也未暴露 GitHub MCP 工具。
- 用户级存在 node_repl、OpenPencil；本项目已禁用 OpenPencil，启用 FigCraft。这些已有配置保持原样，不能仅因本项目用不到就删除其他项目可能使用的工具。
- 本机 Codex CLI 为 0.166.0，具备 MCP 管理命令。Git 可用，未发现 PATH 中的 `gh`，本方案不需要安装它。
- GitHub 官方服务地址未携带凭据访问返回 HTTP 401，说明本次网络请求可达，但不代表已经登录、完成 MCP 握手或取得仓库访问权限。
- 已有 Git 凭据登录不等于 MCP 授权；本轮没有读取、导出或复用 Git 凭据。

## 首批工具清单

| 用途 | 工具 | 对本项目的帮助 |
| --- | --- | --- |
| 确认登录身份 | `get_me` | 避免多账号环境连接错账号 |
| 查看远端文件 | `get_file_contents` | 查看明确分支或版本的文件 |
| 检索代码和项目 | `search_code`、`search_repositories` | 查找成熟方案、公开项目及相关实现 |
| 查看提交 | `get_commit`、`list_commits` | 了解协作者提交了什么、比较版本线索 |
| 查看问题记录 | `search_issues`、`issue_read` | 整理缺陷、需求和讨论背景 |
| 查看合并请求 | `search_pull_requests`、`pull_request_read` | 查看改动差异、审查记录及检查状态 |
| 查看自动检查 | `actions_list`、`actions_get`、`get_job_logs` | 定位哪次检查失败以及具体错误 |

以上名称来自本次读取的 GitHub 官方源码文档。托管服务可能与源码版本不同，执行时必须以实际 `tools/list` 返回结果确认；不能把文档中的工具名称当成已经可用的证据。

首批不启用：直接创建或删除仓库文件、批量推送文件、删除仓库、远程合并、触发或重跑 Actions、Copilot 代写与代审、Gist、通知订阅、组织及企业管理、Projects 看板管理、Discussions 管理、实验功能。代码安全与 Dependabot 专用工具暂不开放，后续有具体维护任务再评估。

创建 Issue、发表评论、创建或修改 PR 有协作价值，但当前尚无明确使用需求，列为后续可选扩展。它们会写入 GitHub 协作记录，不能因为装了工具就自动向他人发送内容。

## 只读 MCP 与本地微调、部署的区别

“只读”仅限制这个 MCP 连接的工具，不限制本地编辑器、Git 或服务器发布工具。

现有流程仍然是：设计稿调整 → 本地代码修改 → 必要检查 → 本地提交 → Git 推送 → 构建并发布服务器 → 检查实际效果。用户提出微调和上线需求后，agent 按适用授权完成这些工作，不需要用户手动逐项执行命令。

GitHub 的直接改文件工具通过 API 修改远程仓库，通常会产生提交。它不替代本地设计同步、构建、浏览器验证、数据库备份或服务器部署，也不能让本地未提交改动自动出现在服务器。因此不把它列入首批，不会增加用户微调上线的操作负担。

MCP 的主要收益是更直接地取得结构化的协作和检查信息；其中许多事情也能通过 GitHub 网页或 API 完成，不能宣传成此前完全做不到的新能力。它也不会自动后台监控仓库、自动部署，或改变提交作者身份。

## 配置与权限方案

1. 按用户追加要求，在 Codex 用户级 `~/.codex/config.toml` 增加 `github` 服务，供本机不同项目与调研聊天共用；项目不重复配置，保留已有 FigCraft 设置。全局服务配置不等于令牌自动取得所有仓库权限，其他协作者的机器也不会随项目同步获得该连接。
2. 使用 Streamable HTTP，显式配置 `enabled_tools` 白名单；同时设置 GitHub 的 `X-MCP-Readonly: true` 和 `X-MCP-Tools` 精确列表，避免启用 `all` 或整套默认功能。服务端筛选结果与客户端白名单都要检查。
3. 认证优先按 GitHub 官方 Codex 接入指南，使用限定仓库的细粒度 PAT，通过本机 `GITHUB_MCP_TOKEN` 环境变量和 `bearer_token_env_var` 引用。令牌不写进项目配置、项目 `.env`、报告或 Git。桌面进程必须实际继承该变量，不能假设设置变量后旧进程立即生效。
4. 在账号允许的情况下，资源所有者和选定仓库限定为 `AProgramerWithoutGlasses/img-gen`；仓库权限仅开放 Contents、Issues、Pull requests、Actions 的 Read，以及 GitHub 自动包含的 Metadata Read。细粒度令牌也包含公开仓库的只读访问，适合公开参考项目调研。
5. 必须先确认实际登录账号及仓库归属。细粒度 PAT 对部分协作者场景有局限，若账号无法选择本仓库或某工具不兼容，先说明具体限制，不悄悄改为可访问所有私有仓库的广泛权限令牌。
6. Codex 支持 OAuth，但 GitHub 官方 Codex 远程接入指南目前给出的方案是 PAT；不能仅凭 Codex 支持 OAuth 就承诺 GitHub 远程服务可直接设备码登录。本轮不为此注册额外 GitHub App，也不安装 OAuth 桥接包。

具体工具权限与托管端支持情况在批准后的只读验收中核对。若必须额外授权才能满足原方案，先说明差异。

## 批准后的执行和验收

1. 备份原 MCP 配置，仅添加上述服务和精确工具列表。
2. 引导用户在 GitHub 官方页面完成令牌创建与本机设置；不要求把完整令牌贴进聊天。
3. 重载 MCP；必要时说明需要重新打开会话或重启应用，保留现有设计工具。
4. 完成 MCP 握手、获取实际工具目录，确认仅开放所列只读能力。
5. 使用 `get_me` 确认身份；读取目标仓库文件和近期提交，查看已有 PR/Issue（没有记录也是有效结果），读取已有 Actions 状态与日志（如有）。不创建测试 Issue、不提交测试文件、不触发发布。
6. 确认没有仓库写入、删除、远程合并或工作流触发工具可调用，并确认 FigCraft 配置未被更改。
7. 交付实际登录账号、仓库读取结果、实际工具列表和限制。只有完成上述验证才能称为“已连接”；仅写入配置或 HTTP 401 均不算成功。

回退只需移除本次新增服务并按需要撤销本次专用令牌，不影响 Git 推送与现有服务器部署方式。

初次报告阶段仅调研。用户随后批准整合，并明确要求全局可用，现已更新工作流和本机 Codex 用户级 MCP 配置，公开项目范围的授权、独立 MCP 连接验收及重启后的聊天内调用验收均已通过。私有 img-gen 访问未验证；此次接入不涉及生产部署。

## 官方资料

以下资料均于 2026-11-08 实际读取：

- [OpenAI：Codex MCP 配置](https://developers.openai.com/codex/mcp/)
- [GitHub：官方 MCP 服务与工具目录](https://github.com/github/github-mcp-server/blob/main/README.md)
- [GitHub：托管服务、工具筛选与只读头](https://github.com/github/github-mcp-server/blob/main/docs/remote-server.md)
- [GitHub：Codex 接入指南](https://github.com/github/github-mcp-server/blob/main/docs/installation-guides/install-codex.md)
- [GitHub：个人访问令牌与细粒度权限限制](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)
