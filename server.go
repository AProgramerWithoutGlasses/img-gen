package main

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

type app struct {
	db            *sql.DB
	upstream      *provider
	secureCookies bool
	usersMu       sync.Mutex
	logins        loginLimiter
	workers       sync.WaitGroup
	submit        sync.Mutex
	polish        sync.Mutex
	thumbnails    sync.Mutex
}

func newID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b[:])
}
func jsonResponse(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func apiError(w http.ResponseWriter, status int, message string) {
	jsonResponse(w, status, map[string]string{"error": message})
}
func validID(s string) bool {
	if len(s) != 32 {
		return false
	}
	_, err := hex.DecodeString(s)
	return err == nil
}

func (a *app) routes(static fs.FS) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		if a.db.PingContext(ctx) != nil {
			apiError(w, 503, "database unavailable")
			return
		}
		jsonResponse(w, 200, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("GET /api/config", func(w http.ResponseWriter, r *http.Request) {
		jsonResponse(w, 200, map[string]any{"configured": a.upstream.key != "", "max_batch": maxBatchImages, "max_per_model": 4, "max_upload_mb": 12})
	})
	mux.HandleFunc("POST /api/auth/login", a.login)
	mux.HandleFunc("POST /api/auth/logout", a.logout)
	mux.HandleFunc("GET /api/auth/me", a.profile)
	mux.HandleFunc("GET /api/prices", a.listPrices)
	mux.HandleFunc("GET /api/credits/ledger", a.listCreditLedger)
	mux.HandleFunc("GET /api/admin/prices", a.listPrices)
	mux.HandleFunc("PATCH /api/admin/prices/{model}", a.updatePrice)
	mux.HandleFunc("POST /api/admin/users/{id}/credits", a.adjustCredits)
	mux.HandleFunc("GET /api/admin/users/{id}/credits", a.listCreditLedger)
	mux.HandleFunc("POST /api/auth/password", a.changePassword)
	mux.HandleFunc("GET /api/admin/users", a.listUsers)
	mux.HandleFunc("POST /api/admin/users", a.createUser)
	mux.HandleFunc("PATCH /api/admin/users/{id}", a.updateUser)
	mux.HandleFunc("GET /api/admin/jobs", a.listJobs)
	mux.HandleFunc("GET /api/jobs", a.listJobs)
	mux.HandleFunc("POST /api/jobs", a.createJobs)
	mux.HandleFunc("POST /api/prompt/polish", a.polishPrompt)
	mux.HandleFunc("GET /api/jobs/{id}", a.getJob)
	mux.HandleFunc("GET /api/jobs/{id}/input", a.getInput)
	mux.HandleFunc("GET /api/jobs/{id}/reference", a.getInput)
	mux.HandleFunc("GET /api/images/{id}", a.getImage)
	mux.HandleFunc("GET /api/images/{id}/thumbnail/{version}", a.getThumbnail)
	mux.Handle("GET /", http.FileServerFS(static))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "same-origin")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; img-src 'self' blob: data:; style-src 'self'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'")
		w.Header().Set("Cache-Control", "no-store")
		if r.Method != "GET" && r.Method != "HEAD" {
			if strings.EqualFold(r.Header.Get("Sec-Fetch-Site"), "cross-site") {
				apiError(w, 403, "不允许跨站提交")
				return
			}
			if origin := r.Header.Get("Origin"); origin != "" {
				u, err := url.Parse(origin)
				if err != nil || !strings.EqualFold(u.Host, r.Host) {
					apiError(w, 403, "不允许跨站提交")
					return
				}
			}
		}
		if strings.HasPrefix(r.URL.Path, "/api/") && r.URL.Path != "/api/auth/login" {
			var ok bool
			r, ok = a.authenticate(w, r)
			if !ok {
				return
			}
			if strings.HasPrefix(r.URL.Path, "/api/admin/") && currentUser(r).Role != "admin" {
				apiError(w, 403, "仅管理员可访问")
				return
			}
		}
		mux.ServeHTTP(w, r)
	})
}

