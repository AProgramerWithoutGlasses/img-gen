# Google 图像模型别名核对

查证日期：2026-11-06（Asia/Shanghai）。方法：读取 Google 官方公开 HTTP 文档；仅核对名称映射，不据此替代参考网站的参数配置，也未在 Google 网站提交生成。

| 用户指定名称 | 参考站常用别名 | Google 官方模型标识 | 结论 |
| --- | --- | --- | --- |
| Gemini 3.1 Flash Image | Nano Banana 2 | `gemini-3.1-flash-image` | 官方文档明确对应 |
| Gemini 3 Pro Image | Nano Banana Pro | `gemini-3-pro-image` | 官方文档明确对应 |

来源：[Google 官方图像生成文档](https://aistudio.google.com/docs/image-generation)。请求原地址 [ai.google.dev/gemini-api/docs/image-generation](https://ai.google.dev/gemini-api/docs/image-generation) 时，HTTP 重定向到上述 AI Studio 文档，最终响应 200。

原文短证据（相对链接已补全官方域名）：

> **Nano Banana 2**: The [Gemini 3.1 Flash Image](https://aistudio.google.com/docs/models/gemini-3.1-flash-image) model (`gemini-3.1-flash-image`).

> **Nano Banana Pro**: The [Gemini 3 Pro Image](https://aistudio.google.com/docs/models/gemini-3-pro-image) model (`gemini-3-pro-image`).

交叉核对：[Google 官方模型目录](https://ai.google.dev/gemini-api/docs/models) 同样将 Nano Banana 2 链接到 `gemini-3.1-flash-image`，将 Nano Banana Pro 链接到 `gemini-3-pro-image`。

线框中的主名称沿用用户指定名称；调研表可在括号注明对应别名，避免将同一模型列成两项。本记录只证明命名对应，不证明第三方网站实际后端路由、参数或价格与 Google 官方完全一致。
