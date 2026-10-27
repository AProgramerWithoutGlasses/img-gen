# Qiso Gemini Flash 编辑接口复测

日期：2026-10-27，Asia/Shanghai，15:44–15:47。请求模型均为 `gemini-3.1-flash-image`，沿用服务端 Qiso 配置，不保存密钥或完整响应。

## 结论

- **Gemini Flash 可以通过原生接口做双图编辑。** 纯几何图形样例成功把第一张基础图的橙色圆形换成第二张参考图的蓝色五边形，返回 1024×1024 JPEG。
- **当前渠道的 `/v1/images/edits` 不支持这个模型。** 单图 `image`、双图 `image[]` 都返回 HTTP 500 / `convert_request_failed`，报错来自网关的模型转换，而不是证明 Gemini 本身没有编辑能力。
- **小猫样例本次没有出图是内容检查拦截。** 原生接口返回 HTTP 200，候选结束原因为 `PROHIBITED_CONTENT`，没有图片 part。具体触发因素未知；不能从该错误确定是输入图片、提示词、生成内容还是渠道策略造成，也不能断言上午未保留诊断的请求就是同一原因。
- 据此开放网页 Gemini Flash 的默认双图编辑，使用原生接口和两个有序 `inlineData`。其他模型、非默认编辑档位、蒙版、任意内容成功率仍未验证。

## 实际请求与结果

| 用例 | 路径与输入 | HTTP | 结果 | 耗时 |
|---|---|---|---|---|
| edits_single | `/v1/images/edits`，一张小猫基础图，字段 `image` | 500 | `convert_request_failed`，0 张 | 0.19 秒 |
| edits_dual | `/v1/images/edits`，小猫基础图 + 参考图，两个 `image[]` | 500 | 同上，0 张 | 0.19 秒 |
| native_dual | 原生 `generateContent`，两张小猫图片 | 200 | `PROHIBITED_CONTENT`，无图片 part | 10.17 秒 |
| native_shapes_dual | 原生 `generateContent`，两张几何图形图片 | 200 | `STOP`，1 张 1024×1024 JPEG，176,142 字节 | 37.08 秒 |

兼容接口两次错误消息都是：

> not supported model for image generation, only imagen models are supported

这是实际错误原文中的“image generation”，尽管请求路径是 `images/edits`。不能自行解释成图片文件上传失败。

原生路径为 `/v1beta/models/gemini-3.1-flash-image:generateContent`，请求的 `contents[0].parts` 顺序是文本、基础图、参考图，配置只有 `responseModalities: ["TEXT", "IMAGE"]`。未设置尺寸、比例、质量或安全阈值，没有关闭安全检查。返回 modelVersion 为同名，但不能独立证明渠道背后的底层模型身份。

四次真实请求各执行一次，没有失败自动重试；第四项是更换输入和提示词的独立对照实验，不能单独归因于某个词或某张图。开始时另有三次沙箱套接字被拒绝的尝试（WinError 10013），未获得上游响应，证据单独保存在非 live 目录，不计为真实接口结果。没有查询账单，不能确认失败请求或成功请求的实际费用。

## 成功样例与视觉检查

两张输入均为程序绘制的 512×512 PNG。基础图：米色背景，左侧红色方块、中央橙色圆形、右侧绿色方块。参考图：浅蓝背景上的蓝色五边形。

提示词：

> 请编辑第一张图片：把中央橙色圆形替换成第二张图片里的蓝色五边形，保留第一张图的米色背景、左边红色方块和右边绿色方块。只输出一张修改后的图片。

实际打开结果确认：中央是蓝色五边形，米色背景及左右红、绿方块保留，参考图浅蓝背景未进入结果，也未输出拼图。输出重新渲染了纹理、边缘和大小，不是逐像素无损编辑。只证明该默认 PNG 双图样例成功，不保证照片、复杂角色、JPEG 双图或任意提示词的结果。

- 结果 SHA-256：`13f03643ebe960f0eea4c9ca381d740f49c2e092fd5788d9db38e2c8ea4dce61`。
- `edits_single` 请求 ID（来自错误消息）：`202610270744541872521038268d9d6qWwnD6eb`。
- `edits_dual` 请求 ID（来自错误消息）：`202610270744543610747468268d9d6aqoT0ptU`。
- `native_dual` 请求 ID：`202610270744545439381428268d9d6KpvamdOE`。
- `native_shapes_dual` 请求 ID：`202610270746493588484988268d9d69qNBcxX3`。

## 本地证据与复现

脚本：`probe_gemini_edit_routes.py`。默认只打印计划；显式添加 `--execute` 才发起真实、可能计费的请求。每项先独占创建记录，再发送一次；发现已有记录时拒绝执行，包括中断留下的记录。更换目录代表另一次人工选择的实验，不应作为自动重试手段。

```powershell
python probe_gemini_edit_routes.py edits_single edits_dual native_dual native_shapes_dual --output outputs/gemini-edit-routes-new
```

结果、输入和有限诊断：`outputs/gemini-edit-routes-live-2026-10-27/`。JSON 保存结束原因、有限非 thought 文本、图片 part 大小和解码后图片元数据；不保存完整响应、图片 base64 或不透明签名。证据目录不提交 Git。旧报告和旧脚本保留。
