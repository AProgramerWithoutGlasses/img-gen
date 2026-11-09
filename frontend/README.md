# 前端与页面导航

React / TypeScript / Vite。用户按下表中的页面描述需求即可，agent 负责定位代码与设计场景。约束见 [局部规则](AGENTS.md)，共同协议见 [接口契约](../docs/api-contract.md)。

| 页面或区域 | 实现入口 | 设计/浏览器场景 |
| --- | --- | --- |
| 应用侧栏、导航、账户菜单 | src/app/Sidebar.tsx、src/components/AccountMenu.tsx | 主页面与账户菜单 |
| 登录 | src/features/auth/LoginPage.tsx | 登录及会话联调 |
| 图像创作、输入与结果 | src/features/create/CreationPage.tsx | 01–09、29 |
| 创作对话框控件、附件与悬停预览 | src/features/create/DialogControls.tsx、DialogAttachments.tsx | 独立[对话框设计稿](../design/对话框设计稿.figcraft)中标为“本轮适配”的页面 |
| 我的图片 | src/features/gallery/GalleryPage.tsx | 10–17、30 |
| 文件夹选择、图片预览 | FolderPicker.tsx、ImagePreview.tsx（图库目录） | 整理与预览场景 |
| 账户、外观、积分 | src/features/settings/Account.tsx、Appearance.tsx、Credits.tsx | 18–22、31–33 |
| 用户、请求、价格 | src/features/settings/Users.tsx、Requests.tsx、Prices.tsx | 23–28、34–36 |

设计画框 ID 只维护在 [对照映射](../tests/design/fixtures/frames.json)，不在本表复制另一份。当前稿见 [设计说明](../design/README.md)。

创作对话框按独立稿适配：桌面默认900×148px，正文16px/24px、顶边14px，输入按实际折行在两至八行间向上增长；工具栏菜单、提示、最多六张附件及自适应悬停预览使用局部组件与样式。模型选择采用普通按钮填色，模型按钮与展开菜单统一166px并左右对齐，菜单预留选中点；生成按钮继续使用强调色。附件栏随四至六张增宽；浮窗按图片包裹并显示在当前卡片正上方，图片资源按实际尺寸与DPR选择，见 [图片预览策略](../docs/image-preview-strategy.md)。显示简称仅在该工具栏与菜单映射，模型ID、请求和计费协议不变。原稿及其副本只作参考，色板用于配色；旧主稿的整页映射不用于宣称本次对话框已对齐。早期设计依据见[行动报告](../research/2026-11-09-endfield-dialog/action-plan.md)，现行尺寸以当前指定稿和上述说明为准。

## 样式与数据

styles/tokens.css 管理现有主题变量，styles/base.css 为基础样式、components.css 为公共控件；app/layout.css 为布局，create.css、login.css、gallery.css 与 settings.css 跟随功能。index.css 保持既有加载顺序，responsive.css 保留末尾响应式覆盖。共享组件放 components，页面局部组件跟随 features，app 负责组合。

真实数据请求由 services/api.ts 与 state/StudioContext.tsx 负责；服务端决定身份、余额、价格和图片归属，浏览器按用户存主题/发送偏好。preview/ 的 Provider、模拟认证、样例和 IndexedDB 仅模拟模式加载，不进入正式业务构建。

## 本地入口

从仓库根运行 `npm run dev`，5174 代理本地 Go 8080，Go 另行启动；`npm run dev:preview` 不需要后端，用固定示例看界面，不能代表真实保存或生成已通过。`npm run build` 构建并同步嵌入资源。

检查命令、7 条模拟流程、真实 Go/CSP 联调和截图路径统一见 [测试说明](../tests/README.md)。历史 [BACKEND_HANDOFF.md](BACKEND_HANDOFF.md) 只保留当时事实。
