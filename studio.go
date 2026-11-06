package main

// The Studio API adapts the new UI contract without changing legacy job clients.
import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	_ "image/gif"
	"io"
	"net/http"
	"path/filepath"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/go-sql-driver/mysql"
	_ "golang.org/x/image/webp"
)

type studioOptions struct {
	ModelID    string `json:"modelId"`
	Quality    string `json:"quality,omitempty"`
	Resolution string `json:"resolution,omitempty"`
	Ratio      string `json:"ratio"`
	Count      int    `json:"count"`
}
type studioAttachment struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	URL    string `json:"url"`
	Width  int    `json:"width"`
	Height int    `json:"height"`
}
type studioAsset struct {
	studioAttachment
	ThumbnailURL string        `json:"thumbnailUrl"`
	PreviewURL   string        `json:"previewUrl"`
	UserID       string        `json:"userId"`
	CreatedAt    time.Time     `json:"createdAt"`
	BatchID      string        `json:"batchId"`
	OutputIndex  int           `json:"outputIndex"`
	Prompt       string        `json:"prompt"`
	Options      studioOptions `json:"options"`
	FolderIDs    []string      `json:"folderIds"`
}
type studioGeneration struct {
	ID          string             `json:"id"`
	UserID      string             `json:"userId"`
	Username    string             `json:"username"`
	Prompt      string             `json:"prompt"`
	Attachments []studioAttachment `json:"attachments"`
	Options     studioOptions      `json:"options"`
	Status      string             `json:"status"`
	ImageIDs    []string           `json:"imageIds"`
	CreatedAt   time.Time          `json:"createdAt"`
	CompletedAt *time.Time         `json:"completedAt,omitempty"`
	DurationMS  *int64             `json:"durationMs,omitempty"`
	Cost        int64              `json:"cost"`
	Error       string             `json:"error,omitempty"`
}
type studioFolder struct {
	ID        string    `json:"id"`
	UserID    string    `json:"userId"`
	Name      string    `json:"name"`
	CreatedAt time.Time `json:"createdAt"`
}
type studioUser struct {
	ID        string    `json:"id"`
	Username  string    `json:"username"`
	Role      string    `json:"role"`
	Status    string    `json:"status"`
	Balance   int64     `json:"balance"`
	CreatedAt time.Time `json:"createdAt"`
}

func toStudioUser(u user) studioUser {
	status := "disabled"
	if u.Active {
		status = "enabled"
	}
	return studioUser{u.ID, u.Username, u.Role, status, u.Credits, u.CreatedAt}
}

