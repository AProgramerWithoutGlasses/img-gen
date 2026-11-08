# GPT 生图参数失效：官方 Codex 直连根因验证

日期：2026-11-05，北京时间。续接 [上午的全链路参数报告](Qiso-生图参数链路验证-2026-11-05.md)。本轮新增 16 次模型 POST，重点是定位原因，不扩展网站能力选项。

## 结论

**当前账号使用的官方 ChatGPT/Codex 生图路径，没有按公开 OpenAI Images API 的参数语义执行 size、quality 与显式 reasoning.effort。问题在绕过 new-api 和 sub2api 后仍可复现。**

本轮在实际 008 服务器，使用同一账号及其既有代理，直接请求 `https://chatgpt.com/backend-api/codex/responses` 和 `/images/generations`；正常验证 TLS 证书，没有关闭校验。结果如下：

1. Responses 请求的图片工具 model/size/quality 被官方返回的工具声明归一成 `gpt-image-2-codex / auto / auto`；传不存在的图片工具模型、非法 size/quality，也能出图并返回同样声明。
2. 显式 `reasoning.effort=high` 在官方直连同样返回 `image_generation_user_error / invalid_value`：`Complexity 'high' is not supported for this image model.`
3. 官方 Codex 原生 Images 请求 `size=1024x1536, quality=high`，实际 PNG 为 1536×1024，响应 quality=low；传 `size=INVALID, quality=INVALID`，也成功返回 1536×1024、medium。
4. 使用历史 `codex_cli_rs/0.107.0` 与本地 sub2api 规范的 `codex-tui/0.146.0` 对照，上述行为一致，不能简单归为旧 UA。

这里的原因是已复现的接口行为：**Codex 的工具声明/实际生成不遵守这组公开 API 控制字段，且显式 effort 触发该路径内部的 Complexity 校验失败。** 无法看到 OpenAI 服务端源码，所以不能进一步断言是有意的能力限制、账号开关还是官方兼容性缺陷，也不把结论推广至公开的 `api.openai.com/v1/images/generations`。

## 1. 两层网关外的独立调用

实际机器：用户授权操作的 Xshell `ali-sg-a0008`，部署目录 `/usr/local/sandai`。

通过只读 SQL 会话读取刚刚成功出图账号 187 的现有 OAuth access token 与代理 253。SQL 设置 `default_transaction_read_only=on` 和 5 秒 statement timeout。凭据只进入服务器 Python 进程内存，用于原官方地址和原代理；没有输出、复制到本地或写入报告。没有刷新 OAuth、改变调度或创建新密钥。

脚本：[probe_codex_server_controls.py](../../../tests/probes/probe_codex_server_controls.py)。HTTP 使用 requests，不继承环境代理、显式使用原账号代理、不跟随重定向、默认开启 TLS 验证、无自动重试。响应仅提取允许保存的字段与图片字节解码后的 PNG 宽高/SHA-256；不保存完整响应、图片 base64、思考文本或凭据。

TLS 证书摘要：subject CN=`chatgpt.com`，issuer=`Let's Encrypt / YE1`，校验成功。直连响应还有 Cloudflare `cf-ray`；原生 Images 返回 `x-codex-imagegen-request-id`。结合固定 HTTPS 目标，支持“请求到达官方 Codex 端点”，不依赖网关自报模型名。

### 0.146.0 身份的四项最终对照

全部使用账号 187、代理 253、同一无比例提示词，每项独立请求。

| 用例 | 客户端关键参数 | 官方返回及解码结果 |
|---|---|---|
| responses_valid | tools.model=gpt-image-2，size=1024x1536，quality=high；不传 reasoning | HTTP 200、completed；声明工具 model=gpt-image-2-codex、size=auto、quality=auto；成品 1536×1024、low |
| responses_effort_high | 与上一项相同，增加 reasoning.effort=high | HTTP 200 SSE 最终 failed；Complexity high 不支持；无成品 |
| images_valid | 顶层 model=gpt-image-2、size=1024x1536、quality=high | HTTP 200；实际 1536×1024、响应 low |
| images_invalid | 顶层 size=INVALID、quality=INVALID | HTTP 200；实际 1536×1024、响应 medium |

