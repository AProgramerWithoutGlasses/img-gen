package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func inputFixture(t *testing.T, w, h int, format string) []byte {
	t.Helper()
	im := image.NewNRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			im.SetNRGBA(x, y, color.NRGBA{R: 180, G: uint8(x), B: 60, A: 120})
		}
	}
	var out bytes.Buffer
	var err error
	if format == "jpeg" {
		err = jpeg.Encode(&out, im, &jpeg.Options{Quality: 95})
	} else {
		err = png.Encode(&out, im)
	}
	if err != nil {
		t.Fatal(err)
	}
	return out.Bytes()
}

func TestUpstreamInputPreservesOriginalAndAlpha(t *testing.T) {
	data := inputFixture(t, upstreamInputMaxEdge+100, 80, "png")
	original := bytes.Clone(data)
	pic, err := prepareUpstreamInput(context.Background(), data)
	if err != nil {
		t.Fatal(err)
	}
	if pic.Width != upstreamInputMaxEdge || pic.Height < 1 || pic.MIME != "image/png" || !bytes.Equal(data, original) {
		t.Fatalf("incorrect resize or original changed: %dx%d %s", pic.Width, pic.Height, pic.MIME)
	}
	im, err := png.Decode(bytes.NewReader(pic.Content))
	if err != nil {
		t.Fatal(err)
	}
	_, _, _, alpha := im.At(pic.Width/2, pic.Height/2).RGBA()
	if alpha < 110*257 || alpha > 130*257 {
		t.Fatalf("transparency lost: %d", alpha)
	}
	small := testPNG()
	unchanged, err := prepareUpstreamInput(context.Background(), small)
	if err != nil || !bytes.Equal(unchanged.Content, small) {
		t.Fatal("small PNG should remain unchanged", err)
	}
}

func TestUpstreamInputJPEGOrientationAndMetadata(t *testing.T) {
	data := inputFixture(t, 60, 40, "jpeg")
	// Little-endian TIFF with one EXIF orientation=6 (90 degrees clockwise).
	exif := []byte{'E', 'x', 'i', 'f', 0, 0, 'I', 'I', 42, 0, 8, 0, 0, 0,
		1, 0, 0x12, 1, 3, 0, 1, 0, 0, 0, 6, 0, 0, 0, 0, 0, 0, 0}
	withExif := append([]byte{255, 216, 255, 225, 0, byte(len(exif) + 2)}, exif...)
	withExif = append(withExif, data[2:]...)
	withExif = append(withExif, []byte("camera-tail-test")...)
	original := bytes.Clone(withExif)
	pic, err := prepareUpstreamInput(context.Background(), withExif)
	if err != nil {
		t.Fatal(err)
	}
	if pic.Width != 40 || pic.Height != 60 || pic.MIME != "image/jpeg" {
		t.Fatalf("orientation not applied: %dx%d %s", pic.Width, pic.Height, pic.MIME)
	}
	if bytes.Contains(pic.Content, []byte("Exif")) || bytes.Contains(pic.Content, []byte("camera-tail-test")) || !bytes.Equal(withExif, original) {
		t.Fatal("metadata retained or original modified")
	}
}

func TestUpstreamInputThinAndBoundaryImages(t *testing.T) {
	for _, dimensions := range [][2]int{{1, 8192}, {8192, 1}, {4096, 8}, {8, 4096}} {
		data := inputFixture(t, dimensions[0], dimensions[1], "png")
		pic, err := prepareUpstreamInput(context.Background(), data)
		if err != nil {
			t.Fatal(dimensions, err)
		}
		if pic.Width < 1 || pic.Height < 1 || pic.Width > upstreamInputMaxEdge || pic.Height > upstreamInputMaxEdge {
			t.Fatalf("invalid narrow-image dimensions: %dx%d", pic.Width, pic.Height)
		}
		if dimensions[0] <= upstreamInputMaxEdge && dimensions[1] <= upstreamInputMaxEdge && !bytes.Equal(pic.Content, data) {
			t.Fatal("boundary PNG changed unnecessarily")
		}
	}
}

