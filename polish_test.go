package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"testing/fstest"
	"time"
)

func polishFixture(text string) string {
	encoded, _ := json.Marshal(text)
	return `{"status":"completed","error":null,"output":[{"type":"reasoning","content":[{"type":"output_text","text":"ignore reasoning"}]},{"type":"message","role":"assistant","status":"completed","content":[{"type":"output_text","text":` + string(encoded) + `}]}]}`
}

func TestPolishRouteAndProtocol(t *testing.T) {
	for _, mode := range []string{"generate", "edit"} {
		t.Run(mode, func(t *testing.T) {
			var calls atomic.Int32
			s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				if r.Method != "POST" || r.URL.Path != "/v1/responses" || r.Header.Get("Authorization") != "Bearer test-secret" || r.Header.Get("Content-Type") != "application/json" {
					t.Error("incorrect upstream request")
				}
				var body map[string]any
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Error(err)
				}
				if body["model"] != "gpt-6-luna" || body["input"] != "熊猫喝茶" || body["store"] != false || body["stream"] != false {
					t.Errorf("unexpected request: %+v", body)
				}
				instructions, _ := body["instructions"].(string)
				if (mode == "edit") != strings.Contains(instructions, "你没有看到参考图") {
					t.Error("mode-specific instructions missing")
				}
				_, _ = w.Write([]byte(polishFixture("  竹林里，熊猫在柔和光线下喝茶。  ")))
			}))
			defer s.Close()
			a := app{upstream: &provider{base: s.URL, key: "test-secret", client: s.Client()}}
			r := httptest.NewRequest("POST", "http://studio/api/prompt/polish", strings.NewReader(`{"prompt":" 熊猫喝茶 ","mode":"`+mode+`"}`))
			mockSession(t, &a, r, "user")
			r.Header.Set("Origin", "http://studio")
			w := httptest.NewRecorder()
			a.routes(fstest.MapFS{}).ServeHTTP(w, r)
			var result map[string]string
			_ = json.Unmarshal(w.Body.Bytes(), &result)
			if w.Code != 200 || result["prompt"] != "竹林里，熊猫在柔和光线下喝茶。" || result["model"] != polishModel || calls.Load() != 1 {
				t.Fatalf("got %d %s; calls=%d", w.Code, w.Body, calls.Load())
			}
		})
	}
}

func TestPolishValidationAndProtection(t *testing.T) {
	var calls atomic.Int32
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls.Add(1) }))
	defer s.Close()
	valid := `{"prompt":"熊猫","mode":"generate"}`
	for _, tc := range []struct {
		name, body, key, password, origin string
		locked                            bool
		status                            int
	}{
		{"empty", `{"prompt":" ","mode":"generate"}`, "key", "private", "", false, 400},
		{"long", `{"prompt":"` + strings.Repeat("猫", 6001) + `","mode":"generate"}`, "key", "private", "", false, 400},
		{"large", strings.Repeat(" ", 65537) + valid, "key", "private", "", false, 400},
		{"bad-json", `{`, "key", "private", "", false, 400},
		{"trailing", valid + `{}`, "key", "private", "", false, 400},
		{"bad-mode", `{"prompt":"猫","mode":"unknown"}`, "key", "private", "", false, 400},
		{"override-model", `{"prompt":"猫","mode":"generate","model":"other"}`, "key", "private", "", false, 400},
		{"unconfigured", valid, "", "private", "", false, 503},
		{"unauthenticated", valid, "key", "", "", false, 401},
		{"cross-origin", valid, "key", "private", "https://evil.test", false, 403},
		{"concurrent", valid, "key", "private", "", true, 409},
	} {
		t.Run(tc.name, func(t *testing.T) {
			a := app{upstream: &provider{base: s.URL, key: tc.key, client: s.Client()}}
			if tc.locked {
				a.polish.Lock()
				defer a.polish.Unlock()
			}
			r := httptest.NewRequest("POST", "http://studio/api/prompt/polish", strings.NewReader(tc.body))
			if tc.password != "" && tc.origin != "https://evil.test" {
				mockSession(t, &a, r, "user")
			}
			r.Header.Set("Origin", tc.origin)
			w := httptest.NewRecorder()
			a.routes(fstest.MapFS{}).ServeHTTP(w, r)
			if w.Code != tc.status {
				t.Fatalf("got %d: %s", w.Code, w.Body)
			}
		})
	}
	if calls.Load() != 0 {
		t.Fatal("invalid requests reached upstream")
	}
}

func TestPolishFailuresDoNotRetry(t *testing.T) {
	for _, tc := range []struct {
		name string
		code int
		body string
	}{
		{"http-error", 429, `{"error":"test-secret"}`},
		{"invalid-json", 200, "test-secret"},
		{"empty", 200, polishFixture(" ")},
		{"too-long", 200, polishFixture(strings.Repeat("猫", 6001))},
		{"too-large", 200, strings.Repeat("x", (1<<20)+1)},
		{"incomplete", 200, strings.Replace(polishFixture("partial"), `"completed"`, `"incomplete"`, 1)},
		{"incomplete-message", 200, strings.ReplaceAll(polishFixture("partial"), `"status":"completed","content"`, `"status":"incomplete","content"`)},
		{"refusal", 200, strings.ReplaceAll(polishFixture("test-secret"), `"type":"output_text"`, `"type":"refusal"`)},
		{"response-error", 200, strings.Replace(polishFixture("partial"), `"error":null`, `"error":{"message":"test-secret"}`, 1)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var calls atomic.Int32
			s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				w.WriteHeader(tc.code)
				_, _ = w.Write([]byte(tc.body))
			}))
			defer s.Close()
			p := provider{base: s.URL, key: "test-secret", client: s.Client()}
			result, err := p.polish(context.Background(), "猫", "generate")
			if err == nil || result != "" || strings.Contains(err.Error(), "test-secret") || calls.Load() != 1 {
				t.Fatalf("result=%q err=%v calls=%d", result, err, calls.Load())
			}
		})
	}
}

func TestPolishCancellation(t *testing.T) {
	var calls atomic.Int32
	started := make(chan struct{})
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		close(started)
		select {
		case <-r.Context().Done():
		case <-time.After(2 * time.Second):
		}
	}))
	defer s.Close()
	p := provider{base: s.URL, key: "key", client: s.Client()}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() { _, err := p.polish(ctx, "猫", "generate"); done <- err }()
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("request did not start")
	}
	cancel()
	select {
	case err := <-done:
		if err == nil || calls.Load() != 1 {
			t.Fatalf("cancellation ignored: %v, calls=%d", err, calls.Load())
		}
	case <-time.After(time.Second):
		t.Fatal("cancellation did not stop the request")
	}
}
