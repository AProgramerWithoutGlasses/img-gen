# 前端与页面导航

React / TypeScript / Vite。用户按下表中的页面描述需求即可，agent 负责定位代码与设计场景。约束见 [局部规则](AGENTS.md)，共同协议见 [接口契约](../docs/api-contract.md)。

| 页面或区域 | 实现入口 | 设计/浏览器场景 |
| --- | --- | --- |
| 应用侧栏、导航、账户菜单 | src/app/Sidebar.tsx、src/components/AccountMenu.tsx | [主界面设计稿](../design/主界面设计稿.figcraft)中的外壳、导航与账户菜单 |
| 登录 | src/features/auth/LoginPage.tsx | 登录及会话联调 |
| 图像创作、输入与结果 | src/features/create/CreationPage.tsx、ResultStage.tsx、result-layout.ts | 主界面设计稿中的工作区、1–4图及生成状态 |
| 创作对话框控件、附件与悬停预览 | src/features/create/DialogControls.tsx、DialogAttachments.tsx | 独立[对话框设计稿](../design/对话框设计稿.figcraft)中“本轮适配”的几何与附件，配色跟随主界面稿 |
| 全部图片、文件夹管理及内容页 | src/features/gallery/GalleryPage.tsx、FolderManagement.tsx | 主界面设计稿中的图库与文件夹管理 |
| 文件夹选择、图片预览 | FolderPicker.tsx、ImagePreview.tsx（图库目录） | 主界面设计稿中的图片查看、详情与整理 |
| 账户、外观、积分 | src/features/settings/Account.tsx、Appearance.tsx、Credits.tsx | 18–22、31–33 |
| 用户、请求、价格 | src/features/settings/Users.tsx、Requests.tsx、Prices.tsx | 23–28、34–36 |

当前适配稿及其范围见 [设计说明](../design/README.md)。[原有对照映射](../tests/design/fixtures/frames.json)属于旧主稿的37个场景，不能用于证明新主界面已对齐；未改动页面仍可按对应场景参考。

## 当前主界面约定

- 侧栏与主区域贴边，用细线分隔；桌面侧栏展开224px、收起72px，品牌为AiCraft。创作和图库不设独立全局顶栏；设置页保留标题栏。“我的图片”下直接提供全部图片、文件夹管理及可展开的单层文件夹列表，分组加号新建文件夹，不增加未分类入口。窄屏以58px导航栏配合抽屉保持全部入口可达。
- 工作区只显示最新接收批次，历史成功图继续留在图库。提示词与状态在结果上方；1–4张图按可用空间和实际图片比例选择布局，同批槽位同尺寸，末行居中；处理中及失败保留原槽位，成功图立即可操作。
- 每张图提供“继续修图／加入文件夹／下载”，移入图片或键盘聚焦时显示图内操作，移出后隐藏；触屏保留可达入口。近全屏大图使用 Yet Another React Lightbox 的 Inline 与 Zoom，提供缩略切换、缩放、平移、100%与可切换详情；正常查看按尺寸与DPR选压缩资源，主动放大细节或选择100%时按需载入原图。衍生资源失败仍沿用原有权限检查和原图回退策略。
- “继续修图”返回创作并把该图放在附件首位，标为基础图；保留提示词草稿和其他参考图，替换先前基础图。六附件已满时提示处理，不静默丢弃参考图。这是前端编辑目标标识，请求仍只有有序附件，不新增服务端或上游角色字段。
- 亮暗主题使用单一高级蓝强调色（亮色`#315cbb`、暗色`#9ab9ff`）和中性灰度，红色表示警告或删除。通用图标由Lucide React统一提供；已定稿对话框的加号与胶囊轮廓保留专用绘制。
- 生成等待使用抽象模糊底、底部渐暗蒙层、百分比与真实已用时。每张图的预估进度单调推进且等待期间最高95%，图片解码可显示后补至100%并在650ms内由模糊渐显清晰；失败停止进度，成功图片保留，不自动重试。侧栏伸缩、菜单与结果重排采用局部过渡；减少动态效果时直接显示清晰图片。
- 对话框可用宽度不超过760px时，配置工具栏按内容换行，保持按钮尺寸，确保窄屏下生成按钮可达。

本轮新增依赖的许可声明见 [第三方声明](../docs/third-party-notices.md)。

侧栏与创作布局以[侧边栏调整稿](../design/侧边栏调整小样.figcraft)第05页及动效分镜为准，图库与大图沿用主界面稿。创作对话框延续独立稿的控件几何：容器随结果区同宽延展、默认高148px，正文16px/24px、顶边14px，输入按实际折行在两至八行间向上增长；配色与放置位置同步当前主界面稿。工具栏菜单、提示、最多六张附件及自适应悬停预览使用局部组件与样式。模型选择采用普通按钮填色，模型按钮166px，展开菜单最小166px并随文字自然伸展，左对齐且保留视口8px，菜单预留选中点；生成按钮使用当前主题强调色。附件栏随四至六张增宽；浮窗按图片包裹并显示在当前卡片正上方，图片资源按实际尺寸与DPR选择，见 [图片预览策略](../docs/image-preview-strategy.md)。显示简称仅在该工具栏与菜单映射，模型ID、请求和计费协议不变。原稿及其副本保留参考；旧主稿的整页映射不用于宣称本次对话框已对齐。早期设计依据见[行动报告](../research/2026-11-09-endfield-dialog/action-plan.md)，现行尺寸以当前指定稿和上述说明为准。

## 样式与数据

styles/tokens.css 管理亮暗主题变量，styles/base.css 为基础样式、components.css 为公共控件；app/layout.css 为布局，create.css、login.css、gallery.css、image-preview.css 与 settings.css 跟随功能。index.css 保持既有加载顺序，responsive.css 保留末尾响应式覆盖。共享组件放 components，页面局部组件跟随 features，app 负责组合。

真实数据请求由 services/api.ts 与 state/StudioContext.tsx 负责；服务端决定身份、余额、价格和图片归属，浏览器按用户存主题/发送偏好。preview/ 的 Provider、模拟认证、样例和 IndexedDB 仅模拟模式加载，不进入正式业务构建。

## 本地入口

从仓库根运行 `npm run dev`，5174 代理本地 Go 8080，Go 另行启动；`npm run dev:preview` 不需要后端，用固定示例看界面，不能代表真实保存或生成已通过。`npm run build` 构建并同步嵌入资源。

检查命令、7 条模拟流程、真实 Go/CSP 联调和截图路径统一见 [测试说明](../tests/README.md)。历史 [BACKEND_HANDOFF.md](BACKEND_HANDOFF.md) 只保留当时事实。
