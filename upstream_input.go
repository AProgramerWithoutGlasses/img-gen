package main

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

// Only one full input decode/resize at a time on the single-instance host.
var upstreamInputSlot = make(chan struct{}, 1)

// prepareUpstreamInput creates a disposable request copy. Never change the
// persisted input or reference: history, downloads and later edits use originals.
func prepareUpstreamInput(ctx context.Context, content []byte) (picture, error) {
	select {
	case upstreamInputSlot <- struct{}{}:
		defer func() { <-upstreamInputSlot }()
	case <-ctx.Done():
		return picture{}, ctx.Err()
	}
	if err := ctx.Err(); err != nil {
		return picture{}, err
	}
	info, err := decodePicture(content)
	if err != nil {
		return picture{}, err
	}
	source, err := imaging.Decode(bytes.NewReader(content), imaging.AutoOrientation(true))
	if err != nil {
		return picture{}, errors.New("输入图片无法完整解码，请重新导出 PNG / JPEG 后上传")
	}
	if err := ctx.Err(); err != nil {
		return picture{}, err
	}
	bounds := source.Bounds()
	resize := bounds.Dx() > upstreamInputMaxEdge || bounds.Dy() > upstreamInputMaxEdge
	// Preserve small PNG bytes and transparency; JPEG is normalized even when
	// small so orientation is applied before discarding camera metadata.
	if !resize && info.MIME == "image/png" {
		return info, nil
	}
	if resize {
		source = imaging.Fit(source, upstreamInputMaxEdge, upstreamInputMaxEdge, imaging.Lanczos)
	}
	var out bytes.Buffer
	if info.MIME == "image/jpeg" {
		err = jpeg.Encode(&out, source, &jpeg.Options{Quality: 95})
	} else {
		err = png.Encode(&out, source)
	}
	if err != nil {
		return picture{}, errors.New("处理输入图片失败，请重新导出后上传")
	}
	if err := ctx.Err(); err != nil {
		return picture{}, err
	}
	return decodePicture(out.Bytes())
}
