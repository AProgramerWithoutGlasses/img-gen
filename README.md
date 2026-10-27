# Qiso Studio

一个基于实测可用能力的图片生成与编辑网站。后端 Go，数据库 MySQL，前端为原生 HTML / CSS / JavaScript，随 Go 二进制一起内嵌发布，无需 Node.js 构建。

## 功能

- 中文创作工作台，适配桌面和手机。右上角支持白天 / 黑夜 / 跟随系统，默认跟随系统并记住选择；系统外观变化时实时切换。
- 提示词下方可点击“润色提示词”，由 `gpt-6-luna` 润色后回填，支持撤销；编辑模式强调局部修改与保留要求。润色期间修改内容或切换模式时，不覆盖新输入。
- GPT Image 2 / 1.5 / 2.5 Sunburst 文字生图，自动、1:1、16:9、9:16、3:2 比例提示。
- Gemini Flash / Pro 名称使用原生 generateContent。Flash 可选默认配置或横向 16:9 + 1K / 2K / 4K；Pro 可选默认或横向 16:9 + 2K。日常推荐 2K，放大或裁剪可选 4K，生成更慢、文件更大。
- 双图参考编辑：**基础图 + 参考图 + 一句修改说明**，例如“把画面中间的小猫换成参考图里的小猫”。基础图可自行上传或从历史作品“一键修图”载入；参考图提供要借用的对象或外观。两张图分别支持上传或拖拽 PNG / JPEG（每张最大 12 MB），图片可独立替换或移除。点击“开始编辑”才提交，结果另存为新作品。
- 双图编辑仅开放实测成功的 GPT Image 2 默认配置。Gemini Flash 本轮双图实测没有返回图片，暂不开放；旧单图任务仍可查看和按原协议手动重试。历史详情、参数复用、失败重试会保留基础图和参考图两种角色。
- 默认使用单模型和数量下拉框；展开“多模型对比”后才启用多选，收起即恢复单模型。多模型共用提示词、参考图和画面设定；每个模型分别选择 1–4 张，每批最多 20 张，每张独立请求、独立记录、独立计费。后台两名 worker，最多 20 个待处理任务。
- MySQL 保存任务、提示词、实际请求参数、参考图、原始结果图片、真实尺寸、格式、耗时、返回模型和请求 ID。
- 历史搜索、模型 / 状态组合筛选、分页、详情、原图下载、参数复用。失败重试需再次点击提交，不会自动产生新的计费调用。
- 独立账号登录、退出和修改密码；普通用户仅可查看自己的历史、详情、参考图与原图。
- 仅管理员登录后显示管理后台：创建账号、调整角色、启停账号、重置密码；按用户 / 提示词 / 状态筛选所有生图请求，查看完整输入、参考图、生成结果与失败原因。
- 服务端角色与数据归属校验，密码 PBKDF2-SHA256 加盐存储，HttpOnly / SameSite 会话 Cookie、登录限流和同源提交校验；上游密钥仅存服务端，不返回浏览器。

GPT 与 Gemini 混选时使用共同已验证的自动画面 / 默认分辨率；仅选 GPT 时可选比例提示，仅选 Flash 时可选默认或 16:9 + 1K / 2K / 4K，包含 Pro 的 Gemini 组合仅可选默认或 16:9 + 2K。切换模型或模式后，若原档位不再支持则重置为默认。整批校验通过后一次入队，队列容量不足或任一配置无效时不会部分提交。复用历史单张作品时，只选择该作品对应的模型，数量重置为 1，并恢复原分辨率档位。

## 能力边界

选项依据根目录的 `Qiso-图片生成与编辑接口测试汇总-2026-10-24.md` 和 `Qiso-图片清晰度参数实验-2026-10-26.md`，不是按供应商文档猜测支持性：

| 模式 | 实现 | 限制 |
|---|---|---|
| GPT 生图 | `/v1/images/generations`，只发 model / prompt；比例追加到提示词 | 不承诺精确像素，不发送未可靠生效的 quality / size / n / output_format |
| GPT 双图编辑 | `/v1/images/edits`，multipart 两个 `image[]`，按基础图、参考图排序；附明确图片角色的 prompt | 10 月 27 日实测 Image 2 成功替换小猫；仅默认配置，不开放 mask、尺寸和质量控制 |
| Gemini 生图 | `/v1beta/models/{model}:generateContent` | 默认或横向 16:9 档位；Flash 支持 1K / 2K / 4K，Pro 支持 2K，不承诺固定像素或等比例细节提升 |
| 旧单图编辑 | GPT `image` / Gemini Flash 原生 `inlineData` | 保留旧任务兼容；Gemini 双图本轮未出图，网页双图不开放 |
| 多张 | 由本站建立多个独立任务 | 每张会单独调用，不依赖 n 字段 |

