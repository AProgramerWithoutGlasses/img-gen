package main

import (
	"database/sql"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
)

func mockSession(t *testing.T, a *app, r *http.Request, role string) sqlmock.Sqlmock {
	t.Helper()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	a.db = db
	t.Cleanup(func() {
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Error(err)
		}
		db.Close()
	})
	r.AddCookie(&http.Cookie{Name: sessionCookie, Value: strings.Repeat("a", 64)})
	mock.ExpectQuery("SELECT u.id,u.username,u.role,u.active,u.created_at FROM sessions").WithArgs(sessionHash(strings.Repeat("a", 64))).WillReturnRows(sqlmock.NewRows([]string{"id", "username", "role", "active", "created_at"}).AddRow(strings.Repeat("b", 32), "tester", role, true, time.Now()))
	return mock
}

func TestPasswordHash(t *testing.T) {
	hash := hashPassword("correct-password")
	if hash == hashPassword("correct-password") {
		t.Fatal("password salts reused")
	}
	if !checkPassword(hash, "correct-password") || checkPassword(hash, "wrong-password") || checkPassword("malformed", "correct-password") {
		t.Fatal("password verification failed")
	}
}

func TestSessionAndAdminProtection(t *testing.T) {
	for _, path := range []string{"/api/jobs", "/api/jobs/" + strings.Repeat("1", 32), "/api/images/" + strings.Repeat("2", 32), "/api/admin/users", "/api/admin/jobs", "/api/auth/me"} {
		r := httptest.NewRequest("GET", path, nil)
		w := httptest.NewRecorder()
		a := app{}
		a.routes(fstest.MapFS{}).ServeHTTP(w, r)
		if w.Code != 401 {
			t.Errorf("anonymous %s: %d", path, w.Code)
		}
	}
	for _, path := range []string{"/api/admin/users", "/api/admin/jobs"} {
		r := httptest.NewRequest("GET", path, nil)
		w := httptest.NewRecorder()
		a := app{}
		mockSession(t, &a, r, "user")
		a.routes(fstest.MapFS{}).ServeHTTP(w, r)
		if w.Code != 403 {
			t.Errorf("non-admin %s: %d", path, w.Code)
		}
	}
	for _, path := range []string{"/api/jobs/" + strings.Repeat("1", 32), "/api/jobs/" + strings.Repeat("1", 32) + "/input", "/api/images/" + strings.Repeat("2", 32) + "?download=1"} {
		r := httptest.NewRequest("GET", path, nil)
		w := httptest.NewRecorder()
		a := app{}
		mock := mockSession(t, &a, r, "user")
		mock.ExpectQuery(`SELECT .* WHERE .*id=\? AND .*user_id=\?`).WithArgs(sqlmock.AnyArg(), strings.Repeat("b", 32)).WillReturnError(sql.ErrNoRows)
		a.routes(fstest.MapFS{}).ServeHTTP(w, r)
		if w.Code != 404 {
			t.Errorf("foreign object %s: %d", path, w.Code)
		}
	}
}

func TestExpiredOrRevokedSession(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	r := httptest.NewRequest("GET", "/api/auth/me", nil)
	r.AddCookie(&http.Cookie{Name: sessionCookie, Value: strings.Repeat("a", 64)})
	mock.ExpectQuery(`SELECT .*s.expires_at>UTC_TIMESTAMP.*u.active=TRUE AND s.user_version=u.session_version`).WillReturnError(sql.ErrNoRows)
	w := httptest.NewRecorder()
	a := app{db: db}
	a.routes(fstest.MapFS{}).ServeHTTP(w, r)
	if w.Code != 401 {
		t.Fatal(w.Code)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestLoginLimiter(t *testing.T) {
	var limiter loginLimiter
	for i := 0; i < 20; i++ {
		if !limiter.allow("ip") {
			t.Fatal("limited too early")
		}
	}
	if limiter.allow("ip") {
		t.Fatal("login flooding allowed")
	}
	limiter.entries["ip"] = loginAttempt{Count: 20, Until: time.Now().Add(-time.Second)}
	if !limiter.allow("ip") {
		t.Fatal("limiter never expires")
	}
}

func TestLoginRejectsCrossSiteRequests(t *testing.T) {
	for _, header := range []string{"Origin", "Sec-Fetch-Site"} {
		r := httptest.NewRequest("POST", "http://localhost/api/auth/login", strings.NewReader(`{"username":"admin","password":"test-password"}`))
		value := "https://other.example"
		if header == "Sec-Fetch-Site" {
			value = "cross-site"
		}
		r.Header.Set(header, value)
		w := httptest.NewRecorder()
		a := app{}
		a.routes(fstest.MapFS{}).ServeHTTP(w, r)
		if w.Code != http.StatusForbidden {
			t.Fatalf("%s: %d", header, w.Code)
		}
	}
}
