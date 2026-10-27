package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
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
	if config.Params == nil {
		config.Params = map[string]string{}
	}
	config.Params["time_zone"] = "'+00:00'"
	db, err := sql.Open("mysql", config.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	var tableCount int
	if err := db.QueryRow("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE()").Scan(&tableCount); err != nil || tableCount != 0 {
		t.Fatal("integration requires a completely empty dedicated database")
	}
	t.Cleanup(func() {
		for _, table := range []string{"credit_ledger", "model_prices", "image_thumbnails", "images", "jobs", "sessions", "users"} {
			if _, err := db.Exec("DROP TABLE IF EXISTS " + table); err != nil {
				t.Error(err)
			}
		}
		db.Close()
	})
	if err = migrate(ctx, db); err != nil {
		t.Fatal(err)
	}
	// Simulate upgrading the previous schema and running the additive migration twice.
	if _, err = db.Exec("ALTER TABLE jobs DROP COLUMN reference_image, DROP COLUMN reference_mime"); err != nil {
		t.Fatal(err)
	}
	if err = migrate(ctx, db); err != nil {
		t.Fatal(err)
	}
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
			if files := r.MultipartForm.File["image[]"]; len(files) > 0 {
				if len(files) != 2 {
					t.Error("dual-image worker lost an input")
					return
				}
				for i, expected := range [][]byte{testPNG(), referencePNG()} {
					file, err := files[i].Open()
					if err != nil {
						t.Error(err)
						return
					}
					data, _ := io.ReadAll(file)
					file.Close()
					if !bytes.Equal(data, expected) {
						t.Error("worker reversed or corrupted images")
					}
				}
			}
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
	if err := bootstrapAdmin(ctx, db, "admin", "test-access"); err != nil {
		t.Fatal(err)
	}
	var adminID string
	if err := db.QueryRow("SELECT id FROM users WHERE username='admin'").Scan(&adminID); err != nil {
		t.Fatal(err)
	}
	token := newID() + newID()
	if _, err := db.Exec("INSERT INTO sessions(token_hash,user_id,user_version,expires_at) VALUES(?,?,1,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 1 DAY))", sessionHash(token), adminID); err != nil {
		t.Fatal(err)
	}
	a := &app{db: db, upstream: &provider{base: upstream.URL, key: "test-key", client: upstream.Client()}}
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
		r.AddCookie(&http.Cookie{Name: sessionCookie, Value: token})
		if contentType != "" {
			r.Header.Set("Content-Type", contentType)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}
	grant := request("POST", "/api/admin/users/"+adminID+"/credits", bytes.NewBufferString(`{"delta":1000,"note":"测试积分","request_id":"11111111111111111111111111111111"}`), "application/json")
	if grant.Code != 200 {
		t.Fatalf("grant credits: %s", grant.Body.String())
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
			ref, _ := writer.CreateFormFile("reference", "reference.png")
			_, _ = ref.Write(referencePNG())
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
		for _, variant := range []struct{ url, version string }{{j.Images[0].ThumbnailURL, thumbnailVersion}, {j.Images[0].PreviewURL, previewCacheVersion}} {
			if variant.url == "" {
				t.Fatal("missing thumbnail URL")
			}
			thumb := request("GET", variant.url, nil, "")
			if thumb.Code != 200 || thumb.Header().Get("Content-Type") != "image/webp" {
				t.Fatalf("thumbnail: %d %s", thumb.Code, thumb.Body.String())
			}
			var saved []byte
			if err := db.QueryRow("SELECT content FROM image_thumbnails WHERE image_id=? AND version=?", j.Images[0].ID, variant.version).Scan(&saved); err != nil || !bytes.Equal(saved, thumb.Body.Bytes()) {
				t.Fatal("thumbnail was not persisted", err)
			}
			fresh := &app{db: db, upstream: a.upstream}
			r := httptest.NewRequest("GET", variant.url, nil)
			r.AddCookie(&http.Cookie{Name: sessionCookie, Value: token})
			r.Header.Set("If-None-Match", thumb.Header().Get("ETag"))
			cached := httptest.NewRecorder()
			fresh.routes(fstest.MapFS{}).ServeHTTP(cached, r)
			if cached.Code != 304 || cached.Body.Len() != 0 {
				t.Fatalf("thumbnail cache after restart: %d", cached.Code)
			}
		}
		var renditions int
		if err := db.QueryRow("SELECT COUNT(*) FROM image_thumbnails WHERE image_id=?", j.Images[0].ID).Scan(&renditions); err != nil || renditions != 2 {
			t.Fatal("thumbnail and preview must persist independently", renditions, err)
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
	w = request("GET", "/api/jobs/"+editIDs[0]+"/reference", nil, "")
	if w.Code != 200 || !bytes.Equal(w.Body.Bytes(), referencePNG()) {
		t.Fatal("second image not persisted")
	}
	w = request("GET", "/api/jobs/"+editIDs[0], nil, "")
	var edited job
	if json.Unmarshal(w.Body.Bytes(), &edited) != nil || !edited.HasReference || !edited.HasInput || !strings.Contains(edited.EffectivePrompt, referenceEditPrompt) {
		t.Fatal("dual-image metadata lost")
	}
	testAccountWorkflow(t, db, h, successIDs[0], editIDs[0], adminID, token)
	testCreditsWorkflow(t, db, h, a, adminID, token)
	// A fresh app instance reads the same saved history after the old workers stop.
	a2 := &app{db: db, upstream: a.upstream}
	h = a2.routes(fstest.MapFS{"index.html": {Data: []byte("studio")}})
	w = request("GET", "/api/jobs/"+editIDs[0]+"/reference", nil, "")
	if w.Code != 200 || !bytes.Equal(w.Body.Bytes(), referencePNG()) {
		t.Fatal("second image lost across app restart")
	}
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
	// Reuse a saved output without downloading and uploading it through the browser.
	var sourceImageID string
	if err := db.QueryRow("SELECT id FROM images WHERE job_id=?", successIDs[0]).Scan(&sourceImageID); err != nil {
		t.Fatal(err)
	}
	var savedBody bytes.Buffer
	savedWriter := multipart.NewWriter(&savedBody)
	for k, v := range map[string]string{"mode": "edit", "model": "gpt-image-2", "prompt": "替换成参考图里的小猫", "count": "1", "ratio": "auto", "resolution": "default", "base_image_id": sourceImageID} {
		_ = savedWriter.WriteField(k, v)
	}
	ref, _ := savedWriter.CreateFormFile("reference", "reference.png")
	_, _ = ref.Write(referencePNG())
	_ = savedWriter.Close()
	w = request("POST", "/api/jobs", &savedBody, savedWriter.FormDataContentType())
	if w.Code != 202 {
		t.Fatalf("saved base image create: %d %s", w.Code, w.Body.String())
	}
	var saved struct{ IDs []string }
	if err := json.Unmarshal(w.Body.Bytes(), &saved); err != nil || len(saved.IDs) != 1 {
		t.Fatalf("saved base image response: %s", w.Body.String())
	}
	ids = append(ids, saved.IDs...)
	for endpoint, expected := range map[string][]byte{"input": testPNG(), "reference": referencePNG()} {
		w = request("GET", "/api/jobs/"+saved.IDs[0]+"/"+endpoint, nil, "")
		if w.Code != 200 || !bytes.Equal(w.Body.Bytes(), expected) {
			t.Fatalf("saved base image %s snapshot mismatch", endpoint)
		}
	}
}
