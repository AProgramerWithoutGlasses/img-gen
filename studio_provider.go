package main

import (
	"bytes"
	"context"
	"fmt"
	"image"
	"image/png"
	"math"
	"strconv"
	"strings"
)

// Requested controls are forwarded explicitly. The provider's actual quality and
// decoded dimensions remain the result facts; this is not a capability guarantee.
func studioSize(o studioOptions) string {
	ratio := strings.TrimSuffix(o.Ratio, " HD")
	if ratio == "自动" {
		return "auto"
	}
	if o.ModelID == "gpt-image-1.5" {
		return map[string]string{"1:1": "1024x1024", "3:2": "1536x1024", "2:3": "1024x1536"}[ratio]
	}
	parts := strings.Split(ratio, ":")
	if len(parts) != 2 {
		return "auto"
	}
	w, _ := strconv.ParseFloat(parts[0], 64)
	h, _ := strconv.ParseFloat(parts[1], 64)
	edge := map[string]float64{"1K": 1024, "2K": 2048, "3K": 3072, "4K": 4096}[o.Resolution]
	if edge == 0 || w == 0 || h == 0 {
		return "auto"
	}
	if strings.HasSuffix(o.Ratio, " HD") && edge < 2048 {
		edge = 2048
	}
	if w >= h {
		return fmt.Sprintf("%dx%d", int(edge), int(math.Round(edge*h/w/8))*8)
	}
	return fmt.Sprintf("%dx%d", int(math.Round(edge*w/h/8))*8, int(edge))
}
func studioQuality(o studioOptions) string {
	return map[string]string{"自动": "auto", "最高": "max", "超高": "xhigh", "高": "high", "中": "medium", "低": "low"}[o.Quality]
}
func prepareStudioInputs(ctx context.Context, inputs []picture) ([]picture, error) {
	result := make([]picture, 0, len(inputs))
	for i, p := range inputs {
		// Preserve uploaded originals. Convert WebP/GIF to PNG before the existing
		// request-copy preparation; its size and compression presets stay unchanged.
		if p.MIME == "image/webp" || p.MIME == "image/gif" {
			source, _, err := image.Decode(bytes.NewReader(p.Content))
			if err != nil {
				return nil, fmt.Errorf("第 %d 张附件无法解码", i+1)
			}
			var out bytes.Buffer
			if err = png.Encode(&out, source); err != nil {
				return nil, fmt.Errorf("第 %d 张附件格式转换失败", i+1)
			}
			p.Content = out.Bytes()
		}
		normalized, err := prepareUpstreamInput(ctx, p.Content)
		if err != nil {
			return nil, fmt.Errorf("第 %d 张附件处理失败：%w", i+1, err)
		}
		result = append(result, normalized)
	}
	return result, nil
}
