# Qiso Studio

一个基于实测可用能力的图片生成与编辑网站。后端 Go，数据库 MySQL，前端为原生 HTML / CSS / JavaScript，随 Go 二进制一起内嵌发布，无需 Node.js 构建。

## 功能

- 中文创作工作台，适配桌面和手机。右上角支持白天 / 黑夜 / 跟随系统，默认跟随系统并记住选择；系统外观变化时实时切换。
- 提示词下方可点击“润色提示词”，由 `gpt-6-luna` 润色后回填，支持撤销；编辑模式强调局部修改与保留要求。润色期间修改内容或切换模式时，不覆盖新输入。
- GPT Image 2 / 1.5 / 2.5 Sunburst 文字生图，自动、1:1、16:9、9:16、3:2 比例提示。
- Gemini Flash / Pro 名称使用原生 generateContent，支持默认配置或已测通的 16:9 + 2K 组合。
- GPT Image 2 与 Gemini Flash 参考图编辑，上传或拖入 PNG / JPEG，也可以继续编辑已有作品。
- 默认使用单模型和数量下拉框；展开“多模型对比”后才启用多选，收起即恢复单模型。多模型共用提示词、参考图和画面设定；每个模型分别选择 1–4 张，每批最多 20 张，每张独立请求、独立记录、独立计费。后台两名 worker，最多 20 个待处理任务。
- MySQL 保存任务、提示词、实际请求参数、参考图、原始结果图片、真实尺寸、格式、耗时、返回模型和请求 ID。
- 历史搜索、状态筛选、分页、详情、原图下载、参数复用。失败重试需再次点击提交，不会自动产生新的计费调用。
- 网站访问密码、同源提交校验；上游密钥仅存服务端，不返回浏览器。

GPT 与 Gemini 混选时使用共同已验证的自动画面 / 默认分辨率；仅选 GPT 时可选比例提示，仅选 Gemini 时可选默认或 16:9 + 2K。切换到混选会将画面设定重置为默认。整批校验通过后一次入队，队列容量不足或任一配置无效时不会部分提交。复用历史单张作品时，只选择该作品对应的模型，数量重置为 1。

## 能力边界

选项依据根目录的 `Qiso-图片生成与编辑接口测试汇总-2026-10-24.md`，不是按供应商文档猜测支持性：

| 模式 | 实现 | 限制 |
|---|---|---|
| GPT 生图 | `/v1/images/generations`，只发 model / prompt；比例追加到提示词 | 不承诺精确像素，不发送未可靠生效的 quality / size / n / output_format |
| GPT 编辑 | `/v1/images/edits`，multipart 的 image / model / prompt | 仅开放已测通的 Image 2；不开放 mask、尺寸和质量控制 |
| Gemini 生图 | `/v1beta/models/{model}:generateContent` | 只开放默认或 16:9 + 2K 组合；不把 2K 当作固定像素 |
| Gemini 编辑 | 同原生接口，inlineData 参考图 | 仅开放已测通的 Flash 默认配置 |
| 多张 | 由本站建立多个独立任务 | 每张会单独调用，不依赖 n 字段 |

Gemini Pro 名称的测试响应曾返回 Flash 的 modelVersion，不能确认底层 Pro 身份。历史详情同时展示请求名称和上游返回名称。质量只展示响应元数据，不是画质评分。输出支持实测的 PNG / JPEG base64，当前不处理远程图片 URL、WebP 或聊天兼容接口。

## 本地启动（Go + 已有 MySQL）

需要 Go 1.25+、MySQL 8.0+（使用 `SKIP LOCKED`；推荐 8.4）。先创建专用数据库和用户：

```sql
CREATE DATABASE imggen CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'imggen'@'localhost' IDENTIFIED BY 'replace-with-random-password';
GRANT ALL PRIVILEGES ON imggen.* TO 'imggen'@'localhost';
```

图片原始字节保存在 MySQL，建议在 MySQL 配置中设置 `max_allowed_packet=128M`。服务启动会自动创建 `jobs` / `images` 两张表，无需手动导入 SQL。

```powershell
Copy-Item .env.example .env
# 编辑 .env，填写 MYSQL_DSN、QISO_API_KEY、APP_PASSWORD
go run .
```

浏览器打开 <http://127.0.0.1:8080>，用户名 **admin**，密码是 `APP_PASSWORD`。这是单个私有工作室，所有登录者共享历史，不包含多人账号隔离。

`.env` 会自动加载，进程环境变量优先。不需要把上游密钥填进网页。QISO_BASE_URL 应为基础地址，例如 `https://api.qiso.io`，不要附加 `/v1`。

| 配置 | 用途 |
|---|---|
| `LISTEN_ADDR` | 默认 `127.0.0.1:8080` |
| `MYSQL_DSN` | `imggen:password@tcp(127.0.0.1:3306)/imggen?charset=utf8mb4&parseTime=true&loc=UTC` |
| `QISO_BASE_URL` | 默认 `https://api.qiso.io` |
| `QISO_API_KEY` | Qiso 上游密钥；未配置时可以看网站和历史，不能提交任务 |
| `APP_PASSWORD` | 网站访问密码；对外服务必须设置 |
| `APP_DEV_MODE` | 明确设为 true 且绑定回环 IP 时，允许本机无密码开发 |

