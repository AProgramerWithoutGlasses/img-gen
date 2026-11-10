package studio_test

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	studio "github.com/AProgramerWithoutGlasses/img-gen/internal/studio"
	"github.com/go-sql-driver/mysql"
)

func TestRegistrationRejectsInvalidInputBeforeDatabase(t *testing.T) {
	for name, body := range map[string]string{
		"short":        `{"username":"new_user","password":"1234567"}`,
		"long":         `{"username":"new_user","password":"` + strings.Repeat("a", 129) + `"}`,
		"unicode-long": `{"username":"new_user","password":"` + strings.Repeat("密", 43) + `"}`,
		"username":     `{"username":"bad name","password":"test-password"}`,
		"role":         `{"username":"new_user","password":"test-password","role":"admin"}`,
		"credits":      `{"username":"new_user","password":"test-password","credits":1000}`,
		"active":       `{"username":"new_user","password":"test-password","active":false}`,
		"oversized":    `{"username":"new_user","password":"` + strings.Repeat("a", 5000) + `"}`,
	} {
		t.Run(name, func(t *testing.T) {
			a := studio.App{}
			w := httptest.NewRecorder()
			a.Handler(fstest.MapFS{}).ServeHTTP(w, httptest.NewRequest("POST", "/api/auth/register", strings.NewReader(body)))
			if w.Code != http.StatusBadRequest {
				t.Fatalf("invalid registration: %d", w.Code)
			}
		})
	}
}

func TestRegistrationAdmissionAndCrossSiteProtection(t *testing.T) {
	a := studio.App{}
	h := a.Handler(fstest.MapFS{})
	for i := 0; i <= 5; i++ {
		r := httptest.NewRequest("POST", "/api/auth/register", strings.NewReader("{"))
		r.RemoteAddr = "192.0.2.1:1234"
		if i%2 == 0 {
			r.RemoteAddr = "[::ffff:192.0.2.1]:5678"
		}
		r.Header.Set("X-Forwarded-For", fmt.Sprintf("198.51.100.%d", i))
		r.Header.Set("X-Real-IP", fmt.Sprintf("198.51.100.%d", i))
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		want := http.StatusBadRequest
		if i == 5 {
			want = http.StatusTooManyRequests
		}
		if w.Code != want || (i == 5 && w.Header().Get("Retry-After") == "") {
			t.Fatalf("registration admission %d: %d", i, w.Code)
		}
	}
	a = studio.App{}
	for i := 0; i < 2; i++ {
		a.LoginProtection().Begin()
	}
	w := httptest.NewRecorder()
	a.Handler(fstest.MapFS{}).ServeHTTP(w, httptest.NewRequest("POST", "/api/auth/register", strings.NewReader(`{"username":"new_user","password":"test-password"}`)))
	if w.Code != 429 || w.Header().Get("Retry-After") != "1" {
		t.Fatal("registration bypassed the shared password work limit")
	}
	for i := 0; i < 2; i++ {
		a.LoginProtection().End()
	}
	for _, header := range []string{"Origin", "Sec-Fetch-Site"} {
		r := httptest.NewRequest("POST", "http://localhost/api/auth/register", strings.NewReader(`{"username":"new_user","password":"test-password"}`))
		value := "https://other.example"
		if header == "Sec-Fetch-Site" {
			value = "cross-site"
		}
		r.Header.Set(header, value)
		w = httptest.NewRecorder()
		a.Handler(fstest.MapFS{}).ServeHTTP(w, r)
		if w.Code != http.StatusForbidden {
			t.Fatalf("cross-site registration accepted: %s", header)
		}
	}
}

func TestRegistrationLoopbackProxyVisitorQuotas(t *testing.T) {
	a := studio.App{}
	h := a.Handler(fstest.MapFS{})
	request := func(realIP string, want int) {
		t.Helper()
		r := httptest.NewRequest("POST", "/api/auth/register", strings.NewReader("{"))
		r.RemoteAddr = "127.0.0.1:1234"
		r.Header.Set("X-Real-IP", realIP)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != want {
			t.Fatalf("proxy visitor %s: %d want %d", realIP, w.Code, want)
		}
	}
	for i := 0; i < 5; i++ {
		request("192.0.2.1", http.StatusBadRequest)
		request("192.0.2.2", http.StatusBadRequest)
	}
	request("::ffff:192.0.2.1", http.StatusTooManyRequests)
	request("192.0.2.2", http.StatusTooManyRequests)
	request("192.0.2.3", http.StatusBadRequest)
}

