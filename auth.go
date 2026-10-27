package main

import (
	"context"
	"crypto/pbkdf2"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const sessionCookie = "qiso_session"

type user struct {
	Credits   int64     `json:"credits"`
	ID        string    `json:"id"`
	Username  string    `json:"username"`
	Role      string    `json:"role"`
	Active    bool      `json:"active"`
	CreatedAt time.Time `json:"created_at"`
}
type userContextKey struct{}

func currentUser(r *http.Request) user { u, _ := r.Context().Value(userContextKey{}).(user); return u }

var usernamePattern = regexp.MustCompile(`^[a-zA-Z0-9_][a-zA-Z0-9_.-]{2,31}$`)

func validPassword(password string) bool { return len(password) >= 4 && len(password) <= 128 }
func hashPassword(password string) string {
	salt := newID()
	key, err := pbkdf2.Key(sha256.New, password, []byte(salt), 600000, 32)
	if err != nil {
		panic(err)
	}
	return "pbkdf2-sha256$600000$" + salt + "$" + hex.EncodeToString(key)
}
func checkPassword(hash, password string) bool {
	p := strings.Split(hash, "$")
	if len(p) != 4 || p[0] != "pbkdf2-sha256" || p[1] != "600000" || !validID(p[2]) || len(password) > 128 {
		return false
	}
	expected, err := hex.DecodeString(p[3])
	if err != nil || len(expected) != 32 {
		return false
	}
	actual, err := pbkdf2.Key(sha256.New, password, []byte(p[2]), 600000, 32)
	return err == nil && subtle.ConstantTimeCompare(actual, expected) == 1
}
func sessionHash(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func bootstrapAdmin(ctx context.Context, db *sql.DB, username, password string) error {
	var count int
	if err := db.QueryRowContext(ctx, "SELECT COUNT(*) FROM users").Scan(&count); err != nil {
		return err
	}
	if count > 0 {
		return nil
	}
	if !usernamePattern.MatchString(username) || !validPassword(password) {
		return errors.New("首次启动请设置 ADMIN_USERNAME（3–32 位字母、数字、_、.、-）和 ADMIN_PASSWORD（4–128 字节）；兼容使用 APP_PASSWORD 作为初始密码")
	}
	_, err := db.ExecContext(ctx, "INSERT INTO users(id,username,password_hash,role,active) VALUES(?,?,?,'admin',TRUE)", newID(), username, hashPassword(password))
	return err
}

func decodeJSON(w http.ResponseWriter, r *http.Request, value any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 4096)
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if err := d.Decode(value); err != nil {
		apiError(w, 400, "请求格式无效")
		return false
	}
	if d.Decode(&struct{}{}) != io.EOF {
		apiError(w, 400, "请求格式无效")
		return false
	}
	return true
}

func (a *app) login(w http.ResponseWriter, r *http.Request) {
	ip, _, _ := net.SplitHostPort(r.RemoteAddr)
	if parsed := net.ParseIP(ip); parsed != nil {
		ip = parsed.String() // IPv4 and IPv4-mapped IPv6 share a quota.
	}
	if retry := a.logins.allow("ip:"+ip, loginIPLimit, time.Now()); retry > 0 {
		loginThrottled(w, retry)
		return
	}
	if !a.logins.begin() {
		loginThrottled(w, time.Second)
		return
	}
	defer a.logins.end()
	var input struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	input.Username = strings.TrimSpace(input.Username)
	// Restrict to the same ASCII alphabet as account creation so database
	// collation aliases cannot bypass the account quota.
	if !usernamePattern.MatchString(input.Username) || !validPassword(input.Password) {
		apiError(w, 401, "用户名或密码错误，或账号已停用")
		return
	}
	if retry := a.logins.allow("account:"+strings.ToLower(input.Username), loginAccountLimit, time.Now()); retry > 0 {
		loginThrottled(w, retry)
		return
	}
	var u user
	var hash string
	var version int
	err := a.db.QueryRowContext(r.Context(), "SELECT id,username,role,active,created_at,password_hash,session_version,credits FROM users WHERE username=?", strings.TrimSpace(input.Username)).Scan(&u.ID, &u.Username, &u.Role, &u.Active, &u.CreatedAt, &hash, &version, &u.Credits)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		apiError(w, 500, "登录服务暂不可用")
		return
	}
	if errors.Is(err, sql.ErrNoRows) {
		hash = "pbkdf2-sha256$600000$00000000000000000000000000000000$" + strings.Repeat("0", 64)
	}
	matched := checkPassword(hash, input.Password)
	if !matched || !u.Active {
		apiError(w, 401, "用户名或密码错误，或账号已停用")
		return
	}
	token := newID() + newID()
	if _, err := a.db.ExecContext(r.Context(), "DELETE FROM sessions WHERE expires_at <= UTC_TIMESTAMP(3)"); err != nil {
		apiError(w, 500, "建立会话失败")
		return
	}
	if _, err := a.db.ExecContext(r.Context(), "INSERT INTO sessions(token_hash,user_id,user_version,expires_at) VALUES(?,?,?,DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 7 DAY))", sessionHash(token), u.ID, version); err != nil {
		apiError(w, 500, "建立会话失败")
		return
	}
	// A browser login replaces its previous session.
	if old, err := r.Cookie(sessionCookie); err == nil {
		_, _ = a.db.ExecContext(r.Context(), "DELETE FROM sessions WHERE token_hash=?", sessionHash(old.Value))
	}
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Value: token, Path: "/", HttpOnly: true, Secure: a.secureCookies || r.TLS != nil, SameSite: http.SameSiteStrictMode, MaxAge: 7 * 24 * 60 * 60})
	jsonResponse(w, 200, u)
}

