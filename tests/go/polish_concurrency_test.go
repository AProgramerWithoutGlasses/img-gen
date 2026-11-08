package studio_test

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"testing/fstest"
	"time"

	studio "github.com/AProgramerWithoutGlasses/img-gen/internal/studio"
	"github.com/DATA-DOG/go-sqlmock"
)

// Exercise actual overlapping HTTP calls rather than acquiring the implementation's private mutex.
func TestPolishConcurrentRequestsAreRejected(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	started, release := make(chan struct{}), make(chan struct{})
	var calls atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if calls.Add(1) == 1 {
			close(started)
			<-release
		}
		_, _ = w.Write([]byte(polishFixture("熊猫喝茶")))
	}))
	defer upstream.Close()
	a := studio.App{DB: db, Upstream: &studio.Provider{Base: upstream.URL, Key: "fixture", Client: upstream.Client()}}
	handler := a.Handler(fstest.MapFS{})
	for range 3 {
		mock.ExpectQuery("SELECT u.id,u.username,u.role,u.active,u.created_at FROM sessions").WithArgs(sqlmock.AnyArg()).WillReturnRows(sqlmock.NewRows([]string{"id", "username", "role", "active", "created_at"}).AddRow(strings.Repeat("b", 32), "tester", "user", true, time.Now()))
	}
	request := func() int {
		r := httptest.NewRequest("POST", "/api/prompt/polish", strings.NewReader(`{"prompt":"熊猫","mode":"generate"}`))
		r.AddCookie(&http.Cookie{Name: sessionCookie, Value: strings.Repeat("a", 64)})
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w.Code
	}
	done := make(chan int, 1)
	go func() { done <- request() }()
	select {
	case <-started:
	case <-time.After(5 * time.Second):
		close(release)
		t.Fatal("first request did not reach upstream")
	}
	code := request()
	close(release)
	if code != http.StatusConflict {
		t.Errorf("overlapping request = %d, want 409", code)
	}
	select {
	case code = <-done:
		if code != 200 {
			t.Errorf("first request = %d", code)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("first request did not finish")
	}
	if code = request(); code != 200 {
		t.Errorf("guard did not recover: %d", code)
	}
	if calls.Load() != 2 {
		t.Errorf("rejected request reached upstream or retry occurred: %d", calls.Load())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