func (a *app) createJobs(w http.ResponseWriter, r *http.Request) {
	if a.upstream.key == "" {
		apiError(w, 503, "请先在服务端 .env 配置 QISO_API_KEY 并重启")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 25<<20)
	if err := r.ParseMultipartForm(1 << 20); err != nil {
		apiError(w, 400, "表单无效或过大；基础图和参考图各不能超过 12 MB")
		return
	}
	defer r.MultipartForm.RemoveAll()
	j := job{Mode: r.FormValue("mode"), Model: r.FormValue("model"), Prompt: r.FormValue("prompt"), Ratio: r.FormValue("ratio"), Resolution: r.FormValue("resolution")}
	var selections []modelSelection
	if values, exists := r.MultipartForm.Value["models"]; exists {
		if len(values) != 1 || json.Unmarshal([]byte(values[0]), &selections) != nil {
			apiError(w, 400, "模型与数量配置无效")
			return
		}
	} else {
		// Preserve compatibility with existing single-model clients.
		count, err := strconv.Atoi(r.FormValue("count"))
		if err != nil {
			apiError(w, 400, "每个模型可生成 1–4 张图片")
			return
		}
		selections = []modelSelection{{Model: j.Model, Count: count}}
	}
	_, hasSavedBase := r.MultipartForm.Value["base_image_id"]
	if j.Mode != "edit" && (len(r.MultipartForm.File) > 0 || hasSavedBase) {
		apiError(w, 400, "上传图片请使用编辑模式")
		return
	}
	if j.Mode == "edit" {
		var base picture
		var err error
		if hasSavedBase {
			ids := r.MultipartForm.Value["base_image_id"]
			if len(ids) != 1 || !validID(ids[0]) || len(r.MultipartForm.File["image"]) > 0 {
				apiError(w, 400, "请选择一张历史基础图，或上传一张基础图，不能同时指定")
				return
			}
			scope, args := ownerScope(r, "jobs.user_id")
			var data []byte
			var mime string
			err = a.db.QueryRowContext(r.Context(), "SELECT images.mime,images.content FROM images JOIN jobs ON jobs.id=images.job_id WHERE images.id=?"+scope, append([]any{ids[0]}, args...)...).Scan(&mime, &data)
			if errors.Is(err, sql.ErrNoRows) {
				apiError(w, 404, "基础图不存在或无权访问")
				return
			}
			if err != nil {
				apiError(w, 500, "读取历史基础图失败")
				return
			}
			if len(data) > 12<<20 {
				apiError(w, 400, "基础图不能超过 12 MB")
				return
			}
			base, err = decodePicture(data)
		} else {
			base, err = readEditUpload(r, "image", "基础图", true)
		}
		if err != nil {
			apiError(w, 400, err.Error())
			return
		}
		reference, err := readEditUpload(r, "reference", "参考图", false)
		if err != nil {
			apiError(w, 400, err.Error())
			return
		}
		j.Input, j.InputMIME = base.Content, base.MIME
		j.Reference, j.ReferenceMIME = reference.Content, reference.MIME
	}
	jobs, err := expandBatch(j, selections)
	if err != nil {
		apiError(w, 400, err.Error())
		return
	}
	// Serializes queue admission within the single active server process.
	a.submit.Lock()
	defer a.submit.Unlock()
	var pending int
	if err := a.db.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM jobs WHERE status IN ('queued','running')").Scan(&pending); err != nil {
		apiError(w, 500, "读取任务队列失败")
		return
	}
	if pending+len(jobs) > maxBatchImages {
		apiError(w, 429, "当前队列已满，请等待已有任务完成")
		return
	}
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		apiError(w, 500, "无法创建任务")
		return
	}
	defer tx.Rollback()
	balance, err := reserveBatch(r.Context(), tx, currentUser(r).ID, jobs)
	if errors.Is(err, errInsufficientCredits) {
		apiError(w, 402, err.Error())
		return
	}
	if err != nil {
		apiError(w, 500, "冻结积分失败，任务未提交")
		return
	}
	var reserved int64
	for _, j := range jobs {
		reserved += j.CreditsCost
	}
	if raw := r.FormValue("expected_credits"); raw != "" {
		expected, parseErr := strconv.ParseInt(raw, 10, 64)
		if parseErr != nil || expected != reserved {
			apiError(w, 409, "模型价格已变化，请确认最新积分价格后重新提交")
			return
		}
	}
	batch := newID()
	ids := []string{}
	for _, j := range jobs {
		id := newID()
		_, err = tx.ExecContext(r.Context(), `INSERT INTO jobs(id,batch_id,mode,model,prompt,effective_prompt,ratio,resolution,status,error,input_image,input_mime,reference_image,reference_mime,user_id,credits_cost,credits_state,created_at) VALUES(?,?,?,?,?,?,?,?,'queued','',?,?,?,?,?,?,'reserved',UTC_TIMESTAMP(3))`, id, batch, j.Mode, j.Model, j.Prompt, j.EffectivePrompt, j.Ratio, j.Resolution, j.Input, j.InputMIME, j.Reference, j.ReferenceMIME, currentUser(r).ID, j.CreditsCost)
		if err != nil {
			apiError(w, 500, "保存任务失败，请检查数据库磁盘与 max_allowed_packet")
			return
		}
		balance -= j.CreditsCost
		if _, err := tx.ExecContext(r.Context(), "INSERT INTO credit_ledger(user_id,request_key,kind,delta,balance_after,job_id) VALUES(?,?,'reserve',?,?,?)", currentUser(r).ID, "reserve:"+id, -j.CreditsCost, balance, id); err != nil {
			apiError(w, 500, "保存积分流水失败，任务未提交")
			return
		}
		ids = append(ids, id)
	}
	if err = tx.Commit(); err != nil {
		apiError(w, 500, "任务提交结果未知，请先查看历史记录，避免重复提交")
		return
	}
	jsonResponse(w, 202, map[string]any{"batch_id": batch, "ids": ids, "credits_reserved": reserved})
}

