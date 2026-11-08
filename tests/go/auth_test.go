package studio_test

import studio "github.com/AProgramerWithoutGlasses/img-gen/internal/studio"

import (
	"database/sql"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"testing/fstest"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
)

func mockSession(t *testing.T, a *studio.App, r *http.Request, role string) sqlmock.Sqlmock {
	t.Helper()
	DB, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	a.DB = DB
	t.Cleanup(func() {
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Error(err)
		}
		DB.Close()
	})
	r.AddCookie(&http.Cookie{Name: sessionCookie, Value: strings.Repeat("a", 64)})
	mock.ExpectQuery("SELECT u.id,u.username,u.role,u.active,u.created_at FROM sessions").WithArgs(studio.SessionHash(strings.Repeat("a", 64))).WillReturnRows(sqlmock.NewRows([]string{"id", "username", "role", "active", "created_at"}).AddRow(strings.Repeat("b", 32), "tester", role, true, time.Now()))
	return mock
}

func TestPasswordHash(t *testing.T) {
	hash := studio.HashPassword("correct-password")
	if hash == studio.HashPassword("correct-password") {
		t.Fatal("password salts reused")
	}
	if !studio.CheckPassword(hash, "correct-password") || studio.CheckPassword(hash, "wrong-password") || studio.CheckPassword("malformed", "correct-password") {
		t.Fatal("password verification failed")
	}
}

func TestSessionAndAdminProtection(t *testing.T) {
	for _, path := range []string{"/api/jobs", "/api/jobs/" + strings.Repeat("1", 32), "/api/images/" + strings.Repeat("2", 32), "/api/admin/users", "/api/admin/jobs", "/api/auth/me"} {
		r := httptest.NewRequest("GET", path, nil)
		w := httptest.NewRecorder()
		a := studio.App{}
		a.Handler(fstest.MapFS{}).ServeHTTP(w, r)
		if w.Code != 401 {
			t.Errorf("anonymous %s: %d", path, w.Code)
		}
	}
	for _, path := range []string{"/api/admin/users", "/api/admin/jobs"} {
		r := httptest.NewRequest("GET", path, nil)
		w := httptest.NewRecorder()
		a := studio.App{}
		mockSession(t, &a, r, "user")
		a.Handler(fstest.MapFS{}).ServeHTTP(w, r)
		if w.Code != 403 {
			t.Errorf("non-admin %s: %d", path, w.Code)
		}
	}
	for _, path := range []string{"/api/jobs/" + strings.Repeat("1", 32), "/api/jobs/" + strings.Repeat("1", 32) + "/input", "/api/jobs/" + strings.Repeat("1", 32) + "/reference", "/api/images/" + strings.Repeat("2", 32) + "?download=1"} {
		r := httptest.NewRequest("GET", path, nil)
		w := httptest.NewRecorder()
		a := studio.App{}
		mock := mockSession(t, &a, r, "user")
		mock.ExpectQuery(`SELECT .* WHERE .*id=\? AND .*user_id=\?`).WithArgs(sqlmock.AnyArg(), strings.Repeat("b", 32)).WillReturnError(sql.ErrNoRows)
		a.Handler(fstest.MapFS{}).ServeHTTP(w, r)
		if w.Code != 404 {
			t.Errorf("foreign object %s: %d", path, w.Code)
		}
	}
}