所有数据库连接使用 UTC；API 返回带时区的时间，页面按浏览器本地时区显示。

## Docker Compose

复制 `.env.example` 为 `.env`，至少修改以下值：

```dotenv
QISO_API_KEY=your-qiso-key
APP_PASSWORD=your-random-site-password
MYSQL_PASSWORD=your-random-database-password
MYSQL_ROOT_PASSWORD=your-random-root-password
```

```bash
docker compose up -d --build
docker compose logs -f app
```

Compose 会启动 MySQL 8.4 并创建专用数据库，自动等待数据库就绪。数据库不暴露主机端口，网站默认仅发布到 `127.0.0.1:8080`。外网访问时在前面配置 HTTPS 反向代理，转发原始 Host。HTTP Basic 密码应通过 HTTPS 传输。Docker 采用 Compose 中的 MYSQL_DSN，不使用 `.env` 里的本地 MYSQL_DSN。

数据库保存在 `mysql-data` 命名卷中。升级可运行 `docker compose up -d --build`；不要用 `docker compose down -v`，它会删除数据库卷。历史原图和参考图都在数据库中，备份数据库即可一并备份作品。

## 任务和故障行为

提示词润色使用服务端 `QISO_BASE_URL` / `QISO_API_KEY`，单次调用 `POST /v1/responses`，固定模型 `gpt-6-luna`，非流式、`store=false`。只发送提示词和模式相关指令，不上传参考图、不创建生图任务或数据库记录。每次点击可能产生独立文本调用费用，单实例同时只执行一次润色，50 秒超时；失败、取消或响应不完整均不自动重试，也不切换模型或接口。需要渠道开通该模型的 Responses 权限；原有图片探测报告未验证这个文本接口，mock 测试不代表真实渠道已测通。

1. 浏览器提交 multipart 表单，Go 校验能力组合及参考图后，将整批任务事务写入 MySQL，立即返回任务 ID。
2. worker 在事务中领取任务，调用相应上游接口，最长等待 5 分钟。
3. 从真实图片内容读取格式和宽高，将图片与成功状态放在同一事务提交。
4. 网页每 4 秒更新状态；关闭网页不取消已保存任务。历史不依赖 localStorage，localStorage 只记住当前批次的 ID。
5. 服务重启后 queued 任务继续执行，running 任务标记为失败，提示用户手动决定是否重试。不能确认上游是否已计费时，不自动重发。

同一数据库用 MySQL advisory lock 限制单个服务实例；失去锁连接会停止服务。需要横向扩容时应先重新设计队列租约、实例恢复和限流策略。当前没有自动清理历史，图片增长会占用数据库空间。

上传最大 12 MB，PNG / JPEG；输出单张最大 24 MB、6400 万像素，上游响应整体最大 72 MB。保存图片失败时保留失败任务；上游可能已完成并计费，排查 `max_allowed_packet` 和磁盘空间后再决定重试。

排查顺序：`/healthz` → 服务日志 → 历史详情的任务 ID、请求 ID、调用路径、实际提示词。服务不记录密钥或完整上游错误体，前端不显示完整上游响应。

## 验证

```bash
go test ./...
go vet ./...
go build ./...
```

默认测试涵盖两类接口的生成/编辑请求构造、Gemini 多 part 响应、真实图片格式与尺寸、无图/错误响应、取消、参数约束、认证与跨站提交校验。

真实 MySQL 集成测试需要一个**空的、名称以 `_test` 结尾的专用数据库**：

```powershell
$env:TEST_MYSQL_DSN='root:password@tcp(127.0.0.1:3306)/imggen_test?parseTime=true'
go test -v ./...
```

该测试通过模拟上游验证批量入队、两个 worker、成功/失败持久化、编辑原图、原图下载、历史检索分页、重新创建服务实例后读历史，以及 UTC 时间。只清理由本次测试建立的任务。GitHub Actions 使用 MySQL 8.4 并执行 `go test -race`。

本地验证说明见 [docs/VALIDATION.md](docs/VALIDATION.md)。模拟上游测试不证明当前 Qiso 渠道真实可用性；配置真实密钥后的首次调用需要自行验证。

## 代码位置

- `main.go`：配置、MySQL 连接、单实例锁、启动和退出。
- `provider.go`：能力校验、GPT / Gemini 协议适配、图片解码。
- `server.go`：HTTP API、认证、队列 worker、结果持久化。
- `store.go`：数据库初始化与记录读取。
- `web/`：创作页面、历史页面、样式与浏览器交互。
- `*_test.go`：协议与数据库集成测试。
- 根目录测试汇总及 `probe_*.py`：已有接口探测依据；探测脚本从环境读取密钥，执行可能产生真实计费。

原始探测输出 `outputs/`、本地验证目录 `.local/`、`.env` 不提交 Git。测试汇总中的原始证据链接指向当时的本地文件，远程克隆后不会自带这些原图。首页示例 `web/sample.jpg` 来自已提供的 Gemini 测试图，已缩小压缩，仅作示例，不计入用户历史。
