package studio

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"sync"
)

type App struct {
	DB            *sql.DB
	Upstream      *Provider
	SecureCookies bool
	usersMu       sync.Mutex
	logins        LoginLimiter
	workers       sync.WaitGroup
	submit        sync.Mutex
	polish        sync.Mutex
	thumbnails    sync.Mutex
}

func NewID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b[:])
}

func jsonResponse(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func apiError(w http.ResponseWriter, status int, message string) {
	jsonResponse(w, status, map[string]string{"error": message})
}

func ValidID(s string) bool {
	if len(s) != 32 {
		return false
	}
	_, err := hex.DecodeString(s)
	return err == nil
}

// LoginProtection returns the shared admission guard for lifecycle and diagnostics.
func (a *App) LoginProtection() *LoginLimiter { return &a.logins }