func TestPreparedInputsReachBothProtocols(t *testing.T) {
	base := inputFixture(t, upstreamInputMaxEdge+100, 80, "jpeg")
	ref := inputFixture(t, 80, upstreamInputMaxEdge+100, "png")
	baseOriginal, refOriginal := bytes.Clone(base), bytes.Clone(ref)
	for model := range models {
		t.Run(model, func(t *testing.T) {
			calls := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				var blobs [][]byte
				var mimes []string
				if strings.HasPrefix(model, "gemini-") {
					var request struct {
						Contents []struct {
							Parts []struct {
								InlineData *struct {
									Data     string
									MimeType string
								} `json:"inlineData"`
							}
						}
					}
					if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
						t.Error(err)
						return
					}
					for _, part := range request.Contents[0].Parts {
						if part.InlineData != nil {
							b, err := base64.StdEncoding.DecodeString(part.InlineData.Data)
							if err != nil {
								t.Error(err)
								return
							}
							blobs = append(blobs, b)
							mimes = append(mimes, part.InlineData.MimeType)
						}
					}
				} else {
					if err := r.ParseMultipartForm(1 << 20); err != nil {
						t.Error(err)
						return
					}
					defer r.MultipartForm.RemoveAll()
					for _, file := range r.MultipartForm.File["image[]"] {
						f, err := file.Open()
						if err != nil {
							t.Error(err)
							return
						}
						b, err := io.ReadAll(f)
						f.Close()
						if err != nil {
							t.Error(err)
							return
						}
						blobs = append(blobs, b)
						mimes = append(mimes, file.Header.Get("Content-Type"))
					}
				}
				if len(blobs) != 2 {
					t.Error("lost input roles")
					return
				}
				for i, b := range blobs {
					pic, err := decodePicture(b)
					if err != nil {
						t.Error(err)
						continue
					}
					if pic.MIME != mimes[i] || (i == 0 && (pic.Width != upstreamInputMaxEdge || pic.MIME != "image/jpeg")) || (i == 1 && (pic.Height != upstreamInputMaxEdge || pic.MIME != "image/png")) {
						t.Errorf("wrong processed input %d: %dx%d %s", i, pic.Width, pic.Height, pic.MIME)
					}
				}
				w.WriteHeader(400)
			}))
			defer server.Close()
			p := provider{base: server.URL, key: "mock", client: server.Client()}
			_, err := p.generate(context.Background(), job{Mode: "edit", Model: model, Input: base, InputMIME: "image/jpeg", Reference: ref, ReferenceMIME: "image/png"})
			if err == nil || calls != 1 {
				t.Fatalf("expected one failed call, got %d, %v", calls, err)
			}
			if !bytes.Equal(base, baseOriginal) || !bytes.Equal(ref, refOriginal) {
				t.Fatal("original changed")
			}
		})
	}
}

func TestBadOrCancelledInputNeverCallsUpstream(t *testing.T) {
	broken := testPNG()[:40] // Valid PNG dimensions, incomplete image data.
	if _, err := decodePicture(broken); err != nil {
		t.Fatal("fixture should pass header validation", err)
	}
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls++; w.WriteHeader(400) }))
	defer server.Close()
	p := provider{base: server.URL, key: "mock", client: server.Client()}
	_, err := p.generate(context.Background(), job{Mode: "edit", Model: "gpt-image-2", Input: testPNG(), Reference: broken})
	if err == nil || !strings.Contains(err.Error(), "参考图") {
		t.Fatal("corrupt reference accepted", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err = p.generate(ctx, job{Mode: "edit", Model: "gpt-image-2", Input: testPNG()})
	if err == nil || calls != 0 {
		t.Fatalf("invalid input sent upstream: calls=%d err=%v", calls, err)
	}
}
