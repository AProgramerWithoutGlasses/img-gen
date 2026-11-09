package studio

import (
	"database/sql"
	"errors"
	_ "golang.org/x/image/webp"
	_ "image/gif"
	"io"
	"net/http"
	"path/filepath"
	"unicode/utf8"
)

func (a *App) uploadStudioAttachment(w http.ResponseWriter, r *http.Request) {
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
	cfg, format, _, err := attachmentPictureConfig(content)
	if err != nil {
		apiError(w, 400, "请选择有效的 PNG、JPG、WebP 或 GIF 图片（最多 6400 万像素）")
		return
	}
	id := NewID()
	name := filepath.Base(files[0].Filename)
	if !utf8.ValidString(name) || utf8.RuneCountInString(name) > 255 {
		name = "image." + format
	}
	_, err = a.DB.ExecContext(r.Context(), "INSERT INTO studio_attachments(id,user_id,name,mime,width,height,content) VALUES(?,?,?,?,?,?,?)", id, currentUser(r).ID, name, "image/"+format, cfg.Width, cfg.Height, content)
	if err != nil {
		apiError(w, 500, "保存附件失败")
		return
	}
	att := Attachment{ID: id, Name: name, Width: cfg.Width, Height: cfg.Height}
	setAttachmentRenditionURLs(&att)
	jsonResponse(w, 201, att)
}

func (a *App) getStudioAttachment(w http.ResponseWriter, r *http.Request) {
	if !ValidID(r.PathValue("id")) {
		apiError(w, 404, "附件不存在")
		return
	}
	var content []byte
	var mime string
	scope, args := ownerScope(r, "user_id")
	err := a.DB.QueryRowContext(r.Context(), "SELECT mime,content FROM studio_attachments WHERE id=?"+scope, append([]any{r.PathValue("id")}, args...)...).Scan(&mime, &content)
	if errors.Is(err, sql.ErrNoRows) {
		apiError(w, 404, "附件不存在")
		return
	}
	if err != nil {
		apiError(w, 500, "读取附件失败")
		return
	}
	ServeCachedImage(w, r, content, mime)
}