func TestExpiredOrRevokedSession(t *testing.T) {
	DB, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer DB.Close()
	r := httptest.NewRequest("GET", "/api/auth/me", nil)
	r.AddCookie(&http.Cookie{Name: sessionCookie, Value: strings.Repeat("a", 64)})
	mock.ExpectQuery(`SELECT .*s.expires_at>UTC_TIMESTAMP.*u.active=TRUE AND s.user_version=u.session_version`).WillReturnError(sql.ErrNoRows)
	w := httptest.NewRecorder()
	a := studio.App{DB: DB}
	a.Handler(fstest.MapFS{}).ServeHTTP(w, r)
	if w.Code != 401 {
		t.Fatal(w.Code)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestLoginLimiter(t *testing.T) {
	var limiter studio.LoginLimiter
	now := time.Now()
	for i := 0; i < loginIPLimit; i++ {
		if limiter.Allow("ip", loginIPLimit, now) != 0 {
			t.Fatal("limited too early")
		}
	}
	for _, elapsed := range []time.Duration{0, time.Second, 14 * time.Minute} {
		if retry := limiter.Allow("ip", loginIPLimit, now.Add(elapsed)); retry != loginWindow-elapsed {
			t.Fatalf("wrong cooldown or rejection extended it: %v", retry)
		}
	}
	if limiter.Allow("ip", loginIPLimit, now.Add(loginWindow)) != 0 {
		t.Fatal("limiter never expires")
	}
}

func TestLoginLimiterConcurrentAndBounded(t *testing.T) {
	var limiter studio.LoginLimiter
	now := time.Now()
	var admitted atomic.Int32
	var wg sync.WaitGroup
	for i := 0; i < 100; i++ {
		wg.Go(func() {
			if limiter.Allow("account:admin", loginAccountLimit, now) == 0 {
				admitted.Add(1)
			}
		})
	}
	wg.Wait()
	if admitted.Load() != loginAccountLimit {
		t.Fatalf("concurrent requests bypassed quota: %d", admitted.Load())
	}
	for i := 0; i < loginMaxEntries-1; i++ {
		if limiter.Allow(fmt.Sprint(i), loginIPLimit, now) != 0 {
			t.Fatal("capacity reached too early")
		}
	}
	if limiter.Allow("overflow", loginIPLimit, now) <= 0 || limiter.Size() != loginMaxEntries {
		t.Fatal("unbounded limiter")
	}
	if limiter.Allow("account:admin", loginAccountLimit, now) <= 0 {
		t.Fatal("capacity evicted a blocked account")
	}
	if limiter.Allow("overflow", loginIPLimit, now.Add(loginWindow)) != 0 {
		t.Fatal("expired entries did not free capacity")
	}
}

func TestLoginAccountQuotaAcrossIPs(t *testing.T) {
	DB, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer DB.Close()
	a := studio.App{DB: DB}
	h := a.Handler(fstest.MapFS{})
	// Unknown accounts receive exactly the same quota. Alternating case and
	// whitespace and changing the source IP must not reset it.
	for i := 0; i <= loginAccountLimit; i++ {
		name := "Admin"
		if i%2 == 0 {
			name = " admin "
		}
		if i < loginAccountLimit {
			mock.ExpectQuery("SELECT .* FROM users WHERE username").WithArgs(strings.TrimSpace(name)).WillReturnError(sql.ErrNoRows)
		}
		r := httptest.NewRequest("POST", "/api/auth/login", strings.NewReader(fmt.Sprintf(`{"username":%q,"password":"wrong-password"}`, name)))
		r.RemoteAddr = fmt.Sprintf("192.0.2.%d:1234", i+1)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		want := 401
		if i == loginAccountLimit {
			want = 429
		}
		if w.Code != want {
			t.Fatalf("attempt %d: %d want %d", i, w.Code, want)
		}
		if want == 429 && w.Header().Get("Retry-After") == "" {
			t.Fatal("missing retry delay")
		}
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestLoginIPQuotaIgnoresForwardedHeaders(t *testing.T) {
	a := studio.App{}
	h := a.Handler(fstest.MapFS{})
	for i := 0; i <= loginIPLimit; i++ {
		// Invalid JSON still consumes the source quota, without a database call.
		r := httptest.NewRequest("POST", "/api/auth/login", strings.NewReader("{"))
		r.RemoteAddr = "192.0.2.1:1234"
		if i%2 == 0 {
			r.RemoteAddr = "[::ffff:192.0.2.1]:5678"
		}
		r.Header.Set("X-Forwarded-For", fmt.Sprintf("198.51.100.%d", i))
		r.Header.Set("X-Real-IP", fmt.Sprintf("198.51.100.%d", i))
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		want := 400
		if i == loginIPLimit {
			want = 429
		}
		if w.Code != want {
			t.Fatalf("attempt %d: %d want %d", i, w.Code, want)
		}
	}
	if a.LoginProtection().Active() != 0 {
		t.Fatal("parse errors leaked concurrency slots")
	}
}

func TestLoginConcurrentWorkIsRejected(t *testing.T) {
	a := studio.App{}
	for i := 0; i < loginMaxConcurrent; i++ {
		a.LoginProtection().Begin()
	}
	r := httptest.NewRequest("POST", "/api/auth/login", strings.NewReader(`{"username":"admin","password":"test-password"}`))
	w := httptest.NewRecorder()
	a.Handler(fstest.MapFS{}).ServeHTTP(w, r)
	if w.Code != 429 || w.Header().Get("Retry-After") != "1" {
		t.Fatalf("concurrent login was not rejected before DB access: %d", w.Code)
	}
	for i := 0; i < loginMaxConcurrent; i++ {
		a.LoginProtection().End()
	}
	w = httptest.NewRecorder()
	a.Handler(fstest.MapFS{}).ServeHTTP(w, httptest.NewRequest("POST", "/api/auth/login", strings.NewReader("{")))
	if w.Code != 400 {
		t.Fatal("concurrency slots did not recover")
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
		a := studio.App{}
		a.Handler(fstest.MapFS{}).ServeHTTP(w, r)
		if w.Code != http.StatusForbidden {
			t.Fatalf("%s: %d", header, w.Code)
		}
	}
}