Gemini Pro 名称的测试响应曾返回 Flash 的 modelVersion，不能确认底层 Pro 身份。历史详情同时展示请求名称和上游返回名称。质量只展示响应元数据，不是画质评分。输出支持实测的 PNG / JPEG base64，当前不处理远程图片 URL、WebP 或聊天兼容接口。

## 本地启动（Go + 已有 MySQL）

需要 Go 1.25+、MySQL 8.0+（使用 `SKIP LOCKED`；推荐 8.4）。先创建专用数据库和用户：

```sql
CREATE DATABASE imggen CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'imggen'@'localhost' IDENTIFIED BY 'replace-with-random-password';
GRANT ALL PRIVILEGES ON imggen.* TO 'imggen'@'localhost';
```

图片原始字节保存在 MySQL，建议在 MySQL 配置中设置 `max_allowed_packet=128M`。服务启动会自动创建 `users` / `sessions` / `jobs` / `images` / `model_prices` / `credit_ledger` 表并迁移旧结构，无需手动导入 SQL。旧任务保留为“历史共享记录”，只在管理员请求记录中可见，不会错误归属到某个新用户。

```powershell
Copy-Item .env.example .env
# 编辑 .env，填写 MYSQL_DSN、QISO_API_KEY、ADMIN_PASSWORD
go run .
```

浏览器打开 <http://127.0.0.1:8080>，使用登录表单登录。首次启动在用户表为空时创建管理员：用户名为 `ADMIN_USERNAME`（默认 **admin**），密码为 `ADMIN_PASSWORD`，未设置时兼容读取旧的 `APP_PASSWORD`。密码须为 4–128 字节。已有用户时不会因重启或修改环境变量而覆盖账号密码；修改密码请使用账号设置或管理员后台。

本项目为私有工作室，不开放公开注册，管理员在“管理后台 → 用户管理”创建账号。普通用户只看自己的作品；管理员的创作空间和历史作品也只展示自己的记录，所有用户的内容统一在“请求记录”查看。用户管理采用停用账号来收回访问权，不删除用户和历史证据。角色、状态或密码更新后，已有会话立即失效；至少保留一个启用的管理员。已提交的生成任务继续执行，停用账号不会自动取消或重新调用上游。

`.env` 会自动加载，进程环境变量优先。不需要把上游密钥填进网页。QISO_BASE_URL 应为基础地址，例如 `https://api.qiso.io`，不要附加 `/v1`。

| 配置 | 用途 |
|---|---|
| `LISTEN_ADDR` | 默认 `127.0.0.1:8080` |
| `MYSQL_DSN` | `imggen:password@tcp(127.0.0.1:3306)/imggen?charset=utf8mb4&parseTime=true&loc=UTC` |
| `QISO_BASE_URL` | 默认 `https://api.qiso.io` |
| `QISO_API_KEY` | Qiso 上游密钥；未配置时可以看网站和历史，不能提交任务 |
| `ADMIN_USERNAME` | 首次初始化管理员用户名，默认 `admin`；3–32 位字母、数字、_、.、-，以字母、数字或 _ 开头 |
| `ADMIN_PASSWORD` | 首次初始化管理员密码，4–128 字节 |
| `APP_PASSWORD` | 兼容旧配置，仅在未设置 `ADMIN_PASSWORD` 且用户表为空时使用 |
| `COOKIE_SECURE` | HTTPS 部署设为 `true`，让会话 Cookie 仅通过 HTTPS 发送；本机 HTTP 默认 `false` |

所有数据库连接使用 UTC；API 返回带时区的时间，页面按浏览器本地时区显示。

## Docker Compose

复制 `.env.example` 为 `.env`，至少修改以下值：

```dotenv
QISO_API_KEY=your-qiso-key
ADMIN_PASSWORD=your-random-admin-password
MYSQL_PASSWORD=your-random-database-password
MYSQL_ROOT_PASSWORD=your-random-root-password
```

```bash
docker compose up -d --build
docker compose logs -f app
```

Compose 会启动 MySQL 8.4 并创建专用数据库，自动等待数据库就绪。数据库不暴露主机端口，网站默认仅发布到 `127.0.0.1:8080`。外网访问时在前面配置 HTTPS 反向代理，转发原始 Host。公网部署应使用 HTTPS 并设置 `COOKIE_SECURE=true`。登录已改为表单与服务端会话，旧 HTTP Basic 客户端需先调用 `POST /api/auth/login` 并保存 Cookie。Docker 采用 Compose 中的 MYSQL_DSN，不使用 `.env` 里的本地 MYSQL_DSN。