func TestRegistrationInvalidProxyAddressFallsBackToPeer(t *testing.T) {
	a := studio.App{}
	h := a.Handler(fstest.MapFS{})
	values := [][]string{
		{"not-an-ip"},
		{"192.0.2.1, 192.0.2.2"},
		{"192.0.2.1:1234"},
		{"[2001:db8::1]"},
		{"192.0.2.1", "192.0.2.2"},
		{"invalid-final-value"},
	}
	for i, headers := range values {
		r := httptest.NewRequest("POST", "/api/auth/register", strings.NewReader("{"))
		r.RemoteAddr = "[::1]:1234"
		for _, value := range headers {
			r.Header.Add("X-Real-IP", value)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		want := http.StatusBadRequest
		if i == 5 {
			want = http.StatusTooManyRequests
		}
		if w.Code != want {
			t.Fatalf("invalid proxy input %d escaped peer quota: %d want %d", i, w.Code, want)
		}
	}
}

func TestRegistrationMySQL(t *testing.T) {
	dsn := os.Getenv("TEST_MYSQL_DSN")
	if dsn == "" {
		t.Skip("set TEST_MYSQL_DSN to an empty dedicated _test database")
	}
	cfg, err := mysql.ParseDSN(dsn)
	if err != nil || !strings.HasSuffix(cfg.DBName, "_test") {
		t.Fatal("requires a dedicated _test database")
	}
	cfg.ParseTime, cfg.Loc = true, time.UTC
	DB, err := sql.Open("mysql", cfg.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { DB.Close() })
	var tables int
	if err := DB.QueryRow("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE()").Scan(&tables); err != nil || tables != 0 {
		t.Fatal("registration test requires a completely empty dedicated database")
	}
	t.Cleanup(func() {
		for _, table := range []string{"studio_image_folders", "studio_folders", "studio_batch_attachments", "studio_attachment_renditions", "studio_attachments", "studio_batch_jobs", "studio_batches", "credit_ledger", "model_prices", "job_image_previews", "image_thumbnails", "images", "jobs", "sessions", "users"} {
			if _, err := DB.Exec("DROP TABLE IF EXISTS " + table); err != nil {
				t.Error(err)
			}
		}
	})
	if err := studio.Migrate(context.Background(), DB); err != nil {
		t.Fatal(err)
	}
	a := studio.App{DB: DB, SecureCookies: true}
	h := a.Handler(fstest.MapFS{})
	sequence := 0
	request := func(method, path string, body any, cookie *http.Cookie, want int) *httptest.ResponseRecorder {
		t.Helper()
		encoded, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		r := httptest.NewRequest(method, "http://localhost"+path, bytes.NewReader(encoded))
		sequence++
		r.RemoteAddr = fmt.Sprintf("192.0.2.%d:1234", sequence)
		r.Header.Set("Content-Type", "application/json")
		if cookie != nil {
			r.AddCookie(cookie)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != want {
			t.Fatalf("%s %s: %d want %d: %s", method, path, w.Code, want, w.Body.String())
		}
		return w
	}
	credentials := map[string]string{"username": "new_user", "password": "test-password"}
	created := request("POST", "/api/auth/register", credentials, nil, 201)
	if strings.Contains(created.Body.String(), "password") || strings.Contains(created.Body.String(), "pbkdf2") || len(created.Result().Cookies()) != 0 {
		t.Fatal("registration exposed authentication state")
	}
	var role, hash string
	var active bool
	var credits int64
	if err := DB.QueryRow("SELECT role,active,credits,password_hash FROM users WHERE username='new_user'").Scan(&role, &active, &credits, &hash); err != nil {
		t.Fatal(err)
	}
	if role != "user" || !active || credits != 0 || !studio.CheckPassword(hash, "test-password") {
		t.Fatal("public registration did not create an enabled ordinary zero-credit account")
	}
	request("POST", "/api/auth/register", map[string]string{"username": "NEW_USER", "password": "test-password"}, nil, 409)
	login := request("POST", "/api/auth/login", credentials, nil, 200)
	cookies := login.Result().Cookies()
	if len(cookies) != 1 || !cookies[0].HttpOnly || !cookies[0].Secure || cookies[0].SameSite != http.SameSiteStrictMode || cookies[0].MaxAge != 7*24*60*60 {
		t.Fatal("registered account did not get the normal persistent protected session")
	}
	request("GET", "/api/auth/me", nil, cookies[0], 200)
	request("GET", "/api/auth/me", nil, cookies[0], 200)
	request("GET", "/api/admin/users", nil, cookies[0], 403)
	request("POST", "/api/admin/users/00000000000000000000000000000000/credits", map[string]any{"delta": 100}, cookies[0], 403)
	for name, password := range map[string]string{"ascii_max": strings.Repeat("a", 128), "unicode_max": strings.Repeat("密", 42) + "ab", "unicode_min": "密密ab"} {
		body := map[string]string{"username": name, "password": password}
		request("POST", "/api/auth/register", body, nil, 201)
		request("POST", "/api/auth/login", body, nil, 200)
	}
	if _, err := DB.Exec("INSERT INTO users(id,username,password_hash,role,active) VALUES(?,?,?,'user',TRUE)", studio.NewID(), "legacy_user", studio.HashPassword("abcd")); err != nil {
		t.Fatal(err)
	}
	request("POST", "/api/auth/login", map[string]string{"username": "legacy_user", "password": "abcd"}, nil, 200)
}
