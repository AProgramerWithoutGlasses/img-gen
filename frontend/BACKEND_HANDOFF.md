# 新前端接手说明

> 2026-11-06 接入更新：本档案保留合并时的交接基线；当前实现已接入服务端，默认入口、接口、验证和未实测边界以 [前后端适配说明](../docs/studio-integration.md) 为准。下文“当前未实现/模拟”的描述指本次接入前的状态。

核对日期：2026-11-06。后端基线为 main 的 bdb08b0，前端来源为 UI Studio 的 81a99e2。
本分支新增 frontend/，仍是可独立运行的模拟前端；现有 Go 服务、web/ 和生产首页尚未切换，也未部署。

## 运行与替换入口

在 frontend/ 执行 npm ci、npm run dev；npm run verify 执行前端检查，npm run build 输出 dist/。
浏览器测试在 Windows 使用 Edge，Linux 使用 Playwright Chromium；CI 需先安装 Chromium 及其系统依赖。
hash 路由入口为 #/login、#/create、#/gallery、#/settings/*。源码路径以下均相对 frontend/。

| 位置 | 后端接入职责 |
| --- | --- |
| src/types.ts | 保持页面使用的 StudioData / StudioActions 契约，集中映射服务端字段 |
| src/state/StudioContext.tsx | 将本地状态变更替换为请求、查询缓存和任务轮询；成功响应后更新 UI |
| src/services/persistence.ts | 目前使用 IndexedDB；身份、余额、价格、图片归属必须改以服务端为准 |
| src/services/previewAuth.ts、src/data/seed.ts | 固定演示登录与样例数据，上线前移除 |
| src/config/models.ts | 当前五模型配置；待服务端返回能力、限制和有效组合 |
| src/lib/images.ts | 上传读取与下载适配，替换 data URL 为服务端资源 |

## 当前后端已有接口

以下依据本分支 Go 源码，不代表新版前端已连接这些接口。API 错误为带 error 字段的 JSON；401 处理为会话失效，403 为无权限，409 保留输入并提示冲突，429 尊重 Retry-After。

| 前端用途 | 已有接口／字段 | 适配重点 |
| --- | --- | --- |
| 登录 | POST /api/auth/login，JSON {username,password}，成功直接返回 user | Cookie 为 qiso_session，HttpOnly、SameSite=Strict、7天；Secure 依服务端配置或TLS。同源请求，客户端不读取或保存Cookie令牌 |
| 当前账号／退出 | GET /api/auth/me；POST /api/auth/logout | user 为 id、username、role、active、credits、created_at；映射 active→status、credits→balance、created_at→createdAt。me 另含 credits_held、credits_spent、recharge_enabled（目前false） |
| 改密 | POST /api/auth/password，JSON {current_password,password} | 成功使会话版本失效；清理前端身份并返回登录，不把本地模拟成功当作真实改密 |
| 模型价格 | GET /api/prices 或 GET /api/admin/prices，返回 {items:[{model,credits,version,updated_at}]} | PATCH /api/admin/prices/{model} 发送 {credits,version}；允许0–1000000整数，需保留version并处理409并发冲突 |
| 用户列表／创建 | GET /api/admin/users?q=&page=，返回 items、total、page、page_size=24；POST 同路径发送 {username,password,role}，返回 {id} | 当前创建总是active=true，不接收前端新建表单的停用状态；需后端明确扩展，不静默忽略 |
| 更新用户／积分 | PATCH /api/admin/users/{id} 接受 role、active、password；POST /api/admin/users/{id}/credits 接受 {delta,note,request_id} | 积分调整须非零整数、必填原因、32位十六进制request_id；前端当前仅金额，需补原因和幂等请求ID。账号更新的会话影响遵循后端 |
| 任务查询 | GET /api/jobs；GET /api/admin/jobs；GET /api/jobs/{id} | 列表返回 items、total、page、page_size=24、stats。个人列表始终按当前用户；管理员列表可跨用户 |
| 配置 | GET /api/config | 目前仅configured、max_batch=20、max_per_model=4、max_upload_mb=12；不是完整模型能力接口 |

