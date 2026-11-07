# 方法与自动化参考初查

核对日期：2026-11-07。本文记录第一方资料及其在本研究中的拟用方式。已读取文档不代表已安装、运行或验证工具效果；本地小样验证在实际实施时记录。项目计划见 [研究入口](../README.md)。

## 设计研究与体系方法

| 编号 | 第一方来源 | 已确认的内容 | 本研究的适配 |
| --- | --- | --- | --- |
| M01 | [Design Council：The Double Diamond](https://www.designcouncil.org.uk/our-resources/the-double-diamond/) | Discover、Define、Develop、Deliver；通过发现、定义、多方案和小范围测试推进，也允许迭代返回 | 用于安排广泛采集、规则归纳、双主题试点和验证。此处是视觉与交互研究，不将资料分析冒充用户访谈 |
| M02 | [Brad Frost：Interface Inventory](https://bradfrost.com/blog/post/interface-inventory/) | 收集并分类界面组成部分，寻找同类组件的不同处理，并排比较；并非收集每一次重复出现 | 同时盘点游戏参考与工作室组件，按按钮、导航、表单、弹窗、状态等类别组织截图 |
| M03 | [Brad Frost：Atomic Design，Chapter 2](https://atomicdesign.bradfrost.com/chapter-2/) | 以 atoms、molecules、organisms、templates、pages 组织界面体系 | 建立基础变量、组件、组合区块与真实页面之间的映射，以实际内容验证规则 |

组合流程为本研究的实施建议：先广泛采集，再做界面盘点和比较，提炼规则后制作代表性双主题样张，最后根据实际交互修正规范。它不是对原作者某一完整流程的逐字复现，也不能替代 Marathon 的原始视觉证据。

补充候选：[Style Tiles](https://styletil.es/) 本次访问返回 HTTP 429，未读取到正文，暂不作为已核实的方法依据。

## 自动化工具

| 编号 | 第一方来源 | 已确认的能力 | 拟用任务与验证重点 |
| --- | --- | --- | --- |
| T01 | [yt-dlp](https://github.com/yt-dlp/yt-dlp) · [已读取 README](https://raw.githubusercontent.com/yt-dlp/yt-dlp/master/README.md) | 命令行音视频下载工具，提供站点支持与相关采集选项 | 目标材料的元数据、字幕和视频采集；先验证实际站点、时间戳及可获取性 |
| T02 | [FFmpeg 官方文档](https://ffmpeg.org/ffmpeg.html) | 输入输出、转码、过滤与媒体处理管线 | 取帧、裁切和片段导出；核对原始时间戳、分辨率与色彩，保留源文件 |
| T03 | [PySceneDetect](https://github.com/Breakthrough/PySceneDetect) · [已读取 README](https://raw.githubusercontent.com/Breakthrough/PySceneDetect/main/README.md) | 镜头切分检测、按镜头保存图像和视频拆分；拆分依赖 FFmpeg 等工具 | 快速生成关键帧与镜头索引；补查静态镜头内部的 UI 状态变化和细微动效 |
| T04 | [Playwright](https://github.com/microsoft/playwright) · [已读取 README](https://raw.githubusercontent.com/microsoft/playwright/main/README.md) | 浏览器自动化和测试，支持多个浏览器引擎 | 优先复用项目已有安装检查本地原型、双主题与组件状态，避免重复搭建工具链 |
| T05 | [Style Dictionary](https://github.com/style-dictionary/style-dictionary) · [已读取 README](https://raw.githubusercontent.com/amzn/style-dictionary/main/README.md) | 以设计 token 为统一来源，转换导出多个平台／语言的样式表达 | 双主题变量、CSS 与规范表同步；按实际规模与轻量脚本比较后选用 |

URL 规范化、文件校验和、感知哈希、OCR、区域取色、静态图册生成和增量清单是拟采用的处理手段。尚未选定的库不记为已采用项目，具体工具以小样质量、现有环境兼容性和维护成本决定。

## 小样验证与复用方式

1. 选择少量不同类型材料：官网画面、带字幕解析视频、宣传片片段、包含菜单交互的实机片段，以及本项目的一组双主题组件。
2. 验证来源编号能贯穿原件、帧图、裁切、时间戳、分析卡与图册；失败材料保留原因。
3. 人工对照自动取帧与原片，检查镜头内动画、遮罩、文字变化和短暂状态是否遗漏。
4. 检查自动去重没有丢掉悬浮／选中等重要状态差别；OCR 与取色仅作为辅助候选。
5. 验证第二次执行可以复用相同输入，变更参数或源文件后只更新受影响产物；记录耗时和输出规模后再决定并发与批量规模。
6. 将实际使用的版本、依赖、命令和配置保存在研究目录，依据结果选择足够简单的工具组合。

此处只完成方法与工具的一手资料初查。尚未运行以上小样，不宣称已实现自动采集、自动分析或具体提速倍数。
