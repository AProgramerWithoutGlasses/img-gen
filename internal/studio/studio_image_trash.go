package studio

import (
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"sort"
	"strings"
)

// Deleting an image never deletes its job, batch or credit ledger. A purged
// image retains only its identity and deletion timestamps; all output bytes
// and rendition caches are removed in the same transaction.
func (a *App) changeStudioImages(action string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var input struct {
			ImageIDs []string `json:"imageIds"`
		}
		r.Body = http.MaxBytesReader(w, r.Body, 32<<10)
		d := json.NewDecoder(r.Body)
		d.DisallowUnknownFields()
		if d.Decode(&input) != nil || d.Decode(&struct{}{}) != io.EOF || len(input.ImageIDs) == 0 || len(input.ImageIDs) > 500 {
			apiError(w, 400, "请选择有效的图片（单次最多 500 张）")
			return
		}
		ids := make([]string, 0, len(input.ImageIDs))
		seen := map[string]bool{}
		for _, raw := range input.ImageIDs {
			id := strings.ToLower(raw)
			if !ValidID(id) {
				apiError(w, 400, "无效的图片编号")
				return
			}
			if !seen[id] {
				ids = append(ids, id)
				seen[id] = true
			}
		}
		lockedIDs := append([]string{}, ids...)
		sort.Strings(lockedIDs)
		// Admission of an edit and deletion of its source have a single order,
		// including the legacy multipart endpoint that snapshots bytes eagerly.
		a.submit.Lock()
		defer a.submit.Unlock()
		// A cache miss must not recreate a rendition while its output is purged.
		if action == "purge" {
			a.thumbnails.Lock()
			defer a.thumbnails.Unlock()
		}
		tx, err := a.DB.BeginTx(r.Context(), nil)
		if err != nil {
			apiError(w, 500, "更新图片失败")
			return
		}
		defer tx.Rollback()
		uid := currentUser(r).ID
		for _, id := range lockedIDs {
			var trashed, purged sql.NullTime
			err := tx.QueryRowContext(r.Context(), `SELECT images.trashed_at,images.purged_at FROM images
				JOIN jobs ON jobs.id=images.job_id WHERE images.id=? AND jobs.user_id=? FOR UPDATE`, id, uid).Scan(&trashed, &purged)
			if errors.Is(err, sql.ErrNoRows) {
				apiError(w, 404, "图片不存在或无权操作")
				return
			}
			if err != nil {
				apiError(w, 500, "读取图片状态失败")
				return
			}
			if purged.Valid && action != "purge" {
				apiError(w, 409, "图片已彻底删除，请刷新列表")
				return
			}
			if action == "purge" && !trashed.Valid {
				apiError(w, 409, "请先将图片移入回收站")
				return
			}
		}
		for _, id := range lockedIDs {
			switch action {
			case "trash":
				_, err = tx.ExecContext(r.Context(), "UPDATE images SET trashed_at=COALESCE(trashed_at,UTC_TIMESTAMP(3)) WHERE id=?", id)
			case "restore":
				_, err = tx.ExecContext(r.Context(), "UPDATE images SET trashed_at=NULL WHERE id=?", id)
			case "purge":
				for _, query := range []string{
					"DELETE FROM image_thumbnails WHERE image_id=?",
					"DELETE FROM studio_image_folders WHERE image_id=?",
					"UPDATE images SET content='',mime='',width=0,height=0,byte_size=0,purged_at=COALESCE(purged_at,UTC_TIMESTAMP(3)) WHERE id=?",
				} {
					if _, err = tx.ExecContext(r.Context(), query, id); err != nil {
						break
					}
				}
				if err == nil {
					// Editing creates an independent input snapshot. Retain snapshots
					// already referenced by historical/queued batches so those tasks
					// and their records remain valid; discard unreferenced copies.
					_, err = tx.ExecContext(r.Context(), `DELETE FROM studio_attachments WHERE id=? AND user_id=?
						AND NOT EXISTS (SELECT 1 FROM studio_batch_attachments WHERE attachment_id=?)`, id, uid, id)
				}
			}
			if err != nil {
				apiError(w, 500, "更新图片失败，未保存本次操作")
				return
			}
		}
		if err = tx.Commit(); err != nil {
			apiError(w, 500, "操作结果未知，请刷新核对，不要重复操作")
			return
		}
		jsonResponse(w, 200, map[string]any{"action": action, "imageIds": ids})
	}
}
