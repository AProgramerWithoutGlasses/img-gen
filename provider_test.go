package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"testing/fstest"
	"time"
)

func testPNG() []byte {
	img := image.NewRGBA(image.Rect(0, 0, 4, 3))
	img.Set(0, 0, color.RGBA{R: 250, A: 255})
	var b bytes.Buffer
	_ = png.Encode(&b, img)
	return b.Bytes()
}

func TestProviderProtocols(t *testing.T) {
	for _, name := range []string{"gpt-generate", "gpt-edit", "gemini-generate", "gemini-edit"} {
		t.Run(name, func(t *testing.T) {
			j := job{Mode: "generate", Model: "gpt-image-2", Prompt: "竹林里的熊猫", Ratio: "16:9", Resolution: "default"}
			gemini := strings.HasPrefix(name, "gemini")
			edit := strings.HasSuffix(name, "edit")
			if gemini {
				j.Model = "gemini-3.1-flash-image"
				j.Resolution = "2K"
			}
			if edit {
				j.Mode = "edit"
				j.Input = testPNG()
				j.InputMIME = "image/png"
				j.Ratio = "auto"
				j.Resolution = "default"
			}
			if err := validateJob(&j); err != nil {
				t.Fatal(err)
			}
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Header.Get("Authorization") != "Bearer test-secret" {
					t.Error("missing auth")
				}
				if r.Method != "POST" {
					t.Error("wrong method")
				}
				w.Header().Set("X-Request-ID", "test-request-123")
				if gemini {
					if r.URL.Path != "/v1beta/models/gemini-3.1-flash-image:generateContent" {
						t.Errorf("wrong Gemini endpoint %s", r.URL.Path)
					}
					var request struct {
						Contents []struct {
							Parts []struct {
								Text       string `json:"text"`
								InlineData *struct {
									Data string `json:"data"`
									MIME string `json:"mimeType"`
								} `json:"inlineData"`
							} `json:"parts"`
						} `json:"contents"`
						Config struct {
							Modalities []string          `json:"responseModalities"`
							Image      map[string]string `json:"imageConfig"`
						} `json:"generationConfig"`
					}
					if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
						t.Fatal(err)
					}
					if len(request.Contents) != 1 || len(request.Contents[0].Parts) == 0 {
						t.Error("missing parts")
						return
					}
					if request.Contents[0].Parts[0].Text != j.Prompt {
						t.Error("wrong prompt")
					}
					if edit {
						if len(request.Contents[0].Parts) != 2 || request.Contents[0].Parts[1].InlineData == nil {
							t.Error("missing reference")
							return
						}
						input := request.Contents[0].Parts[1].InlineData
						if input.Data != base64.StdEncoding.EncodeToString(testPNG()) || input.MIME != "image/png" {
							t.Error("invalid inline reference")
						}
						if request.Config.Image != nil {
							t.Error("edit must not add untested dimensions")
						}
					} else if request.Config.Image["aspectRatio"] != "16:9" || request.Config.Image["imageSize"] != "2K" {
						t.Error("missing 2K combination")
					}
					jsonResponse(w, 200, map[string]any{"modelVersion": "gemini-3.1-flash-image", "candidates": []any{map[string]any{"content": map[string]any{"parts": []any{map[string]any{"text": "说明"}, map[string]any{"thought": true, "inlineData": map[string]string{"data": "ignore-this-thought-image"}}, map[string]any{"inlineData": map[string]string{"data": base64.StdEncoding.EncodeToString(testPNG())}}}}}}})
				} else {
					if edit {
						if r.URL.Path != "/v1/images/edits" {
							t.Error("wrong edit endpoint")
						}
						if err := r.ParseMultipartForm(1 << 20); err != nil {
							t.Error(err)
							return
						}
						defer r.MultipartForm.RemoveAll()
						f, _, err := r.FormFile("image")
						if err != nil {
							t.Error(err)
							return
						}
						defer f.Close()
						data, _ := io.ReadAll(f)
						if !bytes.Equal(data, j.Input) {
							t.Error("reference differs")
						}
						if r.FormValue("prompt") != j.Prompt || r.FormValue("model") != j.Model {
							t.Error("wrong edit fields")
						}
						if r.FormValue("size") != "" || r.FormValue("mask") != "" {
							t.Error("unsupported fields sent")
						}
					} else {
						if r.URL.Path != "/v1/images/generations" {
							t.Error("wrong generate endpoint")
						}
						var body map[string]any
						if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
							t.Error(err)
							return
						}
						if len(body) != 2 || body["model"] != j.Model || body["prompt"] != j.EffectivePrompt {
							t.Errorf("wrong GPT request: %v", body)
						}
						if !strings.Contains(j.EffectivePrompt, "16:9") {
							t.Error("ratio not in prompt")
						}
					}
					jsonResponse(w, 200, map[string]any{"model": j.Model, "quality": "low", "data": []any{map[string]string{"b64_json": base64.StdEncoding.EncodeToString(testPNG())}}})
				}
			}))
			defer server.Close()
			p := provider{base: server.URL, key: "test-secret", client: server.Client()}
			result, err := p.generate(context.Background(), j)
			if err != nil {
				t.Fatal(err)
			}
			if len(result.Images) != 1 || result.Images[0].Width != 4 || result.Images[0].Height != 3 || result.RequestID != "test-request-123" {
				t.Fatalf("invalid result: %+v", result)
			}
		})
	}
}

