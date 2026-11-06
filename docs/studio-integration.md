# 新前端服务端适配

2026-11-06。基于合并后的 `14dbf36` 和 `frontend/BACKEND_HANDOFF.md`。沿用新版页面和操作，不引入旧视觉规范、双图角色面板、润色、多模型或图片删除功能。

## 启动

```powershell
cd frontend
npm ci
npm run build:server
cd ..
go run .
```

Go 默认提供新前端，需要已有 MySQL 和服务端环境变量。未构建前端时启动明确报错，不回落到旧首页。`web/studio/` 是忽略提交的构建产物；旧 `web/` 文件只为旧接口测试和历史参考保留。Docker 增加 Node 构建阶段，复制 dist 到 Go 的嵌入资源；本轮未执行远程部署。

开发时 `frontend/npm run dev` 同源代理到本机 8080，Cookie 仍由服务端设置，未放宽 CORS、Origin 或 CSP。`npm run dev:preview` 才使用原有 IndexedDB 模拟预览。生产构建剔除模拟 provider、公开演示密码与 seed。

## 操作协议

| 接口 | 行为 |
| --- | --- |
| GET /api/studio/models | 五模型的现有界面选项，保持控件范围；表示可提交参数，不是逐项上游实测认证 |
| GET /api/studio/state | 返回 StudioData、priceVersions；普通用户仅自己的资料和资源，管理员可读取请求记录需要的全部记录；不含密码和图片二进制 |
| POST /api/studio/attachments | multipart 的 image 字段，单张20MB、PNG/JPEG/WebP/GIF、最多6400万像素，返回服务端附件ID和私有URL |
| GET /api/studio/attachments/{id} | 认证后按归属读取原始附件；管理员可查看请求中的附件 |
| POST /api/studio/generations | JSON：prompt、attachmentIds、options、requestId、expectedCredits；最多6附件、1–4输出；202接收，完全相同的requestId重放返回200且不重复入队或扣费，不同内容返回409 |
| POST/PATCH/DELETE /api/studio/folders[/id] | 当前用户的单层文件夹；名称1–60字符、去首尾空白、同用户内不重名；删除仅清关联，不删图片 |
| POST /api/studio/folder-memberships | imageIds、folderIds、remove；批量增补或移出当前关系，重复加入幂等；单次最多500图片/100文件夹；事务内检查所有资源归属，管理员也不能把他人的图归入自己的文件夹 |

会话、改密、价格、用户和积分操作复用现有认证与管理员API。创建用户新增可选 active，旧调用缺省仍启用。积分调整通过原弹窗输入金额，适配层填写固定来源“管理员通过工作室调整积分”和随机幂等编号，不增加界面字段。个人主题与发送偏好按用户ID保存在浏览器，余额、角色、图片与文件夹只信任服务端。

原价格编辑页保存打开/刷新时的版本；后台轮询不会替换编辑版本。409保留输入，使用现有刷新价格按钮重新读取。401清理工作区身份；429显示Retry-After；任何写请求均不自动重试。网络结果未知时，未改动的生成输入保留同一幂等编号，先读取历史再允许明确手动提交。

## 任务与计费

新增表均为增量迁移：studio_batches、studio_batch_jobs、studio_attachments、studio_batch_attachments、studio_folders、studio_image_folders。已有用户/任务/原图/积分流水不重写、不导入、不删除。迁移可重复执行。

每个输出仍独立进入原队列并单独调用上游，保持现有冻结/成功结算/失败退款逻辑。服务端保存批内outputIndex，刷新后顺序稳定；批内部分完成时立即显示成功图，仍有运行任务则整批processing，全部结束且有失败则failed。成功图仍入图库，费用只包含服务端实际冻结或结算的任务；完成失败批次的管理记录显示实际消耗。旧多模型批次按模型拆成多轮，旧批内序号没有历史事实可恢复，保留旧创建时间/ID顺序。

六张附件按上传次序存储并传给上游。GPT编辑采用多个image[]；Gemini采用多个原生inlineData。WebP/GIF在请求副本中转换为PNG，原件保留；其后仍走原有输入处理，4096边长、12MB请求副本预算、JPEG质量等压缩设定未改。原图下载和后续添加仍使用原图；列表/预览采用原服务返回的版本化缩略图与高清预览URL。

## 参数与实测边界

新版接口独立校验现有前端选项，不套用旧接口的16:9/default组合白名单。旧/api/jobs保留协议和验证，未删除探测报告或测试。

- “自动”不生成比例限制；GPT比例继续写入提示词，同时显式传quality和size；中文质量映射为auto/max/xhigh/high/medium/low。GPT Image 1.5按1024×1024/1536×1024/1024×1536映射，其他GPT按所选长边与比例计算8像素对齐尺寸；1:1 HD最低2048边长。
- Gemini使用generationConfig.imageConfig.aspectRatio/imageSize，0.5K映射为512。保留原生返回thought过滤，不走会混入草稿的Chat转换接口。不混淆quality与reasoning，也不额外发送reasoning字段。
- `Qiso-生图参数链路验证-2026-11-05.md` 已证明Flash部分比例及512/1K/2K/4K组合；Pro名称存在映射到Flash的证据。其余比例和六图编辑仅完成本地协议验证。
- 同日GPT报告已证明当前渠道的size/quality不能可靠兑现。转发字段不等于修复上游；options记录请求值，实际图片尺寸来自解码，旧任务API保留actual_model/quality等返回事实。不进行真实付费探测，不将这一适配声称为参数效果已验证。

## 数据规模

现有UI在内存中搜索、筛选、分页和计算数量。为确保记录超过24条时不漏图、不把单页统计当全局统计，当前state返回该角色有权读取的全部元数据，图片内容按独立URL读取。此适配面向现有单实例私有工作室；记录规模扩大时应按相同界面接入独立图片分页和请求查询缓存，避免全量元数据轮询。处理中1.5秒刷新，空闲15秒刷新，无跨站同步。

## 验证

```powershell
cd frontend
npm run verify
npm run build:server
cd ..
go test ./...
go vet ./...
go build ./...
# 仅空的、专用且以_test结尾的数据库；测试创建并清理自己的表。
$env:TEST_MYSQL_DSN = '.../studio_integration_test?parseTime=true'
$env:STUDIO_BROWSER_CHECK = '1'
go test -run TestStudioMySQLWorkflow -count=1 -v
```

真实MySQL检查迁移、重复提交、部分失败结算、六附件传递、跨用户权限、文件夹多归属和删除保图、结果复用、改密失效。浏览器直接请求真实Go和MySQL，只有图片上游用本地fixture；验证Go的真实CSP、登录、发送、下载、文件夹刷新、价格保存、创建账号和改密。截图在frontend/outputs/integration/，测试日志和临时数据库在outputs/，均不提交。测试不代表真实渠道支持全部请求参数。
