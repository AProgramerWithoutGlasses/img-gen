package studio

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

func (a *App) createJobs(w http.ResponseWriter, r *http.Request) {
	if a.Upstream.Key == "" {
		apiError(w, 503, "请先在服务端 .env 配置 QISO_API_KEY 并重启")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 25<<20)
	if err := r.ParseMultipartForm(1 << 20); err != nil {
		apiError(w, 400, "表单无效或过大；基础图和参考图各不能超过 12 MB")
		return
	}
	defer r.MultipartForm.RemoveAll()
	j := Job{Mode: r.FormValue("mode"), Model: r.FormValue("model"), Prompt: r.FormValue("prompt"), Ratio: r.FormValue("ratio"), Resolution: r.FormValue("resolution")}
	var selections []ModelSelection
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
		selections = []ModelSelection{{Model: j.Model, Count: count}}
	}
	_, hasSavedBase := r.MultipartForm.Value["base_image_id"]
	if j.Mode != "edit" && (len(r.MultipartForm.File) > 0 || hasSavedBase) {
		apiError(w, 400, "上传图片请使用编辑模式")
		return
	}
	// Serialize admission before reading a saved base image so a concurrent
	// purge cannot finish and then have that source admitted as a new edit.
	a.submit.Lock()
	defer a.submit.Unlock()
	if j.Mode == "edit" {
		var Base Picture
		var err error
		if hasSavedBase {
			ids := r.MultipartForm.Value["base_image_id"]
			if len(ids) != 1 || !ValidID(ids[0]) || len(r.MultipartForm.File["image"]) > 0 {
				apiError(w, 400, "请选择一张历史基础图，或上传一张基础图，不能同时指定")
				return
			}
			scope, args := ownerScope(r, "jobs.user_id")
			var data []byte
			var mime string
			err = a.DB.QueryRowContext(r.Context(), "SELECT images.mime,images.content FROM images JOIN jobs ON jobs.id=images.job_id WHERE images.id=? AND images.trashed_at IS NULL AND images.purged_at IS NULL"+scope, append([]any{ids[0]}, args...)...).Scan(&mime, &data)
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
			Base, err = DecodePicture(data)
		} else {
			Base, err = readEditUpload(r, "image", "基础图", true)
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
		j.Input, j.InputMIME = Base.Content, Base.MIME
		j.Reference, j.ReferenceMIME = reference.Content, reference.MIME
	}
	jobs, err := ExpandBatch(j, selections)
	if err != nil {
		apiError(w, 400, err.Error())
		return
	}
	// Serializes queue admission within the single active server process.
	var pending int
	if err := a.DB.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM jobs WHERE status IN ('queued','running')").Scan(&pending); err != nil {
		apiError(w, 500, "读取任务队列失败")
		return
	}
	if pending+len(jobs) > maxBatchImages {
		apiError(w, 429, "当前队列已满，请等待已有任务完成")
		return
	}
	tx, err := a.DB.BeginTx(r.Context(), nil)
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
	batch := NewID()
	ids := []string{}
	for _, j := range jobs {
		id := NewID()
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

func readEditUpload(r *http.Request, field, label string, required bool) (Picture, error) {
	files := r.MultipartForm.File[field]
	if len(files) == 0 && !required {
		return Picture{}, nil
	} // Preserve legacy single-image API requests.
	if len(files) != 1 {
		return Picture{}, fmt.Errorf("请上传一张%s", label)
	}
	file, err := files[0].Open()
	if err != nil {
		return Picture{}, fmt.Errorf("读取%s失败", label)
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, (12<<20)+1))
	if err != nil || len(data) > 12<<20 {
		return Picture{}, fmt.Errorf("%s不能超过 12 MB", label)
	}
	input, err := DecodePicture(data)
	if err != nil {
		return Picture{}, fmt.Errorf("%s：%w", label, err)
	}
	return input, nil
}

func (a *App) listJobs(w http.ResponseWriter, r *http.Request) {
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
		start, end, err := RequestTimeRange(r.URL.Query(), time.Now())
		if err != nil {
			apiError(w, 400, err.Error())
			return
		}
		where += " AND created_at>=? AND created_at<=?"
		args = append(args, start, end)
		if id := r.URL.Query().Get("user_id"); id != "" {
			if id == "legacy" {
				where += " AND user_id IS NULL"
			} else if ValidID(id) {
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
	if err := a.DB.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM jobs"+where, args...).Scan(&total); err != nil {
		apiError(w, 500, "读取历史记录失败")
		return
	}
	queryArgs := append(append([]any{}, args...), 24, (page-1)*24)
	rows, err := a.DB.QueryContext(r.Context(), "SELECT "+jobColumns+" FROM jobs"+where+" ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?", queryArgs...)
	if err != nil {
		apiError(w, 500, "读取历史记录失败")
		return
	}
	jobs := []Job{}
	for rows.Next() {
		j, err := ScanJob(rows)
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
	statRows, err := a.DB.QueryContext(r.Context(), "SELECT status,COUNT(*) FROM jobs"+where+" GROUP BY status", args...)
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

func (a *App) getJob(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !ValidID(id) {
		apiError(w, 404, "记录不存在")
		return
	}
	scope, args := ownerScope(r, "user_id")
	j, err := ScanJob(a.DB.QueryRowContext(r.Context(), "SELECT "+jobColumns+" FROM jobs WHERE id=?"+scope, append([]any{id}, args...)...))
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
	if err = a.inputPictures(r, &j); err != nil {
		apiError(w, 500, "读取输入图片信息失败")
		return
	}
	jsonResponse(w, 200, j)
}

func (a *App) getImage(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !ValidID(id) {
		apiError(w, 404, "图片不存在")
		return
	}
	var data []byte
	var mime string
	scope, args := ownerScope(r, "jobs.user_id")
	err := a.DB.QueryRowContext(r.Context(), "SELECT images.mime,images.content FROM images JOIN jobs ON jobs.id=images.job_id WHERE images.id=? AND images.purged_at IS NULL"+scope, append([]any{id}, args...)...).Scan(&mime, &data)
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
	ServeCachedImage(w, r, data, mime)
}

func (a *App) getInput(w http.ResponseWriter, r *http.Request) {
	columns := "input_image,input_mime"
	if strings.HasSuffix(r.URL.Path, "/reference") {
		columns = "reference_image,reference_mime"
	}
	id := r.PathValue("id")
	if !ValidID(id) {
		apiError(w, 404, "参考图不存在")
		return
	}
	var data []byte
	var mime string
	scope, args := ownerScope(r, "user_id")
	err := a.DB.QueryRowContext(r.Context(), "SELECT "+columns+" FROM jobs WHERE id=?"+scope, append([]any{id}, args...)...).Scan(&data, &mime)
	if errors.Is(err, sql.ErrNoRows) || err == nil && len(data) == 0 {
		apiError(w, 404, "参考图不存在")
		return
	}
	if err != nil {
		apiError(w, 500, "读取参考图失败")
		return
	}
	ServeCachedImage(w, r, data, mime)
}
