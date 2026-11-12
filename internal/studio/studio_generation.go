package studio

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	_ "golang.org/x/image/webp"
	_ "image/gif"
	"io"
	"net/http"
	"strings"
	"unicode/utf8"
)

func (a *App) createStudioGeneration(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Prompt          string            `json:"prompt"`
		AttachmentIDs   []string          `json:"attachmentIds"`
		Options         GenerationOptions `json:"options"`
		RequestID       string            `json:"requestId"`
		ExpectedCredits *int64            `json:"expectedCredits"`
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
	if !ValidID(input.RequestID) || input.Prompt == "" || utf8.RuneCountInString(input.Prompt) > 6000 || len(input.AttachmentIDs) > 6 || input.ExpectedCredits == nil {
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
		if !ValidID(id) || seen[id] {
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
	err := a.DB.QueryRowContext(ctx, "SELECT user_id,fingerprint FROM studio_batches WHERE id=?", input.RequestID).Scan(&oldUser, &oldFingerprint)
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
	if a.Upstream.Key == "" {
		apiError(w, 503, "请先在服务端配置图片服务")
		return
	}
	var pending int
	if err = a.DB.QueryRowContext(ctx, "SELECT COUNT(*) FROM jobs WHERE status IN ('queued','running')").Scan(&pending); err != nil {
		apiError(w, 500, "读取任务队列失败")
		return
	}
	if pending+input.Options.Count > maxBatchImages {
		apiError(w, 429, "当前队列已满，请等待已有任务完成")
		return
	}
	tx, err := a.DB.BeginTx(ctx, nil)
	if err != nil {
		apiError(w, 500, "创建任务失败")
		return
	}
	defer tx.Rollback()
	// All resources are checked against the actor, including when the actor is an administrator.
	for _, id := range input.AttachmentIDs {
		// Generated inputs may already have an independent attachment snapshot.
		// Check the original tombstone first so that snapshot cannot be reused to
		// bypass trash/purge. Locking serializes reuse against lifecycle changes.
		var imageOwner string
		var trashedAt, purgedAt sql.NullTime
		err = tx.QueryRowContext(ctx, `SELECT jobs.user_id,images.trashed_at,images.purged_at FROM images
			JOIN jobs ON jobs.id=images.job_id WHERE images.id=? FOR UPDATE`, id).Scan(&imageOwner, &trashedAt, &purgedAt)
		if err == nil && (imageOwner != uid || trashedAt.Valid || purgedAt.Valid) {
			apiError(w, 404, "附件不存在或无权使用")
			return
		}
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			apiError(w, 500, "读取附件状态失败")
			return
		}
		var owner string
		err = tx.QueryRowContext(ctx, "SELECT user_id FROM studio_attachments WHERE id=? FOR UPDATE", id).Scan(&owner)
		if errors.Is(err, sql.ErrNoRows) {
			var mime string
			var data []byte
			var width, height int
			err = tx.QueryRowContext(ctx, "SELECT jobs.user_id,images.mime,images.content,images.width,images.height FROM images JOIN jobs ON jobs.id=images.job_id WHERE images.id=? AND jobs.user_id=? AND images.trashed_at IS NULL AND images.purged_at IS NULL", id, uid).Scan(&owner, &mime, &data, &width, &height)
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
	jobs := make([]Job, input.Options.Count)
	for i := range jobs {
		jobs[i] = Job{Model: input.Options.ModelID}
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
		id := NewID()
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

func (a *App) loadStudioJob(ctx context.Context, j *Job) error {
	var raw []byte
	err := a.DB.QueryRowContext(ctx, "SELECT options FROM studio_batches WHERE id=?", j.BatchID).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return errors.New("读取任务参数失败，未调用上游")
	}
	if err = json.Unmarshal(raw, &j.Studio); err != nil {
		return errors.New("任务参数无效，未调用上游")
	}
	rows, err := a.DB.QueryContext(ctx, "SELECT a.mime,a.content FROM studio_batch_attachments b JOIN studio_attachments a ON a.id=b.attachment_id WHERE b.batch_id=? ORDER BY b.position", j.BatchID)
	if err != nil {
		return errors.New("读取任务附件失败，未调用上游")
	}
	defer rows.Close()
	for rows.Next() {
		var p Picture
		if err = rows.Scan(&p.MIME, &p.Content); err != nil {
			return errors.New("读取任务附件失败，未调用上游")
		}
		j.StudioInputs = append(j.StudioInputs, p)
	}
	return rows.Err()
}
