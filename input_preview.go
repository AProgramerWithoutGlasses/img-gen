package main

import (
	"database/sql"
	"errors"
	"net/http"
)

// Detail metadata reads byte counts, never transfers the input BLOBs to Go.
func (a *app) inputPictures(r *http.Request, j *job) error {
	if !j.HasInput && !j.HasReference {
		return nil
	}
	var inputBytes, referenceBytes int
	scope, args := ownerScope(r, "user_id")
	err := a.db.QueryRowContext(r.Context(), `SELECT COALESCE(OCTET_LENGTH(input_image),0),COALESCE(OCTET_LENGTH(reference_image),0) FROM jobs WHERE id=?`+scope, append([]any{j.ID}, args...)...).Scan(&inputBytes, &referenceBytes)
	if err != nil {
		return err
	}
	picture := func(role string, size int) *sourcePicture {
		url := "/api/jobs/" + j.ID + "/" + role
		return &sourcePicture{URL: url, PreviewURL: url + "/preview/" + previewVersion, Bytes: size}
	}
	if j.HasInput {
		j.InputPicture = picture("input", inputBytes)
	}
	if j.HasReference {
		j.ReferencePicture = picture("reference", referenceBytes)
	}
	return nil
}

func (a *app) getInputPreview(w http.ResponseWriter, r *http.Request) {
	id, role := r.PathValue("id"), r.PathValue("role")
	// Only these fixed column names may enter SQL; input and reference cache separately.
	column := ""
	switch role {
	case "input":
		column = "input_image"
	case "reference":
		column = "reference_image"
	}
	if !validID(id) || column == "" || r.PathValue("version") != previewVersion {
		apiError(w, 404, "图片预览不存在")
		return
	}
	scope, args := ownerScope(r, "jobs.user_id")
	query := `SELECT p.content FROM jobs LEFT JOIN job_image_previews p
		ON p.job_id=jobs.id AND p.role=? AND p.version=? WHERE jobs.id=? AND jobs.` + column + ` IS NOT NULL` + scope
	queryArgs := append([]any{role, previewVersion, id}, args...)
	var data []byte
	read := func() error { return a.db.QueryRowContext(r.Context(), query, queryArgs...).Scan(&data) }
	err := read()
	if errors.Is(err, sql.ErrNoRows) {
		apiError(w, 404, "图片不存在")
		return
	}
	if err != nil {
		apiError(w, 500, "读取图片预览失败")
		return
	}
	if len(data) == 0 {
		err = func() error {
			// Share the result-image lock to bound decoding memory across all previews.
			a.thumbnails.Lock()
			defer a.thumbnails.Unlock()
			if err := r.Context().Err(); err != nil {
				return err
			}
			if err := read(); err != nil || len(data) != 0 {
				return err
			}
			var original []byte
			if err := a.db.QueryRowContext(r.Context(), "SELECT jobs."+column+" FROM jobs WHERE jobs.id=?"+scope, append([]any{id}, args...)...).Scan(&original); err != nil {
				return err
			}
			var err error
			data, err = makePreview(original)
			if err != nil {
				return err
			}
			_, err = a.db.ExecContext(r.Context(), "INSERT INTO job_image_previews(job_id,role,version,content) VALUES(?,?,?,?)", id, role, previewVersion, data)
			return err
		}()
		if err != nil {
			apiError(w, 500, "生成图片预览失败，仍可点击查看原图")
			return
		}
	}
	serveCachedImage(w, r, data, "image/webp")
}