func migrateStudio(ctx context.Context, db *sql.DB) error {
	for _, ddl := range []string{
		`CREATE TABLE IF NOT EXISTS studio_batches (id CHAR(32) PRIMARY KEY,user_id CHAR(32) NOT NULL,options JSON NOT NULL,fingerprint CHAR(64) NOT NULL,FOREIGN KEY(user_id) REFERENCES users(id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
		`CREATE TABLE IF NOT EXISTS studio_batch_jobs (batch_id CHAR(32) NOT NULL,job_id CHAR(32) NOT NULL UNIQUE,output_index INT NOT NULL,PRIMARY KEY(batch_id,output_index),FOREIGN KEY(batch_id) REFERENCES studio_batches(id),FOREIGN KEY(job_id) REFERENCES jobs(id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
		`CREATE TABLE IF NOT EXISTS studio_attachments (id CHAR(32) PRIMARY KEY,user_id CHAR(32) NOT NULL,name VARCHAR(255) NOT NULL,mime VARCHAR(32) NOT NULL,width INT NOT NULL,height INT NOT NULL,content LONGBLOB NOT NULL,created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),FOREIGN KEY(user_id) REFERENCES users(id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
		`CREATE TABLE IF NOT EXISTS studio_batch_attachments (batch_id CHAR(32) NOT NULL,attachment_id CHAR(32) NOT NULL,position INT NOT NULL,PRIMARY KEY(batch_id,position),FOREIGN KEY(batch_id) REFERENCES studio_batches(id),FOREIGN KEY(attachment_id) REFERENCES studio_attachments(id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
		`CREATE TABLE IF NOT EXISTS studio_folders (id CHAR(32) PRIMARY KEY,user_id CHAR(32) NOT NULL,name VARCHAR(60) NOT NULL,created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),UNIQUE KEY idx_folder_name(user_id,name),FOREIGN KEY(user_id) REFERENCES users(id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
		`CREATE TABLE IF NOT EXISTS studio_image_folders (image_id CHAR(32) NOT NULL,folder_id CHAR(32) NOT NULL,PRIMARY KEY(image_id,folder_id),FOREIGN KEY(image_id) REFERENCES images(id),FOREIGN KEY(folder_id) REFERENCES studio_folders(id) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
	} {
		if _, err := db.ExecContext(ctx, ddl); err != nil {
			return err
		}
	}
	return nil
}
func (a *app) studioRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/studio/state", a.studioState)
	mux.HandleFunc("GET /api/studio/models", func(w http.ResponseWriter, r *http.Request) { jsonResponse(w, 200, studioModels()) })
	mux.HandleFunc("POST /api/studio/attachments", a.uploadStudioAttachment)
	mux.HandleFunc("GET /api/studio/attachments/{id}", a.getStudioAttachment)
	mux.HandleFunc("POST /api/studio/generations", a.createStudioGeneration)
	mux.HandleFunc("POST /api/studio/folders", a.createStudioFolder)
	mux.HandleFunc("PATCH /api/studio/folders/{id}", a.renameStudioFolder)
	mux.HandleFunc("DELETE /api/studio/folders/{id}", a.deleteStudioFolder)
	mux.HandleFunc("POST /api/studio/folder-memberships", a.studioMemberships)
}

func studioModels() []map[string]any {
	gptRatios := []string{"自动", "1:1", "16:9", "9:16", "3:2"}
	geminiRatios := []string{"自动", "21:9", "16:9", "4:3", "1:1", "9:16"}
	return []map[string]any{
		{"id": "gpt-image-2", "name": "GPT Image 2", "qualities": []string{}, "resolutions": []string{}, "ratios": gptRatios},
		{"id": "gpt-image-1.5", "name": "GPT Image 1.5", "qualities": []string{}, "resolutions": []string{}, "ratios": gptRatios},
		{"id": "gpt-image-2.5-sunburst", "name": "GPT Image 2.5 Sunburst", "qualities": []string{}, "resolutions": []string{}, "ratios": gptRatios},
		{"id": "gemini-3.1-flash-image", "name": "Gemini 3.1 Flash Image", "qualities": []string{}, "resolutions": []string{"0.5K", "1K", "2K", "4K"}, "ratios": geminiRatios},
		{"id": "gemini-3-pro-image", "name": "Gemini 3 Pro Image", "qualities": []string{}, "resolutions": []string{"0.5K", "1K", "2K", "4K"}, "ratios": []string{"自动", "1:1", "9:16", "16:9"}},
	}
}
func validateStudioOptions(o studioOptions, editing bool) error {
	if o.Count < 1 || o.Count > 4 {
		return errors.New("每次可生成 1–4 张图片")
	}
	for _, m := range studioModels() {
		if m["id"] != o.ModelID {
			continue
		}
		for _, field := range []struct{ k, v string }{{"ratios", o.Ratio}, {"qualities", o.Quality}, {"resolutions", o.Resolution}} {
			values := m[field.k].([]string)
			if editing && field.k == "resolutions" {
				values = []string{}
			}
			valid := len(values) == 0 && field.v == ""
			for _, v := range values {
				valid = valid || v == field.v
			}
			if !valid {
				return fmt.Errorf("无效的模型参数：%s", field.k)
			}
		}
		return nil
	}
	return errors.New("请选择有效模型")
}

func (a *app) uploadStudioAttachment(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 21<<20)
	if err := r.ParseMultipartForm(1 << 20); err != nil {
		apiError(w, 400, "单张图片不能超过 20 MB")
		return
	}
	defer r.MultipartForm.RemoveAll()
	files := r.MultipartForm.File["image"]
	if len(files) != 1 {
		apiError(w, 400, "请选择一张图片")
		return
	}
	f, err := files[0].Open()
	if err != nil {
		apiError(w, 400, "无法读取图片")
		return
	}
	defer f.Close()
	content, err := io.ReadAll(io.LimitReader(f, (20<<20)+1))
	if err != nil || len(content) > 20<<20 {
		apiError(w, 400, "单张图片不能超过 20 MB")
		return
	}
	cfg, format, err := image.DecodeConfig(bytes.NewReader(content))
	if err != nil || !strings.Contains("|png|jpeg|webp|gif|", "|"+format+"|") || cfg.Width < 1 || cfg.Height < 1 || int64(cfg.Width)*int64(cfg.Height) > 64_000_000 {
		apiError(w, 400, "请选择有效的 PNG、JPG、WebP 或 GIF 图片（最多 6400 万像素）")
		return
	}
	id := newID()
	name := filepath.Base(files[0].Filename)
	if !utf8.ValidString(name) || utf8.RuneCountInString(name) > 255 {
		name = "image." + format
	}
	_, err = a.db.ExecContext(r.Context(), "INSERT INTO studio_attachments(id,user_id,name,mime,width,height,content) VALUES(?,?,?,?,?,?,?)", id, currentUser(r).ID, name, "image/"+format, cfg.Width, cfg.Height, content)
	if err != nil {
		apiError(w, 500, "保存附件失败")
		return
	}
	jsonResponse(w, 201, studioAttachment{id, name, "/api/studio/attachments/" + id, cfg.Width, cfg.Height})
}
func (a *app) getStudioAttachment(w http.ResponseWriter, r *http.Request) {
	if !validID(r.PathValue("id")) {
		apiError(w, 404, "附件不存在")
		return
	}
	var content []byte
	var mime string
	scope, args := ownerScope(r, "user_id")
	err := a.db.QueryRowContext(r.Context(), "SELECT mime,content FROM studio_attachments WHERE id=?"+scope, append([]any{r.PathValue("id")}, args...)...).Scan(&mime, &content)
	if errors.Is(err, sql.ErrNoRows) {
		apiError(w, 404, "附件不存在")
		return
	}
	if err != nil {
		apiError(w, 500, "读取附件失败")
		return
	}
	serveCachedImage(w, r, content, mime)
}

func (a *app) createStudioGeneration(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Prompt          string        `json:"prompt"`
		AttachmentIDs   []string      `json:"attachmentIds"`
		Options         studioOptions `json:"options"`
		RequestID       string        `json:"requestId"`
		ExpectedCredits *int64        `json:"expectedCredits"`
	}
	// A 6000-character prompt can exceed the legacy JSON decoder's 4 KB cap.
	r.Body = http.MaxBytesReader(w, r.Body, 32<<10)
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if err := d.Decode(&input); err != nil || d.Decode(&struct{}{}) != io.EOF {
		apiError(w, 400, "请求格式无效")
		return
	}
	input.Prompt = strings.TrimSpace(input.Prompt)
	if !validID(input.RequestID) || input.Prompt == "" || utf8.RuneCountInString(input.Prompt) > 6000 || len(input.AttachmentIDs) > 6 || input.ExpectedCredits == nil {
		apiError(w, 400, "请填写提示词、有效参数和最多 6 张附件")
		return
	}
	if err := validateStudioOptions(input.Options, len(input.AttachmentIDs) > 0); err != nil {
		apiError(w, 400, err.Error())
		return
	}
	if len(input.AttachmentIDs) > 0 && (input.Options.Ratio != "自动" || input.Options.Quality != "" || input.Options.Resolution != "") {
		apiError(w, 400, "参考图编辑使用原图比例和默认清晰度")
		return
	}
	seen := map[string]bool{}
	for _, id := range input.AttachmentIDs {
		if !validID(id) || seen[id] {
			apiError(w, 400, "附件编号无效或重复")
			return
		}
		seen[id] = true
	}
	raw, _ := json.Marshal(input)
	sum := sha256.Sum256(raw)
	fingerprint := hex.EncodeToString(sum[:])
	ctx := r.Context()
	uid := currentUser(r).ID
	a.submit.Lock()
	defer a.submit.Unlock()
	var oldUser, oldFingerprint string
	err := a.db.QueryRowContext(ctx, "SELECT user_id,fingerprint FROM studio_batches WHERE id=?", input.RequestID).Scan(&oldUser, &oldFingerprint)
	if err == nil {
		if oldUser != uid || oldFingerprint != fingerprint {
			apiError(w, 409, "请求编号已使用，请检查历史记录")
			return
		}
		jsonResponse(w, 200, map[string]string{"id": input.RequestID})
		return
	}
	if !errors.Is(err, sql.ErrNoRows) {
		apiError(w, 500, "读取提交状态失败")
		return
	}
	if a.upstream.key == "" {
		apiError(w, 503, "请先在服务端配置图片服务")
		return
	}
	var pending int
	if err = a.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM jobs WHERE status IN ('queued','running')").Scan(&pending); err != nil {
		apiError(w, 500, "读取任务队列失败")
		return
	}
	if pending+input.Options.Count > maxBatchImages {
		apiError(w, 429, "当前队列已满，请等待已有任务完成")
		return
	}
	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		apiError(w, 500, "创建任务失败")
		return
	}
	defer tx.Rollback()
	// All resources are checked against the actor, including when the actor is an administrator.
	for _, id := range input.AttachmentIDs {
		var owner string
		err = tx.QueryRowContext(ctx, "SELECT user_id FROM studio_attachments WHERE id=?", id).Scan(&owner)
		if errors.Is(err, sql.ErrNoRows) {
			var mime string
			var data []byte
			var width, height int
			err = tx.QueryRowContext(ctx, "SELECT jobs.user_id,images.mime,images.content,images.width,images.height FROM images JOIN jobs ON jobs.id=images.job_id WHERE images.id=? AND jobs.user_id=?", id, uid).Scan(&owner, &mime, &data, &width, &height)
			if err == nil {
				_, err = tx.ExecContext(ctx, "INSERT INTO studio_attachments(id,user_id,name,mime,width,height,content) VALUES(?,?,?,?,?,?,?)", id, uid, "生成图片", mime, width, height, data)
			}
		}
		if errors.Is(err, sql.ErrNoRows) || err == nil && owner != uid {
			apiError(w, 404, "附件不存在或无权使用")
			return
		}
		if err != nil {
			apiError(w, 500, "读取附件失败")
			return
		}
	}
	mode := "generate"
	if len(input.AttachmentIDs) > 0 {
		mode = "edit"
	}
	jobs := make([]job, input.Options.Count)
	for i := range jobs {
		jobs[i] = job{Model: input.Options.ModelID}
	}
	balance, err := reserveBatch(ctx, tx, uid, jobs)
	if errors.Is(err, errInsufficientCredits) {
		apiError(w, 402, err.Error())
		return
	}
	if err != nil {
		apiError(w, 500, "冻结积分失败")
		return
	}
	var reserved int64
	for _, j := range jobs {
		reserved += j.CreditsCost
	}
	if reserved != *input.ExpectedCredits {
		apiError(w, 409, "模型价格已变化，请确认最新积分价格后重新提交")
		return
	}
	options, _ := json.Marshal(input.Options)
	if _, err = tx.ExecContext(ctx, "INSERT INTO studio_batches(id,user_id,options,fingerprint) VALUES(?,?,?,?)", input.RequestID, uid, options, fingerprint); err != nil {
		apiError(w, 500, "保存任务失败")
		return
	}
	for i, id := range input.AttachmentIDs {
		if _, err = tx.ExecContext(ctx, "INSERT INTO studio_batch_attachments(batch_id,attachment_id,position) VALUES(?,?,?)", input.RequestID, id, i); err != nil {
			apiError(w, 500, "保存附件关系失败")
			return
		}
	}
	for i, j := range jobs {
		id := newID()
		_, err = tx.ExecContext(ctx, `INSERT INTO jobs(id,batch_id,mode,model,prompt,effective_prompt,ratio,resolution,status,error,user_id,credits_cost,credits_state,created_at) VALUES(?,?,?,?,?,?,?,?,'queued','',?,?,'reserved',UTC_TIMESTAMP(3))`, id, input.RequestID, mode, input.Options.ModelID, input.Prompt, input.Prompt, input.Options.Ratio, input.Options.Resolution, uid, j.CreditsCost)
		if err == nil {
			_, err = tx.ExecContext(ctx, "INSERT INTO studio_batch_jobs(batch_id,job_id,output_index) VALUES(?,?,?)", input.RequestID, id, i)
		}
		balance -= j.CreditsCost
		if err == nil {
			_, err = tx.ExecContext(ctx, "INSERT INTO credit_ledger(user_id,request_key,kind,delta,balance_after,job_id) VALUES(?,?,'reserve',?,?,?)", uid, "reserve:"+id, -j.CreditsCost, balance, id)
		}
		if err != nil {
			apiError(w, 500, "保存任务与积分流水失败，未提交")
			return
		}
	}
	if err = tx.Commit(); err != nil {
		apiError(w, 500, "提交结果未知，请先查看历史记录；不要重复提交")
		return
	}
	jsonResponse(w, 202, map[string]string{"id": input.RequestID})
}

