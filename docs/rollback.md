# 回退点

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
