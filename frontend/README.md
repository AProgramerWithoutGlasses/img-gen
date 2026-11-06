# 新版前端预览

React + TypeScript + Vite，桌面界面以 1440 × 900 为基准。包含对话创作、原比例图片结果、图库与多文件夹归类、登录、设置及管理员页面。

这是可独立运行的前端交接版本，当前业务使用本地模拟数据。仓库原有 Go 服务、`web/` 和 Docker 入口没有切换；后端适配与生产接入见 [BACKEND_HANDOFF.md](BACKEND_HANDOFF.md)。

## 本地运行

需要 Node.js 22.12+（推荐 Node 22 LTS 最新补丁）。

```sh
cd frontend
npm ci
npm run dev
```

打开 http://127.0.0.1:5174/ ，登录页为 `/#/login`。演示账号 `admin` / `user1`，演示密码均为 `preview1234`；这些是公开测试常量，不是真实认证。新增管理用户只演示列表变化，不会生成可登录的真实账号。

生成结果为 SVG 线框占位图。图片、文件夹和设置只保存在当前浏览器 IndexedDB（`ui-studio-preview-v1`），上传不会发送到远程；本地预览不承担多标签或多端同步。全新浏览器存储空间会创建示例数据。

## 构建与检查

```sh
npm run build       # 产物：frontend/dist/
npm run preview     # http://127.0.0.1:4174/
npm run verify      # 类型、脚本语法、构建和7条浏览器流程
```

Windows 浏览器检查使用已安装的 Microsoft Edge；Linux/macOS 先运行 `npx playwright install chromium`。Linux CI 用 `npx playwright install --with-deps chromium` 安装浏览器与系统依赖。

测试使用 5175 端口和独立临时浏览器上下文，不修改日常预览数据。结果与截图位于 `outputs/preview/`，不提交。新增 CI 仅做检查，不部署。无需 FigCraft 或其他设计软件。

## 主要入口

- `src/App.tsx`：路由、导航与全局界面。
- `src/features/`：auth、create、gallery、settings。
- `src/state/StudioContext.tsx`：本地操作适配层，接入后端时替换。
- `src/types.ts`：共享数据与操作契约。
- `src/config/models.ts`：模型参数配置。
- `src/services/previewAuth.ts`、`src/data/seed.ts`：可移除的预览认证与示例数据。

## 迁移来源

迁自独立 UI Studio 的提交 `81a99e2`，包含此前的等高图片行和登录页。迁移以目标仓库 `main` 的 `bdb08b0765631739def819324dfb96c6ee31bac3` 为基线，通过新提交加入 `frontend/`，没有导入独立仓库的整段 Git 历史。

原项目保留本地标签 `snapshot/frontend-before-migration-2026-11-06` 和完整 ZIP 快照。该标签属于原本地仓库，不是此仓库可直接切换的标签；此仓库可通过父提交恢复迁移前状态。原设计档案、参考素材和机器配置未迁入。

`go.mod` 只用作目录边界，避免根目录 `go test ./...` 进入安装后的 npm 依赖；本目录不是 Go 后端。
