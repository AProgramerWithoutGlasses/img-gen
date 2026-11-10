package studio_test

import studio "github.com/AProgramerWithoutGlasses/img-gen/internal/studio"

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	webassets "github.com/AProgramerWithoutGlasses/img-gen/web"
	"io"
	"io/fs"
	"mime/multipart"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"os"
	"os/exec"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/go-sql-driver/mysql"
)

func TestStudioMySQLWorkflow(t *testing.T) {
	dsn := os.Getenv("TEST_MYSQL_DSN")
	if dsn == "" {
		t.Skip("set TEST_MYSQL_DSN to an empty dedicated _test database")
	}
	cfg, err := mysql.ParseDSN(dsn)
	if err != nil || !strings.HasSuffix(cfg.DBName, "_test") {
		t.Fatal("requires dedicated _test database")
	}
	cfg.ParseTime = true
	cfg.Loc = time.UTC
	DB, err := sql.Open("mysql", cfg.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { DB.Close() })
	var tables int
	if err = DB.QueryRow("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE()").Scan(&tables); err != nil || tables != 0 {
		t.Fatal("requires empty dedicated database", err)
	}
	t.Cleanup(func() {
		for _, table := range []string{"studio_image_folders", "studio_folders", "studio_batch_attachments", "studio_attachment_renditions", "studio_attachments", "studio_batch_jobs", "studio_batches", "credit_ledger", "model_prices", "job_image_previews", "image_thumbnails", "images", "jobs", "sessions", "users"} {
			if _, err := DB.Exec("DROP TABLE IF EXISTS " + table); err != nil {
				t.Error(err)
			}
		}
	})
	if err = studio.Migrate(context.Background(), DB); err != nil {
		t.Fatal(err)
	}
	if err = studio.Migrate(context.Background(), DB); err != nil {
		t.Fatal("migration must be repeatable", err)
	}
	if err = studio.BootstrapAdmin(context.Background(), DB, "admin", "integration1234"); err != nil {
		t.Fatal(err)
	}
	if _, err = DB.Exec("UPDATE users SET credits=1000"); err != nil {
		t.Fatal(err)
	}
	var calls atomic.Int32
	var partialCalls atomic.Int32
	partialSuccess := make(chan struct{})
	Upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		prompt := ""
		gemini := strings.Contains(r.URL.Path, "generateContent")
		if gemini {
			var payload struct {
				Contents []struct {
					Parts []struct {
						Text       string `json:"text"`
						InlineData *struct {
							MIME string `json:"mimeType"`
							Data string `json:"data"`
						} `json:"inlineData"`
					} `json:"parts"`
				} `json:"contents"`
				Config struct {
					Image map[string]string `json:"imageConfig"`
				} `json:"generationConfig"`
			}
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				t.Error(err)
				w.WriteHeader(500)
				return
			}
			prompt = payload.Contents[0].Parts[0].Text
			if strings.Contains(prompt, "six-inputs") {
				if len(payload.Contents[0].Parts) != 7 || len(payload.Config.Image) != 0 {
					t.Error("Gemini lost requested inputs/controls")
				}
			}
		} else if strings.Contains(r.Header.Get("Content-Type"), "multipart") {
			if err := r.ParseMultipartForm(1 << 20); err != nil {
				t.Error(err)
				return
			}
			defer r.MultipartForm.RemoveAll()
			prompt = r.FormValue("prompt")
			if strings.Contains(prompt, "six-inputs") && (len(r.MultipartForm.File["image[]"]) != 6 || r.FormValue("quality") != "" || r.FormValue("size") != "") {
				t.Error("GPT lost requested inputs/controls")
			}
		} else {
			var payload map[string]string
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				t.Error(err)
			}
			prompt = payload["prompt"]
			if strings.Contains(prompt, "partial") && (payload["quality"] != "" || payload["size"] != "") {
				t.Error("GPT controls not forwarded")
			}
		}
		if strings.Contains(prompt, "partial") {
			if partialCalls.Add(1)%2 == 0 {
				w.WriteHeader(503)
				return
			}
			select {
			case <-partialSuccess:
			case <-r.Context().Done():
				return
			}
		}
		encoded := base64.StdEncoding.EncodeToString(testPNG())
		if gemini {
			jsonResponse(w, 200, map[string]any{"candidates": []any{map[string]any{"content": map[string]any{"parts": []any{map[string]any{"inlineData": map[string]string{"data": encoded}}}}}}})
			return
		}
		jsonResponse(w, 200, map[string]any{"data": []any{map[string]string{"b64_json": encoded}}, "quality": "low"})
	}))
	defer Upstream.Close()
	a := &studio.App{DB: DB, Upstream: &studio.Provider{Base: Upstream.URL, Key: "integration-only", Client: Upstream.Client()}}
	static, err := fs.Sub(webassets.Files, "studio")
	if os.Getenv("STUDIO_BROWSER_CHECK") == "1" {
		if err != nil {
			t.Fatal(err)
		}
		if _, err := fs.Stat(static, "index.html"); err != nil {
			t.Fatal("build:server must run before the browser test", err)
		}
	}
	server := httptest.NewServer(a.Handler(static))
	defer server.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer func() { cancel(); a.WaitWorkers() }()
	jar, _ := cookiejar.New(nil)
	Client := &http.Client{Jar: jar}
	request := func(c *http.Client, method, path string, body any, want int) []byte {
		t.Helper()
		var reader io.Reader
		if body != nil {
			raw, _ := json.Marshal(body)
			reader = bytes.NewReader(raw)
		}
		r, _ := http.NewRequest(method, server.URL+path, reader)
		if body != nil {
			r.Header.Set("Content-Type", "application/json")
		}
		res, err := c.Do(r)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		raw, _ := io.ReadAll(res.Body)
		if res.StatusCode != want {
			t.Fatalf("%s %s: %d want %d: %s", method, path, res.StatusCode, want, raw)
		}
		return raw
	}
	state := func(c *http.Client) struct {
		Version     int
		Assets      []studio.Asset
		Generations []studio.Generation
		Users       []studio.StudioUser
		Folders     []studio.Folder
	} {
		t.Helper()
		var s struct {
			Version     int
			Assets      []studio.Asset
			Generations []studio.Generation
			Users       []studio.StudioUser
			Folders     []studio.Folder
		}
		if err := json.Unmarshal(request(c, "GET", "/api/studio/state", nil, 200), &s); err != nil {
			t.Fatal(err)
		}
		return s
	}
	request(Client, "GET", "/api/studio/state", nil, 401)
	request(Client, "POST", "/api/auth/login", map[string]string{"username": "admin", "password": "integration1234"}, 200)
	opts := studio.GenerationOptions{ModelID: "gpt-image-2", Ratio: "自动", Count: 2}
	bid := studio.NewID()
	body := map[string]any{"prompt": "partial", "attachmentIds": []string{}, "options": opts, "requestId": bid, "expectedCredits": 2}
	request(Client, "POST", "/api/studio/generations", body, 202)
	request(Client, "POST", "/api/studio/generations", body, 200)
	bad := map[string]any{}
	for k, v := range body {
		bad[k] = v
	}
	bad["prompt"] = "changed"
	request(Client, "POST", "/api/studio/generations", bad, 409)
	queued := state(Client)
	if queued.Version != 1 || len(queued.Generations) != 1 || len(queued.Generations[0].Outputs) != 2 {
		t.Fatalf("single-output state or version missing: %+v", queued)
	}
	for i, output := range queued.Generations[0].Outputs {
		if output.OutputIndex != i || output.Status != "queued" || output.StartedAt != nil || output.FinishedAt != nil {
			t.Fatalf("queued output should not have started: %+v", output)
		}
	}
	for range 2 {
		a.StartWorkers(ctx, 1)
	}
	// Hold the successful fixture response so a failed slot must be visible while
	// its sibling is genuinely running, without inventing an upstream percentage.
	deadline := time.Now().Add(10 * time.Second)
	for {
		s := state(Client)
		running, failed := 0, 0
		for _, output := range s.Generations[0].Outputs {
			switch output.Status {
			case "running":
				running++
				if output.StartedAt == nil || output.FinishedAt != nil {
					t.Fatal("running output timestamps invalid", output)
				}
			case "failed":
				failed++
				if output.StartedAt == nil || output.FinishedAt == nil {
					t.Fatal("failed output timestamps missing", output)
				}
			}
		}
		if running == 1 && failed == 1 {
			if s.Generations[0].Status != "processing" || len(s.Assets) != 0 {
				t.Fatal("partial failure must preserve the active batch", s)
			}
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("single-output failure was hidden until the whole batch ended", s)
		}
		time.Sleep(50 * time.Millisecond)
	}
	close(partialSuccess)
	deadline = time.Now().Add(10 * time.Second)
	for {
		s := state(Client)
		if len(s.Generations) == 1 && s.Generations[0].Status != "processing" {
			if s.Generations[0].Status != "failed" || len(s.Assets) != 1 || s.Generations[0].Cost != 1 || s.Users[0].Balance != 999 || s.Generations[0].Error == "" {
				t.Fatalf("partial result/settlement lost: %+v", s)
			}
			for i, output := range s.Generations[0].Outputs {
				if output.OutputIndex != i || output.StartedAt == nil || output.FinishedAt == nil || output.StartedAt.After(*output.FinishedAt) {
					t.Fatalf("finished output order/timing lost: %+v", output)
				}
				if (output.Status == "succeeded") != (s.Assets[0].OutputIndex == output.OutputIndex) {
					t.Fatalf("result attached to the wrong output status: %+v", s)
				}
			}
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("workers did not finish")
		}
		time.Sleep(50 * time.Millisecond)
	}
	if calls.Load() != 2 {
		t.Fatal("duplicate submission or upstream retry", calls.Load())
	}
	s := state(Client)
	imageID := s.Assets[0].ID
	folder := func(name string) studio.Folder {
		t.Helper()
		var f studio.Folder
		json.Unmarshal(request(Client, "POST", "/api/studio/folders", map[string]string{"name": name}, 201), &f)
		return f
	}
	f1, f2 := folder("一"), folder("二")
	request(Client, "POST", "/api/studio/folders", map[string]string{"name": "一"}, 409)
	memberships := map[string]any{"imageIds": []string{imageID}, "folderIds": []string{f1.ID, f2.ID}, "remove": false}
	request(Client, "POST", "/api/studio/folder-memberships", memberships, 200)
	request(Client, "POST", "/api/studio/folder-memberships", memberships, 200)
	if len(state(Client).Assets[0].FolderIDs) != 2 {
		t.Fatal("membership duplicated/lost")
	}
	request(Client, "POST", "/api/studio/folder-memberships", map[string]any{"imageIds": []string{imageID}, "folderIds": []string{f1.ID}, "remove": true}, 200)
	if got := state(Client).Assets[0].FolderIDs; len(got) != 1 || got[0] != f2.ID {
		t.Fatal("removing one membership removed another")
	}
	request(Client, "POST", "/api/studio/folder-memberships", memberships, 200)
	request(Client, "DELETE", "/api/studio/folders/"+f1.ID, nil, 200)
	s = state(Client)
	if len(s.Assets) != 1 || len(s.Assets[0].FolderIDs) != 1 || s.Assets[0].FolderIDs[0] != f2.ID {
		t.Fatal("deleting folder removed image/other membership")
	}
	var other struct{ ID string }
	json.Unmarshal(request(Client, "POST", "/api/admin/users", map[string]any{"username": "other", "password": "integration1234", "role": "user", "active": true}, 201), &other)
	jar2, _ := cookiejar.New(nil)
	second := &http.Client{Jar: jar2}
	request(second, "POST", "/api/auth/login", map[string]string{"username": "other", "password": "integration1234"}, 200)
	if len(state(second).Assets) != 0 || len(state(second).Generations) != 0 || len(state(second).Users) != 1 {
		t.Fatal("snapshot leaks another account")
	}
	request(second, "POST", "/api/studio/folder-memberships", memberships, 404)
	request(second, "GET", "/api/images/"+imageID, nil, 404)
	request(second, "GET", "/api/admin/users", nil, 403)
	request(Client, "POST", "/api/admin/users", map[string]any{"username": "disabled_user", "password": "integration1234", "role": "user", "active": false}, 201)
	request(second, "POST", "/api/auth/login", map[string]string{"username": "disabled_user", "password": "integration1234"}, 401)
	attachmentIDs := []string{}
	var firstAttachment studio.Attachment
	for range 6 {
		var buf bytes.Buffer
		writer := multipart.NewWriter(&buf)
		part, _ := writer.CreateFormFile("image", "input.png")
		part.Write(testPNG())
		writer.Close()
		r, _ := http.NewRequest("POST", server.URL+"/api/studio/attachments", &buf)
		r.Header.Set("Content-Type", writer.FormDataContentType())
		res, err := Client.Do(r)
		if err != nil {
			t.Fatal(err)
		}
		raw, _ := io.ReadAll(res.Body)
		res.Body.Close()
		if res.StatusCode != 201 {
			t.Fatal(string(raw))
		}
		var att studio.Attachment
		json.Unmarshal(raw, &att)
		if len(attachmentIDs) == 0 {
			firstAttachment = att
		}
		attachmentIDs = append(attachmentIDs, att.ID)
	}
	// Historical attachments create display copies only when visited; originals
	// and submission inputs remain unchanged after all three renditions exist.
	var cacheCount int
	if err = DB.QueryRow("SELECT COUNT(*) FROM studio_attachment_renditions WHERE attachment_id=?", firstAttachment.ID).Scan(&cacheCount); err != nil || cacheCount != 0 {
		t.Fatal("upload must not eagerly encode display copies", cacheCount, err)
	}
	for _, url := range []string{firstAttachment.ThumbnailURL, firstAttachment.PreviewURL, firstAttachment.PreviewLargeURL} {
		if url == "" {
			t.Fatal("upload omitted rendition URL")
		}
		res, err := Client.Get(server.URL + url)
		if err != nil {
			t.Fatal(err)
		}
		data, _ := io.ReadAll(res.Body)
		res.Body.Close()
		if res.StatusCode != 200 || res.Header.Get("Content-Type") != "image/webp" || len(data) == 0 {
			t.Fatal("rendition was not generated", res.StatusCode)
		}
		etag := res.Header.Get("ETag")
		req, _ := http.NewRequest("GET", server.URL+url, nil)
		req.Header.Set("If-None-Match", etag)
		res, err = Client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		data, _ = io.ReadAll(res.Body)
		res.Body.Close()
		if res.StatusCode != 304 || len(data) != 0 {
			t.Fatal("rendition did not revalidate", res.StatusCode)
		}
		request(second, "GET", url, nil, 404)
	}
	if err = DB.QueryRow("SELECT COUNT(*) FROM studio_attachment_renditions WHERE attachment_id=?", firstAttachment.ID).Scan(&cacheCount); err != nil || cacheCount != 3 {
		t.Fatal("rendition cache did not persist independently", cacheCount, err)
	}
	if original := request(Client, "GET", firstAttachment.URL, nil, 200); !bytes.Equal(original, testPNG()) {
		t.Fatal("display compression changed original")
	}
	opts = studio.GenerationOptions{ModelID: "gemini-3.1-flash-image", Ratio: "自动", Count: 1}
	six := map[string]any{"prompt": "six-inputs", "attachmentIds": attachmentIDs, "options": opts, "requestId": studio.NewID(), "expectedCredits": 1}
	request(Client, "POST", "/api/studio/generations", six, 202)
	six["requestId"] = studio.NewID()
	request(second, "POST", "/api/studio/generations", six, 404)
	request(second, "GET", "/api/studio/attachments/"+attachmentIDs[0], nil, 404)
	opts = studio.GenerationOptions{ModelID: "gpt-image-2", Ratio: "自动", Count: 2}
	six["options"] = opts
	six["requestId"] = studio.NewID()
	six["expectedCredits"] = 2
	request(Client, "POST", "/api/studio/generations", six, 202)
	deadline = time.Now().Add(10 * time.Second)
	for {
		allDone := true
		for _, g := range state(Client).Generations {
			allDone = allDone && g.Status != "processing"
		}
		if allDone {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("six-input tasks did not finish")
		}
		time.Sleep(50 * time.Millisecond)
	}
	orderedBatch := six["requestId"].(string)
	// Output order survives a later refresh even when job timestamps sort differently.
	if _, err := DB.Exec("UPDATE jobs JOIN studio_batch_jobs bj ON bj.job_id=jobs.id SET jobs.created_at=IF(bj.output_index=0,'2020-01-02 00:00:00','2020-01-01 00:00:00') WHERE bj.batch_id=?", orderedBatch); err != nil {
		t.Fatal(err)
	}
	var expectedFirst string
	if err := DB.QueryRow("SELECT images.id FROM images JOIN studio_batch_jobs bj ON bj.job_id=images.job_id WHERE bj.batch_id=? AND bj.output_index=0", orderedBatch).Scan(&expectedFirst); err != nil {
		t.Fatal(err)
	}
	for _, g := range state(Client).Generations {
		if g.ID == orderedBatch && (len(g.ImageIDs) != 2 || g.ImageIDs[0] != expectedFirst) {
			t.Fatal("refresh reordered batch outputs")
		}
		if g.ID == orderedBatch {
			if len(g.Outputs) != 2 || g.Outputs[0].OutputIndex != 0 || g.Outputs[1].OutputIndex != 1 || g.Outputs[0].Status != "succeeded" || g.Outputs[1].Status != "succeeded" {
				t.Fatal("refresh reordered per-output status", g.Outputs)
			}
		}
	}
	// Reusing a generated result as an attachment must preserve the original.
	opts.Count = 1
	six["options"] = opts
	six["expectedCredits"] = 1
	six["attachmentIds"] = []string{imageID}
	six["requestId"] = studio.NewID()
	six["prompt"] = "reuse"
	request(Client, "POST", "/api/studio/generations", six, 202)
	var count int
	if err = DB.QueryRow("SELECT COUNT(*) FROM images WHERE id=?", imageID).Scan(&count); err != nil || count != 1 {
		t.Fatal("result reuse removed original")
	}
	if os.Getenv("STUDIO_BROWSER_CHECK") == "1" {
		command := exec.Command("node", "tests/e2e/integration-check.mjs", server.URL)
		command.Dir = "../../frontend"
		command.Env = append(os.Environ(), "STUDIO_TEST_PASSWORD=integration1234")
		output, err := command.CombinedOutput()
		if err != nil {
			t.Fatalf("real browser workflow: %v\n%s", err, output)
		}
		t.Log(string(output))
	}
	// Bulk metadata must keep every image past one UI page and keep the same
	// ownership boundary for both administrator and ordinary-user snapshots.
	adminBefore := len(state(Client).Assets)
	for range 40 {
		jid, iid := studio.NewID(), studio.NewID()
		if _, err := DB.Exec(`INSERT INTO jobs(id,batch_id,mode,model,prompt,effective_prompt,ratio,resolution,status,error,user_id)
			VALUES(?,?,'generate','gpt-image-2','bulk fixture','bulk fixture','auto','default','succeeded','',?)`, jid, studio.NewID(), other.ID); err != nil {
			t.Fatal(err)
		}
		if _, err := DB.Exec("INSERT INTO images(id,job_id,mime,width,height,byte_size,content) VALUES(?,?,'image/png',1,1,?,?)", iid, jid, len(testPNG()), testPNG()); err != nil {
			t.Fatal(err)
		}
	}
	personal := state(second)
	if len(personal.Assets) != 40 || len(personal.Generations) != 40 {
		t.Fatalf("bulk history lost images: %d assets, %d generations", len(personal.Assets), len(personal.Generations))
	}
	for _, asset := range personal.Assets {
		if asset.UserID != other.ID || asset.ThumbnailURL == "" || asset.PreviewURL == "" {
			t.Fatal("bulk history leaked ownership or lost rendition URLs")
		}
	}
	if got := len(state(Client).Assets); got != adminBefore+40 {
		t.Fatalf("administrator history lost images: got %d want %d", got, adminBefore+40)
	}
	// Verify server-controlled password/session invalidation, not a local UI toggle.
	request(second, "POST", "/api/auth/password", map[string]string{"current_password": "integration1234", "password": "replacement1234"}, 200)
	request(second, "GET", "/api/studio/state", nil, 401)
	t.Logf("real MySQL + HTTP passed; upstream protocol fixture calls=%d; static=embedded web/studio", calls.Load())
}
