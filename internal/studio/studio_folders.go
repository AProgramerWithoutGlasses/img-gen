package studio

import (
	"database/sql"
	"encoding/json"
	"errors"
	"github.com/go-sql-driver/mysql"
	_ "golang.org/x/image/webp"
	_ "image/gif"
	"io"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"
)

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

func (a *App) createStudioFolder(w http.ResponseWriter, r *http.Request) {
	name, ok := studioFolderName(w, r)
	if !ok {
		return
	}
	f := Folder{NewID(), currentUser(r).ID, name, time.Now().UTC()}
	_, err := a.DB.ExecContext(r.Context(), "INSERT INTO studio_folders(id,user_id,name,created_at) VALUES(?,?,?,?)", f.ID, f.UserID, f.Name, f.CreatedAt)
	if err != nil {
		folderWriteError(w, err)
		return
	}
	jsonResponse(w, 201, f)
}

func (a *App) renameStudioFolder(w http.ResponseWriter, r *http.Request) {
	name, ok := studioFolderName(w, r)
	if !ok {
		return
	}
	id := r.PathValue("id")
	if !ValidID(id) {
		apiError(w, 404, "文件夹不存在")
		return
	}
	var found string
	err := a.DB.QueryRowContext(r.Context(), "SELECT id FROM studio_folders WHERE id=? AND user_id=?", id, currentUser(r).ID).Scan(&found)
	if errors.Is(err, sql.ErrNoRows) {
		apiError(w, 404, "文件夹不存在")
		return
	}
	if err != nil {
		apiError(w, 500, "读取文件夹失败")
		return
	}
	_, err = a.DB.ExecContext(r.Context(), "UPDATE studio_folders SET name=? WHERE id=? AND user_id=?", name, id, currentUser(r).ID)
	if err != nil {
		folderWriteError(w, err)
		return
	}
	jsonResponse(w, 200, map[string]bool{"ok": true})
}

func (a *App) deleteStudioFolder(w http.ResponseWriter, r *http.Request) {
	if !ValidID(r.PathValue("id")) {
		apiError(w, 404, "文件夹不存在")
		return
	}
	result, err := a.DB.ExecContext(r.Context(), "DELETE FROM studio_folders WHERE id=? AND user_id=?", r.PathValue("id"), currentUser(r).ID)
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

func (a *App) studioMemberships(w http.ResponseWriter, r *http.Request) {
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
	tx, err := a.DB.BeginTx(r.Context(), nil)
	if err != nil {
		apiError(w, 500, "归类失败")
		return
	}
	defer tx.Rollback()
	for _, item := range []struct {
		ids   []string
		query string
	}{{input.FolderIDs, "SELECT id FROM studio_folders WHERE id=? AND user_id=? FOR UPDATE"}, {input.ImageIDs, "SELECT images.id FROM images JOIN jobs ON jobs.id=images.job_id WHERE images.id=? AND jobs.user_id=? AND images.trashed_at IS NULL AND images.purged_at IS NULL FOR UPDATE"}} {
		for _, id := range item.ids {
			if !ValidID(id) {
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
