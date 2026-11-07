# ArtCraft 界面参考素材

参考：[Create Image](https://app.getartcraft.com/create-image)，2026-11-06 的公开未登录页面，左侧导航展开。

- 1920×1080 与 1440×900 分别读取网页实际布局；1440 版按页面滚动容器裁掉不可见导航项。
- `reference-*.json` 保存可见元素的尺寸、颜色、字距、字重和 SVG 数据；只含界面数据，不含账号、Cookie 或业务内容。
- `icons-*.svg` 按侧栏、页头、欢迎区和输入区组织原站矢量图标；文字和背景在 FigCraft 中是独立可编辑节点。
- `logo.png` 来自参考站的 `/images/artcraft-logo-2.png`；`model-google.svg` 来自 `/images/services/google.svg`。
- `fonts/` 中的 Archivo、Geist Mono 来自 [Google Fonts](https://github.com/google/fonts)，附各自 OFL 许可证。页面的 `system-ui` 在本机实际使用 Microsoft YaHei UI。
- 为 FigCraft 的字体扫描，本机已将两份 TTF 复制到用户字体目录 `%LOCALAPPDATA%/Microsoft/Windows/Fonts/`，文件名为 `UIStudio-Archivo-VF.ttf`、`UIStudio-GeistMono-VF.ttf`，没有修改字体注册表。其他机器可复制同样的文件后执行 `text.rescanFonts`。

生成器：`node design/scripts/build-artcraft.mjs`，只生成 `design/commands/artcraft-wide.json`。该批次用于空白画布的初次创建；现有画面应做局部修改，不要再次执行整个创建批次。

当前画布主文件为 `design/ui-studio-design.figcraft`。本目录记录最初两张参考基底的素材，当前成稿已包含后续创作、图库和设置设计；网页预览独立保留。原网页截图、导出图和校对结果位于不提交的 `outputs/`。
