package studio

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"
)

const studioImagePageSize = 50

type studioImageCursor struct {
	CreatedAt time.Time `json:"at"`
	ID        string    `json:"id"`
}

type studioImagePage struct {
	Images     []Asset `json:"images"`
	Total      int     `json:"total"`
	NextCursor string  `json:"nextCursor,omitempty"`
}

type imageSummary struct {
	Total        int            `json:"total"`
	FolderCounts map[string]int `json:"folderCounts"`
}

// selectedScope only interpolates fixed column names supplied by this package.
func selectedScope(column string, ids []string) (string, []any) {
	if len(ids) == 0 {
		return " AND 1=0", nil
	}
	args := make([]any, len(ids))
	for i, id := range ids {
		args[i] = id
	}
	return " AND " + column + " IN (" + strings.TrimSuffix(strings.Repeat("?,", len(ids)), ",") + ")", args
}

func (a *App) workspaceBatchIDs(ctx context.Context, userID string) ([]string, error) {
	// Select whole batches, including older unfinished ones. LIMIT is applied in
	// SQL before any image, attachment or generation metadata is read.
	rows, err := a.DB.QueryContext(ctx, `SELECT batch_id FROM (
		SELECT batch_id,MAX(created_at) AS latest FROM jobs WHERE user_id=?
		GROUP BY batch_id ORDER BY latest DESC,batch_id DESC LIMIT 10
	) recent UNION SELECT DISTINCT batch_id FROM jobs
		WHERE user_id=? AND status IN ('queued','running')`, userID, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	ids := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

func (a *App) studioImageSummary(ctx context.Context, userID string) (imageSummary, error) {
	summary := imageSummary{FolderCounts: map[string]int{}}
	if err := a.DB.QueryRowContext(ctx, `SELECT COUNT(*) FROM images
		JOIN jobs ON jobs.id=images.job_id WHERE jobs.user_id=?`, userID).Scan(&summary.Total); err != nil {
		return summary, err
	}
	rows, err := a.DB.QueryContext(ctx, `SELECT m.folder_id,COUNT(*) FROM studio_image_folders m
		JOIN studio_folders f ON f.id=m.folder_id JOIN images ON images.id=m.image_id
		JOIN jobs ON jobs.id=images.job_id WHERE f.user_id=? AND jobs.user_id=? GROUP BY m.folder_id`, userID, userID)
	if err != nil {
		return summary, err
	}
	defer rows.Close()
	for rows.Next() {
		var folderID string
		var count int
		if err := rows.Scan(&folderID, &count); err != nil {
			return summary, err
		}
		summary.FolderCounts[folderID] = count
	}
	return summary, rows.Err()
}

func (a *App) studioImages(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	actor := currentUser(r)
	limit := studioImagePageSize
	if raw := r.URL.Query().Get("limit"); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 1 {
			apiError(w, 400, "无效的图片数量")
			return
		}
		if value < limit {
			limit = value
		}
	}
	where, args := " WHERE jobs.user_id=?", []any{actor.ID}
	folderID := r.URL.Query().Get("folderId")
	if folderID == "unfiled" {
		where += " AND NOT EXISTS (SELECT 1 FROM studio_image_folders m JOIN studio_folders f ON f.id=m.folder_id WHERE m.image_id=images.id AND f.user_id=?)"
		args = append(args, actor.ID)
	} else if folderID != "" && folderID != "all" {
		if !ValidID(folderID) {
			apiError(w, 400, "无效的文件夹")
			return
		}
		var found string
		if err := a.DB.QueryRowContext(ctx, "SELECT id FROM studio_folders WHERE id=? AND user_id=?", folderID, actor.ID).Scan(&found); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				apiError(w, 404, "文件夹不存在")
			} else {
				apiError(w, 500, "读取文件夹失败")
			}
			return
		}
		where += " AND EXISTS (SELECT 1 FROM studio_image_folders m WHERE m.image_id=images.id AND m.folder_id=?)"
		args = append(args, folderID)
	}
	page := studioImagePage{Images: []Asset{}}
	from := " FROM images JOIN jobs ON jobs.id=images.job_id"
	if err := a.DB.QueryRowContext(ctx, "SELECT COUNT(*)"+from+where, args...).Scan(&page.Total); err != nil {
		apiError(w, 500, "读取图片数量失败")
		return
	}
	if raw := r.URL.Query().Get("cursor"); raw != "" {
		decoded, err := base64.RawURLEncoding.DecodeString(raw)
		var cursor studioImageCursor
		if err != nil || len(decoded) > 160 || json.Unmarshal(decoded, &cursor) != nil || !ValidID(cursor.ID) || cursor.CreatedAt.IsZero() {
			apiError(w, 400, "无效的图片游标")
			return
		}
		where += " AND (jobs.created_at < ? OR (jobs.created_at = ? AND images.id < ?))"
		args = append(args, cursor.CreatedAt.UTC(), cursor.CreatedAt.UTC(), cursor.ID)
	}
	rows, err := a.DB.QueryContext(ctx, "SELECT images.id,jobs.batch_id,jobs.created_at"+from+where+" ORDER BY jobs.created_at DESC,images.id DESC LIMIT ?", append(args, limit+1)...)
	if err != nil {
		apiError(w, 500, "读取图片失败")
		return
	}
	type pageItem struct {
		studioImageCursor
		BatchID string
	}
	items := []pageItem{}
	for rows.Next() {
		var item pageItem
		if err = rows.Scan(&item.ID, &item.BatchID, &item.CreatedAt); err != nil {
			break
		}
		items = append(items, item)
	}
	err = errors.Join(err, rows.Err())
	rows.Close()
	if err != nil {
		apiError(w, 500, "读取图片失败")
		return
	}
	if len(items) > limit {
		items = items[:limit]
		raw, _ := json.Marshal(items[len(items)-1].studioImageCursor)
		page.NextCursor = base64.RawURLEncoding.EncodeToString(raw)
	}
	if len(items) == 0 {
		jsonResponse(w, 200, page)
		return
	}
	batchIDs := []string{}
	seen := map[string]bool{}
	for _, item := range items {
		if !seen[item.BatchID] {
			batchIDs = append(batchIDs, item.BatchID)
			seen[item.BatchID] = true
		}
	}
	scope, batchArgs := selectedScope("jobs.batch_id", batchIDs)
	rows, err = a.DB.QueryContext(ctx, "SELECT "+jobColumns+" FROM jobs WHERE jobs.user_id=?"+scope+" ORDER BY created_at,id", append([]any{actor.ID}, batchArgs...)...)
	if err != nil {
		apiError(w, 500, "读取图片任务失败")
		return
	}
	jobs := []Job{}
	for rows.Next() {
		var job Job
		if job, err = ScanJob(rows); err != nil {
			break
		}
		jobs = append(jobs, job)
	}
	err = errors.Join(err, rows.Err())
	rows.Close()
	if err != nil {
		apiError(w, 500, "读取图片任务失败")
		return
	}
	_, assets, err := a.loadStudioHistory(ctx, jobs, actor.ID)
	if err != nil {
		apiError(w, 500, "读取图片信息失败")
		return
	}
	byID := make(map[string]Asset, len(assets))
	for _, image := range assets {
		byID[image.ID] = image
	}
	for _, item := range items {
		if image, ok := byID[item.ID]; ok {
			page.Images = append(page.Images, image)
		}
	}
	jsonResponse(w, 200, page)
}