func loginThrottled(w http.ResponseWriter, retry time.Duration) {
	seconds := int64((retry + time.Second - 1) / time.Second)
	w.Header().Set("Retry-After", strconv.FormatInt(seconds, 10))
	apiError(w, http.StatusTooManyRequests, "登录过于频繁，请 "+strconv.FormatInt(seconds, 10)+" 秒后再试")
}
func (a *app) authenticate(w http.ResponseWriter, r *http.Request) (*http.Request, bool) {
	c, err := r.Cookie(sessionCookie)
	if err != nil || len(c.Value) != 64 {
		apiError(w, 401, "请先登录")
		return r, false
	}
	var u user
	err = a.db.QueryRowContext(r.Context(), `SELECT u.id,u.username,u.role,u.active,u.created_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>UTC_TIMESTAMP(3) AND u.active=TRUE AND s.user_version=u.session_version`, sessionHash(c.Value)).Scan(&u.ID, &u.Username, &u.Role, &u.Active, &u.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		apiError(w, 401, "登录已失效，请重新登录")
		return r, false
	}
	if err != nil {
		apiError(w, 503, "登录服务暂不可用")
		return r, false
	}
	return r.WithContext(context.WithValue(r.Context(), userContextKey{}, u)), true
}
func (a *app) logout(w http.ResponseWriter, r *http.Request) {
	c, _ := r.Cookie(sessionCookie)
	if _, err := a.db.ExecContext(r.Context(), "DELETE FROM sessions WHERE token_hash=?", sessionHash(c.Value)); err != nil {
		apiError(w, 500, "退出失败，请重试")
		return
	}
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Value: "", Path: "/", MaxAge: -1, HttpOnly: true, Secure: a.secureCookies || r.TLS != nil, SameSite: http.SameSiteStrictMode})
	jsonResponse(w, 200, map[string]bool{"ok": true})
}

func (a *app) changePassword(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Current  string `json:"current_password"`
		Password string `json:"password"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	if !validPassword(input.Password) {
		apiError(w, 400, "密码须为 4–128 字节")
		return
	}
	var old string
	if err := a.db.QueryRowContext(r.Context(), "SELECT password_hash FROM users WHERE id=?", currentUser(r).ID).Scan(&old); err != nil {
		apiError(w, 500, "读取账号失败")
		return
	}
	if !checkPassword(old, input.Current) {
		apiError(w, 400, "当前密码错误")
		return
	}
	result, err := a.db.ExecContext(r.Context(), "UPDATE users SET password_hash=?,session_version=session_version+1 WHERE id=? AND password_hash=?", hashPassword(input.Password), currentUser(r).ID, old)
	if err != nil {
		apiError(w, 500, "修改密码失败")
		return
	}
	n, _ := result.RowsAffected()
	if n != 1 {
		apiError(w, 409, "账号已变更，请重新登录")
		return
	}
	jsonResponse(w, 200, map[string]bool{"ok": true})
}

// Every object read is scoped in SQL, including original image downloads.
func ownerScope(r *http.Request, column string) (string, []any) {
	u := currentUser(r)
	if u.Role == "admin" {
		return "", nil
	}
	return " AND " + column + "=?", []any{u.ID}
}
