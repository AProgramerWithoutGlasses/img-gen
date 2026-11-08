# 上游探测工具

原根 probe_* 完整迁入此处；Python 互相导入保持相邻，项目根通过脚本位置向上两级定位。执行例如 `python tests/probes/probe_generation_controls.py --help`，具体费用与开关遵循原脚本。

Go 边界探测现在直接导入真实 studio 适配器，不再拼接根 provider.go 源码：

```powershell
go build -tags boundaryprobe -o outputs/boundaryprobe.exe ./tests/probes
outputs/boundaryprobe.exe --model gpt-image-2 --case offline-check --out outputs/probes
```

未加 --execute 时不会发送请求；--prepare-only 仅离线预处理。部分历史脚本明确为服务器环境设计，不能自动在本地执行。配置、完整响应与输出图片留忽略目录；失败不自动重试。