func readEditUpload(r *http.Request, field, label string, required bool) (picture, error) {
	files := r.MultipartForm.File[field]
	if len(files) == 0 && !required {
		return picture{}, nil
	} // Preserve legacy single-image API requests.
	if len(files) != 1 {
		return picture{}, fmt.Errorf("请上传一张%s", label)
	}
	file, err := files[0].Open()
	if err != nil {
		return picture{}, fmt.Errorf("读取%s失败", label)
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, (12<<20)+1))
	if err != nil || len(data) > 12<<20 {
		return picture{}, fmt.Errorf("%s不能超过 12 MB", label)
	}
	input, err := decodePicture(data)
	if err != nil {
		return picture{}, fmt.Errorf("%s：%w", label, err)
	}
	return input, nil
}

func (a *app) listJobs(w http.ResponseWriter, r *http.Request) {
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	if page < 1 {
		page = 1
	}
	if page > 100000 {
		apiError(w, 400, "页码过大")
		return
	}
	where := " WHERE 1=1"
	args := []any{}
	// Studio/history is always personal; the admin endpoint explicitly exposes all records.
	if r.URL.Path != "/api/admin/jobs" {
		where += " AND user_id=?"
		args = append(args, currentUser(r).ID)
	} else {
		start, end, err := requestTimeRange(r.URL.Query(), time.Now())
		if err != nil {
			apiError(w, 400, err.Error())
			return
		}
		where += " AND created_at>=? AND created_at<=?"
		args = append(args, start, end)
		if id := r.URL.Query().Get("user_id"); id != "" {
			if id == "legacy" {
				where += " AND user_id IS NULL"
			} else if validID(id) {
				where += " AND user_id=?"
				args = append(args, id)
			} else {
				apiError(w, 400, "用户参数无效")
				return
			}
		}
		if username := strings.TrimSpace(r.URL.Query().Get("username")); username != "" {
			if len(username) > 128 {
				apiError(w, 400, "用户名过长")
				return
			}
			where += " AND user_id IN (SELECT id FROM users WHERE LOCATE(?,username)>0)"
			args = append(args, username)
		}
	}
	if q := strings.TrimSpace(r.URL.Query().Get("q")); q != "" {
		if len(q) > 500 {
			apiError(w, 400, "搜索词过长")
			return
		}
		where += " AND LOCATE(?,prompt)>0"
		args = append(args, q)
	}
	if status := r.URL.Query().Get("status"); status != "" {
		where += " AND status=?"
		args = append(args, status)
	}
	if model := strings.TrimSpace(r.URL.Query().Get("model")); model != "" {
		if len(model) > 80 {
			apiError(w, 400, "模型名称过长")
			return
		}
		where += " AND model=?"
		args = append(args, model)
	}
	var total int
	if err := a.db.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM jobs"+where, args...).Scan(&total); err != nil {
		apiError(w, 500, "读取历史记录失败")
		return
	}
	queryArgs := append(append([]any{}, args...), 24, (page-1)*24)
	rows, err := a.db.QueryContext(r.Context(), "SELECT "+jobColumns+" FROM jobs"+where+" ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?", queryArgs...)
	if err != nil {
		apiError(w, 500, "读取历史记录失败")
		return
	}
	jobs := []job{}
	for rows.Next() {
		j, err := scanJob(rows)
		if err != nil {
			rows.Close()
			apiError(w, 500, "读取任务失败")
			return
		}
		jobs = append(jobs, j)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		apiError(w, 500, "读取任务失败")
		return
	}
	for i := range jobs {
		if err := a.pictures(r.Context(), &jobs[i]); err != nil {
			apiError(w, 500, "读取图片信息失败")
			return
		}
	}
	stats := map[string]int{"total": 0, "succeeded": 0, "active": 0, "failed": 0}
	statRows, err := a.db.QueryContext(r.Context(), "SELECT status,COUNT(*) FROM jobs"+where+" GROUP BY status", args...)
	if err != nil {
		apiError(w, 500, "读取任务统计失败")
		return
	}
	for statRows.Next() {
		var s string
		var n int
		if err = statRows.Scan(&s, &n); err != nil {
			break
		}
		stats["total"] += n
		if s == "queued" || s == "running" {
			stats["active"] += n
		} else {
			stats[s] += n
		}
	}
	if err == nil {
		err = statRows.Err()
	}
	statRows.Close()
	if err != nil {
		apiError(w, 500, "读取任务统计失败")
		return
	}
	jsonResponse(w, 200, map[string]any{"items": jobs, "total": total, "page": page, "page_size": 24, "stats": stats})
}

