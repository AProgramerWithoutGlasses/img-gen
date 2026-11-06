# 对话式图像生成网站：参考调研

访问日期：2026-11-06（Asia/Shanghai）。本报告整合主代理在内置浏览器中的实际操作记录与保存的截图。四站正式布局观察均在 `innerWidth = 1440`、`innerHeight = 900` 下进行；此前窄视口的入口检查不作为桌面布局依据。

本阶段目标为 1440 × 900、原生可编辑的中性静态线框。网站行为是调研事实；适用于本项目的取舍以“设计建议”标记，不直接变成新增需求。

## 1. 范围、方法和验证边界

| 来源 | 本次访问状态 | 完成的实际操作 | 尚未验证 |
| --- | --- | --- | --- |
| [ArtCraft](https://app.getartcraft.com/create-image) | 已登录，可访问 | 模型与参数菜单；五模型数量；单张及追加第二张参考图；展开附件区域；Prompt focus mode 展开及 Done／× 返回 | 附件移除；真实生成、结果、失败、扣费 |
| [ImageAT](https://imageat.com/ai/image) | 已登录，可访问 | Sunburst 与 GPT Image 2 参数差异；先后上传两张；移除第二张 | 真实生成、结果、失败、扣费；未记录模型的完整配置 |
| [Krea](https://www.krea.ai/image) | 已登录，可访问 | 模型弹窗；Sunburst 档位和清晰度；单张及追加第二张；上传中禁用发送 | 附件移除；真实生成、结果、失败、扣费 |
| [Base Design](https://www.basedesign.com/) | 公开页面可访问 | Filter 展开；Larger 切换；Projects；进入 Chateau 项目详情 | 未逐一验证全部筛选条件；未将项目页视为原图灯箱 |

先读取页面结构与控件信息，再针对上传、模型切换和图片浏览进行操作验证。上传使用本地专用测试图片，不使用用户的参考截图。ImageAT 首次上传条款已由用户确认同意后继续。未点击付费生成按钮，因此示例图片、营销图片及原有内容均不作为本次生成结果。

“可多选上传”和“能够多次追加”分别记录：文件选择器是否允许多选，不能直接证明最终最大附件数量；成功上传两张也不证明上限为两张。报告正文不记录账号邮箱；本地原始截图可能包含登录会话可见的用户入口，均留在不提交的 `outputs/` 中。

模型参数完整表见 [model-parameters.md](model-parameters.md)；官方别名核对见 [model-aliases.md](model-aliases.md)。

## 2. ArtCraft：贴底输入区与紧凑附件入口

来源：[app.getartcraft.com/create-image](https://app.getartcraft.com/create-image)。

**已验证事实**

- 桌面左侧为约 244 px 的导航区；顶部横栏容纳库、积分及用户等入口。中央初始工作区显示创作引导，宽输入区位于工作区底部。
- 用户菜单已实际展开，包含 Settings、Support、Join Discord、Sign out；积分位于顶栏，不在这个菜单中。
- 模型和当前参数集中放在输入区底部工具行。五个指定模型都能在同一页面切换；参数项目和可选集合随模型不同，详见参数表。
- 上传前显示 Reference 按钮。上传一张后入口变为倾斜缩略图和加号；追加第二张后使用叠放缩略图表达多个附件。
- 点击缩略图可展开附件区域。文件选择器的 `multiple` 为 `true`，单张及两张追加均已实际成功；附件移除未操作验证。
- 五个模型的数量菜单逐一展开，均出现 1、2、3、4。Sunburst 与 GPT 系列有档位，两个 Nano Banana 模型没有独立质量档位。
- 2026-11-06 补充实测输入框展开功能：在已登录的新调研标签中核验视口为 1440 × 900；默认无附件、空提示词、Nano Banana Pro 状态下，DOM 可见文字输入框约 40 px 高，整个输入容器约 139.6 px 高。这只记录该状态的尺寸，不推断长文本时的高度上限。
- 点击输入框右上角 `Expand prompt to focus mode` 后，打开带背景遮罩的居中 `Prompt focus mode` 对话框，约 896 × 663.6 px。它包含 Prompt 标题、大文本编辑区、右上角 ×，以及底部 Reference、模型、比例、清晰度和 Done 按钮；不是仅把底部输入框原地拉高。
- 在对话框输入专用测试文字并点击 Done 后，返回紧凑输入框，测试文字保留。再次打开后点击右上角 ×，也能返回紧凑输入状态。最后将测试文字清空；未触发生成、上传或付费。未测试 Escape、点击遮罩、长文本滚动或 × 对新编辑内容的保存规则。

**设计建议**

- 借鉴侧栏和工作区分离，以及底部保持稳定位置的输入区；它能为对话与结果保留主要空间。
- 借鉴参数只展示当前值的紧凑方式。将模型、条件档位、比例、清晰度和数量组织成清晰的一组，不在默认画面展开全部选项。
- 建议直接显示已上传附件，便于核对图片归属。当前项目已由用户明确为“有图显示、删光隐藏”，不引入附件手动折叠。
- 默认输入框保持紧凑，右上角提供长提示词编辑入口；约 140 px 的实测容器可作为本项目约 144 px 默认输入框的布局参考。展开状态的尺寸与内容组织仍属于本项目设计选择，不能直接等同于原站实现。
- 网站导航包含多种创作工具，本项目只保留已确认的图像创作和我的图片，不复制整个产品导航。

证据：[默认页面](../../outputs/research/artcraft-default.jpg)、[上传一张](../../outputs/research/artcraft-upload-one.jpg)、[上传两张](../../outputs/research/artcraft-upload-two.jpg)、[两张附件文字快照](../../outputs/research/artcraft-upload-two.txt)。

输入框展开补充证据：[紧凑空态](../../outputs/research/artcraft-focus-default.jpg)、[展开对话框](../../outputs/research/artcraft-focus-expanded.jpg)、[Done 后保留测试文字](../../outputs/research/artcraft-focus-done.jpg)、[× 返回并恢复空输入](../../outputs/research/artcraft-focus-returned.jpg)。这些截图均按 1440 × 900 保存。

## 3. ImageAT：显式档位与有编号的参考图

来源：[imageat.com/ai/image](https://imageat.com/ai/image)。

**已验证事实**

- 页面顶部为横向导航；内容区有历史／Trends 切换与三种网格展示按钮。中央初始区域为空态。
- 输入卡位于主内容区域靠下位置，页面下方还有营销内容，不能将它描述为全站固定贴底输入区。
- Sunburst 展示 Low、Med、High、X-High、Max 五个档位按钮，以及独立清晰度。切换 GPT Image 2 后档位变为 Low、Med、High，独立清晰度控件消失。
- 文件选择器 `multiple` 为 `false`，但可以逐次追加。先后上传一张、第二张均成功，附件分别标为 REF 1、REF 2，每项有移除入口。
- 实际移除第二张后保留第一张，验证了单附件移除行为。
- 切换到 GPT Image 2 后再次追加第二张成功；此时 REF 上传入口消失、YouTube 按钮禁用。这只证明当前模型的两附件状态，不推定其他模型也有同样上限。
- 积分显示会随参数变化；页面宣传与显示存在不稳定，未采为本项目定价。

**设计建议**

- 借鉴可明确识别每张参考图的附件项及独立移除入口。首稿可同时显示附件缩略图、简短文件名和数量，减少图片与消息归属的歧义。
- 当档位选项很少且空间允许时，分段按钮有利于比较；但本项目 Sunburst 选项较多且工具栏还需容纳其他参数，首稿建议优先用带当前值的下拉选择器。
- 历史和趋势内容不是本项目需求，不引入营销区域。图库管理入口需要另行评估，不直接复制三个网格按钮。

证据：[默认页面](../../outputs/research/imageat-default.jpg)、[上传一张](../../outputs/research/imageat-upload-one.jpg)、[GPT Image 2 上传两张](../../outputs/research/imageat-upload-two.jpg)、[两张附件文字快照](../../outputs/research/imageat-upload-two.txt)、[移除第二张后](../../outputs/research/imageat-removed-second.jpg)。

## 4. Krea：居中输入卡与向上增长的附件区

来源：[www.krea.ai/image](https://www.krea.ai/image)。

**已验证事实**

- 左侧导航约 256 px，用户入口在侧栏底部；模型入口位于上方，底部输入卡居中，宽约 896 px。
- 模型选择弹窗按类别、示例图和价格组织。默认可见图片为产品示例，不是此次操作生成的结果。
- Sunburst 档位为 Low、Medium、High、Extra High、Max；清晰度为 1K、2K、4K。
- Add image 打开 Upload／Select asset 入口，Upload 允许多选文件。
- 实际上传一张并追加第二张成功。附件缩略图位于提示词上方，输入卡随附件区域出现向上增高。
- 上传进行时 Generate 禁用；上传后的附件有 Remove image 1／2 操作入口，但本次未实际执行移除。

**设计建议**

- 借鉴输入区向上增长、附件在文本上方的结构，保持发送区域稳定，并明确附件属于当前待发送消息。
- 首稿设置输入区高度边界，避免附件与长提示词挤掉全部对话结果；具体高度根据 1440 × 900 截图检验。
- 上传中不能发送的关系适合后续独立状态标注；本次静态首稿使用上传完成状态。
- 本项目仅有五个模型，模型选择可以更紧凑，不必照搬带大量示例图的大弹窗。Select asset 关联资产复用，当前未确认，不直接增加。

证据：[默认页面](../../outputs/research/krea-default.jpg)、[上传一张](../../outputs/research/krea-upload-one.jpg)、[上传两张](../../outputs/research/krea-upload-two.jpg)。

## 5. Base Design：按行变化的图片网格与密度调节

来源：[www.basedesign.com](https://www.basedesign.com/)。

**已验证事实**

- 顶部导航包括 Feed、Projects、Index，以及搜索和菜单入口；图片占据页面主要区域。
- 首页为密集的按行排布图片网格，同一行卡片宽度可以变化，横向边界整齐。观察到的结构不是传统等宽列瀑布流。
- 底部固定工具条含 Filter、Larger／Smaller 和 Now。
- Filter 已实际展开，分组包括 Studio、Sector、Personality、Color。未逐一执行所有筛选组合。
- 点击 Larger 后图片卡片变大，Smaller 变为可用，验证了显示密度调整。
- Projects 已访问，并实际点击 Chateau 项目，进入含大图、说明、分类的独立项目详情页；此行为不是直接打开原图灯箱。

**设计建议**

- 我的图片页借鉴“图像优先、弱化卡片装饰、通过图片比例形成节奏”，用接近行对齐的网格兼顾不同长宽比，避免把所有生成图强制裁成同一种比例。
- 密度切换可作为浏览增强建议，但并非首轮必要功能。若采用，建议只保留清晰的两档，而非复杂布局配置。
- 最小范围先满足浏览与查看图片详情；详情中建议保留来源提示词和生成参数，使图片可追溯到对话。这是本项目建议，不是 Base 的现成图像生成行为。
- 下载、回到来源对话作为待确认的最小管理入口。删除、收藏、批量管理先不纳入。
- Base 的 Studio／Sector／Personality／Color 是其内容分类体系，不能照搬为生成图片的筛选维度；搜索、模型筛选、时间筛选同样应经需求确认后再增加。

证据：[首页](../../outputs/research/base-default.jpg)、[Larger 后](../../outputs/research/base-larger-cards.jpg)、[Projects](../../outputs/research/base-projects.jpg)、[Chateau 详情](../../outputs/research/base-detail.jpg)。首页快照含当时的 Cookie 提示，网格布局结论来自实际页面观察，不把提示框视为本项目组件。

## 6. 底部输入区对比与首稿取舍

| 区域 | 实测参考 | 本项目建议 | 限制 |
| --- | --- | --- | --- |
| 整体位置 | ArtCraft 贴底宽输入；Krea 居中输入卡 | 工作区底部保留稳定输入区域，中央结果独立滚动 | 不照搬 ImageAT 的营销页长页面结构 |
| 附件 | ArtCraft 叠放与展开；ImageAT 编号及独立移除；Krea 提示词上方缩略图 | 首稿直接显示附件行、数量及移除入口 | 多附件最大数量未知，不虚构上限 |
| 参数 | ArtCraft 紧凑当前值；ImageAT 可见分段档位 | 模型与参数同组，缺少配置项时隐藏 | 同模型的第三方配置存在差异，不混搭 |
| 发送 | Krea 上传中禁用；各站发送位于输入卡操作端 | 发送和预计积分相邻，后续标注上传中的禁用关系 | 真实生成、失败及扣费未验证 |
| 用户入口 | Krea 侧栏底部；本地参考图的展开用户面板 | 用户入口在侧栏底部，展开后含账号、余额充值、主题、设置 | 独立设置页与充值流程不在本轮范围 |
| 图库 | Base 密集行布局、密度切换及项目详情 | 图片优先的浏览页和详情；最少管理建议单独确认 | Base 项目详情不能直接当作图片灯箱事实 |

补充成熟模式见 [component-patterns.md](component-patterns.md)：Ant Design X Sender／Attachments、Ant Design Image／PreviewGroup 仅作为结构和状态参考，不确定本项目代码栈或视觉主题。补充来源采用公开文档与示例源码核对，未进行网页交互测试；其证据级别与上述实测产品不同。

本地三张图片的逐张观察与推荐采用项见 [local-references.md](local-references.md)。

## 7. 本轮设计落地边界

- 先制作一张 1440 × 900 图像创作代表性画面：上一轮用户消息与对应结果位于中央，下一轮已上传参考图与待发送提示词位于底部。
- 画面中的生成结果使用中性线框占位，明确为设计示例，不能作为实际模型输出证据。
- 组件按侧栏、对话组、结果组、输入区和附件项组织，原生可编辑；参数条件与区域归属用设计标注说明。
- 其他静态状态和我的图片页在首张主画面经用户审阅后扩展。本报告中的未确认管理功能不提前画成既定功能。
- 未验证的失败、扣费、排队、重试及实际生成耗时保持未知，不为填充状态编造产品行为。