func (a *app) loadStudioJob(ctx context.Context, j *job) error {
	var raw []byte
	err := a.db.QueryRowContext(ctx, "SELECT options FROM studio_batches WHERE id=?", j.BatchID).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return errors.New("读取任务参数失败，未调用上游")
	}
	if err = json.Unmarshal(raw, &j.Studio); err != nil {
		return errors.New("任务参数无效，未调用上游")
	}
	rows, err := a.db.QueryContext(ctx, "SELECT a.mime,a.content FROM studio_batch_attachments b JOIN studio_attachments a ON a.id=b.attachment_id WHERE b.batch_id=? ORDER BY b.position", j.BatchID)
	if err != nil {
		return errors.New("读取任务附件失败，未调用上游")
	}
	defer rows.Close()
	for rows.Next() {
		var p picture
		if err = rows.Scan(&p.MIME, &p.Content); err != nil {
			return errors.New("读取任务附件失败，未调用上游")
		}
		j.StudioInputs = append(j.StudioInputs, p)
	}
	return rows.Err()
}

func (a *app) studioState(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	actor := currentUser(r)
	scope, args := ownerScope(r, "jobs.user_id")
	users := []studioUser{}
	userSQL := "SELECT id,username,role,active,created_at,credits FROM users"
	userArgs := []any{}
	if actor.Role != "admin" {
		userSQL += " WHERE id=?"
		userArgs = append(userArgs, actor.ID)
	}
	rows, err := a.db.QueryContext(ctx, userSQL+" ORDER BY created_at DESC,id", userArgs...)
	if err != nil {
		apiError(w, 500, "读取账户失败")
		return
	}
	for rows.Next() {
		var u user
		if err = rows.Scan(&u.ID, &u.Username, &u.Role, &u.Active, &u.CreatedAt, &u.Credits); err != nil {
			break
		}
		users = append(users, toStudioUser(u))
	}
	err = errors.Join(err, rows.Err())
	rows.Close()
	if err != nil {
		apiError(w, 500, "读取账户失败")
		return
	}
	prices := map[string]int64{}
	versions := map[string]int{}
	updated := map[string]time.Time{}
	rows, err = a.db.QueryContext(ctx, "SELECT model,credits,version,updated_at FROM model_prices")
	if err != nil {
		apiError(w, 500, "读取价格失败")
		return
	}
	for rows.Next() {
		var p modelPrice
		if err = rows.Scan(&p.Model, &p.Credits, &p.Version, &p.UpdatedAt); err != nil {
			break
		}
		prices[p.Model] = p.Credits
		versions[p.Model] = p.Version
		updated[p.Model] = p.UpdatedAt
	}
	err = errors.Join(err, rows.Err())
	rows.Close()
	if err != nil {
		apiError(w, 500, "读取价格失败")
		return
	}
	rows, err = a.db.QueryContext(ctx, "SELECT "+jobColumns+" FROM jobs WHERE 1=1"+scope+" ORDER BY created_at,id", args...)
	if err != nil {
		apiError(w, 500, "读取任务失败")
		return
	}
	jobs := []job{}
	for rows.Next() {
		var j job
		j, err = scanJob(rows)
		if err != nil {
			break
		}
		jobs = append(jobs, j)
	}
	err = errors.Join(err, rows.Err())
	rows.Close()
	if err != nil {
		apiError(w, 500, "读取任务失败")
		return
	}
	// Read metadata in bulk; no binary image content is included in the snapshot.
	opts := map[string]studioOptions{}
	positions := map[string]int{}
	attachments := map[string][]studioAttachment{}
	batchScope, batchArgs := ownerScope(r, "b.user_id")
	rows, err = a.db.QueryContext(ctx, "SELECT b.id,b.options FROM studio_batches b WHERE 1=1"+batchScope, batchArgs...)
	if err != nil {
		apiError(w, 500, "读取任务参数失败")
		return
	}
	for rows.Next() {
		var id string
		var raw []byte
		var o studioOptions
		if err = rows.Scan(&id, &raw); err != nil {
			break
		}
		if err = json.Unmarshal(raw, &o); err != nil {
			break
		}
		opts[id] = o
	}
	err = errors.Join(err, rows.Err())
	rows.Close()
	if err != nil {
		apiError(w, 500, "读取任务参数失败")
		return
	}
	rows, err = a.db.QueryContext(ctx, "SELECT bj.job_id,bj.output_index FROM studio_batch_jobs bj JOIN studio_batches b ON b.id=bj.batch_id WHERE 1=1"+batchScope, batchArgs...)
	if err != nil {
		apiError(w, 500, "读取输出顺序失败")
		return
	}
	for rows.Next() {
		var id string
		var pos int
		if err = rows.Scan(&id, &pos); err != nil {
			break
		}
		positions[id] = pos
	}
	err = errors.Join(err, rows.Err())
	rows.Close()
	if err != nil {
		apiError(w, 500, "读取输出顺序失败")
		return
	}
	rows, err = a.db.QueryContext(ctx, "SELECT b.id,a.id,a.name,a.width,a.height FROM studio_batch_attachments ba JOIN studio_batches b ON b.id=ba.batch_id JOIN studio_attachments a ON a.id=ba.attachment_id WHERE 1=1"+batchScope+" ORDER BY ba.position", batchArgs...)
	if err != nil {
		apiError(w, 500, "读取附件失败")
		return
	}
	for rows.Next() {
		var id string
		var att studioAttachment
		if err = rows.Scan(&id, &att.ID, &att.Name, &att.Width, &att.Height); err != nil {
			break
		}
		att.URL = "/api/studio/attachments/" + att.ID
		attachments[id] = append(attachments[id], att)
	}
	err = errors.Join(err, rows.Err())
	rows.Close()
	if err != nil {
		apiError(w, 500, "读取附件失败")
		return
	}
	// Memberships and folders always belong to the current workspace, even for administrators.
	folders := []studioFolder{}
	memberships := map[string][]string{}
	rows, err = a.db.QueryContext(ctx, "SELECT id,user_id,name,created_at FROM studio_folders WHERE user_id=? ORDER BY created_at,id", actor.ID)
	if err != nil {
		apiError(w, 500, "读取文件夹失败")
		return
	}
	for rows.Next() {
		var f studioFolder
		if err = rows.Scan(&f.ID, &f.UserID, &f.Name, &f.CreatedAt); err != nil {
			break
		}
		folders = append(folders, f)
	}
	err = errors.Join(err, rows.Err())
	rows.Close()
	if err != nil {
		apiError(w, 500, "读取文件夹失败")
		return
	}
	rows, err = a.db.QueryContext(ctx, "SELECT m.image_id,m.folder_id FROM studio_image_folders m JOIN studio_folders f ON f.id=m.folder_id WHERE f.user_id=?", actor.ID)
	if err != nil {
		apiError(w, 500, "读取归类失败")
		return
	}
	for rows.Next() {
		var id, fid string
		if err = rows.Scan(&id, &fid); err != nil {
			break
		}
		memberships[id] = append(memberships[id], fid)
	}
	err = errors.Join(err, rows.Err())
	rows.Close()
	if err != nil {
		apiError(w, 500, "读取归类失败")
		return
	}
	// Read image metadata once for the whole authorized snapshot. Querying once
	// per job made startup and every poll slower as history accumulated.
	rows, err = a.db.QueryContext(ctx, `SELECT images.job_id,images.id,images.mime,images.width,images.height,images.byte_size
		FROM images JOIN jobs ON jobs.id=images.job_id WHERE 1=1`+scope+` ORDER BY images.job_id,images.id`, args...)
	if err != nil {
		apiError(w, 500, "读取图片失败")
		return
	}
	pictures := map[string][]picture{}
	for rows.Next() {
		var jobID string
		var p picture
		if err = rows.Scan(&jobID, &p.ID, &p.MIME, &p.Width, &p.Height, &p.Bytes); err != nil {
			break
		}
		p.URL = "/api/images/" + p.ID
		p.ThumbnailURL = p.URL + "/thumbnail/" + thumbnailVersion
		p.PreviewURL = p.URL + "/preview/" + previewVersion
		pictures[jobID] = append(pictures[jobID], p)
	}
	err = errors.Join(err, rows.Err())
	rows.Close()
	if err != nil {
		apiError(w, 500, "读取图片失败")
		return
	}
	for i := range jobs {
		jobs[i].Images = pictures[jobs[i].ID]
	}
	generations, assets := studioHistory(jobs, opts, positions, attachments, memberships)
	jsonResponse(w, 200, map[string]any{"version": 1, "users": users, "currentUserId": actor.ID, "prices": prices, "priceVersions": versions, "priceUpdatedAt": updated, "assets": assets, "folders": folders, "generations": generations, "preferences": map[string]any{"theme": "system", "enterToSend": true}})
}