func TestGeminiResolutionPresets(t *testing.T) {
	for _, model := range []string{"gemini-3.1-flash-image", "gemini-3-pro-image"} {
		for _, resolution := range []string{"default", "1K", "2K", "4K"} {
			t.Run(model+"/"+resolution, func(t *testing.T) {
				j := job{Mode: "generate", Model: model, Prompt: "相机细节", Ratio: "16:9", Resolution: resolution}
				if resolution == "default" {
					j.Ratio = "auto"
				}
				err := validateJob(&j)
				if model == "gemini-3-pro-image" && (resolution == "1K" || resolution == "4K") {
					if err == nil {
						t.Fatal("accepted unverified Pro resolution")
					}
					return
				}
				if err != nil {
					t.Fatal(err)
				}
				var calls atomic.Int32
				s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					calls.Add(1)
					var request struct {
						Config struct {
							Image map[string]string `json:"imageConfig"`
						} `json:"generationConfig"`
					}
					if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
						t.Error(err)
						return
					}
					if resolution == "default" {
						if request.Config.Image != nil {
							t.Error("default must omit imageConfig")
						}
					} else if request.Config.Image["imageSize"] != resolution || request.Config.Image["aspectRatio"] != "16:9" {
						t.Errorf("incorrect imageConfig: %v", request.Config.Image)
					}
					jsonResponse(w, 200, map[string]any{"candidates": []any{map[string]any{"content": map[string]any{"parts": []any{map[string]any{"inlineData": map[string]string{"data": base64.StdEncoding.EncodeToString(testPNG())}}}}}}})
				}))
				defer s.Close()
				p := provider{base: s.URL, key: "test", client: s.Client()}
				result, err := p.generate(context.Background(), j)
				if err != nil || len(result.Images) != 1 || calls.Load() != 1 {
					t.Fatalf("expected one image from one call: %v, calls=%d", err, calls.Load())
				}
			})
		}
	}
}

func TestResolutionBoundaries(t *testing.T) {
	for model := range models {
		for _, resolution := range []string{"default", "1K", "2K", "4K", "8K"} {
			for ratio := range ratioPrompts {
				for _, mode := range []string{"generate", "edit"} {
					j := job{Model: model, Mode: mode, Prompt: "x", Ratio: ratio, Resolution: resolution, Input: testPNG()}
					want := resolution == "default"
					if strings.HasPrefix(model, "gemini-") {
						want = ratio == "auto" && resolution == "default" || ratio == "16:9" && (resolution == "2K" || model == "gemini-3.1-flash-image" && (resolution == "1K" || resolution == "4K"))
					}
					if mode == "edit" {
						want = (model == "gpt-image-2" || model == "gemini-3.1-flash-image") && ratio == "auto" && resolution == "default"
					}
					if got := validateJob(&j) == nil; got != want {
						t.Errorf("%s/%s/%s/%s: allowed=%v, want %v", model, mode, ratio, resolution, got, want)
					}
				}
			}
		}
	}
}

