package main

import (
	"context"
	"database/sql"
	"time"
)

func migrate(ctx context.Context, db *sql.DB) error {
	for _, statement := range []string{
		`CREATE TABLE IF NOT EXISTS users (
		id CHAR(32) PRIMARY KEY, username VARCHAR(32) NOT NULL UNIQUE,
		password_hash VARCHAR(200) NOT NULL, role VARCHAR(16) NOT NULL DEFAULT 'user',
		active BOOLEAN NOT NULL DEFAULT TRUE, session_version INT NOT NULL DEFAULT 1,
		created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
		`CREATE TABLE IF NOT EXISTS sessions (
		token_hash CHAR(64) PRIMARY KEY, user_id CHAR(32) NOT NULL, user_version INT NOT NULL,
		expires_at DATETIME(3) NOT NULL, INDEX idx_expiry(expires_at),
		FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
		`CREATE TABLE IF NOT EXISTS jobs (
		id CHAR(32) PRIMARY KEY, batch_id CHAR(32) NOT NULL,
		mode VARCHAR(16) NOT NULL, model VARCHAR(80) NOT NULL,
		prompt TEXT NOT NULL, effective_prompt TEXT NOT NULL,
		ratio VARCHAR(16) NOT NULL, resolution VARCHAR(16) NOT NULL,
		status VARCHAR(16) NOT NULL DEFAULT 'queued', error TEXT NOT NULL,
		input_image LONGBLOB, input_mime VARCHAR(32) NOT NULL DEFAULT '',
		actual_model VARCHAR(120) NOT NULL DEFAULT '', quality VARCHAR(40) NOT NULL DEFAULT '',
		request_id VARCHAR(160) NOT NULL DEFAULT '', endpoint VARCHAR(160) NOT NULL DEFAULT '',
		created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
		started_at DATETIME(3), finished_at DATETIME(3),
		INDEX idx_queue(status,created_at), INDEX idx_created(created_at), INDEX idx_model(model)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
		`CREATE TABLE IF NOT EXISTS images (
		id CHAR(32) PRIMARY KEY, job_id CHAR(32) NOT NULL,
		mime VARCHAR(32) NOT NULL, width INT NOT NULL, height INT NOT NULL,
		byte_size INT NOT NULL, content LONGBLOB NOT NULL,
		FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE,
		INDEX idx_job(job_id)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
	} {
		if _, err := db.ExecContext(ctx, statement); err != nil {
			return err
		}
	}
	if _, err := db.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS image_thumbnails (
		image_id CHAR(32) NOT NULL, version INT NOT NULL, content MEDIUMBLOB NOT NULL,
		PRIMARY KEY(image_id,version),
		FOREIGN KEY(image_id) REFERENCES images(id) ON DELETE CASCADE
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`); err != nil {
		return err
	}
	// An additive migration preserves existing shared jobs without attributing them to a user.
	var exists int
	if err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='jobs' AND column_name='user_id'`).Scan(&exists); err != nil {
		return err
	}
	if exists == 0 {
		if _, err := db.ExecContext(ctx, `ALTER TABLE jobs ADD COLUMN user_id CHAR(32) NULL, ADD INDEX idx_user_created(user_id,created_at), ADD CONSTRAINT fk_jobs_user FOREIGN KEY(user_id) REFERENCES users(id)`); err != nil {
			return err
		}
	}
	if err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='jobs' AND column_name='reference_image'`).Scan(&exists); err != nil {
		return err
	}
	if exists == 0 {
		if _, err := db.ExecContext(ctx, `ALTER TABLE jobs ADD COLUMN reference_image LONGBLOB, ADD COLUMN reference_mime VARCHAR(32) NOT NULL DEFAULT ''`); err != nil {
			return err
		}
	}
	if _, err := db.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS job_image_previews (
		job_id CHAR(32) NOT NULL, role VARCHAR(16) NOT NULL, version INT NOT NULL,
		content MEDIUMBLOB NOT NULL, PRIMARY KEY(job_id,role,version),
		FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`); err != nil {
		return err
	}
	return migrateCredits(ctx, db)
}

type job struct {
	CreditsCost      int64          `json:"credits_cost"`
	CreditsState     string         `json:"credits_state"`
	UserID           string         `json:"user_id"`
	Username         string         `json:"username"`
	ID               string         `json:"id"`
	BatchID          string         `json:"batch_id"`
	Mode             string         `json:"mode"`
	Model            string         `json:"model"`
	Prompt           string         `json:"prompt"`
	EffectivePrompt  string         `json:"effective_prompt"`
	Ratio            string         `json:"ratio"`
	Resolution       string         `json:"resolution"`
	Status           string         `json:"status"`
	Error            string         `json:"error"`
	ActualModel      string         `json:"actual_model"`
	Quality          string         `json:"quality"`
	RequestID        string         `json:"request_id"`
	Endpoint         string         `json:"endpoint"`
	CreatedAt        time.Time      `json:"created_at"`
	StartedAt        *time.Time     `json:"started_at"`
	FinishedAt       *time.Time     `json:"finished_at"`
	Images           []picture      `json:"images"`
	HasInput         bool           `json:"has_input"`
	Input            []byte         `json:"-"`
	InputMIME        string         `json:"-"`
	HasReference     bool           `json:"has_reference"`
	Reference        []byte         `json:"-"`
	ReferenceMIME    string         `json:"-"`
	InputPicture     *sourcePicture `json:"input_picture,omitempty"`
	ReferencePicture *sourcePicture `json:"reference_picture,omitempty"`
}
type sourcePicture struct {
	URL        string `json:"url"`
	PreviewURL string `json:"preview_url"`
	Bytes      int    `json:"bytes"`
}
type picture struct {
	ThumbnailURL string `json:"thumbnail_url"`
	PreviewURL   string `json:"preview_url"`
	ID           string `json:"id"`
	URL          string `json:"url"`
	MIME         string `json:"mime"`
	Width        int    `json:"width"`
	Height       int    `json:"height"`
	Bytes        int    `json:"bytes"`
	Content      []byte `json:"-"`
}

const jobColumns = `id,batch_id,mode,model,prompt,effective_prompt,ratio,resolution,status,error,actual_model,quality,request_id,endpoint,created_at,started_at,finished_at,(input_image IS NOT NULL),COALESCE(user_id,''),COALESCE((SELECT username FROM users WHERE users.id=jobs.user_id),'历史共享记录'),credits_cost,credits_state,(reference_image IS NOT NULL)`

type scanner interface{ Scan(...any) error }

func scanJob(row scanner) (job, error) {
	j := job{Images: []picture{}}
	err := row.Scan(&j.ID, &j.BatchID, &j.Mode, &j.Model, &j.Prompt, &j.EffectivePrompt, &j.Ratio, &j.Resolution, &j.Status, &j.Error, &j.ActualModel, &j.Quality, &j.RequestID, &j.Endpoint, &j.CreatedAt, &j.StartedAt, &j.FinishedAt, &j.HasInput, &j.UserID, &j.Username, &j.CreditsCost, &j.CreditsState, &j.HasReference)
	return j, err
}

func (a *app) pictures(ctx context.Context, j *job) error {
	rows, err := a.db.QueryContext(ctx, "SELECT id,mime,width,height,byte_size FROM images WHERE job_id=? ORDER BY id", j.ID)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var p picture
		if err := rows.Scan(&p.ID, &p.MIME, &p.Width, &p.Height, &p.Bytes); err != nil {
			return err
		}
		p.URL = "/api/images/" + p.ID
		p.ThumbnailURL = p.URL + "/thumbnail/" + thumbnailVersion
		p.PreviewURL = p.URL + "/preview/" + previewVersion
		j.Images = append(j.Images, p)
	}
	return rows.Err()
}
