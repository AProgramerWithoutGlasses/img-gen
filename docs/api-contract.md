# 前后端接口契约

本文是双方共用的现行接口与模型能力约定。前端实现见 [前端说明](../frontend/README.md)，服务端运行机制见 [后端说明](../internal/studio/README.md)，验证见 [测试说明](../tests/README.md)。历史交接不是当前需求。

## 当前控件

| 模型 | 分辨率控件 | 比例控件 | 能力边界 |
| --- | --- | --- | --- |
| GPT Image 2 / 1.5 / 2.5 Sunburst | 不展示；不展示质量档位 | 自动、1:1、16:9、9:16、3:2 | 比例只写入提示词，不能承诺固定输出尺寸 |
| Gemini 3.1 Flash Image | 0.5K、1K、2K、4K（0.5K 发为512） | 自动、21:9、16:9、4:3、1:1、9:16 | 仅按渠道已探测范围使用，不泛化到任意组合 |
| Gemini 3 Pro Image | 同上 | 自动、1:1、9:16、16:9 | 存在映射到Flash的实测证据，不宣称真实Pro能力 |

每次输出1–4张；有附件时使用自动比例及默认参数，前后端同步校验。调整前的外观和完整选项保存在 [原控件存档](design/README.md)，不覆盖当前控件。

## 操作协议

| 接口 | 行为 |
| --- | --- |
| GET /api/studio/models | 五模型的现有界面选项，保持控件范围；表示可提交参数，不是逐项上游实测认证 |
| GET /api/studio/state | 返回 StudioData、priceVersions；普通用户仅自己的资料和资源，管理员可读取请求记录需要的全部记录；不含密码和图片二进制 |
| POST /api/studio/attachments | multipart 的 image 字段，单张20MB、PNG/JPEG/WebP/GIF、最多6400万像素，返回服务端附件ID和私有URL |
| GET /api/studio/attachments/{id} | 认证后按归属读取原始附件；管理员可查看请求中的附件 |
| GET /api/studio/attachments/{id}/{kind}/1 | kind为thumbnail、preview或preview-large，分别返回256px方形、640px等比、1600px等比静态预览；首次访问懒生成，缓存命中及304/HEAD均先检查权限 |
| POST /api/studio/generations | JSON：prompt、attachmentIds、options、requestId、expectedCredits；最多6附件、1–4输出；202接收，完全相同的requestId重放返回200且不重复入队或扣费，不同内容返回409 |
| POST/PATCH/DELETE /api/studio/folders[/id] | 当前用户的单层文件夹；名称1–60字符、去首尾空白、同用户内不重名；删除仅清关联，不删图片 |
| POST /api/studio/folder-memberships | imageIds、folderIds、remove；批量增补或移出当前关系，重复加入幂等；单次最多500图片/100文件夹；事务内检查所有资源归属，管理员也不能把他人的图归入自己的文件夹 |

会话、改密、价格、用户和积分操作复用现有认证与管理员API。创建用户新增可选 active，旧调用缺省仍启用。积分调整通过原弹窗输入金额，适配层填写固定来源“管理员通过工作室调整积分”和随机幂等编号，不增加界面字段。个人主题与发送偏好按用户ID保存在浏览器，余额、角色、图片与文件夹只信任服务端。

原价格编辑页保存打开/刷新时的版本；后台轮询不会替换编辑版本。409保留输入，使用现有刷新价格按钮重新读取。401清理工作区身份；429显示Retry-After；任何写请求均不自动重试。网络结果未知时，未改动的生成输入保留同一幂等编号，先读取历史再允许明确手动提交。

## 任务与计费

新增表均为增量迁移：studio_batches、studio_batch_jobs、studio_attachments、studio_batch_attachments、studio_folders、studio_image_folders。已有用户/任务/原图/积分流水不重写、不导入、不删除。迁移可重复执行。

每个输出仍独立进入原队列并单独调用上游，保持现有冻结/成功结算/失败退款逻辑。服务端保存批内outputIndex，刷新后顺序稳定；批内部分完成时立即显示成功图，仍有运行任务则整批processing，全部结束且有失败则failed。成功图仍入图库，费用只包含服务端实际冻结或结算的任务；完成失败批次的管理记录显示实际消耗。旧多模型批次按模型拆成多轮，旧批内序号没有历史事实可恢复，保留旧创建时间/ID顺序。

最多六张附件按前端提交的attachmentIds顺序存储并传给上游。“继续修图”把编辑目标放在附件首位，其他参考图保持相对顺序；“基础图”仅为前端编辑目标标识，不增加服务端或上游角色字段，也不承诺渠道对该角色的特殊处理。GPT编辑采用多个image[]；Gemini采用多个原生inlineData。WebP/GIF在请求副本中转换为PNG，原件保留；其后仍走原有输入处理，4096边长、12MB请求副本预算、JPEG质量等压缩设定未改。原图下载和后续添加仍使用原图。Attachment新增可选thumbnailUrl（256方形）、previewUrl（640等比）、previewLargeUrl（1600等比），width/height表示方向校正后的可视原图尺寸；旧附件可在首次衍生缓存建立后纠正尺寸，旧任务输入兼容原有1600预览URL。生成ImageAsset继续提供原有640缩略图/1600预览URL语义。前端按实际显示尺寸与DPR选图，见 [图片预览策略](image-preview-strategy.md)。

## 参数与实测边界

新版接口独立校验现有前端选项，不套用旧接口的16:9/default组合白名单。旧/api/jobs保留协议和验证，未删除探测报告或测试。

- 当前GPT不提供质量和分辨率控件，生成请求不发送这些无效档位；比例写入提示词，“自动”不生成比例限制。代码中保留的quality/size映射实现不代表当前界面开放这些参数。
- Gemini使用generationConfig.imageConfig.aspectRatio/imageSize，0.5K映射为512。保留原生返回thought过滤，不走会混入草稿的Chat转换接口。不混淆quality与reasoning，也不额外发送reasoning字段。
- [Qiso-生图参数链路验证-2026-11-05.md](providers/qiso/Qiso-生图参数链路验证-2026-11-05.md) 已证明Flash部分比例及512/1K/2K/4K组合；Pro名称存在映射到Flash的证据。其余比例和六图编辑仅完成本地协议验证。
- 同日GPT报告已证明当前渠道的size/quality不能可靠兑现。options记录请求值，实际图片尺寸来自解码，旧任务API保留actual_model/quality等返回事实。本地协议测试不证明渠道兑现了参数；重新验证上游需单独明确任务范围，不因普通适配或检查发起付费探测。

## 数据规模

现有UI在内存中搜索、筛选、分页和计算数量。为确保记录超过24条时不漏图、不把单页统计当全局统计，当前state返回该角色有权读取的全部元数据，图片内容按独立URL读取。图片元数据按权限一次批量读取，不随任务数逐条查询；启动时模型与状态并行加载。图片列表延迟加载，资源缓存与 Nginx 配置见[加载性能配置](../deploy/README.md)。此适配面向现有单实例私有工作室；记录规模扩大时应按相同界面接入独立图片分页和请求查询缓存，避免全量元数据轮询。处理中1.5秒刷新，空闲15秒刷新，无跨站同步。
