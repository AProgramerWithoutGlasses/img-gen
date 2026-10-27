package main

import (
	"bytes"
	"crypto/sha256"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/disintegration/imaging"
	"github.com/gen2brain/webp"
)

// Bump the version when changing dimensions or encoding settings so persisted
// thumbnails and browser caches cannot serve an obsolete rendition.
const thumbnailVersion = "1"
const thumbnailMaxSize = 640
const previewVersion = "1"
const previewMaxSize = 1600

// Positive database versions are list thumbnails; negative versions are previews.
const previewCacheVersion = "-" + previewVersion

func makeThumbnail(content []byte) ([]byte, error) {
	return makeRendition(content, thumbnailMaxSize, 82)
}

func makePreview(content []byte) ([]byte, error) {
	return makeRendition(content, previewMaxSize, 93)
}

func makeRendition(content []byte, maxSize, quality int) ([]byte, error) {
	// Check the existing byte/pixel limits before allocating the decoded image.
	if _, err := decodePicture(content); err != nil {
		return nil, err
	}
	source, err := imaging.Decode(bytes.NewReader(content), imaging.AutoOrientation(true))
	if err != nil {
		return nil, err
	}
	// Fit preserves aspect ratio and alpha, and never enlarges small originals.
	thumb := imaging.Fit(source, maxSize, maxSize, imaging.Lanczos)
	var out bytes.Buffer
	if err := webp.Encode(&out, thumb, webp.Options{Quality: quality, Method: 6}); err != nil {
		return nil, err
	}
	return out.Bytes(), nil
}

func (a *app) getThumbnail(w http.ResponseWriter, r *http.Request) {
	if r.PathValue("version") != thumbnailVersion {
		apiError(w, 404, "缩略图不存在")
		return
	}
	a.serveRendition(w, r, thumbnailVersion, makeThumbnail)
}

func (a *app) getPreview(w http.ResponseWriter, r *http.Request) {
	if r.PathValue("version") != previewVersion {
		apiError(w, 404, "高清预览不存在")
		return
	}
	// A separate cache key keeps the 640px thumbnail and 1600px preview independent.
	a.serveRendition(w, r, previewCacheVersion, makePreview)
}

func (a *app) serveRendition(w http.ResponseWriter, r *http.Request, version string, encode func([]byte) ([]byte, error)) {
	id := r.PathValue("id")
	if !validID(id) {
		apiError(w, 404, "图片不存在")
		return
	}
	// Always check ownership, including cache hits; never read the original BLOB
	// just to serve a cached thumbnail.
	scope, args := ownerScope(r, "jobs.user_id")
	queryArgs := append([]any{version, id}, args...)
	query := `SELECT t.content FROM images JOIN jobs ON jobs.id=images.job_id
		LEFT JOIN image_thumbnails t ON t.image_id=images.id AND t.version=? WHERE images.id=?` + scope
	var data []byte
	read := func() error { return a.db.QueryRowContext(r.Context(), query, queryArgs...).Scan(&data) }
	err := read()
	if errors.Is(err, sql.ErrNoRows) {
		apiError(w, 404, "图片不存在")
		return
	}
	if err != nil {
		apiError(w, 500, "读取缩略图失败")
		return
	}
	if len(data) == 0 {
		// Serialize cache misses to bound peak decoding memory and avoid duplicate
		// encoding when several galleries request the same picture at once.
		err = func() error {
			a.thumbnails.Lock()
			defer a.thumbnails.Unlock()
			if err := r.Context().Err(); err != nil {
				return err
			}
			if err := read(); err != nil || len(data) != 0 {
				return err
			}
			var original []byte
			if err := a.db.QueryRowContext(r.Context(), "SELECT images.content FROM images JOIN jobs ON jobs.id=images.job_id WHERE images.id=?"+scope, append([]any{id}, args...)...).Scan(&original); err != nil {
				return err
			}
			data, err = encode(original)
			if err != nil {
				return err
			}
			_, err = a.db.ExecContext(r.Context(), "INSERT INTO image_thumbnails(image_id,version,content) VALUES(?,?,?)", id, version, data)
			return err
		}()
		if err != nil {
			apiError(w, 500, "生成缩略图失败，仍可在详情查看原图")
			return
		}
	}
	serveCachedImage(w, r, data, "image/webp")
}

func serveCachedImage(w http.ResponseWriter, r *http.Request, data []byte, mime string) {
	w.Header().Set("Content-Type", mime)
	// Revalidate on every reuse so revoked sessions/ownership changes are checked
	// before ServeContent may return 304, while retaining the browser's image bytes.
	w.Header().Set("Cache-Control", "private, no-cache")
	// Session changes must not reuse another user's cached authenticated image.
	w.Header().Add("Vary", "Cookie")
	w.Header().Set("ETag", fmt.Sprintf(`"%x"`, sha256.Sum256(data)))
	http.ServeContent(w, r, "", time.Time{}, bytes.NewReader(data))
}
