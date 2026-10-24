package main

import (
	"context"
	"database/sql"
	"time"
)

func migrate(ctx context.Context, db *sql.DB) error {
	for _, statement := range []string{
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
	return nil
}

type job struct {
	ID              string     `json:"id"`
	BatchID         string     `json:"batch_id"`
	Mode            string     `json:"mode"`
	Model           string     `json:"model"`
	Prompt          string     `json:"prompt"`
	EffectivePrompt string     `json:"effective_prompt"`
	Ratio           string     `json:"ratio"`
	Resolution      string     `json:"resolution"`
	Status          string     `json:"status"`
	Error           string     `json:"error"`
	ActualModel     string     `json:"actual_model"`
	Quality         string     `json:"quality"`
	RequestID       string     `json:"request_id"`
	Endpoint        string     `json:"endpoint"`
	CreatedAt       time.Time  `json:"created_at"`
	StartedAt       *time.Time `json:"started_at"`
	FinishedAt      *time.Time `json:"finished_at"`
	Images          []picture  `json:"images"`
	HasInput        bool       `json:"has_input"`
	Input           []byte     `json:"-"`
	InputMIME       string     `json:"-"`
}
type picture struct {
	ID      string `json:"id"`
	URL     string `json:"url"`
	MIME    string `json:"mime"`
	Width   int    `json:"width"`
	Height  int    `json:"height"`
	Bytes   int    `json:"bytes"`
	Content []byte `json:"-"`
}

const jobColumns = `id,batch_id,mode,model,prompt,effective_prompt,ratio,resolution,status,error,actual_model,quality,request_id,endpoint,created_at,started_at,finished_at,(input_image IS NOT NULL)`

type scanner interface{ Scan(...any) error }

func scanJob(row scanner) (job, error) {
	j := job{Images: []picture{}}
	err := row.Scan(&j.ID, &j.BatchID, &j.Mode, &j.Model, &j.Prompt, &j.EffectivePrompt, &j.Ratio, &j.Resolution, &j.Status, &j.Error, &j.ActualModel, &j.Quality, &j.RequestID, &j.Endpoint, &j.CreatedAt, &j.StartedAt, &j.FinishedAt, &j.HasInput)
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
		j.Images = append(j.Images, p)
	}
	return rows.Err()
}
