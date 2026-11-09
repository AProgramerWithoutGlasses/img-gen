package studio_test

import (
	"bytes"
	"database/sql"
	"encoding/binary"
	"image"
	"image/color"
	"image/gif"
	"image/jpeg"
	"image/png"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"

	studio "github.com/AProgramerWithoutGlasses/img-gen/internal/studio"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gen2brain/webp"
)

func attachmentPNG(t *testing.T, width, height int) []byte {
	t.Helper()
	im := image.NewNRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ {
		for x := width / 2; x < width; x++ {
			im.SetNRGBA(x, y, color.NRGBA{R: 240, G: 110, B: 60, A: 255})
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, im); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func TestAttachmentRenditionDimensionsAndAlpha(t *testing.T) {
	for _, size := range []image.Point{{1600, 800}, {800, 1600}, {32, 16}, {1000, 10}} {
		data := attachmentPNG(t, size.X, size.Y)
		for _, kind := range []string{"thumbnail", "preview", "preview-large"} {
			t.Run(kind+"/"+size.String(), func(t *testing.T) {
				encoded, err := studio.MakeAttachmentRendition(data, kind)
				if err != nil {
					t.Fatal(err)
				}
				img, err := webp.Decode(bytes.NewReader(encoded))
				if err != nil {
					t.Fatal(err)
				}
				b := img.Bounds()
				if b.Dx() > size.X || b.Dy() > size.Y {
					t.Fatal("small original enlarged", b)
				}
				if kind == "thumbnail" {
					if b.Dx() != b.Dy() || b.Dx() > 256 {
						t.Fatal("thumbnail must be bounded square", b)
					}
				} else {
					limit := 640
					if kind == "preview-large" {
						limit = 1600
					}
					ratioError := b.Dx()*size.Y - b.Dy()*size.X
					if ratioError < 0 {
						ratioError = -ratioError
					}
					if b.Dx() > limit || b.Dy() > limit || ratioError > max(size.X, size.Y) {
						t.Fatal("preview ratio/bound changed", b)
					}
				}
				_, _, _, alpha := img.At(b.Min.X, b.Min.Y+b.Dy()/2).RGBA()
				if alpha != 0 {
					t.Fatal("transparency lost")
				}
			})
		}
	}
	if _, err := studio.MakeAttachmentRendition([]byte("not an image"), "preview"); err == nil {
		t.Fatal("invalid image accepted")
	}
	if _, err := studio.MakeAttachmentRendition(testPNG(), "arbitrary-size"); err == nil {
		t.Fatal("unbounded variant accepted")
	}
}

func TestAttachmentRenditionFormatsAndAnimation(t *testing.T) {
	base, _, _ := image.Decode(bytes.NewReader(attachmentPNG(t, 40, 20)))
	formats := map[string][]byte{}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, base, nil); err != nil {
		t.Fatal(err)
	}
	formats["jpeg"] = append([]byte(nil), buf.Bytes()...)
	buf.Reset()
	if err := webp.Encode(&buf, base, webp.Options{Lossless: true}); err != nil {
		t.Fatal(err)
	}
	formats["webp"] = append([]byte(nil), buf.Bytes()...)
	buf.Reset()
	palette := color.Palette{color.NRGBA{R: 255, A: 255}, color.NRGBA{B: 255, A: 255}}
	first, second := image.NewPaletted(image.Rect(0, 0, 40, 20), palette), image.NewPaletted(image.Rect(0, 0, 40, 20), palette)
	for i := range second.Pix {
		second.Pix[i] = 1
	}
	if err := gif.EncodeAll(&buf, &gif.GIF{Image: []*image.Paletted{first, second}, Delay: []int{10, 10}, Config: image.Config{ColorModel: palette, Width: 40, Height: 20}}); err != nil {
		t.Fatal(err)
	}
	formats["gif"] = append([]byte(nil), buf.Bytes()...)
	buf.Reset()
	if err := webp.EncodeAll(&buf, &webp.WEBP{Image: []image.Image{first, second}, Delay: []int{100, 100}}, webp.Options{Lossless: true}); err != nil {
		t.Fatal(err)
	}
	formats["animated-webp"] = append([]byte(nil), buf.Bytes()...)
	for format, content := range formats {
		t.Run(format, func(t *testing.T) {
			out, err := studio.MakeAttachmentRendition(content, "preview")
			if err != nil {
				t.Fatal(err)
			}
			img, err := webp.Decode(bytes.NewReader(out))
			if err != nil {
				t.Fatal(err)
			}
			if img.Bounds().Dx() != 40 || img.Bounds().Dy() != 20 {
				t.Fatal("format changed source size")
			}
			if format == "gif" || format == "animated-webp" {
				r, _, b, _ := img.At(10, 10).RGBA()
				if r < 50000 || b > 5000 {
					t.Fatal("GIF did not use first frame")
				}
				all, err := webp.DecodeAll(bytes.NewReader(out))
				if err != nil || len(all.Image) != 1 {
					t.Fatal("GIF preview must be static", err)
				}
			}
		})
	}
}

func TestAttachmentGIFLogicalCanvas(t *testing.T) {
	palette := color.Palette{color.NRGBA{}, color.NRGBA{R: 255, A: 255}}
	frame := image.NewPaletted(image.Rect(10, 5, 30, 15), palette)
	for i := range frame.Pix {
		frame.Pix[i] = 1
	}
	var buf bytes.Buffer
	if err := gif.EncodeAll(&buf, &gif.GIF{Image: []*image.Paletted{frame}, Delay: []int{10}, Config: image.Config{ColorModel: palette, Width: 40, Height: 20}}); err != nil {
		t.Fatal(err)
	}
	out, err := studio.MakeAttachmentRendition(buf.Bytes(), "preview")
	if err != nil {
		t.Fatal(err)
	}
	img, err := webp.Decode(bytes.NewReader(out))
	if err != nil {
		t.Fatal(err)
	}
	if img.Bounds() != image.Rect(0, 0, 40, 20) {
		t.Fatal("GIF logical canvas lost", img.Bounds())
	}
	_, _, _, outside := img.At(0, 0).RGBA()
	r, _, _, inside := img.At(12, 8).RGBA()
	if outside != 0 || inside != 65535 || r < 60000 {
		t.Fatal("offset first frame not composited correctly")
	}
}

func TestAttachmentStaticWebPColour(t *testing.T) {
	source := image.NewNRGBA(image.Rect(0, 0, 20, 20))
	for y := 0; y < 20; y++ {
		for x := 0; x < 20; x++ {
			source.SetNRGBA(x, y, color.NRGBA{245, 245, 245, 255})
		}
	}
	var buf bytes.Buffer
	if err := webp.Encode(&buf, source, webp.Options{Lossless: true}); err != nil {
		t.Fatal(err)
	}
	out, err := studio.MakeAttachmentRendition(buf.Bytes(), "preview")
	if err != nil {
		t.Fatal(err)
	}
	frames, err := webp.DecodeAll(bytes.NewReader(out))
	if err != nil {
		t.Fatal(err)
	}
	if len(frames.Image) != 1 {
		t.Fatal("static output gained frames")
	}
	c := color.NRGBAModel.Convert(frames.Image[0].At(10, 10)).(color.NRGBA)
	if c.R < 240 || c.G < 240 || c.B < 240 {
		t.Fatal("static WebP colour range darkened", c)
	}
}

func TestAttachmentRenditionEXIF(t *testing.T) {
	base := image.NewRGBA(image.Rect(0, 0, 80, 40))
	var jpegData bytes.Buffer
	if err := jpeg.Encode(&jpegData, base, nil); err != nil {
		t.Fatal(err)
	}
	// Little-endian TIFF with Orientation=6 (90 degrees clockwise).
	exif := []byte{'E', 'x', 'i', 'f', 0, 0, 'I', 'I', 42, 0, 8, 0, 0, 0, 1, 0, 0x12, 1, 3, 0, 1, 0, 0, 0, 6, 0, 0, 0, 0, 0, 0, 0}
	segment := []byte{0xff, 0xe1, 0, 0}
	binary.BigEndian.PutUint16(segment[2:4], uint16(len(exif)+2))
	content := append(append(append([]byte(nil), jpegData.Bytes()[:2]...), segment...), exif...)
	content = append(content, jpegData.Bytes()[2:]...)
	out, err := studio.MakeAttachmentRendition(content, "preview")
	if err != nil {
		t.Fatal(err)
	}
	cfg, err := webp.DecodeConfig(bytes.NewReader(out))
	if err != nil || cfg.Width != 40 || cfg.Height != 80 {
		t.Fatal("orientation ignored", cfg, err)
	}
	// Invalid offset must be ignored instead of reading outside the EXIF chunk.
	binary.LittleEndian.PutUint32(exif[10:14], 0xfffffff0)
	bad := append(append(append([]byte(nil), jpegData.Bytes()[:2]...), segment...), exif...)
	bad = append(bad, jpegData.Bytes()[2:]...)
	if _, err := studio.MakeAttachmentRendition(bad, "preview"); err != nil {
		t.Fatal("malformed EXIF broke otherwise valid image", err)
	}
}

func TestAttachmentRenditionCacheAuthorization(t *testing.T) {
	id, userID := strings.Repeat("1", 32), strings.Repeat("b", 32)
	metaQuery := `SELECT COALESCE\(p.mime,''\).*FROM studio_attachments a LEFT JOIN studio_attachment_renditions p .* WHERE a.id=\? AND a.user_id=\?`
	for _, scenario := range []string{"cached", "revalidated", "head", "foreign", "no-session", "bad-version", "legacy"} {
		t.Run(scenario, func(t *testing.T) {
			path := "/api/studio/attachments/" + id + "/preview/1"
			if scenario == "bad-version" {
				path = "/api/studio/attachments/" + id + "/preview/999"
			}
			method := "GET"
			if scenario == "head" {
				method = "HEAD"
			}
			r := httptest.NewRequest(method, path, nil)
			if scenario == "revalidated" {
				r.Header.Set("If-None-Match", `W/"cached"`)
			}
			a := &studio.App{}
			want := 200
			if scenario == "no-session" {
				want = 401
			} else {
				mock := mockSession(t, a, r, "user")
				row := func(etag string) *sqlmock.Rows {
					return sqlmock.NewRows([]string{"mime", "etag", "byte_size", "width", "height", "source_width", "source_height"}).AddRow("image/webp", etag, 11, 40, 20, 40, 20)
				}
				switch scenario {
				case "bad-version":
					want = 404
				case "foreign":
					mock.ExpectQuery(metaQuery).WithArgs("preview", "1", id, userID).WillReturnError(sql.ErrNoRows)
					want = 404
				case "legacy":
					for range 2 {
						mock.ExpectQuery(metaQuery).WithArgs("preview", "1", id, userID).WillReturnRows(row(""))
					}
					mock.ExpectQuery(`SELECT a.content FROM studio_attachments a WHERE a.id=\? AND a.user_id=\?`).WithArgs(id, userID).WillReturnRows(sqlmock.NewRows([]string{"content"}).AddRow(testPNG()))
					mock.ExpectExec(`INSERT INTO studio_attachment_renditions`).WithArgs(id, "preview", "1", "image/webp", sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg()).WillReturnResult(sqlmock.NewResult(0, 1))
				default:
					mock.ExpectQuery(metaQuery).WithArgs("preview", "1", id, userID).WillReturnRows(row(`"cached"`))
					if scenario == "revalidated" {
						want = 304
					} else if scenario != "head" {
						mock.ExpectQuery(`SELECT p.content FROM studio_attachments a JOIN studio_attachment_renditions p .* WHERE a.id=\? AND a.user_id=\?`).WithArgs("preview", "1", id, userID).WillReturnRows(sqlmock.NewRows([]string{"content"}).AddRow([]byte("cached-webp")))
					}
				}
			}
			w := httptest.NewRecorder()
			a.Handler(fstest.MapFS{}).ServeHTTP(w, r)
			if w.Code != want {
				t.Fatalf("got %d want %d: %s", w.Code, want, w.Body.String())
			}
			if want == 304 || scenario == "head" {
				if w.Body.Len() != 0 || w.Header().Get("ETag") != `"cached"` || w.Header().Get("Vary") != "Cookie" {
					t.Fatal("invalid cache metadata response")
				}
			}
			if want == 401 || want == 404 {
				if w.Header().Get("Cache-Control") != "no-store" {
					t.Fatal("access failure cached")
				}
			}
			if scenario == "legacy" {
				if _, err := webp.Decode(bytes.NewReader(w.Body.Bytes())); err != nil {
					t.Fatal(err)
				}
			}
		})
	}
}
