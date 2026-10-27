package main

import (
	"bytes"
	"database/sql"
	"mime/multipart"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestSavedBaseImageAccess(t *testing.T) {
	for _, tc := range []struct {
		name, id      string
		upload, found bool
		want          int
	}{
		{"owned image", strings.Repeat("1", 32), false, true, 429},
		{"foreign or missing image", strings.Repeat("1", 32), false, false, 404},
		{"invalid identifier", "../other", false, false, 400},
		{"ambiguous base", strings.Repeat("1", 32), true, false, 400},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var body bytes.Buffer
			mw := multipart.NewWriter(&body)
			for k, v := range map[string]string{"mode": "edit", "model": "gpt-image-2", "prompt": "换成参考图里的猫", "ratio": "auto", "resolution": "default", "count": "1", "base_image_id": tc.id} {
				_ = mw.WriteField(k, v)
			}
			ref, _ := mw.CreateFormFile("reference", "ref.png")
			_, _ = ref.Write(referencePNG())
			if tc.upload {
				f, _ := mw.CreateFormFile("image", "base.png")
				_, _ = f.Write(testPNG())
			}
			_ = mw.Close()
			a := &app{upstream: &provider{key: "mock"}}
			r := httptest.NewRequest("POST", "/api/jobs", &body)
			r.Header.Set("Content-Type", mw.FormDataContentType())
			mock := mockSession(t, a, r, "user")
			if validID(tc.id) && !tc.upload {
				query := mock.ExpectQuery(`SELECT images.mime,images.content FROM images JOIN jobs ON jobs.id=images.job_id WHERE images.id=\? AND jobs.user_id=\?`).WithArgs(tc.id, strings.Repeat("b", 32))
				if tc.found {
					query.WillReturnRows(sqlmock.NewRows([]string{"mime", "content"}).AddRow("image/png", testPNG()))
					mock.ExpectQuery("SELECT COUNT.*FROM jobs WHERE status").WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(maxBatchImages))
				} else {
					query.WillReturnError(sql.ErrNoRows)
				}
			}
			w := httptest.NewRecorder()
			a.routes(fstest.MapFS{}).ServeHTTP(w, r)
			if w.Code != tc.want {
				t.Fatalf("got %d %s; want %d", w.Code, w.Body, tc.want)
			}
		})
	}
}
