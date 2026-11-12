package studio_test

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"

	studio "github.com/AProgramerWithoutGlasses/img-gen/internal/studio"
	"github.com/go-sql-driver/mysql"
)

func TestStudioImageTrashMySQL(t *testing.T) {
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
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := db.Exec(query, args...); err != nil {
			t.Fatal(err)
		}
	}
	if err := studio.Migrate(context.Background(), db); err != nil {
		t.Fatal(err)
	}
	if err := studio.BootstrapAdmin(context.Background(), db, "trash-admin", "trash-test-password"); err != nil {
		t.Fatal(err)
	}
	var owner string
	if err := db.QueryRow("SELECT id FROM users WHERE username='trash-admin'").Scan(&owner); err != nil {
		t.Fatal(err)
	}
	foreign := studio.NewID()
	exec("INSERT INTO users(id,username,password_hash,role,active) VALUES(?,?,?,'user',TRUE)", foreign, "trash-other", studio.HashPassword("trash-other-password"))
	type outputFixture struct{ image, job, batch string }
	seed := func(uid string, cost int) outputFixture {
		t.Helper()
		f := outputFixture{studio.NewID(), studio.NewID(), studio.NewID()}
		options, _ := json.Marshal(studio.GenerationOptions{ModelID: "gpt-image-2", Ratio: "自动", Count: 1})
		exec("INSERT INTO studio_batches(id,user_id,options,fingerprint) VALUES(?,?,?,?)", f.batch, uid, options, strings.Repeat("0", 64))
		exec(`INSERT INTO jobs(id,batch_id,mode,model,prompt,effective_prompt,ratio,resolution,status,error,user_id,credits_cost,credits_state,started_at,finished_at)
			VALUES(?,?,'generate','gpt-image-2','fixture','fixture','auto','default','succeeded','',?,?,'charged',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, f.job, f.batch, uid, cost)
		exec("INSERT INTO studio_batch_jobs(batch_id,job_id,output_index) VALUES(?,?,0)", f.batch, f.job)
		exec("INSERT INTO images(id,job_id,mime,width,height,byte_size,content) VALUES(?,?,'image/png',1,1,?,?)", f.image, f.job, len(testPNG()), testPNG())
		exec("INSERT INTO credit_ledger(user_id,request_key,kind,delta,balance_after,job_id) VALUES(?,?,'charge',0,980,?)", uid, "charge:"+f.job, f.job)
		return f
	}
	one, two, three := seed(owner, 7), seed(owner, 11), seed(owner, 2)
	other := seed(foreign, 5)
	exec("UPDATE users SET credits=980 WHERE id=?", owner)
	// Upgrade from a pre-trash database with existing charged jobs and bytes,
	// including a partially applied migration, then repeat it unchanged.
	exec("ALTER TABLE images DROP COLUMN trashed_at, DROP COLUMN purged_at")
	if err := studio.Migrate(context.Background(), db); err != nil {
		t.Fatal(err)
	}
	exec("ALTER TABLE images DROP COLUMN purged_at")
	for range 2 {
		if err := studio.Migrate(context.Background(), db); err != nil {
			t.Fatal(err)
		}
	}
	folder := studio.NewID()
	exec("INSERT INTO studio_folders(id,user_id,name) VALUES(?,?,'original folder')", folder, owner)
	for _, id := range []string{one.image, two.image} {
		exec("INSERT INTO studio_image_folders(image_id,folder_id) VALUES(?,?)", id, folder)
	}
	app := &studio.App{DB: db, Upstream: &studio.Provider{Key: "local-fixture-only"}}
	server := httptest.NewServer(app.Handler(nil))
	t.Cleanup(server.Close)
	newClient := func() *http.Client {
		jar, _ := cookiejar.New(nil)
		return &http.Client{Jar: jar}
	}
	client, second := newClient(), newClient()
	request := func(c *http.Client, method, path string, body any, status int, result any) []byte {
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
		if res.StatusCode != status {
			t.Fatalf("%s %s: got %d want %d: %s", method, path, res.StatusCode, status, raw)
		}
		if result != nil {
			if err := json.Unmarshal(raw, result); err != nil {
				t.Fatal(err)
			}
		}
		return raw
	}
	mutate := func(c *http.Client, action string, ids []string, status int) {
		t.Helper()
		request(c, "POST", "/api/studio/images/"+action, map[string]any{"imageIds": ids}, status, nil)
	}
	type snapshot struct {
		Assets       []studio.Asset
		Generations  []studio.Generation
		ImageSummary struct {
			Total, TrashTotal int
			FolderCounts      map[string]int
		}
	}
	state := func() snapshot {
		t.Helper()
		var s snapshot
		request(client, "GET", "/api/studio/state?view=workspace", nil, 200, &s)
		return s
	}
	type imagePage struct {
		Images     []studio.Asset
		Total      int
		NextCursor string
	}
	page := func(c *http.Client, query string) imagePage {
		t.Helper()
		var p imagePage
		request(c, "GET", "/api/studio/images"+query, nil, 200, &p)
		return p
	}
	request(client, "POST", "/api/studio/images/trash", map[string]any{"imageIds": []string{one.image}}, 401, nil)
	request(client, "POST", "/api/auth/login", map[string]string{"username": "trash-admin", "password": "trash-test-password"}, 200, nil)
	request(second, "POST", "/api/auth/login", map[string]string{"username": "trash-other", "password": "trash-other-password"}, 200, nil)
	if s := state(); s.ImageSummary.Total != 3 || s.ImageSummary.TrashTotal != 0 || s.ImageSummary.FolderCounts[folder] != 2 {
		t.Fatal("migration lost images or memberships", s)
	}
	// Reuse materializes the old image as a durable batch input before deletion.
	edit := map[string]any{"prompt": "snapshot fixture", "attachmentIds": []string{one.image}, "options": studio.GenerationOptions{ModelID: "gpt-image-2", Ratio: "自动", Count: 1}, "requestId": studio.NewID(), "expectedCredits": 1}
	request(client, "POST", "/api/studio/generations", edit, 202, nil)
	ledgerBefore := request(client, "GET", "/api/credits/ledger", nil, 200, nil)
	var balanceBefore int64
	if err := db.QueryRow("SELECT credits FROM users WHERE id=?", owner).Scan(&balanceBefore); err != nil {
		t.Fatal(err)
	}
	baseline := state()
	checkAccounting := func() {
		t.Helper()
		var balance int64
		if err := db.QueryRow("SELECT credits FROM users WHERE id=?", owner).Scan(&balance); err != nil {
			t.Fatal(err)
		}
		if balance != balanceBefore || !bytes.Equal(ledgerBefore, request(client, "GET", "/api/credits/ledger", nil, 200, nil)) {
			t.Fatal("image operation changed balance or independent ledger")
		}
		var before, after []struct {
			ID, Status string
			Cost       int64
		}
		for _, g := range baseline.Generations {
			before = append(before, struct {
				ID, Status string
				Cost       int64
			}{g.ID, g.Status, g.Cost})
		}
		for _, g := range state().Generations {
			after = append(after, struct {
				ID, Status string
				Cost       int64
			}{g.ID, g.Status, g.Cost})
		}
		if !reflect.DeepEqual(before, after) {
			t.Fatal("image deletion changed generation accounting", before, after)
		}
	}
	t.Run("input-validation-ownership-and-atomicity", func(t *testing.T) {
		mutate(client, "trash", nil, 400)
		mutate(client, "trash", []string{"invalid"}, 400)
		mutate(client, "trash", make([]string, 501), 400)
		for _, action := range []string{"trash", "restore", "purge"} {
			mutate(second, action, []string{one.image}, 404)
			mutate(client, action, []string{other.image}, 404) // Administrator mutations remain personal.
		}
		mutate(client, "trash", []string{one.image, other.image}, 404)
		mutate(client, "trash", []string{one.image, studio.NewID()}, 404)
		mutate(client, "purge", []string{three.image}, 409)
		if s := state(); len(s.Assets) != 3 || s.ImageSummary.TrashTotal != 0 {
			t.Fatal("failed batch mutated a valid member", s)
		}
		request(client, "GET", "/api/studio/images?view=unknown", nil, 400, nil)
		request(client, "GET", "/api/studio/images?view=trash&folderId="+folder, nil, 400, nil)
	})
	t.Run("trash-restore-and-pagination", func(t *testing.T) {
		mutate(client, "trash", []string{one.image, two.image, one.image}, 200)
		mutate(client, "trash", []string{one.image}, 200)
		s := state()
		if len(s.Assets) != 1 || s.Assets[0].ID != three.image || s.ImageSummary.Total != 1 || s.ImageSummary.TrashTotal != 2 || s.ImageSummary.FolderCounts[folder] != 0 {
			t.Fatal("trash leaked into workspace or counts", s)
		}
		for _, g := range s.Generations {
			if g.ID == one.batch && (len(g.ImageIDs) != 0 || g.Outputs[0].Status != "succeeded" || g.Outputs[0].ImageState != "trashed") {
				t.Fatal("trashed success slot lost", g)
			}
		}
		first := page(client, "?view=trash&limit=1")
		if first.Total != 2 || len(first.Images) != 1 || first.NextCursor == "" || first.Images[0].TrashedAt == nil {
			t.Fatal("trash page invalid", first)
		}
		next := page(client, "?view=trash&limit=1&cursor="+first.NextCursor)
		if len(next.Images) != 1 || first.Images[0].ID == next.Images[0].ID || next.NextCursor != "" {
			t.Fatal("trash cursor lost or duplicated a picture", next)
		}
		if p := page(second, "?view=trash"); p.Total != 0 {
			t.Fatal("trash leaks ownership", p)
		}
		if p := page(client, "?folderId="+folder); p.Total != 0 {
			t.Fatal("folder lists trash", p)
		}
		request(client, "GET", "/api/images/"+one.image, nil, 200, nil)
		request(client, "GET", "/api/images/"+one.image+"/thumbnail/1", nil, 200, nil)
		request(client, "GET", "/api/images/"+one.image+"/preview/1", nil, 200, nil)
		request(second, "GET", "/api/images/"+one.image+"/thumbnail/1", nil, 404, nil)
		request(client, "POST", "/api/studio/folder-memberships", map[string]any{"imageIds": []string{one.image}, "folderIds": []string{folder}}, 404, nil)
		edit["requestId"] = studio.NewID()
		request(client, "POST", "/api/studio/generations", edit, 404, nil)
		var legacy studio.Job
		request(client, "GET", "/api/jobs/"+one.job, nil, 200, &legacy)
		if len(legacy.Images) != 0 || legacy.CreditsCost != 7 {
			t.Fatal("legacy history shows trashed image or loses charge", legacy)
		}
		mutate(client, "restore", []string{one.image, two.image}, 200)
		mutate(client, "restore", []string{one.image}, 200)
		if s := state(); len(s.Assets) != 3 || s.ImageSummary.TrashTotal != 0 || s.ImageSummary.FolderCounts[folder] != 2 {
			t.Fatal("restore failed to recover original folders", s)
		}
		checkAccounting()
	})
	t.Run("purge-removes-bytes-caches-and-keeps-accounting", func(t *testing.T) {
		// Also exercise cleanup of an unreferenced materialized source copy.
		exec("INSERT INTO studio_attachments(id,user_id,name,mime,width,height,content) VALUES(?,?,'unused','image/png',1,1,?)", two.image, owner, testPNG())
		request(client, "GET", "/api/studio/attachments/"+two.image+"/thumbnail/1", nil, 200, nil)
		mutate(client, "trash", []string{one.image, two.image}, 200)
		mutate(client, "purge", []string{one.image, three.image}, 409)
		if p := page(client, "?view=trash"); p.Total != 2 {
			t.Fatal("mixed active/trash purge was not atomic", p)
		}
		mutate(client, "purge", []string{one.image, two.image}, 200)
		mutate(client, "purge", []string{one.image, two.image}, 200)
		mutate(client, "restore", []string{one.image}, 409)
		mutate(client, "trash", []string{one.image}, 409)
		for _, id := range []string{one.image, two.image} {
			for _, suffix := range []string{"", "?download=1", "/thumbnail/1", "/preview/1"} {
				request(client, "GET", "/api/images/"+id+suffix, nil, 404, nil)
				request(client, "HEAD", "/api/images/"+id+suffix, nil, 404, nil)
			}
			var payloadBytes, cacheCount, relationCount int
			if err := db.QueryRow("SELECT OCTET_LENGTH(content)+OCTET_LENGTH(mime)+width+height+byte_size FROM images WHERE id=? AND purged_at IS NOT NULL", id).Scan(&payloadBytes); err != nil || payloadBytes != 0 {
				t.Fatal("purge retained output bytes or metadata", payloadBytes, err)
			}
			if err := db.QueryRow("SELECT COUNT(*) FROM image_thumbnails WHERE image_id=?", id).Scan(&cacheCount); err != nil || cacheCount != 0 {
				t.Fatal("purge retained output cache", cacheCount, err)
			}
			if err := db.QueryRow("SELECT COUNT(*) FROM studio_image_folders WHERE image_id=?", id).Scan(&relationCount); err != nil || relationCount != 0 {
				t.Fatal("purge retained folder memberships", relationCount, err)
			}
		}
		for _, suffix := range []string{"", "/thumbnail/1"} {
			request(client, "GET", "/api/studio/attachments/"+two.image+suffix, nil, 404, nil)
		}
		// A referenced input is a separate immutable snapshot for an existing
		// task; deleting its original output must not break that task's history.
		request(client, "GET", "/api/studio/attachments/"+one.image, nil, 200, nil)
		edit["requestId"] = studio.NewID()
		request(client, "POST", "/api/studio/generations", edit, 404, nil)
		var multipartBody bytes.Buffer
		writer := multipart.NewWriter(&multipartBody)
		for key, value := range map[string]string{"mode": "edit", "model": "gpt-image-2", "count": "1", "prompt": "blocked deleted source", "ratio": "auto", "resolution": "default", "base_image_id": one.image} {
			writer.WriteField(key, value)
		}
		writer.Close()
		r, _ := http.NewRequest("POST", server.URL+"/api/jobs", &multipartBody)
		r.Header.Set("Content-Type", writer.FormDataContentType())
		res, err := client.Do(r)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		if res.StatusCode != 404 {
			t.Fatal("legacy editing reused a purged source", res.StatusCode)
		}
		s := state()
		if len(s.Assets) != 1 || s.ImageSummary.Total != 1 || s.ImageSummary.TrashTotal != 0 || page(client, "?view=trash").Total != 0 {
			t.Fatal("purged output remains visible", s)
		}
		for _, g := range s.Generations {
			if g.ID == one.batch || g.ID == two.batch {
				if len(g.ImageIDs) != 0 || len(g.Outputs) != 1 || g.Outputs[0].Status != "succeeded" || g.Outputs[0].ImageState != "deleted" {
					t.Fatal("permanent delete removed historical success", g)
				}
			}
		}
		checkAccounting()
	})
	t.Run("multiple-images-in-one-job-keep-independent-tombstones", func(t *testing.T) {
		// A provider can return several pictures for one successful job. Their
		// lifecycle cannot be reconstructed from the aggregate slot state alone.
		sibling := studio.NewID()
		exec("INSERT INTO images(id,job_id,mime,width,height,byte_size,content) VALUES(?,?,'image/png',1,1,?,?)", sibling, three.job, len(testPNG()), testPNG())
		mutate(client, "trash", []string{three.image}, 200)
		mutate(client, "purge", []string{three.image}, 200)
		found := false
		for _, g := range state().Generations {
			if g.ID != three.batch {
				continue
			}
			found = true
			if len(g.ImageIDs) != 1 || g.ImageIDs[0] != sibling || len(g.Outputs) != 1 || g.Outputs[0].ImageState != "available" || g.Outputs[0].ImageStates[three.image] != "deleted" || g.Outputs[0].ImageStates[sibling] != "available" || g.Cost != 2 {
				t.Fatal("a surviving sibling obscured the deleted image tombstone", g)
			}
		}
		if !found {
			t.Fatal("deleting one picture removed the shared job history")
		}
		if active := page(client, ""); active.Total != 1 || len(active.Images) != 1 || active.Images[0].ID != sibling {
			t.Fatal("deleted sibling reappeared in image page", active)
		}
		checkAccounting()
	})
	t.Log("real MySQL/HTTP: repeatable migration; personal atomic bulk trash/restore/purge; private cursors; source reuse and cache cleanup; immutable charges and historical inputs")
}
