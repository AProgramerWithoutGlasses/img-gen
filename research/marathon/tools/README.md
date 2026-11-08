# 研究工具与复现

工具只处理本研究目录中的资料和产物，不写产品前端，不访问生产数据或生图上游。

## 已使用的工具

- `collect.py`：有限并发采集选定公开页面，保存正文、链接、媒体与校验和；成功条目复用缓存。正常浏览器可读的页面另保存于 `outputs/browser/`，HTTP 200 的应用壳不冒充已读正文。
- `media.py`：从显式媒体清单取得参考图，保留原件、生成浏览副本和接触表。`--derive` 只补充缺少的初始条目，保留后续人工选择。
- `transcript.py`：整理已有 WebVTT 字幕并保留时间；本轮取得的是英文平台字幕，没有运行本地 ASR。`video-to-summary` 的缓存环境检查已通过。
- `video_evidence.py`：按指定时间点导出视频帧，保存源视频哈希与定位时间。
- `motion_evidence.py`：从已取得媒体导出有长度上限的片段、预览和连续帧。公开短预览与完整片源的选定片段分别标记。
- `build_pilot_design.py`：生成本项目原创的可编辑 SVG 试点和语义变量。SVG 先导入并保存 FigCraft，再同步浏览器试点；此脚本本身不会替换 FigCraft 画框。
- `annotate_cases.py`：为选定案例制作明确标记的研究框线与说明，保留未修改的参考原图。
- `make_review_images.py`：从已验证的浏览器截图裁切并汇总审阅样张，检查预期画面未被截断。
- `build_atlas.py`：从来源、案例、媒体清单与 Markdown 生成图册和索引。它使用 Python-Markdown，避免另行实现 Markdown 排版器。
- `package_skill.py`：把权威规范与原创试点样张打包到便携 skill，记录来源与哈希；修改规范后再运行，避免手工维护重复副本。
- `validate.py`：检查本地链接、图片可解码、案例来源、双主题文字／控件对比、浏览器证据，并提供缺图和低对比负例探针。

本轮未使用 PySceneDetect、OCR、自动字体识别或 Style Dictionary。固定时间点采样、原生浏览器、已有 FFmpeg 与轻量变量文件已满足试点需要，未安装不用的工具。

## 环境与命令

以下命令从项目根目录执行。`python` 指具有 Pillow 的 Python 3.11+；采集脚本另需 requests。依赖版本记录于 [requirements.txt](requirements.txt)。本轮复用了本机已有 Python／视频工具环境，新增 Markdown 仅装在本研究目录的忽略目录 `outputs/python-deps/`。

```powershell
python -m pip install --target research/marathon/outputs/python-deps Markdown==3.11.3
python research/marathon/tools/build_atlas.py
python research/marathon/tools/package_skill.py
python research/marathon/tools/validate.py --negative-probes
python -m http.server 8766 --bind 127.0.0.1 --directory research/marathon
```

图册访问 `http://127.0.0.1:8766/`，试点访问 `/prototypes/index.html`。修改原型后刷新浏览器，保留本地示例数据标识。

采集选定来源时：

```powershell
python research/marathon/tools/collect.py --ids S01 S02
python research/marathon/tools/media.py --ids S13 S27
python research/marathon/tools/video_evidence.py --source S14 --video research/marathon/outputs/video/S14/source.mp4 --times 20 60 100 --ffmpeg <FFmpeg可执行文件>
```

只有需要重新请求来源时才用 `--refresh`。连接层故障可以显式指定本机现有代理；HTTP 401／403／412／429 不作为绕过限制的理由。Bilibili、部分媒体站点和 Vimeo 完整片源的限制已在来源索引记录。

`yt-dlp` 的通用网页提取可能把“相关作品”也识别为播放列表。本轮遇到此情况后，改用已在页面看到的明确媒体 URL，并把第一次含混输出排除出证据。后续下载先确认单个目标及来源，不用网页上的混合播放列表充当当前作品。

## 实测与边界

本轮参考图直接连接的首轮采集有超时，成功取得 18 张；保留成功缓存后，对连接故障使用现有本机代理，补齐至 53 张，用时约 11.8 秒。此数据包含网络条件变化，不能解释为工具提速倍数。

浏览器检查由当前会话的浏览器工具执行，证据在 `outputs/browser-check/`，包含一次窄屏溢出失败与修复后的复查。它们验证本地试点，不是 Go／MySQL、真实模型调用或生产部署验收。设计审计使用项目现有 `npm run design:verify`，试点导出与审计副本归档在研究目录。

截图注意：计算样式已经切换不代表截图中的绘制帧已经更新。本轮最终主题样张采用分步原生截图，并由 validate.py 比较选中区域的预期颜色；深色画面残留浅色块的负例必须被拒绝。最终审阅使用 prototypes/screenshots/，早期 outputs/ 调试快照不替代最终样张。
