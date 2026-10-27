package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"image"
	"image/color"
	"image/png"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"testing/fstest"
)

func referencePNG() []byte {
	im := image.NewRGBA(image.Rect(0, 0, 5, 4))
	im.Set(1, 1, color.RGBA{B: 255, A: 255})
	var b bytes.Buffer
	_ = png.Encode(&b, im)
	return b.Bytes()
}

func TestTwoImageEditProtocol(t *testing.T) {
	j := job{Mode: "edit", Model: "gpt-image-2", Prompt: "把中间的小猫换成参考图里的小猫", Ratio: "auto", Resolution: "default", Input: testPNG(), InputMIME: "image/png", Reference: referencePNG(), ReferenceMIME: "image/png"}
	if err := validateJob(&j); err != nil {
		t.Fatal(err)
	}
	if j.EffectivePrompt == j.Prompt || !strings.Contains(j.EffectivePrompt, "第一张图片是基础图") || !strings.Contains(j.EffectivePrompt, "第二张图片是参考图") || !strings.HasSuffix(j.EffectivePrompt, j.Prompt) {
		t.Fatal("missing explicit image roles or original instruction")
	}
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.URL.Path != "/v1/images/edits" {
			t.Error("wrong edit endpoint")
		}
		if err := r.ParseMultipartForm(1 << 20); err != nil {
			t.Error(err)
			return
		}
		defer r.MultipartForm.RemoveAll()
		files := r.MultipartForm.File["image[]"]
		if len(files) != 2 || len(r.MultipartForm.File) != 1 {
			t.Error("must send exactly two ordered image[] files")
			return
		}
		for i, want := range [][]byte{j.Input, j.Reference} {
			if files[i].Header.Get("Content-Type") != "image/png" {
				t.Error("image MIME must match the verified multipart protocol")
			}
			f, err := files[i].Open()
			if err != nil {
				t.Error(err)
				return
			}
			data, _ := io.ReadAll(f)
			f.Close()
			if !bytes.Equal(data, want) {
				t.Errorf("image %d lost bytes or role order", i)
			}
		}
		if r.FormValue("prompt") != j.EffectivePrompt || r.FormValue("model") != j.Model || len(r.MultipartForm.Value) != 2 {
			t.Error("wrong prompt or unverified fields")
		}
		jsonResponse(w, 200, map[string]any{"data": []any{map[string]string{"b64_json": base64.StdEncoding.EncodeToString(testPNG())}}})
	}))
	defer server.Close()
	p := provider{base: server.URL, key: "mock", client: server.Client()}
	if _, err := p.generate(context.Background(), j); err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 1 {
		t.Fatalf("expected one billed call, got %d", calls.Load())
	}
	jobs, err := expandBatch(j, []modelSelection{{Model: j.Model, Count: 2}})
	if err != nil || len(jobs) != 2 || !bytes.Equal(jobs[1].Reference, j.Reference) {
		t.Fatal("batch lost second image", err)
	}
	j.Model = "gemini-3.1-flash-image"
	if validateJob(&j) == nil {
		t.Fatal("unverified dual-image Flash accepted")
	}
	j.Model = "gpt-image-2"
	j.Mode = "generate"
	if validateJob(&j) == nil {
		t.Fatal("generation silently discards reference")
	}
}

func TestReferenceUploadValidation(t *testing.T) {
	for _, tc := range []struct {
		name      string
		base, ref []byte
		duplicate bool
	}{
		{"missing base", nil, referencePNG(), false},
		{"invalid reference", testPNG(), []byte("not an image"), false},
		{"oversize reference", testPNG(), make([]byte, (12<<20)+1), false},
		{"duplicate reference", testPNG(), referencePNG(), true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var body bytes.Buffer
			mw := multipart.NewWriter(&body)
			for k, v := range map[string]string{"mode": "edit", "model": "gpt-image-2", "prompt": "replace cat", "ratio": "auto", "resolution": "default", "count": "1"} {
				_ = mw.WriteField(k, v)
			}
			if tc.base != nil {
				p, _ := mw.CreateFormFile("image", "base.png")
				_, _ = p.Write(tc.base)
			}
			for i := 0; i < 1+boolInt(tc.duplicate); i++ {
				p, _ := mw.CreateFormFile("reference", "ref.png")
				_, _ = p.Write(tc.ref)
			}
			_ = mw.Close()
			a := &app{upstream: &provider{key: "mock"}}
			r := httptest.NewRequest("POST", "/api/jobs", &body)
			r.Header.Set("Content-Type", mw.FormDataContentType())
			mockSession(t, a, r, "user")
			w := httptest.NewRecorder()
			a.routes(fstest.MapFS{}).ServeHTTP(w, r)
			if w.Code != 400 {
				t.Fatalf("want 400 before DB work, got %d %s", w.Code, w.Body)
			}
		})
	}
}

func boolInt(b bool) int {
	if b {
		return 1
	}
	return 0
}
