package studio

import (
	"context"
	"database/sql"
	"errors"
	"log"
	"time"
)

func (a *App) claim(ctx context.Context) (Job, error) {
	tx, err := a.DB.BeginTx(ctx, nil)
	if err != nil {
		return Job{}, err
	}
	defer tx.Rollback()
	j, err := ScanJob(tx.QueryRowContext(ctx, "SELECT "+jobColumns+" FROM jobs WHERE status='queued' ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED"))
	if err != nil {
		return Job{}, err
	}
	if err = tx.QueryRowContext(ctx, "SELECT input_image,input_mime,reference_image,reference_mime FROM jobs WHERE id=?", j.ID).Scan(&j.Input, &j.InputMIME, &j.Reference, &j.ReferenceMIME); err != nil {
		return Job{}, err
	}
	if _, err = tx.ExecContext(ctx, "UPDATE jobs SET status='running',started_at=UTC_TIMESTAMP(3) WHERE id=?", j.ID); err != nil {
		return Job{}, err
	}
	return j, tx.Commit()
}

func (a *App) worker(ctx context.Context) {
	defer a.workers.Done()
	for {
		if ctx.Err() != nil {
			return
		}
		j, err := a.claim(ctx)
		if err != nil {
			if !errors.Is(err, sql.ErrNoRows) && ctx.Err() == nil {
				log.Print("读取任务队列失败")
			}
			select {
			case <-ctx.Done():
				return
			case <-time.After(time.Second):
				continue
			}
		}
		err = a.loadStudioJob(ctx, &j)
		var result GenerationResult
		if err == nil {
			result, err = a.Upstream.Generate(ctx, j)
		}
		// Save cancellation/failure with a fresh bounded context during shutdown.
		saveCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		if err != nil {
			message := err.Error()
			var Upstream *upstreamError
			requestID, endpoint := "", ""
			if errors.As(err, &Upstream) {
				requestID = Upstream.RequestID
				endpoint = Upstream.Endpoint
			}
			if saveErr := a.FailJob(saveCtx, j.ID, message, requestID, endpoint); saveErr != nil {
				log.Printf("任务 %s 失败状态保存失败", j.ID)
			}
		} else if err = a.SaveResult(saveCtx, j.ID, result); err != nil {
			log.Printf("任务 %s 图片持久化失败", j.ID)
			if saveErr := a.FailJob(saveCtx, j.ID, "上游已完成，但图片保存失败；冻结积分已退还，请检查数据库。重试会重新计费", result.RequestID, result.Endpoint); saveErr != nil {
				log.Printf("任务 %s 失败状态保存失败", j.ID)
			}
		}
		cancel()
	}
}

func (a *App) SaveResult(ctx context.Context, id string, result GenerationResult) error {
	tx, err := a.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	j, err := ScanJob(tx.QueryRowContext(ctx, "SELECT "+jobColumns+" FROM jobs WHERE id=? FOR UPDATE", id))
	if err != nil {
		return err
	}
	if j.Status == "succeeded" || j.Status == "failed" {
		return nil
	}
	if err := settleCredits(ctx, tx, j, true); err != nil {
		return err
	}
	for _, p := range result.Images {
		if _, err = tx.ExecContext(ctx, "INSERT INTO images(id,job_id,mime,width,height,byte_size,content) VALUES(?,?,?,?,?,?,?)", NewID(), id, p.MIME, p.Width, p.Height, p.Bytes, p.Content); err != nil {
			return err
		}
	}
	if _, err = tx.ExecContext(ctx, "UPDATE jobs SET status='succeeded',actual_model=?,quality=?,request_id=?,endpoint=?,finished_at=UTC_TIMESTAMP(3) WHERE id=?", result.ActualModel, result.Quality, result.RequestID, result.Endpoint, id); err != nil {
		return err
	}
	return tx.Commit()
}

// StartWorkers starts queue consumers; the caller must cancel ctx and WaitWorkers before closing DB.
func (a *App) StartWorkers(ctx context.Context, count int) {
	for range count {
		a.workers.Add(1)
		go a.worker(ctx)
	}
}

// WaitWorkers joins all consumers after cancellation.
func (a *App) WaitWorkers() { a.workers.Wait() }
