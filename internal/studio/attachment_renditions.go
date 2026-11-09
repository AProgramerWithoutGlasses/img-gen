package studio

import (
	"bytes"
	"crypto/sha256"
	"database/sql"
	"encoding/binary"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/disintegration/imaging"
	"github.com/gen2brain/webp"
)

const attachmentRenditionVersion = "1"

func setAttachmentRenditionURLs(att *Attachment) {
	att.URL = "/api/studio/attachments/" + att.ID
	att.ThumbnailURL = att.URL + "/thumbnail/" + attachmentRenditionVersion
	att.PreviewURL = att.URL + "/preview/" + attachmentRenditionVersion
	att.PreviewLargeURL = att.URL + "/preview-large/" + attachmentRenditionVersion
}

// attachmentPictureConfig validates byte/pixel limits before any pixel allocation.
// The returned dimensions describe the oriented original, never a rendition.
func attachmentPictureConfig(content []byte) (image.Config, string, int, error) {
	if len(content) == 0 || len(content) > 20<<20 {
		return image.Config{}, "", 1, errors.New("invalid attachment byte size")
	}
	cfg, format, err := image.DecodeConfig(bytes.NewReader(content))
	if err != nil || !strings.Contains("|png|jpeg|webp|gif|", "|"+format+"|") || cfg.Width < 1 || cfg.Height < 1 || int64(cfg.Width)*int64(cfg.Height) > 64_000_000 {
		return image.Config{}, "", 1, errors.New("invalid attachment image")
	}
	orientation := pictureOrientation(content, format)
	if orientation >= 5 && orientation <= 8 {
		cfg.Width, cfg.Height = cfg.Height, cfg.Width
	}
	return cfg, format, orientation, nil
}

// Read only bounded EXIF chunks; malformed metadata is ignored, never trusted
// as an allocation size or followed outside its containing chunk.
func pictureOrientation(content []byte, format string) int {
	parse := func(data []byte) int {
		data = bytes.TrimPrefix(data, []byte("Exif\x00\x00"))
		if len(data) < 8 {
			return 1
		}
		var order binary.ByteOrder
		switch string(data[:2]) {
		case "II":
			order = binary.LittleEndian
		case "MM":
			order = binary.BigEndian
		default:
			return 1
		}
		if order.Uint16(data[2:4]) != 42 {
			return 1
		}
		offset := uint64(order.Uint32(data[4:8]))
		if offset+2 > uint64(len(data)) {
			return 1
		}
		count := uint64(order.Uint16(data[offset : offset+2]))
		for i := uint64(0); i < count; i++ {
			p := offset + 2 + i*12
			if p+12 > uint64(len(data)) {
				break
			}
			entry := data[p : p+12]
			if order.Uint16(entry[:2]) == 0x112 && order.Uint16(entry[2:4]) == 3 && order.Uint32(entry[4:8]) == 1 {
				if v := int(order.Uint16(entry[8:10])); v >= 1 && v <= 8 {
					return v
				}
			}
		}
		return 1
	}
	switch format {
	case "jpeg":
		for pos := 2; pos+4 <= len(content); {
			if content[pos] != 0xff {
				break
			}
			marker := content[pos+1]
			if marker == 0xda || marker == 0xd9 {
				break
			}
			if marker == 0xff {
				pos++
				continue
			}
			if marker == 0x01 || marker >= 0xd0 && marker <= 0xd8 {
				pos += 2
				continue
			}
			size := int(binary.BigEndian.Uint16(content[pos+2 : pos+4]))
			if size < 2 || size > len(content)-pos-2 {
				break
			}
			chunk := content[pos+4 : pos+2+size]
			if marker == 0xe1 && bytes.HasPrefix(chunk, []byte("Exif\x00\x00")) {
				return parse(chunk)
			}
			pos += 2 + size
		}
	case "png":
		for pos := 8; pos+12 <= len(content); {
			size := uint64(binary.BigEndian.Uint32(content[pos : pos+4]))
			if size+12 > uint64(len(content)-pos) {
				break
			}
			if string(content[pos+4:pos+8]) == "eXIf" {
				return parse(content[pos+8 : pos+8+int(size)])
			}
			pos += int(size) + 12
		}
	case "webp":
		for pos := 12; pos+8 <= len(content); {
			size := uint64(binary.LittleEndian.Uint32(content[pos+4 : pos+8]))
			if size+8 > uint64(len(content)-pos) {
				break
			}
			if string(content[pos:pos+4]) == "EXIF" {
				return parse(content[pos+8 : pos+8+int(size)])
			}
			pos += 8 + int(size) + int(size%2)
		}
	}
	return 1
}

type attachmentRendition struct {
	content                                         []byte
	mime, etag                                      string
	bytes, width, height, sourceWidth, sourceHeight int
}

