package studio

import (
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"
)

const registrationIPLimit = 5

// The deployment's loopback-only listener is reached through Nginx, which
// replaces X-Real-IP. Never trust forwarded headers from a remote peer, a list,
// or multiple header values; malformed proxy input falls back to the peer IP.
func registrationClientIP(r *http.Request) string {
	ip, _, _ := net.SplitHostPort(r.RemoteAddr)
	peer := net.ParseIP(ip)
	if peer == nil {
		return ip
	}
	if peer.IsLoopback() {
		values := r.Header.Values("X-Real-IP")
		if len(values) == 1 {
			if real := net.ParseIP(strings.TrimSpace(values[0])); real != nil {
				return real.String()
			}
		}
	}
	return peer.String()
}

// Public registration deliberately accepts no role, status, or credit fields.
// The same bounded guard also caps the combined login/registration PBKDF2 work.
func (a *App) register(w http.ResponseWriter, r *http.Request) {
	ip := registrationClientIP(r)
	if retry := a.logins.Allow("register-ip:"+ip, registrationIPLimit, time.Now()); retry > 0 {
		registrationThrottled(w, retry)
		return
	}
	if !a.logins.Begin() {
		registrationThrottled(w, time.Second)
		return
	}
	defer a.logins.End()
	var input struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	input.Username = strings.TrimSpace(input.Username)
	if !usernamePattern.MatchString(input.Username) {
		apiError(w, 400, "用户名须为 3–32 位字母、数字、_、.、-，以字母、数字或 _ 开头")
		return
	}
	if len(input.Password) < 8 || len(input.Password) > 128 {
		apiError(w, 400, "注册密码须为 8–128 字节")
		return
	}
	id := NewID()
	if _, err := a.DB.ExecContext(r.Context(), "INSERT INTO users(id,username,password_hash,role,active,credits) VALUES(?,?,?,'user',TRUE,0)", id, input.Username, HashPassword(input.Password)); err != nil {
		userWriteError(w, err)
		return
	}
	jsonResponse(w, http.StatusCreated, map[string]string{"id": id, "username": input.Username})
}

func registrationThrottled(w http.ResponseWriter, retry time.Duration) {
	seconds := int64((retry + time.Second - 1) / time.Second)
	w.Header().Set("Retry-After", strconv.FormatInt(seconds, 10))
	apiError(w, http.StatusTooManyRequests, "注册过于频繁，请稍后再试")
}
