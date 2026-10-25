package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

func testCreditsWorkflow(t *testing.T, db *sql.DB, h http.Handler, a *app, adminID, adminToken string) {
	t.Helper()
	ctx := context.Background()
	request := func(method, path, body, token string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, "http://localhost"+path, strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		r.AddCookie(&http.Cookie{Name: sessionCookie, Value: token})
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}
	check := func(w *httptest.ResponseRecorder, want int) {
		t.Helper()
		if w.Code != want {
			t.Fatalf("status %d want %d: %s", w.Code, want, w.Body.String())
		}
	}
	w := request("POST", "/api/admin/users", `{"username":"credits-user","password":"credits-password","role":"user"}`, adminToken)
	check(w, 201)
	var created struct{ ID string }
	_ = json.Unmarshal(w.Body.Bytes(), &created)
	id := created.ID
	token := newID() + newID()
	if _, err := db.Exec("INSERT INTO sessions(token_hash,user_id,user_version,expires_at) VALUES(?,?,1,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 1 DAY))", sessionHash(token), id); err != nil {
		t.Fatal(err)
	}
	balance := func(want int64) {
		t.Helper()
		var n int64
		if err := db.QueryRow("SELECT credits FROM users WHERE id=?", id).Scan(&n); err != nil || n != want {
			t.Fatalf("balance %d want %d: %v", n, want, err)
		}
	}
	create := func(count int, expected string) *httptest.ResponseRecorder {
		var body bytes.Buffer
		writer := multipart.NewWriter(&body)
		for k, v := range map[string]string{"model": "gpt-image-2", "count": fmt.Sprint(count), "mode": "generate", "prompt": "credit test", "ratio": "auto", "resolution": "default", "expected_credits": expected} {
			_ = writer.WriteField(k, v)
		}
		_ = writer.Close()
		r := httptest.NewRequest("POST", "http://localhost/api/jobs", &body)
		r.Header.Set("Content-Type", writer.FormDataContentType())
		r.AddCookie(&http.Cookie{Name: sessionCookie, Value: token})
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}
	jobIDs := func(w *httptest.ResponseRecorder) []string {
		t.Helper()
		check(w, 202)
		var result struct{ IDs []string }
		if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		return result.IDs
	}
	check(create(1, ""), 402)
	balance(0)
	check(request("PATCH", "/api/admin/prices/gpt-image-2", `{"credits":3,"version":1}`, token), 403)
	check(request("POST", "/api/admin/users/"+id+"/credits", `{"delta":20,"note":"fake","request_id":"33333333333333333333333333333333"}`, token), 403)
	adjust := `{"delta":20,"note":"人工充值测试","request_id":"33333333333333333333333333333333"}`
	check(request("POST", "/api/admin/users/"+id+"/credits", adjust, adminToken), 200)
	balance(20)
	check(request("POST", "/api/admin/users/"+id+"/credits", adjust, adminToken), 200)
	balance(20)
	check(request("POST", "/api/admin/users/"+id+"/credits", strings.Replace(adjust, "20", "21", 1), adminToken), 409)
	check(request("PATCH", "/api/admin/prices/gpt-image-2", `{"credits":3,"version":1}`, adminToken), 200)
	check(request("PATCH", "/api/admin/prices/gpt-image-2", `{"credits":4,"version":1}`, adminToken), 409)
	check(request("PATCH", "/api/admin/prices/gpt-image-2", `{"credits":-1,"version":2}`, adminToken), 400)
	check(create(1, "1"), 409)
	balance(20)
	ids := jobIDs(create(2, "6"))
	balance(14)
	check(request("PATCH", "/api/admin/prices/gpt-image-2", `{"credits":9,"version":2}`, adminToken), 200)
	pic, err := decodePicture(testPNG())
	if err != nil {
		t.Fatal(err)
	}
	result := generationResult{Images: []picture{pic}}
	if err := a.saveResult(ctx, ids[0], result); err != nil {
		t.Fatal(err)
	}
	balance(14)
	if err := a.saveResult(ctx, ids[0], result); err != nil {
		t.Fatal(err)
	}
	if err := a.failJob(ctx, ids[0], "late failure", "", ""); err != nil {
		t.Fatal(err)
	}
	balance(14)
	if err := a.failJob(ctx, ids[1], "test failure", "", ""); err != nil {
		t.Fatal(err)
	}
	balance(17)
	if err := a.failJob(ctx, ids[1], "test failure", "", ""); err != nil {
		t.Fatal(err)
	}
	balance(17)
	var cost int64
	var creditState string
	if err := db.QueryRow("SELECT credits_cost,credits_state FROM jobs WHERE id=?", ids[0]).Scan(&cost, &creditState); err != nil || cost != 3 || creditState != "charged" {
		t.Fatal("price snapshot or settlement lost")
	}
	var count int
	if err := db.QueryRow("SELECT COUNT(*) FROM images WHERE job_id=?", ids[0]).Scan(&count); err != nil || count != 1 {
		t.Fatal("duplicate result persistence")
	}
	// Concurrent batches cannot overspend the same wallet.
	var wg sync.WaitGroup
	responses := make(chan *httptest.ResponseRecorder, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); responses <- create(1, "9") }()
	}
	wg.Wait()
	close(responses)
	var accepted, rejected int
	var interrupted string
	for w := range responses {
		if w.Code == 202 {
			accepted++
			interrupted = jobIDs(w)[0]
		} else if w.Code == 402 {
			rejected++
		} else {
			t.Fatal(w.Body.String())
		}
	}
	if accepted != 1 || rejected != 1 {
		t.Fatalf("concurrent debit accepted=%d rejected=%d", accepted, rejected)
	}
	balance(8)
	// Failed result persistence rolls back the settlement, then returns held credits.
	if err := a.saveResult(ctx, interrupted, generationResult{Images: []picture{{MIME: "image/png", Content: nil}}}); err == nil {
		t.Fatal("expected NOT NULL image failure")
	}
	balance(8)
	if _, err := db.Exec("UPDATE jobs SET status='running' WHERE id=?", interrupted); err != nil {
		t.Fatal(err)
	}
	if err := a.recoverInterrupted(ctx); err != nil {
		t.Fatal(err)
	}
	balance(17)
	if err := a.recoverInterrupted(ctx); err != nil {
		t.Fatal(err)
	}
	balance(17)
	check(request("POST", "/api/admin/users/"+id+"/credits", `{"delta":-18,"note":"不能透支","request_id":"44444444444444444444444444444444"}`, adminToken), 400)
	balance(17)
	check(request("POST", "/api/admin/users/"+id+"/credits", `{"delta":-2,"note":"余额纠正","request_id":"55555555555555555555555555555555"}`, adminToken), 200)
	balance(15)
	w = request("GET", "/api/auth/me", "", token)
	check(w, 200)
	var profile struct {
		Credits int64
		Held    int64 `json:"credits_held"`
		Spent   int64 `json:"credits_spent"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &profile); err != nil || profile.Credits != 15 || profile.Held != 0 || profile.Spent != 3 {
		t.Fatalf("profile: %s", w.Body.String())
	}
	w = request("GET", "/api/credits/ledger?user_id="+adminID, "", token)
	check(w, 200)
	var ledger struct{ Total int }
	_ = json.Unmarshal(w.Body.Bytes(), &ledger)
	if ledger.Total != 8 {
		t.Fatalf("ledger or scope mismatch: %s", w.Body.String())
	}
	// Time filtering and pagination use request creation time, not completion time.
	if _, err := db.Exec("UPDATE jobs SET created_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 2 DAY) WHERE id=?", ids[0]); err != nil {
		t.Fatal(err)
	}
	query := "/api/admin/jobs?user_id=" + id
	w = request("GET", query, "", adminToken)
	check(w, 200)
	var listing struct{ Total int }
	_ = json.Unmarshal(w.Body.Bytes(), &listing)
	if listing.Total != 2 {
		t.Fatalf("today includes old jobs: %s", w.Body.String())
	}
	start := time.Now().UTC().Add(-72 * time.Hour).Format(time.RFC3339)
	end := time.Now().UTC().Add(time.Minute).Format(time.RFC3339)
	w = request("GET", query+"&start="+start+"&end="+end, "", adminToken)
	check(w, 200)
	_ = json.Unmarshal(w.Body.Bytes(), &listing)
	if listing.Total != 3 {
		t.Fatal("custom range failed")
	}
	check(request("GET", query+"&start=bad&end=bad", "", adminToken), 400)
	if err := migrate(ctx, db); err != nil {
		t.Fatal(err)
	}
	balance(15)
	var price int64
	if err := db.QueryRow("SELECT credits FROM model_prices WHERE model='gpt-image-2'").Scan(&price); err != nil || price != 9 {
		t.Fatal("migration reset configured price")
	}
}