// MakeAttachmentRendition creates a bounded static display copy. GIF/WebP
// animations contribute their first frame; the original bytes remain untouched.
func MakeAttachmentRendition(content []byte, kind string) ([]byte, error) {
	r, err := makeAttachmentRendition(content, kind)
	return r.content, err
}

func makeAttachmentRendition(content []byte, kind string) (attachmentRendition, error) {
	var out attachmentRendition
	maxSize, quality := 0, 82
	switch kind {
	case "thumbnail":
		maxSize = 256
	case "preview":
		maxSize = 640
	case "preview-large":
		maxSize, quality = 1600, 93
	default:
		return out, errors.New("unknown attachment rendition")
	}
	cfg, format, orientation, err := attachmentPictureConfig(content)
	if err != nil {
		return out, err
	}
	var source image.Image
	if format == "webp" {
		if attachmentAnimatedWebP(content) {
			// libwebp composites just the first animation frame on its canvas.
			source, err = webp.Decode(bytes.NewReader(content))
		} else {
			// Static Decode returns limited-range YUV as Go YCbCr. Request RGB
			// through the animation decoder only after proving there is one frame.
			// Animated files above use Decode, which stops after its first frame.
			var decoded *webp.WEBP
			decoded, err = webp.DecodeAll(bytes.NewReader(content))
			if err == nil {
				if len(decoded.Image) != 1 {
					return out, errors.New("invalid static WebP")
				}
				source = decoded.Image[0]
			}
		}
	} else {
		source, _, err = image.Decode(bytes.NewReader(content))
	}
	if err != nil {
		return out, err
	}
	if format == "gif" && source.Bounds() != image.Rect(0, 0, cfg.Width, cfg.Height) {
		// gif.Decode decodes one frame, which may be a small offset rectangle.
		// Place it on the logical screen without decoding the rest of the animation.
		canvas := image.NewNRGBA(image.Rect(0, 0, cfg.Width, cfg.Height))
		transparent := false
		if frame, ok := source.(*image.Paletted); ok {
			for _, c := range frame.Palette {
				_, _, _, alpha := c.RGBA()
				if alpha < 0xffff {
					transparent = true
					break
				}
			}
		}
		if !transparent && len(content) > 11 {
			if palette, ok := cfg.ColorModel.(color.Palette); ok && int(content[11]) < len(palette) {
				draw.Draw(canvas, canvas.Bounds(), image.NewUniform(palette[content[11]]), image.Point{}, draw.Src)
			}
		}
		draw.Draw(canvas, source.Bounds(), source, source.Bounds().Min, draw.Src)
		source = canvas
	}
	switch orientation {
	case 2:
		source = imaging.FlipH(source)
	case 3:
		source = imaging.Rotate180(source)
	case 4:
		source = imaging.FlipV(source)
	case 5:
		source = imaging.Transpose(source)
	case 6:
		source = imaging.Rotate270(source)
	case 7:
		source = imaging.Transverse(source)
	case 8:
		source = imaging.Rotate90(source)
	}
	var resized image.Image
	if kind == "thumbnail" {
		side := min(maxSize, source.Bounds().Dx(), source.Bounds().Dy())
		resized = imaging.Fill(source, side, side, imaging.Center, imaging.Lanczos)
	} else {
		resized = imaging.Fit(source, maxSize, maxSize, imaging.Lanczos)
	}
	var encoded bytes.Buffer
	// Low-colour PNG/GIF artwork (text, diagrams, flat fills) benefits from
	// lossless encoding; photographic/gradient sources retain the established
	// quality values. Method 4 avoids the expensive alpha search of method 6.
	lossless := (format == "png" || format == "gif") && attachmentSmallPalette(source)
	if err = webp.Encode(&encoded, resized, webp.Options{Quality: quality, Method: 4, Lossless: lossless}); err != nil {
		return out, err
	}
	out.content = encoded.Bytes()
	out.mime = "image/webp"
	out.bytes = len(out.content)
	out.etag = fmt.Sprintf(`"%x"`, sha256.Sum256(out.content))
	out.width, out.height = resized.Bounds().Dx(), resized.Bounds().Dy()
	out.sourceWidth, out.sourceHeight = cfg.Width, cfg.Height
	return out, nil
}

func attachmentSmallPalette(source image.Image) bool {
	colours := make(map[color.NRGBA]struct{}, 257)
	bounds := source.Bounds()
	for y := bounds.Min.Y; y < bounds.Max.Y; y++ {
		for x := bounds.Min.X; x < bounds.Max.X; x++ {
			c := color.NRGBAModel.Convert(source.At(x, y)).(color.NRGBA)
			if c.A == 0 {
				c = color.NRGBA{}
			}
			colours[c] = struct{}{}
			if len(colours) > 256 {
				return false
			}
		}
	}
	return true
}

