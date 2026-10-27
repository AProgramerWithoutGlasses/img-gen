package main

import (
	"bytes"
	"database/sql"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gen2brain/webp"
)

func TestInputPreviewCacheAndPersistence(t *testing.T) {
	id, userID := strings.Repeat("1", 32), strings.Repeat("b", 32)
	for _, role := range []string{"input", "reference"} {
		for _, scenario := range []string{"cached", "legacy", "missing", "db-error", "bad-version", "bad-role", "bad-image"} {
			t.Run(role+"/"+scenario, func(t *testing.T) {
				a := &app{}
				path := "/api/jobs/" + id + "/" + role + "/preview/1"
				if scenario == "bad-version" {
					path = strings.TrimSuffix(path, "1") + "999"
				}
				if scenario == "bad-role" {
					path = "/api/jobs/" + id + "/other/preview/1"
				}
				r := httptest.NewRequest("GET", path, nil)
				mock := mockSession(t, a, r, "user")
				query := `(?s)SELECT p.content FROM jobs LEFT JOIN job_image_previews p.*WHERE jobs.id=\? AND jobs.` + role + `_image IS NOT NULL AND jobs.user_id=\?`
				want := 200
				switch scenario {
				case "cached":
					mock.ExpectQuery(query).WithArgs(role, previewVersion, id, userID).WillReturnRows(sqlmock.NewRows([]string{"content"}).AddRow([]byte("cached-preview")))
				case "legacy", "bad-image":
					for i := 0; i < 2; i++ {
						mock.ExpectQuery(query).WithArgs(role, previewVersion, id, userID).WillReturnRows(sqlmock.NewRows([]string{"content"}).AddRow(nil))
					}
					original := testPNG()
					if role == "reference" {
						original = referencePNG()
					}
					if scenario == "bad-image" {
						original = []byte("invalid")
						want = 500
					}
					mock.ExpectQuery(`SELECT jobs.`+role+`_image FROM jobs WHERE jobs.id=\? AND jobs.user_id=\?`).WithArgs(id, userID).WillReturnRows(sqlmock.NewRows([]string{"content"}).AddRow(original))
					if scenario == "legacy" {
						mock.ExpectExec(`INSERT INTO job_image_previews`).WithArgs(id, role, previewVersion, sqlmock.AnyArg()).WillReturnResult(sqlmock.NewResult(0, 1))
					}
				case "missing":
					mock.ExpectQuery(query).WithArgs(role, previewVersion, id, userID).WillReturnError(sql.ErrNoRows)
					want = 404
				case "db-error":
					mock.ExpectQuery(query).WithArgs(role, previewVersion, id, userID).WillReturnError(sql.ErrConnDone)
					want = 500
				default:
					want = 404
				}
				w := httptest.NewRecorder()
				a.routes(fstest.MapFS{}).ServeHTTP(w, r)
				if w.Code != want {
					t.Fatalf("got %d want %d: %s", w.Code, want, w.Body.String())
				}
				if scenario == "legacy" {
					if _, err := webp.Decode(bytes.NewReader(w.Body.Bytes())); err != nil {
						t.Fatal(err)
					}
				}
				if scenario == "cached" && w.Body.String() != "cached-preview" {
					t.Fatal("cache content changed")
				}
			})
		}
	}
}

func TestInputImagesConditionalAccess(t *testing.T) {
	id, userID := strings.Repeat("1", 32), strings.Repeat("b", 32)
	for _, role := range []string{"input", "reference"} {
		for _, suffix := range []string{"", "/preview/1"} {
			for _, method := range []string{"GET", "HEAD"} {
				for _, access := range []string{"owner", "admin", "foreign", "revoked", "anonymous"} {
					t.Run(role+suffix+"/"+method+"/"+access, func(t *testing.T) {
						a := &app{}
						r := httptest.NewRequest(method, "/api/jobs/"+id+"/"+role+suffix, nil)
						data := testPNG()
						etag := httptest.NewRecorder()
						serveCachedImage(etag, httptest.NewRequest("GET", "/", nil), data, "image/png")
						r.Header.Set("If-None-Match", etag.Header().Get("ETag"))
						want := 304
						if access == "anonymous" {
							want = 401
						} else if access == "revoked" {
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
							userRole := "user"
							if access == "admin" {
								userRole = "admin"
							}
							mock := mockSession(t, a, r, userRole)
							var query *sqlmock.ExpectedQuery
							var rows *sqlmock.Rows
							if suffix == "" {
								query = mock.ExpectQuery(`SELECT ` + role + `_image,` + role + `_mime FROM jobs WHERE id=\?`)
								if access == "admin" {
									query.WithArgs(id)
								} else {
									query.WithArgs(id, userID)
								}
								rows = sqlmock.NewRows([]string{"content", "mime"}).AddRow(data, "image/png")
							} else {
								query = mock.ExpectQuery(`(?s)SELECT p.content FROM jobs LEFT JOIN job_image_previews p.*WHERE jobs.id=\?`)
								if access == "admin" {
									query.WithArgs(role, previewVersion, id)
								} else {
									query.WithArgs(role, previewVersion, id, userID)
								}
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
							t.Fatal("304 transferred bytes")
						}
						if want != 304 && w.Header().Get("Cache-Control") != "no-store" {
							t.Fatal("permission failure must not be cached")
						}
					})
				}
			}
		}
	}
}