func studioHistory(jobs []job, opts map[string]studioOptions, positions map[string]int, attachments map[string][]studioAttachment, memberships map[string][]string) ([]studioGeneration, []studioAsset) {
	grouped := map[string][]job{}
	keys := []string{}
	for _, j := range jobs {
		key := j.BatchID + ":" + j.Model
		if _, ok := grouped[key]; !ok {
			keys = append(keys, key)
		}
		grouped[key] = append(grouped[key], j)
	}
	generations := []studioGeneration{}
	assets := []studioAsset{}
	for _, key := range keys {
		batch := grouped[key]
		sort.SliceStable(batch, func(i, j int) bool { return positions[batch[i].ID] < positions[batch[j].ID] })
		first := batch[0]
		o, ok := opts[first.BatchID]
		if !ok {
			ratio := first.Ratio
			if ratio == "auto" {
				ratio = "自动"
			}
			o = studioOptions{ModelID: first.Model, Ratio: ratio, Count: len(batch)}
			if first.Resolution != "default" {
				o.Resolution = first.Resolution
			}
		}
		id := first.BatchID
		if !ok {
			id += "-" + first.Model
		}
		g := studioGeneration{ID: id, UserID: first.UserID, Username: first.Username, Prompt: first.Prompt, Options: o, Status: "completed", ImageIDs: []string{}, Attachments: attachments[first.BatchID], CreatedAt: first.CreatedAt}
		if g.Attachments == nil {
			g.Attachments = []studioAttachment{}
		}
		if !ok && first.HasInput {
			g.Attachments = append(g.Attachments, studioAttachment{ID: first.ID + "-input", Name: "输入图片", URL: "/api/jobs/" + first.ID + "/input"})
		}
		if !ok && first.HasReference {
			g.Attachments = append(g.Attachments, studioAttachment{ID: first.ID + "-reference", Name: "参考图片", URL: "/api/jobs/" + first.ID + "/reference"})
		}
		active, failed := false, false
		var started, finished *time.Time
		for i, j := range batch {
			active = active || j.Status == "queued" || j.Status == "running"
			failed = failed || j.Status == "failed"
			if j.Error != "" {
				if g.Error != "" {
					g.Error += "；"
				}
				g.Error += fmt.Sprintf("第 %d 张：%s", i+1, j.Error)
			}
			if j.CreditsState == "charged" || j.CreditsState == "reserved" {
				g.Cost += j.CreditsCost
			}
			if j.StartedAt != nil && (started == nil || j.StartedAt.Before(*started)) {
				started = j.StartedAt
			}
			if j.FinishedAt != nil && (finished == nil || j.FinishedAt.After(*finished)) {
				finished = j.FinishedAt
			}
			for _, p := range j.Images {
				fids := memberships[p.ID]
				if fids == nil {
					fids = []string{}
				}
				assets = append(assets, studioAsset{studioAttachment: studioAttachment{p.ID, "生成图片-" + p.ID + "." + strings.TrimPrefix(p.MIME, "image/"), p.URL, p.Width, p.Height}, ThumbnailURL: p.ThumbnailURL, PreviewURL: p.PreviewURL, UserID: j.UserID, CreatedAt: j.CreatedAt, BatchID: id, OutputIndex: i, Prompt: j.Prompt, Options: o, FolderIDs: fids})
				g.ImageIDs = append(g.ImageIDs, p.ID)
			}
		}
		if active {
			g.Status = "processing"
		} else {
			g.CompletedAt = finished
			if started != nil && finished != nil {
				ms := finished.Sub(*started).Milliseconds()
				g.DurationMS = &ms
			}
			if failed {
				g.Status = "failed"
			}
		}
		generations = append(generations, g)
	}
	sort.SliceStable(generations, func(i, j int) bool { return generations[i].CreatedAt.Before(generations[j].CreatedAt) })
	sort.SliceStable(assets, func(i, j int) bool {
		if assets[i].BatchID == assets[j].BatchID {
			return assets[i].OutputIndex < assets[j].OutputIndex
		}
		return assets[i].CreatedAt.After(assets[j].CreatedAt)
	})
	return generations, assets
}

