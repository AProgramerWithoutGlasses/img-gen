package studio

import (
	"io/fs"
	"net/http"
	"regexp"
	"strings"
)

// Vite content hashes change with every asset change. Only existing public build
// assets may be cached indefinitely; HTML, errors and authenticated APIs may not.
var fingerprintedAsset = regexp.MustCompile(`^/assets/[A-Za-z0-9_.-]+-[A-Za-z0-9_-]{8,}\.(js|css)$`)

func staticHandler(static fs.FS) http.Handler {
	files := http.FileServerFS(static)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if fingerprintedAsset.MatchString(r.URL.Path) {
			info, err := fs.Stat(static, strings.TrimPrefix(r.URL.Path, "/"))
			if err != nil || !info.Mode().IsRegular() {
				http.NotFound(w, r)
				return
			}
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		}
		files.ServeHTTP(w, r)
	})
}
