package studio_test

import studio "github.com/AProgramerWithoutGlasses/img-gen/internal/studio"

import (
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
)

func TestStaticCacheIsolation(t *testing.T) {
	static := fstest.MapFS{
		"index.html":                {Data: []byte("<html>studio</html>")},
		"assets/index-1234abcd.js":  {Data: []byte("export default 1")},
		"assets/index-1234abcd.css": {Data: []byte("body{}")},
		"assets/unhashed.js":        {Data: []byte("export default 2")},
	}
	for _, method := range []string{"GET", "HEAD"} {
		for _, path := range []string{"/", "/assets/index-1234abcd.js", "/assets/index-1234abcd.css", "/assets/unhashed.js", "/assets/missing-1234abcd.js", "/api/studio/state", "/api/images/" + strings.Repeat("1", 32) + "/thumbnail/1"} {
			t.Run(method+path, func(t *testing.T) {
				w := httptest.NewRecorder()
				(&studio.App{}).Handler(static).ServeHTTP(w, httptest.NewRequest(method, path, nil))
				want := "no-store"
				if path == "/assets/index-1234abcd.js" || path == "/assets/index-1234abcd.css" {
					want = "public, max-age=31536000, immutable"
				}
				if got := w.Header().Get("Cache-Control"); got != want {
					t.Fatalf("cache policy: got %q want %q", got, want)
				}
				if w.Header().Get("Content-Security-Policy") == "" || w.Header().Get("X-Content-Type-Options") != "nosniff" {
					t.Fatal("security headers lost")
				}
			})
		}
	}
}
