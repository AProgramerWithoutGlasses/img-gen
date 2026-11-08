package studio

import (
	"bytes"
	"context"
	"errors"
	"image/jpeg"
	"image/png"

	"github.com/disintegration/imaging"
)

// A channel compatibility preset, not an advertised model input limit.
const upstreamInputMaxEdge = 4096

// Re-encoding can make a valid uploaded PNG/JPEG much larger. Preserve the
// application's per-input upload budget for its outgoing copy as well.
const upstreamInputMaxBytes = 12 << 20

var errInputEncodingBudget = errors.New("input encoding budget exceeded")

type inputEncodingBuffer struct{ bytes.Buffer }

func (b *inputEncodingBuffer) Write(p []byte) (int, error) {
	if len(p) > upstreamInputMaxBytes-b.Len() {
		return 0, errInputEncodingBudget
	}
	return b.Buffer.Write(p)
}

// Only one full input decode/resize at a time on the single-instance host.
var upstreamInputSlot = make(chan struct{}, 1)

// prepareUpstreamInput creates a disposable request copy. Never change the
// persisted input or reference: history, downloads and later edits use originals.
func PrepareUpstreamInput(ctx context.Context, content []byte) (Picture, error) {
	select {
	case upstreamInputSlot <- struct{}{}:
		defer func() { <-upstreamInputSlot }()
	case <-ctx.Done():
		return Picture{}, ctx.Err()
	}
	if err := ctx.Err(); err != nil {
		return Picture{}, err
	}
	info, err := DecodePicture(content)
	if err != nil {
		return Picture{}, err
	}
	source, err := imaging.Decode(bytes.NewReader(content), imaging.AutoOrientation(true))
	if err != nil {
		return Picture{}, errors.New("输入图片无法完整解码，请重新导出 PNG / JPEG 后上传")
	}
	if err := ctx.Err(); err != nil {
		return Picture{}, err
	}
	bounds := source.Bounds()
	resize := bounds.Dx() > upstreamInputMaxEdge || bounds.Dy() > upstreamInputMaxEdge
	// Preserve small PNG bytes and transparency; JPEG is normalized even when
	// small so orientation is applied before discarding camera metadata.
	if !resize && info.MIME == "image/png" && len(content) <= upstreamInputMaxBytes {
		return info, nil
	}
	if resize {
		source = imaging.Fit(source, upstreamInputMaxEdge, upstreamInputMaxEdge, imaging.Lanczos)
	}
	for {
		if err := ctx.Err(); err != nil {
			return Picture{}, err
		}
		var out inputEncodingBuffer
		if info.MIME == "image/jpeg" {
			err = jpeg.Encode(&out, source, &jpeg.Options{Quality: 95})
		} else {
			err = png.Encode(&out, source)
		}
		if err == nil {
			if err := ctx.Err(); err != nil {
				return Picture{}, err
			}
			return DecodePicture(out.Bytes())
		}
		if !errors.Is(err, errInputEncodingBudget) {
			return Picture{}, errors.New("处理输入图片失败，请重新导出后上传")
		}
		// Retry local encoding only, never a network/model request. Keep alpha
		// instead of flattening transparent images to JPEG to meet the budget.
		edge := max(source.Bounds().Dx(), source.Bounds().Dy())
		if edge <= 1 {
			return Picture{}, errors.New("输入图片无法压缩到上传大小限制")
		}
		source = imaging.Fit(source, max(1, edge*4/5), max(1, edge*4/5), imaging.Lanczos)
	}
}
