package studio_test

import studio "github.com/AProgramerWithoutGlasses/img-gen/internal/studio"

import (
	"database/sql"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestStudioAttachmentCacheAccess(t *testing.T) {
	id := strings.Repeat("1", 32)
	data := testPNG()
	baseline := httptest.NewRecorder()
	studio.ServeCachedImage(baseline, httptest.NewRequest("GET", "/", nil), data, "image/png")
	for _, method := range []string{"GET", "HEAD"} {
		for _, access := range []string{"owner", "foreign", "no-session"} {
			t.Run(method+"/"+access, func(t *testing.T) {
				a := &studio.App{}
				r := httptest.NewRequest(method, "/api/studio/attachments/"+id, nil)
				r.Header.Set("If-None-Match", baseline.Header().Get("ETag"))
				want := 401
				if access != "no-session" {
					mock := mockSession(t, a, r, "user")
					query := mock.ExpectQuery(`SELECT mime,content FROM studio_attachments WHERE id=\? AND user_id=\?`).WithArgs(id, strings.Repeat("b", 32))
					want = 304
					if access == "foreign" {
						query.WillReturnError(sql.ErrNoRows)
						want = 404
					} else {
						query.WillReturnRows(sqlmock.NewRows([]string{"mime", "content"}).AddRow("image/png", data))
					}
				}
				w := httptest.NewRecorder()
				a.Handler(fstest.MapFS{}).ServeHTTP(w, r)
				if w.Code != want {
					t.Fatalf("got %d want %d: %s", w.Code, want, w.Body.String())
				}
				if want == 304 {
					if w.Body.Len() != 0 || w.Header().Get("Cache-Control") != "private, no-cache" || w.Header().Get("Vary") != "Cookie" {
						t.Fatal("invalid private attachment revalidation")
					}
				} else if w.Header().Get("Cache-Control") != "no-store" {
					t.Fatal("access errors must not be cached")
				}
			})
		}
	}
}
