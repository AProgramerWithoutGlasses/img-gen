# 加载性能配置

现有生产位置、备份和升级顺序仍以 [部署说明](../docs/DEPLOYMENT.md) 为准。
`nginx-img-gen.conf` 是当前站点的完整配置模板，适用于 Ubuntu 打补丁的 Nginx 1.24；
复用当前 certbot 证书路径，替换前备份原配置，执行 `nginx -t` 后 reload。
使用较新 Nginx 时按官方文档核对 HTTP/2 指令语法，不直接照搬旧版本语法。

## 方案与安全边界

- 使用 Nginx 内置 HTTP/2 多路复用，限制每连接并发流为 32；使用发行版安全更新，不自行编译第三方模块。
- gzip 仅用于公开的 `/assets/` 下 JS/CSS，私有 API 不压缩，避免私有内容与可控文本同时压缩的 BREACH 风险。
- Go 仅对实际存在且文件名带 Vite 内容哈希的 JS/CSS设置一年 `immutable` 缓存；入口 HTML 与接口保持 `no-store`。发布更新生成新哈希，无需用户清缓存。
- 不启用 `proxy_cache`、CDN 私有图片缓存、Service Worker 或任何跳过鉴权的图片公开地址。
- 图片和附件使用 `private, no-cache`、ETag 与 `Vary: Cookie`。每次条件请求先检查会话和资源归属，再允许 304；换账号、停用或改密不会通过旧缓存响应绕过服务端权限。
- 创作历史使用浏览器原生 `loading="lazy"` 与异步解码；普通屏幕用现有 640px 缩略图，高分屏选择现有 1600px 预览，点击后使用高清预览，下载仍为原图。缩略图、预览与上游输入的压缩参数不变。
- 工作区启动并行读取模型与状态，状态中的图片元数据按相同权限一次批量读取，避免逐任务查询；不返回图片二进制，不裁掉完整历史。

## 验证

- 后端：`go test ./...`、`go vet ./...`、`go build ./...`。
- 专用空 `_test` 数据库与 `STUDIO_BROWSER_CHECK=1` 覆盖真实 Go/MySQL/CSP、越权和 40 张图片完整历史。
- `npm --prefix frontend run performance:check` 在已经构建的生产前端上使用合成元数据，检查 60 张历史的原生延迟加载、高分屏资源选择、详情预览与管理员列表。它不证明真实渠道生图或公网速度。
- 原有模拟浏览器流程继续保留；新检查也包含在 `npm run verify` 中，不重复构建。
- 公网发布后复测 HTTP/2 协商、JS/CSS gzip 与缓存头、未登录接口拒绝，以及冷/热启动资源传输量。测速受当时网络影响，比较时保留原始记录。

## 采用依据

- [Nginx HTTP/2 官方模块](https://nginx.org/en/docs/http/ngx_http_v2_module.html)
- [Nginx gzip 官方模块及 BREACH 提醒](https://nginx.org/en/docs/http/ngx_http_gzip_module.html)
- [MDN 延迟加载](https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/Lazy_loading)
- [MDN Cache-Control](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cache-Control)

无需引入新的运行时依赖或上传图片给第三方优化服务。安全扫描发现原有 2019 年的 `golang.org/x/image` 存在可达的解码漏洞，已升级到兼容 Go 1.25 的修复版本 v0.45.0；压缩预设不变。本地证据在忽略提交的 `outputs/performance-2026-11-07/` 和 `frontend/outputs/performance/`。
