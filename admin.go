package main

import (
	"database/sql"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-sql-driver/mysql"
)

func pageNumber(w http.ResponseWriter, r *http.Request) (int, bool) {
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	if page < 1 {
		page = 1
	}
	if page > 100000 {
		apiError(w, 400, "页码过大")
		return 0, false
	}
	return page, true
}
func (a *app) listUsers(w http.ResponseWriter, r *http.Request) {
	page, ok := pageNumber(w, r)
	if !ok {
		return
	}
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if len(q) > 128 {
		apiError(w, 400, "搜索词过长")
		return
	}
	var total int
	if err := a.db.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM users WHERE LOCATE(?,username)>0", q).Scan(&total); err != nil {
		apiError(w, 500, "读取用户失败")
		return
	}
	rows, err := a.db.QueryContext(r.Context(), "SELECT id,username,role,active,created_at,credits FROM users WHERE LOCATE(?,username)>0 ORDER BY created_at DESC,id LIMIT 24 OFFSET ?", q, (page-1)*24)
	if err != nil {
		apiError(w, 500, "读取用户失败")
		return
	}
	defer rows.Close()
	users := []user{}
	for rows.Next() {
		var u user
		if err := rows.Scan(&u.ID, &u.Username, &u.Role, &u.Active, &u.CreatedAt, &u.Credits); err != nil {
			apiError(w, 500, "读取用户失败")
			return
		}
		users = append(users, u)
	}
	if rows.Err() != nil {
		apiError(w, 500, "读取用户失败")
		return
	}
	jsonResponse(w, 200, map[string]any{"items": users, "total": total, "page": page, "page_size": 24})
}
func userWriteError(w http.ResponseWriter, err error) {
	var mysqlErr *mysql.MySQLError
	if errors.As(err, &mysqlErr) && mysqlErr.Number == 1062 {
		apiError(w, 409, "用户名已存在")
		return
	}
	apiError(w, 500, "保存用户失败")
}
func (a *app) createUser(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Username string `json:"username"`
		Password string `json:"password"`
		Role     string `json:"role"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	input.Username = strings.TrimSpace(input.Username)
	if !usernamePattern.MatchString(input.Username) {
		apiError(w, 400, "用户名须为 3–32 位字母、数字、_、.、-，以字母、数字或 _ 开头")
		return
	}
	if !validPassword(input.Password) {
		apiError(w, 400, "密码须为 10–128 字节")
		return
	}
	if input.Role != "user" && input.Role != "admin" {
		apiError(w, 400, "请选择有效角色")
		return
	}
	id := newID()
	if _, err := a.db.ExecContext(r.Context(), "INSERT INTO users(id,username,password_hash,role,active) VALUES(?,?,?,?,TRUE)", id, input.Username, hashPassword(input.Password), input.Role); err != nil {
		userWriteError(w, err)
		return
	}
	jsonResponse(w, 201, map[string]string{"id": id})
}
func (a *app) updateUser(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !validID(id) {
		apiError(w, 404, "用户不存在")
		return
	}
	var input struct {
		Role     *string `json:"role"`
		Active   *bool   `json:"active"`
		Password *string `json:"password"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	if input.Role == nil && input.Active == nil && input.Password == nil {
		apiError(w, 400, "没有要更新的字段")
		return
	}
	if input.Role != nil && *input.Role != "user" && *input.Role != "admin" {
		apiError(w, 400, "请选择有效角色")
		return
	}
	if input.Password != nil && !validPassword(*input.Password) {
		apiError(w, 400, "密码须为 10–128 字节")
		return
	}
	// Serialize administrator changes in this single-instance service.
	a.usersMu.Lock()
	defer a.usersMu.Unlock()
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		apiError(w, 500, "更新用户失败")
		return
	}
	defer tx.Rollback()
	var role, hash string
	var active bool
	err = tx.QueryRowContext(r.Context(), "SELECT role,active,password_hash FROM users WHERE id=? FOR UPDATE", id).Scan(&role, &active, &hash)
	if errors.Is(err, sql.ErrNoRows) {
		apiError(w, 404, "用户不存在")
		return
	}
	if err != nil {
		apiError(w, 500, "读取用户失败")
		return
	}
	wasAdmin := role == "admin" && active
	if input.Role != nil {
		role = *input.Role
	}
	if input.Active != nil {
		active = *input.Active
	}
	if wasAdmin && (role != "admin" || !active) {
		var count int
		if err := tx.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM users WHERE role='admin' AND active=TRUE").Scan(&count); err != nil {
			apiError(w, 500, "读取管理员失败")
			return
		}
		if count <= 1 {
			apiError(w, 409, "至少保留一个启用的管理员")
			return
		}
	}
	if input.Password != nil {
		hash = hashPassword(*input.Password)
	}
	if _, err = tx.ExecContext(r.Context(), "UPDATE users SET role=?,active=?,password_hash=?,session_version=session_version+1 WHERE id=?", role, active, hash, id); err != nil {
		userWriteError(w, err)
		return
	}
	if err = tx.Commit(); err != nil {
		apiError(w, 500, "保存结果未知，请刷新用户列表确认")
		return
	}
	jsonResponse(w, 200, map[string]bool{"ok": true})
}
