package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/go-sql-driver/mysql"
)

// Use a dedicated empty database ending in _test. Never deletes unrelated data.
func TestMySQLWorkflow(t *testing.T) {
	dsn := os.Getenv("TEST_MYSQL_DSN")
	if dsn == "" {
		t.Skip("set TEST_MYSQL_DSN for real MySQL integration")
	}
	config, err := mysql.ParseDSN(dsn)
	if err != nil || !strings.HasSuffix(config.DBName, "_test") {
		t.Fatal("TEST_MYSQL_DSN must point to a dedicated database ending in _test")
	}
	config.ParseTime = true
	config.Loc = time.UTC
	db, err := sql.Open("mysql", config.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	ctx := context.Background()
	if err = migrate(ctx, db); err != nil {
		t.Fatal(err)
	}
	var existing int
	if err = db.QueryRow("SELECT COUNT(*) FROM jobs").Scan(&existing); err != nil || existing != 0 {
		t.Fatal("integration requires an empty jobs table")
	}
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var data map[string]any
		if strings.Contains(r.Header.Get("Content-Type"), "multipart") {
			if err := r.ParseMultipartForm(1 << 20); err != nil {
				t.Error(err)
				return
			}
			defer r.MultipartForm.RemoveAll()
			data = map[string]any{"prompt": r.FormValue("prompt")}
		} else {
			_ = json.NewDecoder(r.Body).Decode(&data)
		}
		w.Header().Set("X-Request-Id", "integration-request")
		if data["prompt"] == "fail" {
			w.WriteHeader(503)
			return
		}
		if strings.Contains(r.URL.Path, "generateContent") {
			jsonResponse(w, 200, map[string]any{"candidates": []any{map[string]any{"content": map[string]any{"parts": []any{map[string]any{"inlineData": map[string]string{"data": base64.StdEncoding.EncodeToString(testPNG())}}}}}}})
			return
		}
		jsonResponse(w, 200, map[string]any{"model": "gpt-image-2", "data": []any{map[string]string{"b64_json": base64.StdEncoding.EncodeToString(testPNG())}}})
	}))
	defer upstream.Close()
	a := &app{db: db, password: "test-access", upstream: &provider{base: upstream.URL, key: "test-key", client: upstream.Client()}}
	h := a.routes(fstest.MapFS{"index.html": {Data: []byte("studio")}})
	ids := []string{}
	defer func() {
		for _, id := range ids {
			_, _ = db.Exec("DELETE FROM jobs WHERE id=?", id)
		}
	}()
	request := func(method, path string, body *bytes.Buffer, contentType string) *httptest.ResponseRecorder {
		t.Helper()
		if body == nil {
			body = &bytes.Buffer{}
		}
		r := httptest.NewRequest(method, "http://localhost"+path, body)
		r.SetBasicAuth("admin", "test-access")
		if contentType != "" {
			r.Header.Set("Content-Type", contentType)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}
	create := func(prompt string, count int, edit bool) []string {
		t.Helper()
		var body bytes.Buffer
		writer := multipart.NewWriter(&body)
		mode := "generate"
		if edit {
			mode = "edit"
			part, _ := writer.CreateFormFile("image", "sample.png")
			_, _ = part.Write(testPNG())
		}
		for k, v := range map[string]string{"model": "gpt-image-2", "prompt": prompt, "count": fmt.Sprint(count), "mode": mode, "ratio": "auto", "resolution": "default"} {
			_ = writer.WriteField(k, v)
		}
		_ = writer.Close()
		w := request("POST", "/api/jobs", &body, writer.FormDataContentType())
		if w.Code != 202 {
			t.Fatalf("create: %d %s", w.Code, w.Body.String())
		}
		var response struct {
			IDs []string `json:"ids"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
			t.Fatal(err)
		}
		ids = append(ids, response.IDs...)
		return response.IDs
	}
	successIDs := create("持久化图片 <script>alert(1)</script>", 2, false)
	editIDs := create("编辑参考图", 1, true)
	failureIDs := create("fail", 1, false)
	createBatch := func(selections string) *httptest.ResponseRecorder {
		t.Helper()
		var body bytes.Buffer
		writer := multipart.NewWriter(&body)
		for k, v := range map[string]string{"models": selections, "prompt": "多模型对比", "mode": "generate", "ratio": "auto", "resolution": "default"} {
			_ = writer.WriteField(k, v)
		}
		_ = writer.Close()
		return request("POST", "/api/jobs", &body, writer.FormDataContentType())
	}
	multi := createBatch(`[{"model":"gpt-image-2","count":2},{"model":"gemini-3.1-flash-image","count":1}]`)
	if multi.Code != 202 {
		t.Fatalf("multi-model create: %s", multi.Body.String())
	}
	var batch struct {
		IDs     []string `json:"ids"`
		BatchID string   `json:"batch_id"`
	}
	if err := json.Unmarshal(multi.Body.Bytes(), &batch); err != nil {
		t.Fatal(err)
	}
	ids = append(ids, batch.IDs...)
	if len(batch.IDs) != 3 {
		t.Fatalf("wrong model counts: %v", batch.IDs)
	}
	for i, id := range batch.IDs {
		j, err := scanJob(db.QueryRow("SELECT "+jobColumns+" FROM jobs WHERE id=?", id))
		want := "gpt-image-2"
		if i == 2 {
			want = "gemini-3.1-flash-image"
		}
		if err != nil || j.Model != want || j.BatchID != batch.BatchID || j.Prompt != "多模型对比" {
			t.Fatalf("batch persistence: %+v, %v", j, err)
		}
	}
	successIDs = append(successIDs, batch.IDs...)
	for _, invalid := range []string{`[]`, `not-json`, `[{"model":"gpt-image-2","count":1},{"model":"unknown","count":1}]`} {
		if w := createBatch(invalid); w.Code != 400 {
			t.Fatalf("invalid batch accepted: %d", w.Code)
		}
	}
	if w := createBatch(`[{"model":"gpt-image-2","count":4},{"model":"gpt-image-1.5","count":4},{"model":"gpt-image-2.5-sunburst","count":4},{"model":"gemini-3.1-flash-image","count":4}]`); w.Code != 429 {
		t.Fatalf("queue admission must count all models: %d", w.Code)
	}
	// Queue is already durable before any worker starts.
	var queued int
	_ = db.QueryRow("SELECT COUNT(*) FROM jobs WHERE status='queued'").Scan(&queued)
	if queued != 7 {
		t.Fatalf("got %d queued jobs", queued)
	}
	workerCtx, cancel := context.WithCancel(ctx)
	for i := 0; i < 2; i++ {
		a.workers.Add(1)
		go a.worker(workerCtx)
	}
	defer func() { cancel(); a.workers.Wait() }()
	deadline := time.Now().Add(12 * time.Second)
	for {
		var active int
		if err := db.QueryRow("SELECT COUNT(*) FROM jobs WHERE status IN ('queued','running')").Scan(&active); err != nil {
			t.Fatal(err)
		}
		if active == 0 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("worker timeout")
		}
		time.Sleep(50 * time.Millisecond)
	}
	cancel()
	a.workers.Wait()
	for _, id := range append(successIDs, editIDs...) {
		w := request("GET", "/api/jobs/"+id, nil, "")
		var j job
		if err := json.Unmarshal(w.Body.Bytes(), &j); err != nil {
			t.Fatal(err)
		}
		if j.Status != "succeeded" || len(j.Images) != 1 || j.Images[0].Width != 4 || j.RequestID != "integration-request" {
			t.Fatalf("bad completed job %+v", j)
		}
		if time.Since(j.CreatedAt) < -time.Minute || time.Since(j.CreatedAt) > time.Minute {
			t.Fatalf("created_at has a timezone offset: %s", j.CreatedAt)
		}
		imageResponse := request("GET", j.Images[0].URL+"?download=1", nil, "")
		if imageResponse.Code != 200 || !bytes.Equal(imageResponse.Body.Bytes(), testPNG()) || !strings.Contains(imageResponse.Header().Get("Content-Disposition"), "attachment") {
			t.Fatal("original download mismatch")
		}
	}
	w := request("GET", "/api/jobs/"+failureIDs[0], nil, "")
	var failed job
	_ = json.Unmarshal(w.Body.Bytes(), &failed)
	if failed.Status != "failed" || !strings.Contains(failed.Error, "503") {
		t.Fatalf("failure not persisted: %+v", failed)
	}
	w = request("GET", "/api/jobs/"+editIDs[0]+"/input", nil, "")
	if !bytes.Equal(w.Body.Bytes(), testPNG()) {
		t.Fatal("reference not persisted")
	}
	// A fresh app instance reads the same saved history after the old workers stop.
	a2 := &app{db: db, password: "test-access", upstream: a.upstream}
	h = a2.routes(fstest.MapFS{"index.html": {Data: []byte("studio")}})
	w = request("GET", "/api/jobs?q=持久化&status=succeeded", nil, "")
	var listing struct {
		Total int   `json:"total"`
		Items []job `json:"items"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &listing); err != nil {
		t.Fatal(err)
	}
	if listing.Total != 2 || len(listing.Items) != 2 {
		t.Fatalf("history filter mismatch: %s", w.Body.String())
	}
	w = request("GET", "/api/jobs?page=2", nil, "")
	_ = json.Unmarshal(w.Body.Bytes(), &listing)
	if len(listing.Items) != 0 {
		t.Fatal("pagination did not apply")
	}
}
