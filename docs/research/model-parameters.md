# 模型参数核对表

访问与验证日期：2026-11-06（Asia/Shanghai）。对应网站由主代理在已登录的内置浏览器中实际操作，桌面视口为 1440 × 900。以下记录的是第三方网站当日展示的配置，不等同于模型 API 的完整能力，也不证明后端实际请求内容。

用户确认 `GPT Image 2.5 Sunburst` 是一个完整模型名称。Gemini 名称与站点别名的对应关系已有 [Google 官方来源核对](model-aliases.md)。线框主名称沿用用户指定名称，不额外增加重复模型。

## 1. 建议采用的统一配置来源：ArtCraft

来源：[ArtCraft 图像创作](https://app.getartcraft.com/create-image)。表内菜单均已展开核对。以该站为统一配置参考是本项目的设计建议：它在同一输入区中提供了本次指定的五个模型，可避免把不同网站的参数组合误拼成同一种配置。

| 本项目模型名称 | 网站名称／别名 | 档位：实际菜单项 | 清晰度：实际菜单项 | 图片比例：实际菜单项 | 单次生成数量 |
| --- | --- | --- | --- | --- | --- |
| GPT Image 2 | GPT Image 2 | High / Medium / Low | 1K / 2K / 3K / 4K | Auto / Square / Square (HD) / 3:4 / 9:16 / 4:3 / 16:9 | 1 / 2 / 3 / 4 |
| GPT Image 1.5 | GPT Image 1.5 | High / Medium / Low | 无独立清晰度控件 | Square / 3:2 / 2:3 | 1 / 2 / 3 / 4 |
| GPT Image 2.5 Sunburst | GPT Image 2.5 Sunburst | Auto / Max / Extra High / High / Medium / Low | 1K / 2K / 3K / 4K | Auto / Square / Square (HD) / 3:4 / 9:16 / 4:3 / 16:9 | 1 / 2 / 3 / 4 |
| Gemini 3.1 Flash Image | Nano Banana 2 | 无档位控件 | 0.5K / 1K / 2K / 4K | Auto / 21:9 / 16:9 / 3:2 / 4:3 / 5:4 / 1:1 / 4:5 / 3:4 / 2:3 / 9:16 | 1 / 2 / 3 / 4 |
| Gemini 3 Pro Image | Nano Banana Pro | 无档位控件 | 1K / 2K / 4K | Auto / 21:9 / 16:9 / 3:2 / 4:3 / 5:4 / 1:1 / 4:5 / 3:4 / 2:3 / 9:16 | 1 / 2 / 3 / 4 |

说明：

- 表中 `Square`、`Square (HD)` 保留站点原始名称；未核实它们的具体像素尺寸，不将二者合并为一个普通 1:1 选项，也不自行解释 HD 的含义。
- Gemini 两个模型隐藏档位控件，符合用户已确认的显示规则。不能用清晰度选项代替档位来填补空位。
- GPT Image 1.5 的“无独立清晰度控件”是该站事实；线框建议同样隐藏该独立控件，避免提供未经验证的配置。
- 菜单存在某个选项，不证明所有“档位 × 比例 × 清晰度 × 数量”组合均可提交成功。本次未运行付费生成，未验证组合约束或结果尺寸。
- 未从网站价格反推本项目定价；预计积分仅保留位置和随配置更新的关系，示例数值须明确标为占位或待定。

可复核证据：

- [Sunburst 档位菜单](../../outputs/research/artcraft-sunburst-quality.txt)
- [Nano Banana 2 选项](../../outputs/research/artcraft-nano2-options.txt)
- 数量菜单：[GPT Image 2](../../outputs/research/artcraft-GPT-Image-2-count.txt)、[GPT Image 1.5](../../outputs/research/artcraft-GPT-Image-1.5-count.txt)、[Sunburst](../../outputs/research/artcraft-sunburst-count.txt)、[Nano Banana 2](../../outputs/research/artcraft-Nano-Banana-2-count.txt)、[Nano Banana Pro](../../outputs/research/artcraft-Nano-Banana-Pro-count.txt)

以上证据文件是本地调研快照，保留于 `outputs/`，不提交 Git。

## 2. ImageAT：实测差异

来源：[ImageAT 图像创作](https://imageat.com/ai/image)。

| 网站中的模型 | 档位 | 独立清晰度 | 比例 | 与统一参考的差异 |
| --- | --- | --- | --- | --- |
| GPT Image 2.5 Sunburst | Low / Med / High / X-High / Max | 1K / 2K / 4K | Auto / 1:1 / 3:4 / 4:3 / 4:5 / 5:4 / 2:3 / 3:2 / 9:16 / 16:9 / 21:9 | 没有 ArtCraft 的 Auto 档位、3K；比例集合不同；档位标签使用缩写 |
| GPT Image 2 | Low / Med / High | 切换到该模型后独立清晰度控件消失 | 本次未独立展开核对该模型的完整集合 | 同一模型在该站与 ArtCraft 的清晰度控件不同，不能将其视为模型的固定属性 |

积分显示会随参数变化；本次观察到页面宣传与显示不稳定，既不采作本项目定价，也不据此宣称真实扣费。其他模型和数量配置在此表不作未验证补全。

## 3. Krea：实测差异

来源：[Krea 图像创作](https://www.krea.ai/image)。

| 网站中的模型 | 档位 | 独立清晰度 | 其他参数 |
| --- | --- | --- | --- |
| GPT Image 2.5 Sunburst | Low / Medium / High / Extra High / Max | 1K / 2K / 4K | 本次不对未独立核对的比例、数量作完整配置声明 |

与 ArtCraft 相比，实测菜单没有 Auto 档位或 3K。模型选择弹窗会以类别、示例图和价格组织选项，这属于 Krea 的产品展示方式，不要求本项目复制。

## 4. 线框中的参数关系建议

1. 模型选择后仅显示该模型有对应配置的控件；无档位时隐藏档位，无独立清晰度时隐藏清晰度。
2. 选择器展示当前值，完整菜单作为后续静态状态单独表达。首张代表性画面不同时展开全部菜单。
3. 切换模型后，仍受支持的选择可保留；不再受支持的值重置为有效默认值，并在设计标注中说明。这是交互设计建议，尚未完整验证三站均如此处理。
4. 预计积分跟随当前模型与参数显示在发送旁；实际计算规则待后续产品定义，不复制第三方定价。
5. 首轮只制作一张代表性画面；档位显示／隐藏、模型切换、上传异常等变体待主画面审阅后扩展。
