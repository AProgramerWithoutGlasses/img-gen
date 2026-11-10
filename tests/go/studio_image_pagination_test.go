package studio_test

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"

	studio "github.com/AProgramerWithoutGlasses/img-gen/internal/studio"
	"github.com/go-sql-driver/mysql"
)

func TestStudioImagePaginationMySQL(t *testing.T) {
	dsn := os.Getenv("TEST_MYSQL_DSN")
	if dsn == "" {
		t.Skip("set TEST_MYSQL_DSN to an empty dedicated _test database")
	}
	cfg, err := mysql.ParseDSN(dsn)
	if err != nil || !strings.HasSuffix(cfg.DBName, "_test") {
		t.Fatal("requires dedicated _test database")
	}
	cfg.ParseTime, cfg.Loc = true, time.UTC
	db, err := sql.Open("mysql", cfg.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	var tables int
	if err := db.QueryRow("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE()").Scan(&tables); err != nil || tables != 0 {
		t.Fatal("requires empty dedicated database", err)
	}
	t.Cleanup(func() {
		for _, table := range []string{"studio_image_folders", "studio_folders", "studio_batch_attachments", "studio_attachment_renditions", "studio_attachments", "studio_batch_jobs", "studio_batches", "credit_ledger", "model_prices", "job_image_previews", "image_thumbnails", "images", "jobs", "sessions", "users"} {
			if _, err := db.Exec("DROP TABLE IF EXISTS " + table); err != nil {
				t.Error(err)
			}
		}
	})
	if err := studio.Migrate(context.Background(), db); err != nil {
		t.Fatal(err)
	}
	if err := studio.BootstrapAdmin(context.Background(), db, "pagination-admin", "pagination-test-password"); err != nil {
		t.Fatal(err)
	}
	var actorID string
	if err := db.QueryRow("SELECT id FROM users WHERE username='pagination-admin'").Scan(&actorID); err != nil {
		t.Fatal(err)
	}
	const foreignID = "ffffffffffffffffffffffffffffffff"
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := db.Exec(query, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec("INSERT INTO users(id,username,password_hash,role,active) VALUES(?,?,?,'user',TRUE)", foreignID, "pagination-other", studio.HashPassword("pagination-other-password"))
	base := time.Date(2026, 11, 1, 0, 0, 0, 0, time.UTC)
	batchID := func(n int) string { return fmt.Sprintf("%032x", 1000+n) }
	jobID := func(n, output int) string { return fmt.Sprintf("%032x", 100000+n*10+output) }
	imageID := func(n, output int) string { return fmt.Sprintf("%032x", 200000+n*10+output) }
	insertBatch := func(n, outputs int, owner string, active bool) {
		t.Helper()
		options, _ := json.Marshal(studio.GenerationOptions{ModelID: "gpt-image-2", Ratio: "自动", Count: outputs})
		exec("INSERT INTO studio_batches(id,user_id,options,fingerprint) VALUES(?,?,?,?)", batchID(n), owner, options, strings.Repeat("0", 64))
		for output := 0; output < outputs; output++ {
			status := "succeeded"
			if active && output == outputs-1 {
				status = "running"
			}
			exec(`INSERT INTO jobs(id,batch_id,mode,model,prompt,effective_prompt,ratio,resolution,status,error,user_id,created_at)
				VALUES(?,?,'generate','gpt-image-2',?,'prompt','auto','default',?,'',?,?)`, jobID(n, output), batchID(n), fmt.Sprintf("batch-%d", n), status, owner, base.Add(time.Duration(n)*time.Minute))
			exec("INSERT INTO studio_batch_jobs(batch_id,job_id,output_index) VALUES(?,?,?)", batchID(n), jobID(n, output), output)
			if status == "succeeded" {
				exec("INSERT INTO images(id,job_id,mime,width,height,byte_size,content) VALUES(?,?,'image/png',10,20,1,?)", imageID(n, output), jobID(n, output), []byte{0})
			}
		}
	}
	for n := 0; n < 55; n++ {
		outputs := 1
		if n == 0 {
			outputs = 2
		}
		if n == 54 {
			outputs = 4
		}
		insertBatch(n, outputs, actorID, n == 0)
	}
	insertBatch(90, 1, foreignID, false)
	// Legacy records have no studio_batches row and need the same reconstructed
	// count, batch ID and output slots in both endpoints.
	legacyBatch := fmt.Sprintf("%032x", 900)
	for output := 0; output < 2; output++ {
		jid, iid := fmt.Sprintf("%032x", 90000+output), fmt.Sprintf("%032x", 190000+output)
		exec(`INSERT INTO jobs(id,batch_id,mode,model,prompt,effective_prompt,ratio,resolution,status,error,user_id,created_at)
			VALUES(?,?,'generate','gpt-image-2','legacy','legacy','auto','default','succeeded','',?,?)`, jid, legacyBatch, actorID, base.Add(-time.Hour))
		exec("INSERT INTO images(id,job_id,mime,width,height,byte_size,content) VALUES(?,?,'image/png',10,20,1,?)", iid, jid, []byte{0})
	}
	folderID, foreignFolder := strings.Repeat("a", 32), strings.Repeat("b", 32)
	exec("INSERT INTO studio_folders(id,user_id,name) VALUES(?,?,'own'),(?,?,'foreign')", folderID, actorID, foreignFolder, foreignID)
	for output := 0; output < 4; output++ {
		exec("INSERT INTO studio_image_folders(image_id,folder_id) VALUES(?,?)", imageID(54, output), folderID)
	}
	server := httptest.NewServer((&studio.App{DB: db}).Handler(nil))
	t.Cleanup(server.Close)
	jar, _ := cookiejar.New(nil)
	client := &http.Client{Jar: jar}
	request := func(method, path string, body any, want int, result any) {
		t.Helper()
		var reader io.Reader
		if body != nil {
			raw, _ := json.Marshal(body)
			reader = bytes.NewReader(raw)
		}
		req, _ := http.NewRequest(method, server.URL+path, reader)
		if body != nil {
			req.Header.Set("Content-Type", "application/json")
		}
		response, err := client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		raw, _ := io.ReadAll(response.Body)
		if response.StatusCode != want {
			t.Fatalf("%s %s: got %d want %d: %s", method, path, response.StatusCode, want, raw)
		}
		if result != nil {
			if err := json.Unmarshal(raw, result); err != nil {
				t.Fatal(err)
			}
		}
	}
	request("POST", "/api/auth/login", map[string]string{"username": "pagination-admin", "password": "pagination-test-password"}, 200, nil)
	type page struct {
		Images     []studio.Asset `json:"images"`
		Total      int            `json:"total"`
		NextCursor string         `json:"nextCursor"`
	}
	type snapshot struct {
		Assets       []studio.Asset      `json:"assets"`
		Generations  []studio.Generation `json:"generations"`
		ImageSummary struct {
			Total        int            `json:"total"`
			FolderCounts map[string]int `json:"folderCounts"`
		} `json:"imageSummary"`
	}
	var full snapshot
	request("GET", "/api/studio/state", nil, 200, &full)
	expected := map[string]studio.Asset{}
	for _, asset := range full.Assets {
		if asset.UserID == actorID {
			expected[asset.ID] = asset
		}
	}
	if len(expected) != 60 {
		t.Fatalf("fixture should contain 60 own images, got %d", len(expected))
	}
	var first page
	request("GET", "/api/studio/images?limit=999", nil, 200, &first)
	if len(first.Images) != 50 || first.Total != 60 || first.NextCursor == "" {
		t.Fatalf("first page should stop at 50 with an accurate total: %+v", first)
	}
	insertBatch(55, 1, actorID, false)
	var second page
	request("GET", "/api/studio/images?cursor="+url.QueryEscape(first.NextCursor), nil, 200, &second)
	if len(second.Images) != 10 || second.Total != 61 || second.NextCursor != "" {
		t.Fatalf("cursor should retain all 10 old remaining images after an insertion: %+v", second)
	}
	seen := map[string]bool{}
	for _, image := range append(first.Images, second.Images...) {
		want, ok := expected[image.ID]
		if !ok || seen[image.ID] || !reflect.DeepEqual(image, want) {
			t.Fatalf("duplicate, foreign, new or incompatible image metadata: %s", image.ID)
		}
		seen[image.ID] = true
	}
	if len(seen) != len(expected) {
		t.Fatal("pagination omitted old images")
	}
	var folderPage, unfiledPage page
	request("GET", "/api/studio/images?folderId="+folderID, nil, 200, &folderPage)
	request("GET", "/api/studio/images?folderId=unfiled", nil, 200, &unfiledPage)
	if folderPage.Total != 4 || len(folderPage.Images) != 4 || unfiledPage.Total != 57 {
		t.Fatal("folder totals should describe the whole collection")
	}
	request("GET", "/api/studio/images?folderId="+foreignFolder, nil, 404, nil)
	request("GET", "/api/studio/images?cursor=bad-cursor", nil, 400, nil)
	request("GET", "/api/studio/images?limit=0", nil, 400, nil)
	var workspace snapshot
	request("GET", "/api/studio/state?view=workspace", nil, 200, &workspace)
	if len(workspace.Generations) != 11 || workspace.ImageSummary.Total != 61 || workspace.ImageSummary.FolderCounts[folderID] != 4 {
		t.Fatalf("workspace should contain 10 recent plus one older active batch and global counts: %+v", workspace.ImageSummary)
	}
	foundActive, foundFour := false, false
	for _, generation := range workspace.Generations {
		if generation.UserID != actorID {
			t.Fatal("admin workspace included another user's history")
		}
		if generation.ID == batchID(0) {
			foundActive = generation.Status == "processing" && len(generation.Outputs) == 2 && len(generation.ImageIDs) == 1
		}
		if generation.ID == batchID(54) {
			foundFour = len(generation.Outputs) == 4 && len(generation.ImageIDs) == 4
		}
	}
	if !foundActive || !foundFour {
		t.Fatal("workspace truncated a batch or omitted the older active generation")
	}
	exec("UPDATE jobs SET status='failed',finished_at=? WHERE id=?", base.Add(2*time.Hour), jobID(0, 1))
	var completed snapshot
	request("GET", "/api/studio/state?view=workspace&watch="+batchID(0)+","+batchID(90), nil, 200, &completed)
	terminal := false
	for _, generation := range completed.Generations {
		if generation.UserID != actorID {
			t.Fatal("watch bypassed ownership")
		}
		if generation.ID == batchID(0) {
			terminal = generation.Status == "failed" && len(generation.Outputs) == 2
		}
	}
	if !terminal {
		t.Fatal("watch lost the old generation's final state")
	}
	request("GET", "/api/studio/state?view=workspace&watch=invalid", nil, 400, nil)
}