客户端身份：

```text
User-Agent: codex-tui/0.146.0 (Ubuntu 22.4.0; x86_64) xterm-256color
originator: codex-tui
version: 0.146.0
```

原生 Images 非法字段对照请求 ID：`9fa8b263-4799-401b-a9c2-a12311964f92`。各项完整请求 ID 保留在服务器脱敏记录中。

服务器完整脱敏记录：`/tmp/imggen-gpt-cause-20261105-current-client/`。本地 [证据摘要](../../../outputs/gpt-cause-2026-11-05/official-server-evidence-summary.json) 明确标注它是从实际 Xshell 输出摘录的字段，并非下载的完整远程记录。

### 工具声明不是请求值的回显

旧客户端身份的官方直连 `responses_invalid_tool` 请求：

```json
{"type":"image_generation","action":"generate","model":"not-a-real-image-model","size":"INVALID","quality":"INVALID"}
```

官方声明的工具：

```json
{"type":"image_generation","model":"gpt-image-2-codex","size":"auto","quality":"auto","background":"auto","output_format":"png"}
```

该请求实际生成 1536×1024 PNG、quality=low。字段在这条路径中没有按公开 schema 校验/执行，并非“size 校验成功，只是模型偶尔没遵守”。记录在服务器 `/tmp/imggen-gpt-cause-20261105-a187-decoded/responses_invalid_tool.json`。

这只能确认 Responses 工具最终声明 `gpt-image-2-codex`，不能推断所有原生 Images 模型名都映射为它。原生 Images 的可靠结论是已测尺寸/质量控制没有兑现。

## 2. 网关与官方直连的交叉验证

本轮 4 个 Qiso 请求（非法工具字段、非法图片模型、仅 reasoning.summary、空 reasoning 对象）全部成功出图。2 个绕过 new-api 的 sub2api 请求（非法工具字段、非法图片模型）也成功。六项都返回 `gpt-image-2-codex / auto / auto` 工具声明。

本地记录：`outputs/gpt-cause-2026-11-05/response-schema/`、`direct-schema/`、`direct-usage-correlation.json`。

通过 `X-Client-Request-ID` → sub2api 用量 `client:UUID` 精确匹配，两个成功直连请求分别命中账号 187、60，用量 ID 为 4404634、4404650。没有把时间相近的其他请求算作实验。

### 本地完整转发函数检查

以临时 Go overlay 调用实际 `OpenAIGatewayService.Forward`，设置 OAuth 账号，在 HTTP 上游出口截获请求：

```text
target=https://chatgpt.com/backend-api/codex/responses
tools=[{"action":"generate","model":"not-a-real-image-model","quality":"INVALID","size":"INVALID","type":"image_generation"}]
```

省略 reasoning 时出口没有 reasoning；设置 high 时出口保留 high。本地完整 OAuth 构造链没有将工具字段变成 auto，也没有替换为 gpt-image-2-codex。该检查通过，但只代表本地源码；根因定位的关键仍是官方独立直连。

源码位置：

- `D:/workspace/sub2api/backend/internal/service/openai_gateway_forward.go:1372`：目标 URL 和 OAuth 请求头。
- `D:/workspace/sub2api/backend/internal/service/openai_codex_transform.go:907`：工具别名归一化，未默认清掉 size/quality/model。
- `D:/workspace/sub2api/backend/internal/service/openai_images_direct.go:43`：原生 Images 构造保留 size/quality。
- `D:/workspace/sub2api/backend/internal/service/openai_images_responses.go:385`：Images→Responses 分支硬编码 medium；**该显式 medium 与当前已测故障条件冲突**。
- `D:/workspace/codex/codex-rs/codex-api/src/images.rs:6`、`endpoint/images.rs:61`：本地 Codex 源码也使用顶层 model/size/quality 和 images/generations，没有发现另一种字段位置。