数据库保存在 `mysql-data` 命名卷中。升级可运行 `docker compose up -d --build`；不要用 `docker compose down -v`，它会删除数据库卷。历史原图和参考图都在数据库中，备份数据库即可一并备份作品。

## 任务和故障行为

提示词润色使用服务端 `QISO_BASE_URL` / `QISO_API_KEY`，单次调用 `POST /v1/responses`，固定模型 `gpt-6-luna`，非流式、`store=false`。只发送提示词和模式相关指令，不上传参考图、不创建生图任务或数据库记录。每次点击可能产生独立文本调用费用，单实例同时只执行一次润色，50 秒超时；失败、取消或响应不完整均不自动重试，也不切换模型或接口。需要渠道开通该模型的 Responses 权限；原有图片探测报告未验证这个文本接口，mock 测试不代表真实渠道已测通。

1. 浏览器提交 multipart 表单，Go 校验能力组合及参考图后，将整批任务事务写入 MySQL，立即返回任务 ID。
2. worker 在事务中领取任务，调用相应上游接口，最长等待 5 分钟。
3. 从真实图片内容读取格式和宽高，将图片与成功状态放在同一事务提交。
4. 网页每 4 秒更新状态；关闭网页不取消已保存任务。历史不依赖 localStorage，localStorage 按账号分别记住当前批次的 ID，不保存密码或会话令牌。
5. 服务重启后 queued 任务继续执行，running 任务标记为失败，提示用户手动决定是否重试。不能确认上游是否已计费时，不自动重发。

同一数据库用 MySQL advisory lock 限制单个服务实例；失去锁连接会停止服务。需要横向扩容时应先重新设计队列租约、实例恢复和限流策略。当前没有自动清理历史，图片增长会占用数据库空间。

基础图与参考图各最大 12 MB，PNG / JPEG，双图表单整体最大 25 MB；输出单张最大 24 MB、6400 万像素，上游响应整体最大 72 MB。保存图片失败时保留失败任务；上游可能已完成并计费，排查 `max_allowed_packet` 和磁盘空间后再决定重试。

双图实测依据：[2026-10-27 双图修图测试](Qiso-双图修图接口实验-2026-10-27.md)。浏览器提交 `mode=edit`、`image`（上传基础图）或 `base_image_id`（历史结果图片 ID，二选一）、`reference`（参考图）及提示词。“一键修图”立即切换到编辑界面，不再等待原图下载后重新上传；提交时服务端校验历史图片归属并保存独立的基础图快照。服务端为兼容旧客户端，仍接受不含 `reference` 的旧单图编辑请求。输入图片分别通过 `GET /api/jobs/{id}/input` 与 `GET /api/jobs/{id}/reference` 读取，两者使用同样的账号归属检查。迁移只新增 `reference_image` / `reference_mime` 列，不改写旧数据。

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

该测试通过模拟上游验证批量入队、两个 worker、成功/失败持久化、编辑原图、原图下载、历史检索分页、重新创建服务实例后读历史，以及 UTC 时间。运行前校验数据库无任何表；结束后清理本次建立的六张表。账号测试覆盖登录、角色权限、跨用户任务 / 参考图 / 下载隔离、历史共享记录、停用、改密、会话失效和最后一个管理员保护。GitHub Actions 使用 MySQL 8.4 并执行 `go test -race`。

本地验证说明见 [docs/VALIDATION.md](docs/VALIDATION.md)。模拟上游测试不证明当前 Qiso 渠道真实可用性；配置真实密钥后的首次调用需要自行验证。

## 代码位置

- `main.go`：配置、MySQL 连接、单实例锁、启动和退出。
- `provider.go`：能力校验、GPT / Gemini 协议适配、图片解码。
- `server.go`：HTTP API、认证、队列 worker、结果持久化。
- `store.go`：数据库初始化、兼容迁移与记录读取。
- `auth.go` / `admin.go`：用户、登录会话、密码管理和管理员 API。
- `credits.go` / `request_time.go`：积分冻结与结算、价格配置、积分流水和请求时间筛选。
- `web/`：创作页面、历史页面、样式与浏览器交互。
- `*_test.go`：协议与数据库集成测试。
- 根目录测试汇总及 `probe_*.py`：已有接口探测依据；探测脚本从环境读取密钥，执行可能产生真实计费。

