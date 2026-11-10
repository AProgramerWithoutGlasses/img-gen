package studio

import (
	"context"
	"io/fs"
	"net/http"
	"net/url"
	"strings"
	"time"
)

func (a *App) Handler(static fs.FS) http.Handler {
	mux := http.NewServeMux()
	a.studioRoutes(mux)
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		if a.DB.PingContext(ctx) != nil {
			apiError(w, 503, "database unavailable")
			return
		}
		jsonResponse(w, 200, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("GET /api/config", func(w http.ResponseWriter, r *http.Request) {
		jsonResponse(w, 200, map[string]any{"configured": a.Upstream.Key != "", "max_batch": maxBatchImages, "max_per_model": 4, "max_upload_mb": 12})
	})
	mux.HandleFunc("POST /api/auth/login", a.login)
	mux.HandleFunc("POST /api/auth/register", a.register)
	mux.HandleFunc("POST /api/auth/logout", a.logout)
	mux.HandleFunc("GET /api/auth/me", a.profile)
	mux.HandleFunc("GET /api/prices", a.listPrices)
	mux.HandleFunc("GET /api/credits/ledger", a.listCreditLedger)
	mux.HandleFunc("GET /api/admin/prices", a.listPrices)
	mux.HandleFunc("PATCH /api/admin/prices/{model}", a.updatePrice)
	mux.HandleFunc("POST /api/admin/users/{id}/credits", a.adjustCredits)
	mux.HandleFunc("GET /api/admin/users/{id}/credits", a.listCreditLedger)
	mux.HandleFunc("POST /api/auth/password", a.changePassword)
	mux.HandleFunc("GET /api/admin/users", a.listUsers)
	mux.HandleFunc("POST /api/admin/users", a.createUser)
	mux.HandleFunc("PATCH /api/admin/users/{id}", a.updateUser)
	mux.HandleFunc("GET /api/admin/jobs", a.listJobs)
	mux.HandleFunc("GET /api/jobs", a.listJobs)
	mux.HandleFunc("POST /api/jobs", a.createJobs)
	mux.HandleFunc("POST /api/prompt/polish", a.polishPrompt)
	mux.HandleFunc("GET /api/jobs/{id}", a.getJob)
	mux.HandleFunc("GET /api/jobs/{id}/input", a.getInput)
	mux.HandleFunc("GET /api/jobs/{id}/reference", a.getInput)
	mux.HandleFunc("GET /api/jobs/{id}/{role}/preview/{version}", a.getInputPreview)
	mux.HandleFunc("GET /api/images/{id}", a.getImage)
	mux.HandleFunc("GET /api/images/{id}/thumbnail/{version}", a.getThumbnail)
	mux.HandleFunc("GET /api/images/{id}/preview/{version}", a.getPreview)
	mux.Handle("GET /", staticHandler(static))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "same-origin")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; img-src 'self' blob: data:; style-src 'self'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'")
		w.Header().Set("Cache-Control", "no-store")
		if r.Method != "GET" && r.Method != "HEAD" {
			if strings.EqualFold(r.Header.Get("Sec-Fetch-Site"), "cross-site") {
				apiError(w, 403, "不允许跨站提交")
				return
			}
			if origin := r.Header.Get("Origin"); origin != "" {
				u, err := url.Parse(origin)
				if err != nil || !strings.EqualFold(u.Host, r.Host) {
					apiError(w, 403, "不允许跨站提交")
					return
				}
			}
		}
		if strings.HasPrefix(r.URL.Path, "/api/") && r.URL.Path != "/api/auth/login" && r.URL.Path != "/api/auth/register" {
			var ok bool
			r, ok = a.authenticate(w, r)
			if !ok {
				return
			}
			if strings.HasPrefix(r.URL.Path, "/api/admin/") && currentUser(r).Role != "admin" {
				apiError(w, 403, "仅管理员可访问")
				return
			}
		}
		mux.ServeHTTP(w, r)
	})
}
