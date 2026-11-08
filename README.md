# UI Studio · img-gen

两人维护的图像生成网站：React / TypeScript / Vite 前端，Go + MySQL 后端；前端嵌入 Go 二进制。网站：[img.xunxun.me](https://img.xunxun.me)，仓库：[AProgramerWithoutGlasses/img-gen](https://github.com/AProgramerWithoutGlasses/img-gen)。每人使用自己的检出，目录名为 img-gen，本机路径不限。

## 从这里开始

| 要做什么 | 入口 |
| --- | --- |
| 和 agent 调整 UI、预览、上线和反馈 | [工作流程](docs/workflow.md) |
| 找页面、组件和样式 | [前端说明](frontend/README.md) |
| 找后端、配置和队列 | [后端说明](internal/studio/README.md) |
| 编辑设计稿 | [设计流程](design/README.md) |
| 做前后端适配 | [接口契约](docs/api-contract.md) |
| 选择验证范围 | [测试说明](tests/README.md) |
| 做调研或查看资料 | [调研索引](research/README.md) |
| 发布和回滚 | [部署说明](docs/DEPLOYMENT.md) |
| 找所有现行文档和历史资料 | [文档导航](docs/README.md) |

## 首次本地运行

需要 Node.js 22.12+、Go 1.25+、MySQL 8.0+（新环境推荐 8.4）。从仓库根执行：

```powershell
npm run status
npm ci
npm --prefix frontend ci
# 按 .env.example 配置本地数据库和服务端凭据，不使用生产库。
npm run build
go run .
```

访问 http://127.0.0.1:8080。已有依赖不必重装；前端变更后构建一次。`npm run dev` 为前端热更新（另开 Go 服务）；`npm run dev:preview` 为独立模拟预览。其余命令按对应文档使用。

执行约束与自动提交/发布判断见 [AGENTS.md](AGENTS.md)。每图独立调用，失败不自动重试；密钥、数据库和 outputs 不进入 Git。
