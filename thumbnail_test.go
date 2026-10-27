package main

import (
	"bytes"
	"database/sql"
	"image"
	"image/color"
	"image/png"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gen2brain/webp"
)

func TestThumbnailResizeAndAlpha(t *testing.T) {
	for _, size := range []image.Point{{1600, 800}, {800, 1600}, {32, 16}} {
		source := image.NewNRGBA(image.Rect(0, 0, size.X, size.Y))
		for y := 0; y < size.Y; y++ {
			for x := size.X / 2; x < size.X; x++ {
				source.SetNRGBA(x, y, color.NRGBA{R: 220, G: 80, B: 40, A: 255})
			}
		}
		var encoded bytes.Buffer
		if err := png.Encode(&encoded, source); err != nil {
			t.Fatal(err)
		}
		data, err := makeThumbnail(encoded.Bytes())
		if err != nil {
			t.Fatal(err)
		}
		thumb, err := webp.Decode(bytes.NewReader(data))
		if err != nil {
			t.Fatal(err)
		}
		b := thumb.Bounds()
		if b.Dx() > 640 || b.Dy() > 640 || b.Dx() > size.X || b.Dy() > size.Y || b.Dx()*size.Y != b.Dy()*size.X {
			t.Fatalf("unexpected bounds: %v from %v", b, size)
		}
		_, _, _, alpha := thumb.At(0, b.Dy()/2).RGBA()
		if alpha != 0 {
			t.Fatal("transparent background lost")
		}
		_, _, _, alpha = thumb.At(b.Max.X-1, b.Dy()/2).RGBA()
		if alpha != 65535 {
			t.Fatal("opaque content lost")
		}
	}
	if _, err := makeThumbnail([]byte("invalid image")); err == nil {
		t.Fatal("invalid image accepted")
	}
}

func TestThumbnailSampleCompression(t *testing.T) {
	original, err := os.ReadFile("web/sample.jpg")
	if err != nil {
		t.Fatal(err)
	}
	data, err := makeThumbnail(original)
	if err != nil {
		t.Fatal(err)
	}
	if len(data) >= len(original) {
		t.Fatalf("thumbnail is larger: %d >= %d", len(data), len(original))
	}
	t.Logf("sample JPEG %d bytes -> WebP %d bytes (%.1f%% smaller)", len(original), len(data), 100*(1-float64(len(data))/float64(len(original))))
}

func TestPreviewResolutionAndAlpha(t *testing.T) {
	for _, size := range []image.Point{{2400, 1200}, {1200, 2400}, {1054, 1492}, {32, 16}} {
		source := image.NewNRGBA(image.Rect(0, 0, size.X, size.Y))
		for y := 0; y < size.Y; y++ {
			for x := size.X / 2; x < size.X; x++ {
				source.SetNRGBA(x, y, color.NRGBA{R: 220, G: 80, B: 40, A: 255})
			}
		}
		var encoded bytes.Buffer
		if err := png.Encode(&encoded, source); err != nil {
			t.Fatal(err)
		}
		data, err := makePreview(encoded.Bytes())
		if err != nil {
			t.Fatal(err)
		}
		preview, err := webp.Decode(bytes.NewReader(data))
		if err != nil {
			t.Fatal(err)
		}
		want := size
		if size.X > 1600 {
			want = image.Pt(1600, 800)
		}
		if size.Y > 1600 {
			want = image.Pt(800, 1600)
		}
		if preview.Bounds().Size() != want {
			t.Fatalf("preview %v: got %v want %v", size, preview.Bounds().Size(), want)
		}
		_, _, _, transparent := preview.At(0, want.Y/2).RGBA()
		_, _, _, opaque := preview.At(want.X-1, want.Y/2).RGBA()
		if transparent != 0 || opaque != 65535 {
			t.Fatal("preview alpha was not preserved")
		}
	}
	if _, err := makePreview([]byte("invalid")); err == nil {
		t.Fatal("invalid image accepted")
	}
}

func TestCachedImageHTTP(t *testing.T) {
	data := []byte("image bytes")
	r := httptest.NewRequest("GET", "/image", nil)
	w := httptest.NewRecorder()
	serveCachedImage(w, r, data, "image/webp")
	if w.Code != 200 || !bytes.Equal(w.Body.Bytes(), data) || w.Header().Get("Cache-Control") != "private, no-cache" || w.Header().Get("Vary") != "Cookie" {
		t.Fatal("invalid cached response", w)
	}
	for _, method := range []string{"GET", "HEAD"} {
		r = httptest.NewRequest(method, "/image", nil)
		r.Header.Set("If-None-Match", w.Header().Get("ETag"))
		cached := httptest.NewRecorder()
		serveCachedImage(cached, r, data, "image/webp")
		if cached.Code != 304 || cached.Body.Len() != 0 {
			t.Fatal("conditional request did not return 304")
		}
	}
	r = httptest.NewRequest("HEAD", "/image", nil)
	w = httptest.NewRecorder()
	serveCachedImage(w, r, data, "image/webp")
	if w.Code != 200 || w.Body.Len() != 0 || w.Header().Get("Content-Length") != "11" {
		t.Fatal("invalid HEAD response")
	}
}

