# 回退点

> 历史设计回退记录。当前 UI 项目已经连接远程，开发分支为 `main`；文末“未配置远程”等描述仅属于当时状态。此处的标签/提交来自原 UI 历史，当前 main 不保证有对应本地标签；使用前先 `git rev-parse --verify 标签或提交`，必要时按整合归档或 Git bundle 找回。生产回滚按 [部署说明](../../DEPLOYMENT.md)，不能用设计回退步骤替代。

开始前端实现前已保存设计阶段：

- Git 标签：snapshot/design-before-frontend-2026-11-06
- 对应提交：5cd343b
- 设计单文件备份：outputs/backups/design-before-frontend-2026-11-06.figcraft（本地、不提交）

建议用独立目录查看旧版，不影响当前前端：

```sh
git worktree add ../ui-studio-design-baseline snapshot/design-before-frontend-2026-11-06
```

若只需取出旧设计文件，推荐从该独立目录复制 design/start.figcraft。不要直接重置当前分支，否则会丢失未提交工作。

本轮前端在本地分支 codex/frontend-preview。尚未配置或推送远程仓库。将来要把回退标签一起保存到远程，需要单独推送该标签；普通分支推送不保证附带它。原有未跟踪的本地参考图片目录没有被加入Git或删除。