func folderWriteError(w http.ResponseWriter, err error) {
	var e *mysql.MySQLError
	if errors.As(err, &e) && e.Number == 1062 {
		apiError(w, 409, "此文件夹名称已被使用")
		return
	}
	apiError(w, 500, "保存文件夹失败")
}
func studioFolderName(w http.ResponseWriter, r *http.Request) (string, bool) {
	var input struct {
		Name string `json:"name"`
	}
	if !decodeJSON(w, r, &input) {
		return "", false
	}
	name := strings.TrimSpace(input.Name)
	if name == "" || utf8.RuneCountInString(name) > 60 {
		apiError(w, 400, "请输入 1–60 个字符的文件夹名称")
		return "", false
	}
	return name, true
}
func (a *app) createStudioFolder(w http.ResponseWriter, r *http.Request) {
	name, ok := studioFolderName(w, r)
	if !ok {
		return
	}
	f := studioFolder{newID(), currentUser(r).ID, name, time.Now().UTC()}
	_, err := a.db.ExecContext(r.Context(), "INSERT INTO studio_folders(id,user_id,name,created_at) VALUES(?,?,?,?)", f.ID, f.UserID, f.Name, f.CreatedAt)
	if err != nil {
		folderWriteError(w, err)
		return
	}
	jsonResponse(w, 201, f)
}
func (a *app) renameStudioFolder(w http.ResponseWriter, r *http.Request) {
	name, ok := studioFolderName(w, r)
	if !ok {
		return
	}
	id := r.PathValue("id")
	if !validID(id) {
		apiError(w, 404, "文件夹不存在")
		return
	}
	var found string
	err := a.db.QueryRowContext(r.Context(), "SELECT id FROM studio_folders WHERE id=? AND user_id=?", id, currentUser(r).ID).Scan(&found)
	if errors.Is(err, sql.ErrNoRows) {
		apiError(w, 404, "文件夹不存在")
		return
	}
	if err != nil {
		apiError(w, 500, "读取文件夹失败")
		return
	}
	_, err = a.db.ExecContext(r.Context(), "UPDATE studio_folders SET name=? WHERE id=? AND user_id=?", name, id, currentUser(r).ID)
	if err != nil {
		folderWriteError(w, err)
		return
	}
	jsonResponse(w, 200, map[string]bool{"ok": true})
}
func (a *app) deleteStudioFolder(w http.ResponseWriter, r *http.Request) {
	if !validID(r.PathValue("id")) {
		apiError(w, 404, "文件夹不存在")
		return
	}
	result, err := a.db.ExecContext(r.Context(), "DELETE FROM studio_folders WHERE id=? AND user_id=?", r.PathValue("id"), currentUser(r).ID)
	if err != nil {
		apiError(w, 500, "删除文件夹失败")
		return
	}
	n, _ := result.RowsAffected()
	if n == 0 {
		apiError(w, 404, "文件夹不存在")
		return
	}
	jsonResponse(w, 200, map[string]bool{"ok": true})
}
func (a *app) studioMemberships(w http.ResponseWriter, r *http.Request) {
	var input struct {
		ImageIDs  []string `json:"imageIds"`
		FolderIDs []string `json:"folderIds"`
		Remove    bool     `json:"remove"`
	}
	// Bulk selections can exceed 4 KB, but are always bounded.
	r.Body = http.MaxBytesReader(w, r.Body, 64<<10)
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if d.Decode(&input) != nil || d.Decode(&struct{}{}) != io.EOF || len(input.ImageIDs) == 0 || len(input.ImageIDs) > 500 || len(input.FolderIDs) == 0 || len(input.FolderIDs) > 100 {
		apiError(w, 400, "请选择有效的图片和文件夹（单次最多 500 张）")
		return
	}
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		apiError(w, 500, "归类失败")
		return
	}
	defer tx.Rollback()
	for _, item := range []struct {
		ids   []string
		query string
	}{{input.FolderIDs, "SELECT id FROM studio_folders WHERE id=? AND user_id=? FOR UPDATE"}, {input.ImageIDs, "SELECT images.id FROM images JOIN jobs ON jobs.id=images.job_id WHERE images.id=? AND jobs.user_id=? FOR UPDATE"}} {
		for _, id := range item.ids {
			if !validID(id) {
				apiError(w, 404, "图片或文件夹不存在")
				return
			}
			var found string
			err = tx.QueryRowContext(r.Context(), item.query, id, currentUser(r).ID).Scan(&found)
			if errors.Is(err, sql.ErrNoRows) {
				apiError(w, 404, "图片或文件夹不存在或无权访问")
				return
			}
			if err != nil {
				apiError(w, 500, "读取归类信息失败")
				return
			}
		}
	}
	for _, id := range input.ImageIDs {
		for _, fid := range input.FolderIDs {
			q := "INSERT INTO studio_image_folders(image_id,folder_id) VALUES(?,?) ON DUPLICATE KEY UPDATE image_id=VALUES(image_id)"
			if input.Remove {
				q = "DELETE FROM studio_image_folders WHERE image_id=? AND folder_id=?"
			}
			if _, err = tx.ExecContext(r.Context(), q, id, fid); err != nil {
				apiError(w, 500, "保存归类失败")
				return
			}
		}
	}
	if err = tx.Commit(); err != nil {
		apiError(w, 500, "归类提交失败，请刷新核对")
		return
	}
	jsonResponse(w, 200, map[string]bool{"ok": true})
}