原始探测输出 `outputs/`、本地验证目录 `.local/`、`.env` 不提交 Git。测试汇总中的原始证据链接指向当时的本地文件，远程克隆后不会自带这些原图。首页示例 `web/sample.jpg` 来自已提供的 Gemini 测试图，已缩小压缩，仅作示例，不计入用户历史。

## 账号与后台接口

- `POST /api/auth/login`：JSON `{ "username": "admin", "password": "..." }`，成功设置 7 天会话 Cookie。
- `GET /api/auth/me`、`POST /api/auth/logout`、`POST /api/auth/password`（`current_password` / `password`）。
- `GET /api/admin/users?q=&page=1`、`POST /api/admin/users`（`username` / `password` / `role`）。
- `PATCH /api/admin/users/{id}`：可更新 `role`（`user` / `admin`）、`active`、`password`。
- `GET /api/admin/jobs?username=&user_id=&q=&status=&page=1&start=&end=`：按创建时间分页查询生成 / 编辑记录；`user_id=legacy` 查看升级前共享记录，历史记录需要选择包含它们的时间段。`start` / `end` 须同时提供带时区的 RFC3339 时间，精确到秒或毫秒。未传时间默认上海时区今天 00:00 至当前，可用 `timezone_offset`（浏览器 getTimezoneOffset 值）指定默认日期的时区。

记录按每张图片的任务展示，同一批次通过 `batch_id` 关联。提示词润色仍为独立文本工具，不计入生图请求记录。所有 `/api/admin/` 接口均由服务端检查管理员权限；普通 API 的详情和图片只允许本人或管理员访问。禁用和角色变更对后续请求生效，不撤回已经返回的图片。会话过期后需要重新登录。登录按直连 IP 限制为每 15 分钟最多 20 次（包含成功登录）；反向代理后共享这一限额，不信任任意客户端传入的转发 IP 头。

## 积分与模型价格

- 管理后台新增“模型价格配置”，五个模型可分别设置每张图片 `0–1000000` 整数积分，`0` 为免费。初始均为 `1`，不是上游价格换算；请管理员按需调整。同一模型生成、编辑共用单价，任务提交时保存价格快照，后续调价不影响已提交任务。
- 所有用户（包括管理员）初始可用积分为 `0`，旧任务标记为历史记录且不补扣积分。管理员通过“用户管理 → 积分”给自己或用户增加 / 扣减可用余额，并填写原因；不改变账号会话。每次调整有独立幂等编号，不能透支可用积分。
- 提交时在同一数据库事务内验证整批余额、冻结积分并创建任务；任一配置错误或余额不足不会部分扣款或部分入队。前端显示总价，提交时价格变化会拒绝本次请求，刷新报价后由用户重新确认。
- 每张任务成功后结算冻结积分；生成失败、取消、服务重启中断及图片持久化失败会退还冻结积分。任务状态、图片与结算在事务中保存；重复保存不重复扣款 / 退款。退款是本站积分处理，不代表上游退费；仍不会自动重试上游调用。
- 头像下拉菜单提供个人信息、修改密码、积分充值与退出登录。个人信息展示可用 / 冻结 / 累计消耗积分及分页流水。流水中的成功结算可用余额变动为 `0`，因为余额在提交冻结时已经扣减。
- 在线充值入口已预留，当前显示“暂未开放”；尚未接入支付、兑换比例、充值订单或回调，不会模拟付款到账。管理员可暂时通过人工调整入账。未来支付回调应先验签和核验订单，再使用唯一订单号幂等入账；不要向普通用户开放直接改余额接口。
- 提示词润色目前不扣本站积分；上游文本调用仍可能产生费用。

相关接口：`GET /api/prices`、`GET /api/credits/ledger?page=1`（仅本人流水）；管理员使用 `GET /api/admin/prices` 和 `PATCH /api/admin/prices/{model}`（`credits` / `version`，防止覆盖其他管理员修改），以及 `POST /api/admin/users/{id}/credits`（`delta` / `note` / 32 位十六进制 `request_id`）和 `GET /api/admin/users/{id}/credits`。余额和价格均在服务端校验，不能通过修改表单指定实际扣款金额。

请求记录采用列表，包含用户名、请求时间、输入与模型、生成秒数、消耗积分、状态，最右侧显示小图或报错。默认今天 00:00 至当前；1 / 3 / 7 天快捷范围按浏览器本地日期包含今天，结束时间自动更新。自定义开始 / 结束时间可精确到秒，切换为自定义后保持所选范围，手机可横向滚动列表。