func (a *app) getJob(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !validID(id) {
		apiError(w, 404, "记录不存在")
		return
	}
	scope, args := ownerScope(r, "user_id")
	j, err := scanJob(a.db.QueryRowContext(r.Context(), "SELECT "+jobColumns+" FROM jobs WHERE id=?"+scope, append([]any{id}, args...)...))
	if errors.Is(err, sql.ErrNoRows) {
		apiError(w, 404, "记录不存在")
		return
	}
	if err != nil {
		apiError(w, 500, "读取记录失败")
		return
	}
	if err = a.pictures(r.Context(), &j); err != nil {
		apiError(w, 500, "读取图片失败")
		return
	}
	jsonResponse(w, 200, j)
}
func (a *app) getImage(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !validID(id) {
		apiError(w, 404, "图片不存在")
		return
	}
	var data []byte
	var mime string
	scope, args := ownerScope(r, "jobs.user_id")
	err := a.db.QueryRowContext(r.Context(), "SELECT images.mime,images.content FROM images JOIN jobs ON jobs.id=images.job_id WHERE images.id=?"+scope, append([]any{id}, args...)...).Scan(&mime, &data)
	if errors.Is(err, sql.ErrNoRows) {
		apiError(w, 404, "图片不存在")
		return
	}
	if err != nil {
		apiError(w, 500, "读取图片失败")
		return
	}
	if r.URL.Query().Get("download") == "1" {
		ext := "png"
		if mime == "image/jpeg" {
			ext = "jpg"
		}
		w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="qiso-%s.%s"`, id, ext))
	}
	serveCachedImage(w, r, data, mime)
}
func (a *app) getInput(w http.ResponseWriter, r *http.Request) {
	columns := "input_image,input_mime"
	if strings.HasSuffix(r.URL.Path, "/reference") {
		columns = "reference_image,reference_mime"
	}
	id := r.PathValue("id")
	if !validID(id) {
		apiError(w, 404, "参考图不存在")
		return
	}
	var data []byte
	var mime string
	scope, args := ownerScope(r, "user_id")
	err := a.db.QueryRowContext(r.Context(), "SELECT "+columns+" FROM jobs WHERE id=?"+scope, append([]any{id}, args...)...).Scan(&data, &mime)
	if errors.Is(err, sql.ErrNoRows) || err == nil && len(data) == 0 {
		apiError(w, 404, "参考图不存在")
		return
	}
	if err != nil {
		apiError(w, 500, "读取参考图失败")
		return
	}
	serveImage(w, data, mime)
}
func serveImage(w http.ResponseWriter, data []byte, mime string) {
	w.Header().Set("Content-Type", mime)
	w.Header().Set("Content-Length", strconv.Itoa(len(data)))
	_, _ = w.Write(data)
}

func (a *app) claim(ctx context.Context) (job, error) {
	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return job{}, err
	}
	defer tx.Rollback()
	j, err := scanJob(tx.QueryRowContext(ctx, "SELECT "+jobColumns+" FROM jobs WHERE status='queued' ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED"))
	if err != nil {
		return job{}, err
	}
	if err = tx.QueryRowContext(ctx, "SELECT input_image,input_mime,reference_image,reference_mime FROM jobs WHERE id=?", j.ID).Scan(&j.Input, &j.InputMIME, &j.Reference, &j.ReferenceMIME); err != nil {
		return job{}, err
	}
	if _, err = tx.ExecContext(ctx, "UPDATE jobs SET status='running',started_at=UTC_TIMESTAMP(3) WHERE id=?", j.ID); err != nil {
		return job{}, err
	}
	return j, tx.Commit()
}
func (a *app) worker(ctx context.Context) {
	defer a.workers.Done()
	for {
		if ctx.Err() != nil {
			return
		}
		j, err := a.claim(ctx)
		if err != nil {
			if !errors.Is(err, sql.ErrNoRows) && ctx.Err() == nil {
				log.Print("读取任务队列失败")
			}
			select {
			case <-ctx.Done():
				return
			case <-time.After(time.Second):
				continue
			}
		}
		result, err := a.upstream.generate(ctx, j)
		// Save cancellation/failure with a fresh bounded context during shutdown.
		saveCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		if err != nil {
			message := err.Error()
			var upstream *upstreamError
			requestID, endpoint := "", ""
			if errors.As(err, &upstream) {
				requestID = upstream.RequestID
				endpoint = upstream.Endpoint
			}
			if saveErr := a.failJob(saveCtx, j.ID, message, requestID, endpoint); saveErr != nil {
				log.Printf("任务 %s 失败状态保存失败", j.ID)
			}
		} else if err = a.saveResult(saveCtx, j.ID, result); err != nil {
			log.Printf("任务 %s 图片持久化失败", j.ID)
			if saveErr := a.failJob(saveCtx, j.ID, "上游已完成，但图片保存失败；冻结积分已退还，请检查数据库。重试会重新计费", result.RequestID, result.Endpoint); saveErr != nil {
				log.Printf("任务 %s 失败状态保存失败", j.ID)
			}
		}
		cancel()
	}
}
func (a *app) saveResult(ctx context.Context, id string, result generationResult) error {
	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	j, err := scanJob(tx.QueryRowContext(ctx, "SELECT "+jobColumns+" FROM jobs WHERE id=? FOR UPDATE", id))
	if err != nil {
		return err
	}
	if j.Status == "succeeded" || j.Status == "failed" {
		return nil
	}
	if err := settleCredits(ctx, tx, j, true); err != nil {
		return err
	}
	for _, p := range result.Images {
		if _, err = tx.ExecContext(ctx, "INSERT INTO images(id,job_id,mime,width,height,byte_size,content) VALUES(?,?,?,?,?,?,?)", newID(), id, p.MIME, p.Width, p.Height, p.Bytes, p.Content); err != nil {
			return err
		}
	}
	if _, err = tx.ExecContext(ctx, "UPDATE jobs SET status='succeeded',actual_model=?,quality=?,request_id=?,endpoint=?,finished_at=UTC_TIMESTAMP(3) WHERE id=?", result.ActualModel, result.Quality, result.RequestID, result.Endpoint, id); err != nil {
		return err
	}
	return tx.Commit()
}
