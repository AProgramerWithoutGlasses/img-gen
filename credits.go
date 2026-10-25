package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"
)

const maxCredits int64 = 1_000_000_000_000

var errInsufficientCredits = errors.New("积分不足，请联系管理员充值")

func migrateCredits(ctx context.Context, db *sql.DB) error {
	for _, column := range []struct{ table, name, ddl string }{
		{"users", "credits", "ALTER TABLE users ADD COLUMN credits BIGINT NOT NULL DEFAULT 0"},
		{"jobs", "credits_cost", "ALTER TABLE jobs ADD COLUMN credits_cost BIGINT NOT NULL DEFAULT 0"},
		{"jobs", "credits_state", "ALTER TABLE jobs ADD COLUMN credits_state VARCHAR(16) NOT NULL DEFAULT 'legacy'"},
	} {
		var n int
		if err := db.QueryRowContext(ctx, "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=? AND column_name=?", column.table, column.name).Scan(&n); err != nil {
			return err
		}
		if n == 0 {
			if _, err := db.ExecContext(ctx, column.ddl); err != nil {
				return err
			}
		}
	}
	for _, ddl := range []string{
		`CREATE TABLE IF NOT EXISTS model_prices (model VARCHAR(80) PRIMARY KEY, credits BIGINT NOT NULL, version INT NOT NULL DEFAULT 1, updated_by CHAR(32) NULL, updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
		`CREATE TABLE IF NOT EXISTS credit_ledger (
		id BIGINT AUTO_INCREMENT PRIMARY KEY, user_id CHAR(32) NOT NULL, actor_id CHAR(32) NULL,
		request_key VARCHAR(100) NOT NULL UNIQUE, kind VARCHAR(24) NOT NULL,
		delta BIGINT NOT NULL, balance_after BIGINT NOT NULL, job_id CHAR(32) NULL,
		note VARCHAR(500) NOT NULL DEFAULT '', created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
		INDEX idx_user_ledger(user_id,id), FOREIGN KEY(user_id) REFERENCES users(id)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
	} {
		if _, err := db.ExecContext(ctx, ddl); err != nil {
			return err
		}
	}
	for model := range models {
		if _, err := db.ExecContext(ctx, "INSERT INTO model_prices(model,credits) VALUES(?,1) ON DUPLICATE KEY UPDATE model=VALUES(model)", model); err != nil {
			return err
		}
	}
	return nil
}

type modelPrice struct {
	Model     string    `json:"model"`
	Credits   int64     `json:"credits"`
	Version   int       `json:"version"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (a *app) listPrices(w http.ResponseWriter, r *http.Request) {
	rows, err := a.db.QueryContext(r.Context(), "SELECT model,credits,version,updated_at FROM model_prices ORDER BY model")
	if err != nil {
		apiError(w, 500, "读取模型价格失败")
		return
	}
	defer rows.Close()
	items := []modelPrice{}
	for rows.Next() {
		var p modelPrice
		if err := rows.Scan(&p.Model, &p.Credits, &p.Version, &p.UpdatedAt); err != nil {
			apiError(w, 500, "读取模型价格失败")
			return
		}
		items = append(items, p)
	}
	if rows.Err() != nil {
		apiError(w, 500, "读取模型价格失败")
		return
	}
	jsonResponse(w, 200, map[string]any{"items": items})
}
func (a *app) updatePrice(w http.ResponseWriter, r *http.Request) {
	model := r.PathValue("model")
	if !models[model] {
		apiError(w, 404, "模型不存在")
		return
	}
	var input struct {
		Credits *int64 `json:"credits"`
		Version int    `json:"version"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	if input.Credits == nil || *input.Credits < 0 || *input.Credits > 1_000_000 || input.Version < 1 {
		apiError(w, 400, "价格须为 0–1000000 的整数积分")
		return
	}
	result, err := a.db.ExecContext(r.Context(), "UPDATE model_prices SET credits=?,version=version+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE model=? AND version=?", *input.Credits, currentUser(r).ID, model, input.Version)
	if err != nil {
		apiError(w, 500, "保存模型价格失败")
		return
	}
	n, _ := result.RowsAffected()
	if n != 1 {
		apiError(w, 409, "价格已被修改，请刷新后重试")
		return
	}
	jsonResponse(w, 200, map[string]bool{"ok": true})
}

func (a *app) profile(w http.ResponseWriter, r *http.Request) {
	u := currentUser(r)
	var held, spent int64
	if err := a.db.QueryRowContext(r.Context(), `SELECT credits,COALESCE((SELECT SUM(credits_cost) FROM jobs WHERE user_id=users.id AND credits_state='reserved'),0),COALESCE((SELECT SUM(credits_cost) FROM jobs WHERE user_id=users.id AND credits_state='charged'),0) FROM users WHERE id=?`, u.ID).Scan(&u.Credits, &held, &spent); err != nil {
		apiError(w, 500, "读取个人信息失败")
		return
	}
	jsonResponse(w, 200, struct {
		user
		Held            int64 `json:"credits_held"`
		Spent           int64 `json:"credits_spent"`
		RechargeEnabled bool  `json:"recharge_enabled"`
	}{u, held, spent, false})
}

func (a *app) adjustCredits(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !validID(id) {
		apiError(w, 404, "用户不存在")
		return
	}
	var input struct {
		Delta     int64  `json:"delta"`
		Note      string `json:"note"`
		RequestID string `json:"request_id"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	input.Note = strings.TrimSpace(input.Note)
	if input.Delta == 0 || input.Delta > 1_000_000_000 || input.Delta < -1_000_000_000 || input.Note == "" || len([]rune(input.Note)) > 500 || !validID(input.RequestID) {
		apiError(w, 400, "请填写非零整数积分、调整原因及有效请求编号")
		return
	}
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		apiError(w, 500, "调整积分失败")
		return
	}
	defer tx.Rollback()
	var balance int64
	err = tx.QueryRowContext(r.Context(), "SELECT credits FROM users WHERE id=? FOR UPDATE", id).Scan(&balance)
	if errors.Is(err, sql.ErrNoRows) {
		apiError(w, 404, "用户不存在")
		return
	}
	if err != nil {
		apiError(w, 500, "读取积分失败")
		return
	}
	key := "adjust:" + input.RequestID
	var oldUser, oldActor, oldNote string
	var oldDelta int64
	err = tx.QueryRowContext(r.Context(), "SELECT user_id,actor_id,delta,note FROM credit_ledger WHERE request_key=?", key).Scan(&oldUser, &oldActor, &oldDelta, &oldNote)
	if err == nil {
		if oldUser != id || oldActor != currentUser(r).ID || oldDelta != input.Delta || oldNote != input.Note {
			apiError(w, 409, "请求编号已用于其他调整")
			return
		}
		jsonResponse(w, 200, map[string]any{"ok": true, "credits": balance})
		return
	}
	if !errors.Is(err, sql.ErrNoRows) {
		apiError(w, 500, "读取积分流水失败")
		return
	}
	var held int64
	if err := tx.QueryRowContext(r.Context(), "SELECT COALESCE(SUM(credits_cost),0) FROM jobs WHERE user_id=? AND credits_state='reserved'", id).Scan(&held); err != nil {
		apiError(w, 500, "读取冻结积分失败")
		return
	}
	if balance+input.Delta < 0 || balance+input.Delta+held > maxCredits {
		apiError(w, 400, "调整后可用积分不能为负或超过上限")
		return
	}
	balance += input.Delta
	if _, err = tx.ExecContext(r.Context(), "UPDATE users SET credits=? WHERE id=?", balance, id); err != nil {
		apiError(w, 500, "调整积分失败")
		return
	}
	if _, err = tx.ExecContext(r.Context(), "INSERT INTO credit_ledger(user_id,actor_id,request_key,kind,delta,balance_after,note) VALUES(?,?,?,'admin_adjustment',?,?,?)", id, currentUser(r).ID, key, input.Delta, balance, input.Note); err != nil {
		apiError(w, 500, "保存积分流水失败，请刷新余额后确认")
		return
	}
	if err = tx.Commit(); err != nil {
		apiError(w, 500, "调整结果未知，请保留当前表单重试以核对结果")
		return
	}
	jsonResponse(w, 200, map[string]any{"ok": true, "credits": balance})
}

// Prices and the wallet are locked in the same transaction as the batch insert.
func reserveBatch(ctx context.Context, tx *sql.Tx, userID string, jobs []job) (int64, error) {
	var balance int64
	if err := tx.QueryRowContext(ctx, "SELECT credits FROM users WHERE id=? FOR UPDATE", userID).Scan(&balance); err != nil {
		return 0, err
	}
	prices := map[string]int64{}
	var total int64
	for i := range jobs {
		cost, ok := prices[jobs[i].Model]
		if !ok {
			if err := tx.QueryRowContext(ctx, "SELECT credits FROM model_prices WHERE model=? FOR SHARE", jobs[i].Model).Scan(&cost); err != nil {
				return 0, err
			}
			prices[jobs[i].Model] = cost
		}
		jobs[i].CreditsCost = cost
		total += cost
	}
	if balance < total {
		return 0, errInsufficientCredits
	}
	if _, err := tx.ExecContext(ctx, "UPDATE users SET credits=credits-? WHERE id=?", total, userID); err != nil {
		return 0, err
	}
	return balance, nil
}

// Caller holds the job row lock. A terminal job is never charged/refunded twice.
func settleCredits(ctx context.Context, tx *sql.Tx, j job, success bool) error {
	if j.CreditsState != "reserved" {
		return nil
	}
	kind, state, delta := "charge", "charged", int64(0)
	if !success {
		kind, state, delta = "refund", "refunded", j.CreditsCost
	}
	var balance int64
	if err := tx.QueryRowContext(ctx, "SELECT credits FROM users WHERE id=? FOR UPDATE", j.UserID).Scan(&balance); err != nil {
		return err
	}
	if delta > 0 {
		if _, err := tx.ExecContext(ctx, "UPDATE users SET credits=credits+? WHERE id=?", delta, j.UserID); err != nil {
			return err
		}
		balance += delta
	}
	if _, err := tx.ExecContext(ctx, "INSERT INTO credit_ledger(user_id,request_key,kind,delta,balance_after,job_id) VALUES(?,?,?,?,?,?)", j.UserID, kind+":"+j.ID, kind, delta, balance, j.ID); err != nil {
		return err
	}
	_, err := tx.ExecContext(ctx, "UPDATE jobs SET credits_state=? WHERE id=?", state, j.ID)
	return err
}
func (a *app) failJob(ctx context.Context, id, message, requestID, endpoint string) error {
	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	j, err := scanJob(tx.QueryRowContext(ctx, "SELECT "+jobColumns+" FROM jobs WHERE id=? FOR UPDATE", id))
	if err != nil {
		return err
	}
	if j.Status == "succeeded" || j.Status == "failed" {
		return nil
	}
	if err := settleCredits(ctx, tx, j, false); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, "UPDATE jobs SET status='failed',error=?,request_id=?,endpoint=?,finished_at=UTC_TIMESTAMP(3) WHERE id=?", message, requestID, endpoint, id); err != nil {
		return err
	}
	return tx.Commit()
}
func (a *app) recoverInterrupted(ctx context.Context) error {
	rows, err := a.db.QueryContext(ctx, "SELECT id FROM jobs WHERE status='running'")
	if err != nil {
		return err
	}
	ids := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		ids = append(ids, id)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	for _, id := range ids {
		if err := a.failJob(ctx, id, "服务重启中断了任务；冻结积分已退还，请手动重试以避免重复计费", "", ""); err != nil {
			return fmt.Errorf("恢复中断任务: %w", err)
		}
	}
	return nil
}

func (a *app) listCreditLedger(w http.ResponseWriter, r *http.Request) {
	page, ok := pageNumber(w, r)
	if !ok {
		return
	}
	id := currentUser(r).ID
	if target := r.PathValue("id"); target != "" {
		if !validID(target) {
			apiError(w, 404, "用户不存在")
			return
		}
		id = target
	}
	var total int
	if err := a.db.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM credit_ledger WHERE user_id=?", id).Scan(&total); err != nil {
		apiError(w, 500, "读取积分流水失败")
		return
	}
	rows, err := a.db.QueryContext(r.Context(), "SELECT kind,delta,balance_after,COALESCE(job_id,''),note,created_at FROM credit_ledger WHERE user_id=? ORDER BY id DESC LIMIT 24 OFFSET ?", id, (page-1)*24)
	if err != nil {
		apiError(w, 500, "读取积分流水失败")
		return
	}
	defer rows.Close()
	type entry struct {
		Kind      string    `json:"kind"`
		Delta     int64     `json:"delta"`
		Balance   int64     `json:"balance_after"`
		JobID     string    `json:"job_id"`
		Note      string    `json:"note"`
		CreatedAt time.Time `json:"created_at"`
	}
	items := []entry{}
	for rows.Next() {
		var e entry
		if err := rows.Scan(&e.Kind, &e.Delta, &e.Balance, &e.JobID, &e.Note, &e.CreatedAt); err != nil {
			apiError(w, 500, "读取积分流水失败")
			return
		}
		items = append(items, e)
	}
	if rows.Err() != nil {
		apiError(w, 500, "读取积分流水失败")
		return
	}
	jsonResponse(w, 200, map[string]any{"items": items, "total": total, "page": page, "page_size": 24})
}
