# 新前端

React + TypeScript + Vite。沿用已有登录、创作、图库、文件夹、设置和管理员页面；默认通过真实Go服务工作。旧交接档案见 [BACKEND_HANDOFF.md](BACKEND_HANDOFF.md)，本次已完成的接口和边界见 [适配说明](../docs/studio-integration.md)。

## 运行

```sh
npm ci
npm run dev          # 5174，同源代理到127.0.0.1:8080，需要运行Go服务
npm run dev:preview  # 5174，仅原来的本地模拟预览
npm run build:server # 构建并同步到根目录web/studio，随后可go run .
npm run verify      # 类型、构建和原有7条模拟浏览器流程
```

真实模式使用服务端用户名/密码与HttpOnly Cookie，不包含公开演示认证、seed或IndexedDB业务存储。改密成功返回登录，余额、角色、价格和图片归属以服务端为准；主题/Enter偏好按用户保存于本机。纯模拟模式才使用公开admin/user1和preview1234，不发送API请求，不参与生产构建。

`src/state/StudioContext.tsx`负责真实请求和轮询，`PreviewStudioProvider.tsx`保留可独立验证的模拟行为。页面共用StudioData/StudioActions契约。`src/services/api.ts`集中处理同源认证、可读错误和会话失效，不自动重试写入。

Windows浏览器检查使用Edge，其他系统安装Playwright Chromium。真实HTTP/MySQL浏览器联调由根目录TestStudioMySQLWorkflow启动：构建前端，设置空专用_test数据库的TEST_MYSQL_DSN及STUDIO_BROWSER_CHECK=1，再运行对应Go测试。截图在outputs/integration/，不提交；普通模拟截图在outputs/preview/。

生产通过Docker的Node构建阶段或npm run build:server嵌入Go，不依赖Vite开发服务。Go响应的CSP保持不变，动态布局使用React CSSOM；真实浏览器检查覆盖此路径。