func TestRejectUnsupportedCombinations(t *testing.T) {
	for _, j := range []job{
		{Model: "fake", Mode: "generate", Prompt: "x", Ratio: "auto", Resolution: "default"},
		{Model: "gpt-image-2", Mode: "generate", Prompt: "x", Ratio: "auto", Resolution: "2K"},
		{Model: "gemini-3.1-flash-image", Mode: "generate", Prompt: "x", Ratio: "9:16", Resolution: "2K"},
		{Model: "gemini-3-pro-image", Mode: "edit", Prompt: "x", Ratio: "auto", Resolution: "default", Input: testPNG()},
		{Model: "gpt-image-2", Mode: "edit", Prompt: "x", Ratio: "auto", Resolution: "default"},
		{Model: "gpt-image-2", Mode: "generate", Prompt: "  ", Ratio: "auto", Resolution: "default"},
	} {
		if err := validateJob(&j); err == nil {
			t.Errorf("accepted unsupported job %+v", j)
		}
	}
}

func TestProviderFailuresAndNoRetry(t *testing.T) {
	for _, tc := range []struct {
		name   string
		status int
		body   string
	}{
		{"upstream", 503, `{"error":{"message":"secret-api-key"}}`},
		{"no-images", 200, `{"candidates":[{"content":{"parts":[{"text":"blocked"}]}}]}`},
		{"bad-base64", 200, `{"data":[{"b64_json":"!@#$"}]}`},
		{"bad-image", 200, `{"data":[{"b64_json":"aGVsbG8="}]}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var calls atomic.Int32
			s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				w.WriteHeader(tc.status)
				_, _ = w.Write([]byte(tc.body))
			}))
			defer s.Close()
			p := provider{base: s.URL, key: "secret-api-key", client: s.Client()}
			_, err := p.generate(context.Background(), job{Model: "gpt-image-2"})
			if err == nil {
				t.Fatal("expected error")
			}
			if strings.Contains(err.Error(), "secret-api-key") {
				t.Fatal("leaked secret")
			}
			if calls.Load() != 1 {
				t.Fatalf("retried %d times", calls.Load())
			}
		})
	}
}

func TestAuthenticationAndCSRF(t *testing.T) {
	a := app{upstream: &provider{key: "server-secret"}}
	h := a.routes(fstest.MapFS{"index.html": {Data: []byte("test")}})
	for _, tc := range []struct {
		method, path, origin, password string
		want                           int
	}{
		{"GET", "/api/config", "", "", 401},
		{"GET", "/api/config", "", "wrong", 401},
		{"GET", "/api/config", "", "private-password", 200},
		{"POST", "/api/jobs", "https://evil.test", "private-password", 403},
	} {
		r := httptest.NewRequest(tc.method, "http://localhost"+tc.path, nil)
		if tc.password != "" {
			if tc.password == "private-password" && tc.origin == "" {
				mockSession(t, &a, r, "admin")
			} else {
				r.SetBasicAuth("admin", tc.password)
			}
		}
		if tc.origin != "" {
			r.Header.Set("Origin", tc.origin)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != tc.want {
			t.Errorf("%s: got %d want %d", tc.path, w.Code, tc.want)
		}
		if strings.Contains(w.Body.String(), "server-secret") {
			t.Fatal("config leaks key")
		}
	}
}

func TestProviderCancellation(t *testing.T) {
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-r.Context().Done():
		case <-time.After(time.Second):
		}
	}))
	defer s.Close()
	p := provider{base: s.URL, client: s.Client()}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := p.generate(ctx, job{Model: "gpt-image-2"}); err == nil {
		t.Fatal("cancellation ignored")
	}
}
