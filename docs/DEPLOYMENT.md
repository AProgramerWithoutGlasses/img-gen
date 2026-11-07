# 服务器部署与升级

站点：`https://img.xunxun.me`，通过 `ssh me` 连接 Ubuntu 服务器。

本地提交、推送与部署分别需要用户对本批工作的明确授权。先完成按累计改动范围所需的检查；只有用户要求提交时才创建提交。推送或部署请求不授权自动补建提交，同意推送不等于同意部署，历史授权不延续。日常发布准备见 [工作流程](workflow.md)，准备本地构建产物不触发提交、推送或部署。

本机 OpenSSH 的 `~/.ssh/config` 使用 `Host me`，连接 `root@8.140.237.54`，指定 `~/.ssh/id_ed25519_aliyun_me` 和 `IdentitiesOnly yes`。专用公钥追加到服务器的授权列表，保留原有密钥；私钥仅保存在本机，不进入仓库。`ssh me` 是 SSH 主机别名，不依赖 PowerShell alias。

## 运行位置

- 应用：`img-gen.service`，以 `imggen` 用户运行，监听 `127.0.0.1:18080`。
- 当前二进制：`/opt/img-gen/current`，指向 `/opt/img-gen/releases/` 下的版本文件。
- 应用配置：`/opt/img-gen/.env`，权限 `root:imggen 0640`；保留服务器原有 API Key、Base URL 和数据库连接。
- HTTPS 会话需要 `COOKIE_SECURE=true`。首次账号迁移使用 `ADMIN_PASSWORD`，未设置时兼容原 `APP_PASSWORD`；已有账号不会被环境变量重置密码。
- MySQL：独立容器 `img-gen-mysql`，数据卷 `img-gen-mysql-data`，监听 `127.0.0.1:13306`，数据库名 `imggen`。此部署沿用既有 MySQL 8.2 容器。
- Nginx：`/etc/nginx/sites-available/img-gen`；`client_max_body_size 25m` 覆盖新版每张附件20MB的独立上传及旧双图表单上限；证书由 `certbot.timer` 续期。调整后先执行 `nginx -t`，通过后 reload。
- 升级备份：`/opt/img-gen/backups/<UTC时间>/`，目录权限 `0700`，备份文件权限 `0600`。
- 发布信息：`/opt/img-gen/release.json`，记录代码提交、二进制 SHA256、前一版本与备份位置，不保存密钥。

## 升级顺序

1. 等待同一项目其他会话完成，核对 `git status`、各分支及未推送提交；禁止将环境文件、数据库、日志或 `outputs/` 加入 Git。
2. 按累计改动范围做一次必要检查，相关源码、配置和依赖输入一致的已有结果可复用，新改动只补受影响检查；不能只凭Git提交号相同复用未提交工作区的旧结果。用户明确人工验收时不反复运行全量浏览器流程。MySQL 集成测试只能使用空的、名称以 `_test` 结尾的专用数据库。
3. 使用用户已明确授权创建的干净提交执行 `node scripts/prepare-release.mjs`，生成或复用Linux amd64产物和清单。待发布改动未提交时先说明需要提交授权，不自动commit、stash或reset。依赖未变化不重装，前端输入和产物未变化不重建，同一提交的完整产物可复用。需要推送时先取得推送授权；需要上传/切换生产版本时另取得部署授权。也可按原方式手动构建，但不得遗漏前端构建。
4. 上传到 `/opt/img-gen/releases/img-gen-<完整提交号>`，比较本机和服务器的 SHA256。
5. 确认没有 `queued` / `running` 任务后停止应用，备份数据库和配置。不要重试不确定是否已经计费的任务。
6. 原子切换 `current` 软链接，启动服务，等待 `/healthz` 返回成功。数据库兼容迁移由程序启动时执行。
7. 检查健康与公网首页、资源来源。相关页面可由用户手动验收，不重复全站浏览器测试；不调用收费生图或润色接口。
8. 若本次获准推送，核对远端分支与指定提交一致；未获准时保持本地提交并说明未推送。

启动失败可将 `current` 切回前一二进制并恢复原配置。数据库迁移独立于二进制切换；恢复数据库前必须核对迁移和新增业务数据，不能自动覆盖线上数据库。

首次启用积分系统后，账号初始余额为 0、模型初始价格为每张 1 积分。管理员需在后台按实际需要配置价格和增加余额；部署过程不擅自调整业务积分。

## 常用只读检查

```sh
systemctl is-active img-gen nginx certbot.timer
readlink -f /opt/img-gen/current
cat /opt/img-gen/release.json
docker inspect --format '{{.State.Health.Status}}' img-gen-mysql
curl -fsS http://127.0.0.1:18080/healthz
nginx -t
df -h /
```

部署证据、浏览器截图和本地操作脚本放在被 Git 忽略的 `outputs/` 中。不得在维护说明或 Git 提交中保存账号密码、API Key、数据库备份或完整上游响应。