未修改两套网关的受跟踪代码或生产配置。临时测试源码在 `outputs/gpt-cause-2026-11-05/wire_test.go.txt`，通过 overlay 执行。

## 3. 思考参数的精确边界

| reasoning 写法 | 本轮结果 |
|---|---|
| 不传 | 能出图 |
| `{}` | 能出图 |
| `{"summary":"auto"}` | 能出图 |
| `{"effort":"high"}` | 官方直连也报 Complexity high |

不宜笼统说“不能传 reasoning 对象”；证据指向**显式 effort**。上午已测 none/low/medium/high/xhigh/max 均在当前链路触发对应错误，high 现在还有官方直连证据。

省略 effort 后响应显示 medium，不等于可以显式传 medium：缺省与显式值行为不同。改成 low/medium 不是已验证修复；文本推理能力和图片工具的 Complexity 支持也不能混为一谈。

## 4. 生产部署与日志

- new-api：容器 new-api，镜像 yyai-new-api:local，端口3000，启动于2026-11-03。
- sub2api：容器 sub2api，镜像 deploy-sub2api:latest，端口8080，版本0.2.14，build=`2026-10-09T04:59:26Z`，commit 自报 docker。
- 数据挂载 `/usr/local/sandai/sub2api/data` → `/app/data`。
- 两者 FULL_LINK_LOG_ENABLED=true，当日日志存在；精确搜索选定的 Qiso 实验 ID未命中，没有借用其他日志补证据。
- 当前管理 API 插件列表为空；原代理为 HTTP CONNECT 代理，官方直连通过正常 TLS 验证。未发现插件或普通 CONNECT 代理改写 JSON 的证据。

没有关闭 TLS 校验、扩大日志范围、重启网关或修改调度。官方直连使用现有账号/代理，未改变生产流程。

## 5. 处理建议

1. **避免 Complexity 错误**：当前 Codex 图片请求不显式设置 reasoning.effort，只针对生图请求处理，不删除正常文本请求的思考配置。Images→Responses 分支固定 medium 是需兼容修复的位置，本轮按排查范围未修改它。
2. **精确像素与 quality**：已测 Codex 两个端点均未实现，需要切换到实际支持公开 Images 参数的上游路径并验证。公开 API Key Images 是文档支持的候选路径，本轮没有该路径的凭据可完成真实对照，不能称为已验证修复。
3. 继续使用现有 OAuth/Codex 时，只把提示词比例引导与默认输出当作已测能力，不把 size/quality/4K 选项展示为已保证能力。
4. 调整 new-api 透传开关无法修复本次官方直连也存在的行为。

## 6. 实验边界与复现

本轮 16 次模型 POST：Qiso 4、sub2api 直连2、官方服务器直连10。官方首批3次因采集器未处理缺失 Content-Type 的 SSE 或 gzip JSON，未正确解析；原记录保留，不用于结果结论。修正后以新目录明确发起3次对照，再以不同客户端身份发起4次对照。没有客户端自动重试或删除原记录重跑。

可判定的13项中，11项出图、2项明确官方 Complexity 错误。首批3项仅 HTTP 200，不能推断计费或成功。官方直连绕过网关记账，后台不会自动出现这些调用；没有账单核验。

采集器的 gzip + 无 Content-Type SSE 行为已通过本地 HTTP 测试，无真实上游请求。Python 语法检查、img-gen 的 go test/vet/build，以及 sub2api OAuth 出口 overlay 均通过。

复现脚本默认只打印计划，必须加 --execute 才调用。在已授权的实际 sub2api 主机运行：

```sh
python3 probe_codex_server_controls.py responses_valid responses_effort_high images_valid images_invalid \
  --account <已授权账号ID> --output /tmp/my-new-codex-controls --execute
```

同名记录存在则拒绝重发。新证据目录权限0700。凭据只保留在服务器进程内存，没有写入命令行或完整上游响应。
