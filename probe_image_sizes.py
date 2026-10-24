"""Size-only probes; run selected cases explicitly to control API usage."""
import probe_image_api as probe

probe.ROOT = probe.Path(__file__).resolve().parent / "outputs" / "size-probe"
probe.CASES = {
    "size_landscape": {"size": "1536x1024"},
    "size_portrait": {"size": "1024x1536"},
    "size_invalid": {"size": "definitely_invalid"},
    "aspect_portrait": {"aspect_ratio": "9:16"},
    "prompt_landscape": {
        "prompt": probe.PROMPT + "。请生成一张16:9的横向宽幅图片，画布宽度明显大于高度。"
    },
    "prompt_portrait": {
        "prompt": probe.PROMPT + "。请生成一张9:16的竖向长幅图片，画布高度明显大于宽度。"
    },
    "width_height_portrait": {"width": 1024, "height": 1536},
    "image_config_portrait": {"image_config": {"aspect_ratio": "9:16", "image_size": "2K"}},
    "prompt_exact_landscape": {
        "prompt": probe.PROMPT + "。输出图片的像素尺寸必须为1536x1024（宽1536像素，高1024像素），横向3:2画布。"
    },
    "prompt_4k_landscape": {
        "prompt": probe.PROMPT + "。请生成16:9横向图片，4K分辨率，输出宽3840像素、高2160像素。"
    },
    "prompt_exact_square": {
        "prompt": probe.PROMPT + "。输出图片的像素尺寸必须为1024x1024（宽1024像素，高1024像素），正方形1:1画布。"
    },
    "prompt_portrait_repeat": {
        "prompt": probe.PROMPT + "。请生成一张9:16的竖向长幅图片，画布高度明显大于宽度。"
    },
}

if __name__ == "__main__":
    probe.main()