func attachmentAnimatedWebP(content []byte) bool {
	for pos := 12; pos+8 <= len(content); {
		size := uint64(binary.LittleEndian.Uint32(content[pos+4 : pos+8]))
		if size+8 > uint64(len(content)-pos) {
			return false
		}
		if string(content[pos:pos+4]) == "VP8X" && size >= 1 {
			return content[pos+8]&2 != 0
		}
		pos += 8 + int(size) + int(size%2)
	}
	return false
}

func (a *App) getStudioAttachmentRendition(w http.ResponseWriter, r *http.Request) {
	id, kind := r.PathValue("id"), r.PathValue("kind")
	if !ValidID(id) || r.PathValue("version") != attachmentRenditionVersion || kind != "thumbnail" && kind != "preview" && kind != "preview-large" {
		apiError(w, 404, "附件预览不存在")
		return
	}
	scope, args := ownerScope(r, "a.user_id")
	queryArgs := append([]any{kind, attachmentRenditionVersion, id}, args...)
	query := `SELECT COALESCE(p.mime,''),COALESCE(p.etag,''),COALESCE(p.byte_size,0),COALESCE(p.width,0),COALESCE(p.height,0),COALESCE(p.source_width,0),COALESCE(p.source_height,0)
		FROM studio_attachments a LEFT JOIN studio_attachment_renditions p ON p.attachment_id=a.id AND p.kind=? AND p.version=? WHERE a.id=?` + scope
	var cached attachmentRendition
	readMetadata := func() error {
		return a.DB.QueryRowContext(r.Context(), query, queryArgs...).Scan(&cached.mime, &cached.etag, &cached.bytes, &cached.width, &cached.height, &cached.sourceWidth, &cached.sourceHeight)
	}
	err := readMetadata()
	if errors.Is(err, sql.ErrNoRows) {
		apiError(w, 404, "附件不存在")
		return
	}
	if err != nil {
		apiError(w, 500, "读取附件预览失败")
		return
	}
	if cached.etag == "" {
		err = func() error {
			a.thumbnails.Lock()
			defer a.thumbnails.Unlock()
			if err := r.Context().Err(); err != nil {
				return err
			}
			if err := readMetadata(); err != nil || cached.etag != "" {
				return err
			}
			var original []byte
			if err := a.DB.QueryRowContext(r.Context(), "SELECT a.content FROM studio_attachments a WHERE a.id=?"+scope, append([]any{id}, args...)...).Scan(&original); err != nil {
				return err
			}
			var err error
			cached, err = makeAttachmentRendition(original, kind)
			if err != nil {
				return err
			}
			_, err = a.DB.ExecContext(r.Context(), `INSERT INTO studio_attachment_renditions(attachment_id,kind,version,mime,etag,byte_size,width,height,source_width,source_height,content) VALUES(?,?,?,?,?,?,?,?,?,?,?)`, id, kind, attachmentRenditionVersion, cached.mime, cached.etag, cached.bytes, cached.width, cached.height, cached.sourceWidth, cached.sourceHeight, cached.content)
			return err
		}()
		if err != nil {
			apiError(w, 500, "生成附件预览失败，仍可查看原图")
			return
		}
	}
	// Authorization and cache metadata are read before either a conditional 304
	// or a HEAD response. Neither path needs to load the cached BLOB or rehash it.
	setAttachmentCacheHeaders(w, cached)
	if r.Header.Get("If-Match") == "" {
		for _, tag := range strings.Split(r.Header.Get("If-None-Match"), ",") {
			tag = strings.TrimSpace(tag)
			if tag == "*" || strings.TrimPrefix(tag, "W/") == cached.etag {
				w.WriteHeader(http.StatusNotModified)
				return
			}
		}
		if r.Method == http.MethodHead {
			w.Header().Set("Content-Length", strconv.Itoa(cached.bytes))
			return
		}
	}
	if len(cached.content) == 0 {
		err = a.DB.QueryRowContext(r.Context(), `SELECT p.content FROM studio_attachments a JOIN studio_attachment_renditions p ON p.attachment_id=a.id AND p.kind=? AND p.version=? WHERE a.id=?`+scope, queryArgs...).Scan(&cached.content)
		if err != nil {
			// Do not let an access/error response inherit successful image caching.
			w.Header().Del("ETag")
			w.Header().Set("Cache-Control", "no-store")
			apiError(w, 500, "读取附件预览失败")
			return
		}
	}
	http.ServeContent(w, r, "", time.Time{}, bytes.NewReader(cached.content))
}

func setAttachmentCacheHeaders(w http.ResponseWriter, cached attachmentRendition) {
	w.Header().Set("Content-Type", cached.mime)
	w.Header().Set("Cache-Control", "private, no-cache")
	w.Header().Add("Vary", "Cookie")
	w.Header().Set("ETag", cached.etag)
}