除登录外，/api/* 均要求会话；/api/admin/* 还校验管理员。JSON接口拒绝未知字段，按上述契约构造请求，不直接提交整个前端对象。服务端禁止跨站提交并检查 Origin，开发联调应配置同源代理，而非直接假定跨域 Cookie 可用。此迁移没有新增代理或放宽后端安全头。

## 生成提交与任务映射

POST /api/jobs 当前只解析 multipart/form-data，不是 JSON body：

- 文生图：mode=generate、prompt、ratio、resolution，并传 model + count；或单个 models 字段，其内容为 JSON 数组，例如 [{"model":"gpt-image-2","count":2}]。
- 编辑：mode=edit，基础图为文件字段 image，或已有图片 base_image_id（二者互斥）；可再传一个文件字段 reference。当前最多一张基础图加一张参考图，各12MB；只接受有效PNG/JPEG，总请求上限25MB。
- 可传 expected_credits；价格与当前冻结值不同返回409。成功202返回 {batch_id,ids,credits_reserved}，每张图独立创建一个任务。
- 任务状态 queued / running → 前端 processing，succeeded → completed，failed → failed。同一 batch_id 的多个 job 需聚合为一轮对话；每条job含 images、credits_cost、credits_state、created_at、started_at、finished_at、error。
- 保留服务端每图状态，支持同批部分失败；不要把一个job完成误当整批完成。初次提交可保留ids顺序；历史接口目前没有稳定的批内outputIndex，若要严格恢复编号顺序应补服务端持久化字段。
- 轮询已有 GET 接口即可先接通；当前没有 SSE 接口。失败或提交结果未知不能自动重发，防止重复计费；积分结算和退款以服务端为准。

五个模型ID与新版一致：gpt-image-2、gpt-image-1.5、gpt-image-2.5-sunburst、gemini-3.1-flash-image、gemini-3-pro-image。
参数能力尚不一致：新版中文“自动”需映射auto；后端默认分辨率值为default；当前提交未读取独立quality档位，返回quality是结果信息，不能当作请求档位已生效。新版3K、0.5K、更多比例以及六附件方案均待后端适配。保留新版界面范围，依据实际上游验证完善能力接口和参数映射，不以旧限制直接删减设计，也不把未支持组合当成功提交。

## 图片、图库与文件夹

job.images 每项有 id、url、thumbnail_url、preview_url、mime、width、height、bytes；使用返回的版本化URL，不手工固定版本号。
原图为 /api/images/{id}，下载追加 ?download=1；缩略图与预览分别为 /api/images/{id}/thumbnail/{version}、/api/images/{id}/preview/{version}。
详情中的 input_picture / reference_picture 提供 url、preview_url、bytes；当前接口没有独立“先上传获得attachmentId”流程。

当前没有独立图片分页集合、文件夹或用户偏好API。可先由任务列表聚合成功图片；规模增大后增加图片分页，并补图片与文件夹多对多关联：

- 全部图片只计唯一图片；无文件夹关系的图片为“未分类”。
- 加入文件夹只新增关联；部分已有归属可补齐；移出只解除当前文件夹关系。
- 删除文件夹保留所有图片和其他归属；不增加图片删除或回收站。
- 图片下载用原图；结果“添加”进入待发送附件，不等同“加入文件夹”。
- 最新图片按批次排列与文件夹排序需要双方明确服务端时间/序号；已删除的“有新图片·更新”和排序说明不要恢复。

## 请求记录筛选

/api/admin/jobs 支持 page、q、status、model、user_id、username；user_id=legacy 表示旧共享记录。
起止时间通过 start / end 传带时区的RFC3339（前端datetime-local需转换）；未指定时服务端按timezone_offset（浏览器getTimezoneOffset口径）取当天到现在。
stats 为 total、succeeded、active、failed，需映射显示，不能仅统计当前24条。生成耗时可用finished_at−started_at计算，缺失时显示“—”。

## 生产构建衔接

main.go 用 go:embed web/*，Dockerfile 目前只复制web并构建Go，没有Node阶段。因此只提交frontend/不会切换现有首页。
后续接入完成后增加Node构建阶段，将frontend/dist的内容复制到Go构建阶段web/；确认资源base路径、缓存、Cookie同源和下载行为，再做整体发布。
当前CSP包含 style-src 'self'、script-src 'self'；新版图片布局使用React动态style。必须在真实Go响应头下验证布局与CSP行为，不能仅凭Vite预览推断兼容，也不要直接加入unsafe-inline作为默认处理。
新版使用hash路由；由根路径提供时不需SPA路径回退。若改为子路径部署，需同时调整Vite base与资源URL。

## 模拟与交付边界

本地演示账号admin / user1，公开演示口令preview1234；用户输入密码不写入IndexedDB。新建用户只演示列表，不建立真实登录凭据。改密与充值均明确未接入。
预览结果为SVG占位图；约1.3秒等待、刷新中断任务的本地返还逻辑均非生产策略。IndexedDB只用于单标签预览，不承担生产多端同步。
界面测试不验证真实鉴权、生图、收费、上游能力或线上部署。后端接入应保留现有测试并增加真实服务协议检查。
迁移来源提交81a99e2；回退标签snapshot/frontend-before-migration-2026-11-06仅保存在原UI Studio本地仓库，不是本远程仓库可用的标签。此分支以bdb08b0为共同基线，可通过Git提交比较检查迁移内容。