func TestThumbnailAccessAndPersistence(t *testing.T) {
	id := strings.Repeat("1", 32)
	for _, variant := range []struct{ path, version string }{{"thumbnail", thumbnailVersion}, {"preview", previewCacheVersion}} {
		for _, scenario := range []string{"cached", "legacy", "denied", "db-error", "bad-version"} {
			t.Run(variant.path+"/"+scenario, func(t *testing.T) {
				a := &app{upstream: &provider{}}
				path := "/api/images/" + id + "/" + variant.path + "/1"
				if scenario == "bad-version" {
					path = "/api/images/" + id + "/" + variant.path + "/999"
				}
				r := httptest.NewRequest("GET", path, nil)
				mock := mockSession(t, a, r, "user")
				query := `SELECT t.content FROM images JOIN jobs ON jobs.id=images.job_id\s+LEFT JOIN image_thumbnails t ON t.image_id=images.id AND t.version=\? WHERE images.id=\? AND jobs.user_id=\?`
				userID := strings.Repeat("b", 32)
				want := http.StatusOK
				switch scenario {
				case "cached":
					mock.ExpectQuery(query).WithArgs(variant.version, id, userID).WillReturnRows(sqlmock.NewRows([]string{"content"}).AddRow([]byte("cached-webp")))
				case "legacy":
					for i := 0; i < 2; i++ {
						mock.ExpectQuery(query).WithArgs(variant.version, id, userID).WillReturnRows(sqlmock.NewRows([]string{"content"}).AddRow(nil))
					}
					mock.ExpectQuery(`SELECT images.content FROM images JOIN jobs ON jobs.id=images.job_id WHERE images.id=\? AND jobs.user_id=\?`).WithArgs(id, userID).WillReturnRows(sqlmock.NewRows([]string{"content"}).AddRow(testPNG()))
					mock.ExpectExec(`INSERT INTO image_thumbnails`).WithArgs(id, variant.version, sqlmock.AnyArg()).WillReturnResult(sqlmock.NewResult(0, 1))
				case "denied":
					mock.ExpectQuery(query).WithArgs(variant.version, id, userID).WillReturnRows(sqlmock.NewRows([]string{"content"}))
					want = 404
				case "db-error":
					mock.ExpectQuery(query).WithArgs(variant.version, id, userID).WillReturnError(sql.ErrConnDone)
					want = 500
				case "bad-version":
					want = 404
				}
				w := httptest.NewRecorder()
				a.routes(fstest.MapFS{}).ServeHTTP(w, r)
				if w.Code != want {
					t.Fatalf("status %d: %s", w.Code, w.Body.String())
				}
				if want == 200 && w.Header().Get("Content-Type") != "image/webp" {
					t.Fatal("wrong thumbnail type")
				}
				if scenario == "legacy" {
					if _, err := webp.Decode(bytes.NewReader(w.Body.Bytes())); err != nil {
						t.Fatal(err)
					}
				}
			})
		}
	}
	// No session must be rejected before any database/image read.
	w := httptest.NewRecorder()
	(&app{}).routes(fstest.MapFS{}).ServeHTTP(w, httptest.NewRequest("GET", "/api/images/"+id+"/thumbnail/1", nil))
	if w.Code != 401 {
		t.Fatalf("unauthenticated thumbnail: %d", w.Code)
	}
}

func TestImageConditionalRequestsRespectAccess(t *testing.T) {
	id := strings.Repeat("1", 32)
	for _, suffix := range []string{"", "/thumbnail/1", "/preview/1"} {
		for _, method := range []string{"GET", "HEAD"} {
			for _, access := range []string{"owner", "foreign", "revoked"} {
				t.Run(method+suffix+"/"+access, func(t *testing.T) {
					r := httptest.NewRequest(method, "/api/images/"+id+suffix, nil)
					data := testPNG()
					etagResponse := httptest.NewRecorder()
					serveCachedImage(etagResponse, httptest.NewRequest("GET", "/", nil), data, "image/png")
					r.Header.Set("If-None-Match", etagResponse.Header().Get("ETag"))
					a := &app{}
					want := 304
					if access == "revoked" {
						db, mock, err := sqlmock.New()
						if err != nil {
							t.Fatal(err)
						}
						defer db.Close()
						a.db = db
						r.AddCookie(&http.Cookie{Name: sessionCookie, Value: strings.Repeat("a", 64)})
						mock.ExpectQuery(`SELECT .*s.expires_at>UTC_TIMESTAMP.*u.active=TRUE AND s.user_version=u.session_version`).WillReturnError(sql.ErrNoRows)
						t.Cleanup(func() {
							if err := mock.ExpectationsWereMet(); err != nil {
								t.Error(err)
							}
						})
						want = 401
					} else {
						mock := mockSession(t, a, r, "user")
						var query *sqlmock.ExpectedQuery
						var rows *sqlmock.Rows
						if suffix == "" {
							query = mock.ExpectQuery(`SELECT images.mime,images.content FROM images JOIN jobs ON jobs.id=images.job_id WHERE images.id=\? AND jobs.user_id=\?`).WithArgs(id, strings.Repeat("b", 32))
							rows = sqlmock.NewRows([]string{"mime", "content"}).AddRow("image/png", data)
						} else {
							version := thumbnailVersion
							if suffix == "/preview/1" {
								version = previewCacheVersion
							}
							query = mock.ExpectQuery(`SELECT t.content .* WHERE images.id=\? AND jobs.user_id=\?`).WithArgs(version, id, strings.Repeat("b", 32))
							rows = sqlmock.NewRows([]string{"content"}).AddRow(data)
						}
						if access == "foreign" {
							query.WillReturnError(sql.ErrNoRows)
							want = 404
						} else {
							query.WillReturnRows(rows)
						}
					}
					w := httptest.NewRecorder()
					a.routes(fstest.MapFS{}).ServeHTTP(w, r)
					if w.Code != want {
						t.Fatalf("got %d want %d: %s", w.Code, want, w.Body.String())
					}
					if want == 304 && w.Body.Len() != 0 {
						t.Fatal("304 must not transfer image bytes")
					}
					if want != 304 && w.Header().Get("Cache-Control") != "no-store" {
						t.Fatal("access errors must not be cached")
					}
				})
			}
		}
	}
}