// Both snapshots and image pages use the same history conversion. Every query
// reads only metadata for the jobs selected by its caller, never binary content.
func (a *App) loadStudioHistory(ctx context.Context, jobs []Job, membershipOwner string) ([]Generation, []Asset, error) {
	if len(jobs) == 0 {
		return []Generation{}, []Asset{}, nil
	}
	batchIDs, jobIDs := []string{}, []string{}
	seen := map[string]bool{}
	for _, job := range jobs {
		jobIDs = append(jobIDs, job.ID)
		if !seen[job.BatchID] {
			batchIDs = append(batchIDs, job.BatchID)
			seen[job.BatchID] = true
		}
	}
	batchScope, batchArgs := selectedScope("b.id", batchIDs)
	jobScope, jobArgs := selectedScope("images.job_id", jobIDs)
	opts := map[string]GenerationOptions{}
	positions := map[string]int{}
	attachments := map[string][]Attachment{}
	memberships := map[string][]string{}
	rows, err := a.DB.QueryContext(ctx, "SELECT b.id,b.options FROM studio_batches b WHERE 1=1"+batchScope, batchArgs...)
	if err != nil {
		return nil, nil, err
	}
	for rows.Next() {
		var id string
		var raw []byte
		var options GenerationOptions
		if err = rows.Scan(&id, &raw); err != nil {
			break
		}
		if err = json.Unmarshal(raw, &options); err != nil {
			break
		}
		opts[id] = options
	}
	err = errors.Join(err, rows.Err())
	rows.Close()
	if err != nil {
		return nil, nil, err
	}
	rows, err = a.DB.QueryContext(ctx, "SELECT bj.job_id,bj.output_index FROM studio_batch_jobs bj JOIN studio_batches b ON b.id=bj.batch_id WHERE 1=1"+batchScope, batchArgs...)
	if err != nil {
		return nil, nil, err
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
		return nil, nil, err
	}
	rows, err = a.DB.QueryContext(ctx, "SELECT b.id,a.id,a.name,COALESCE(p.source_width,a.width),COALESCE(p.source_height,a.height) FROM studio_batch_attachments ba JOIN studio_batches b ON b.id=ba.batch_id JOIN studio_attachments a ON a.id=ba.attachment_id LEFT JOIN studio_attachment_renditions p ON p.attachment_id=a.id AND p.kind='thumbnail' AND p.version=1 WHERE 1=1"+batchScope+" ORDER BY ba.position", batchArgs...)
	if err != nil {
		return nil, nil, err
	}
	for rows.Next() {
		var id string
		var attachment Attachment
		if err = rows.Scan(&id, &attachment.ID, &attachment.Name, &attachment.Width, &attachment.Height); err != nil {
			break
		}
		setAttachmentRenditionURLs(&attachment)
		attachments[id] = append(attachments[id], attachment)
	}
	err = errors.Join(err, rows.Err())
	rows.Close()
	if err != nil {
		return nil, nil, err
	}
	rows, err = a.DB.QueryContext(ctx, `SELECT m.image_id,m.folder_id FROM studio_image_folders m
		JOIN studio_folders f ON f.id=m.folder_id JOIN images ON images.id=m.image_id
		WHERE f.user_id=?`+jobScope, append([]any{membershipOwner}, jobArgs...)...)
	if err != nil {
		return nil, nil, err
	}
	for rows.Next() {
		var id, folderID string
		if err = rows.Scan(&id, &folderID); err != nil {
			break
		}
		memberships[id] = append(memberships[id], folderID)
	}
	err = errors.Join(err, rows.Err())
	rows.Close()
	if err != nil {
		return nil, nil, err
	}
	rows, err = a.DB.QueryContext(ctx, `SELECT images.job_id,images.id,images.mime,images.width,images.height,images.byte_size
		FROM images WHERE 1=1`+jobScope+` ORDER BY images.job_id,images.id`, jobArgs...)
	if err != nil {
		return nil, nil, err
	}
	pictures := map[string][]Picture{}
	for rows.Next() {
		var jobID string
		var picture Picture
		if err = rows.Scan(&jobID, &picture.ID, &picture.MIME, &picture.Width, &picture.Height, &picture.Bytes); err != nil {
			break
		}
		picture.URL = "/api/images/" + picture.ID
		picture.ThumbnailURL = picture.URL + "/thumbnail/" + thumbnailVersion
		picture.PreviewURL = picture.URL + "/preview/" + previewVersion
		pictures[jobID] = append(pictures[jobID], picture)
	}
	err = errors.Join(err, rows.Err())
	rows.Close()
	if err != nil {
		return nil, nil, err
	}
	for i := range jobs {
		jobs[i].Images = pictures[jobs[i].ID]
	}
	generations, assets := studioHistory(jobs, opts, positions, attachments, memberships)
	return generations, assets, nil
}
