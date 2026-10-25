package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func testAccountWorkflow(t *testing.T, db *sql.DB, h http.Handler, jobID, editID, adminID, adminToken string) {
	t.Helper()
	request := func(method, path, body, token string, want int) *httptest.ResponseRecorder {
		t.Helper()
		r := httptest.NewRequest(method, "http://localhost"+path, strings.NewReader(body))
		if token != "" {
			r.AddCookie(&http.Cookie{Name: sessionCookie, Value: token})
		}
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != want {
			t.Fatalf("%s %s: %d want %d: %s", method, path, w.Code, want, w.Body.String())
		}
		return w
	}
	login := func(username, password string) string {
		t.Helper()
		body, _ := json.Marshal(map[string]string{"username": username, "password": password})
		w := request("POST", "/api/auth/login", string(body), "", 200)
		cookies := w.Result().Cookies()
		if len(cookies) == 0 || !cookies[0].HttpOnly || cookies[0].SameSite != http.SameSiteStrictMode {
			t.Fatal("unsafe session cookie")
		}
		return cookies[0].Value
	}
	request("POST", "/api/auth/login", `{"username":"admin","password":"incorrect"}`, "", 401)
	adminToken = login("admin", "test-access")
	if err := bootstrapAdmin(context.Background(), db, "replacement", "replacement-password"); err != nil {
		t.Fatal(err)
	}
	var bootstrapCount int
	if err := db.QueryRow("SELECT COUNT(*) FROM users").Scan(&bootstrapCount); err != nil || bootstrapCount != 1 {
		t.Fatal("bootstrap must not recreate or overwrite existing accounts")
	}
	request("POST", "/api/admin/users", `{"username":"alice","password":"alice-password","role":"user"}`, adminToken, 201)
	request("POST", "/api/admin/users", `{"username":"alice","password":"alice-password","role":"user"}`, adminToken, 409)
	request("POST", "/api/admin/users", `{"username":"bob","password":"bob-password","role":"user"}`, adminToken, 201)
	alice := login("alice", "alice-password")
	bob := login("bob", "bob-password")
	var aliceID string
	if err := db.QueryRow("SELECT id FROM users WHERE username='alice'").Scan(&aliceID); err != nil {
		t.Fatal(err)
	}
	request("GET", "/api/admin/users", "", alice, 403)
	users := request("GET", "/api/admin/users", "", adminToken, 200).Body.String()
	if strings.Contains(users, "password") || strings.Contains(users, "token") || strings.Contains(users, "pbkdf2") {
		t.Fatal("user listing leaks credentials")
	}
	request("GET", "/api/admin/jobs", "", bob, 403)
	request("POST", "/api/admin/users", `{"username":"hacker","password":"hacker-password","role":"admin"}`, alice, 403)
	request("PATCH", "/api/admin/users/"+aliceID, `{"role":"admin"}`, alice, 403)
	for _, token := range []string{alice, bob} {
		w := request("GET", "/api/jobs?user_id="+adminID, "", token, 200)
		var result struct {
			Total int
			Stats map[string]int
		}
		if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		if result.Total != 0 || result.Stats["total"] != 0 {
			t.Fatal("other users' jobs or statistics leaked")
		}
		request("GET", "/api/jobs/"+jobID, "", token, 404)
		request("GET", "/api/jobs/"+editID+"/input", "", token, 404)
	}
	var imageID string
	if err := db.QueryRow("SELECT id FROM images WHERE job_id=? LIMIT 1", jobID).Scan(&imageID); err != nil {
		t.Fatal(err)
	}
	request("GET", "/api/images/"+imageID+"?download=1", "", alice, 404)
	request("POST", "/api/admin/users/"+aliceID+"/credits", `{"delta":100,"note":"测试积分","request_id":"22222222222222222222222222222222"}`, adminToken, 200)
	// A user's submitted identity cannot override the authenticated owner.
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	for k, v := range map[string]string{"model": "gpt-image-2", "prompt": "Alice <script>alert(1)</script>", "count": "1", "mode": "edit", "ratio": "auto", "resolution": "default", "user_id": adminID} {
		_ = writer.WriteField(k, v)
	}
	part, _ := writer.CreateFormFile("image", "input.png")
	_, _ = part.Write(testPNG())
	_ = writer.Close()
	r := httptest.NewRequest("POST", "http://localhost/api/jobs", &body)
	r.Header.Set("Content-Type", writer.FormDataContentType())
	r.AddCookie(&http.Cookie{Name: sessionCookie, Value: alice})
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 202 {
		t.Fatal(w.Body.String())
	}
	var submitted struct{ IDs []string }
	if err := json.Unmarshal(w.Body.Bytes(), &submitted); err != nil {
		t.Fatal(err)
	}
	id := submitted.IDs[0]
	j, err := scanJob(db.QueryRow("SELECT "+jobColumns+" FROM jobs WHERE id=?", id))
	if err != nil || j.UserID != aliceID {
		t.Fatalf("owner not assigned: %+v %v", j, err)
	}
	pic, err := decodePicture(testPNG())
	if err != nil {
		t.Fatal(err)
	}
	a := app{db: db}
	if err := a.saveResult(context.Background(), id, generationResult{Images: []picture{pic}}); err != nil {
		t.Fatal(err)
	}
	request("GET", "/api/jobs/"+id, "", alice, 200)
	request("GET", "/api/jobs/"+id, "", bob, 404)
	request("GET", "/api/jobs/"+id+"/input", "", alice, 200)
	request("GET", "/api/jobs/"+id+"/input", "", adminToken, 200)
	w = request("GET", "/api/jobs/"+id, "", adminToken, 200)
	if err := json.Unmarshal(w.Body.Bytes(), &j); err != nil || len(j.Images) != 1 || j.Username != "alice" {
		t.Fatal("admin missing owner or images")
	}
	request("GET", j.Images[0].URL, "", alice, 200)
	request("GET", j.Images[0].URL, "", bob, 404)
	request("GET", j.Images[0].URL, "", adminToken, 200)
	w = request("GET", "/api/admin/jobs?username=alice&q=Alice&status=succeeded", "", adminToken, 200)
	var listing struct {
		Total int
		Items []job
	}
	if err := json.Unmarshal(w.Body.Bytes(), &listing); err != nil || listing.Total != 1 || listing.Items[0].UserID != aliceID {
		t.Fatal("admin filter failed")
	}
	legacy := newID()
	if _, err := db.Exec("INSERT INTO jobs(id,batch_id,mode,model,prompt,effective_prompt,ratio,resolution,status,error) VALUES(?,?,'generate','gpt-image-2','legacy','legacy','auto','default','failed','legacy failure')", legacy, legacy); err != nil {
		t.Fatal(err)
	}
	if err := migrate(context.Background(), db); err != nil {
		t.Fatal(err)
	}
	request("GET", "/api/jobs/"+legacy, "", alice, 404)
	w = request("GET", "/api/admin/jobs?user_id=legacy", "", adminToken, 200)
	if err := json.Unmarshal(w.Body.Bytes(), &listing); err != nil || listing.Total != 1 || listing.Items[0].Username != "历史共享记录" {
		t.Fatal("legacy records lost")
	}
	request("PATCH", "/api/admin/users/"+adminID, `{"active":false}`, adminToken, 409)
	request("PATCH", "/api/admin/users/"+adminID, `{"role":"user"}`, adminToken, 409)
	request("PATCH", "/api/admin/users/"+aliceID, `{"active":false}`, adminToken, 200)
	request("GET", "/api/auth/me", "", alice, 401)
	request("POST", "/api/auth/login", `{"username":"alice","password":"alice-password"}`, "", 401)
	request("PATCH", "/api/admin/users/"+aliceID, `{"active":true,"password":"reset-password"}`, adminToken, 200)
	request("GET", "/api/auth/me", "", alice, 401)
	request("POST", "/api/auth/login", `{"username":"alice","password":"alice-password"}`, "", 401)
	alice = login("alice", "reset-password")
	request("POST", "/api/auth/password", `{"current_password":"wrong-password","password":"new-password"}`, alice, 400)
	request("POST", "/api/auth/password", `{"current_password":"reset-password","password":"new-password"}`, alice, 200)
	request("GET", "/api/auth/me", "", alice, 401)
	alice = login("alice", "new-password")
	request("POST", "/api/auth/logout", "", alice, 200)
	request("GET", "/api/auth/me", "", alice, 401)
	request("PATCH", "/api/admin/users/"+aliceID, `{"role":"admin"}`, adminToken, 200)
	alice = login("alice", "new-password")
	request("GET", "/api/admin/users", "", alice, 200)
	request("PATCH", "/api/admin/users/"+aliceID, `{"role":"user"}`, adminToken, 200)
	request("GET", "/api/admin/users", "", alice, 401)
	if _, err := db.Exec("UPDATE sessions SET expires_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 SECOND) WHERE token_hash=?", sessionHash(bob)); err != nil {
		t.Fatal(err)
	}
	request("GET", "/api/auth/me", "", bob, 401)
	if _, err := db.Exec("DELETE FROM jobs WHERE id IN (?,?)", id, legacy); err != nil {
		t.Fatal(err)
	}
}
