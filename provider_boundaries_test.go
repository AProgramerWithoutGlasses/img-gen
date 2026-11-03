package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"math/rand"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestTransparentInputByteBudget(t *testing.T) {
	// An indexed upload fits 12 MiB, but a Lanczos resize expands it to RGBA
	// and can exceed even the 24 MiB result limit of the previous code.
	palette := make(color.Palette, 256)
	for i := range palette {
		palette[i] = color.NRGBA{uint8(i), uint8(i * 71), uint8(i * 131), uint8(80 + i%176)}
	}
	im := image.NewPaletted(image.Rect(0, 0, 4500, 2500), palette)
	rng := rand.New(rand.NewSource(42))
	_, _ = rng.Read(im.Pix)
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, im); err != nil {
		t.Fatal(err)
	}
	input := encoded.Bytes()
	if len(input) > 12<<20 {
		t.Fatal("fixture not on encoded-size boundary", len(input))
	}
	original := bytes.Clone(input)
	result, err := prepareUpstreamInput(context.Background(), input)
	if err != nil {
		t.Fatal(err)
	}
	if result.Bytes > upstreamInputMaxBytes || result.MIME != "image/png" || result.Width >= 4096 || result.Width < 1 || result.Height < 1 {
		t.Fatalf("wrong bounded result: %dx%d %s %d bytes", result.Width, result.Height, result.MIME, result.Bytes)
	}
	decoded, err := png.Decode(bytes.NewReader(result.Content))
	if err != nil {
		t.Fatal(err)
	}
	_, _, _, a := decoded.At(result.Width/2, result.Height/2).RGBA()
	if a == 65535 {
		t.Fatal("transparent PNG was flattened")
	}
	if !bytes.Equal(input, original) {
		t.Fatal("original modified")
	}
	inline := map[string]any{"contents": []any{map[string]any{"parts": []any{
		map[string]any{"inlineData": map[string]string{"mimeType": result.MIME, "data": base64.StdEncoding.EncodeToString(result.Content)}},
		map[string]any{"inlineData": map[string]string{"mimeType": result.MIME, "data": base64.StdEncoding.EncodeToString(result.Content)}},
		map[string]string{"text": strings.Repeat("图", 6000)},
	}}}}
	body, _ := json.Marshal(inline)
	if len(body) > 33<<20 {
		t.Fatal("two images exceed conservative JSON budget", len(body))
	}
}

func TestProviderResponseBoundaries(t *testing.T) {
	truncated := base64.StdEncoding.EncodeToString(testPNG()[:40])
	good := base64.StdEncoding.EncodeToString(testPNG())
	for _, tc := range []struct {
		name, model, body, want string
		status                  int
	}{
		{"truncated-gpt", "gpt-image-2", `{"data":[{"b64_json":"` + truncated + `"}]}`, "损坏", 200},
		{"truncated-gemini", "gemini-3-pro-image", `{"candidates":[{"content":{"parts":[{"inlineData":{"data":"` + truncated + `"}}]}}]}`, "损坏", 200},
		{"prompt-block", "gemini-3.1-flash-image", `{"promptFeedback":{"blockReason":"SAFETY","blockReasonMessage":"secret-do-not-expose"}}`, "内容检查", 200},
		{"empty-part", "gemini-3.1-flash-image", `{"candidates":[{"content":{"parts":[{"inlineData":{}},{"inlineData":{},"inline_data":{"data":"` + good + `"}}]}}]}`, "", 200},
		{"invalid-input", "gpt-image-1.5", `{"error":{"message":"Invalid input image file. secret-do-not-expose"}}`, "输入图片", 400},
		{"body-limit", "gemini-3-pro-image", `secret-do-not-expose`, "HTTP 413", 413},
		{"billing-status", "gpt-image-2.5-sunburst", `{"error":{"message":"Invalid input image file. secret-do-not-expose"}}`, "HTTP 403", 403},
	} {
		t.Run(tc.name, func(t *testing.T) {
			calls := 0
			s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				w.WriteHeader(tc.status)
				_, _ = w.Write([]byte(tc.body))
			}))
			defer s.Close()
			p := provider{base: s.URL, key: "mock", client: s.Client()}
			result, err := p.generate(context.Background(), job{Model: tc.model})
			if calls != 1 {
				t.Fatal("request retried", calls)
			}
			if tc.want == "" {
				if err != nil || len(result.Images) != 1 {
					t.Fatal("empty inline part hid valid image", err)
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatal("incorrect diagnosis", err)
			}
			if strings.Contains(err.Error(), "secret-do-not-expose") {
				t.Fatal("raw response leaked")
			}
		})
	}
}
