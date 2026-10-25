package main

import (
	"database/sql/driver"
	"encoding/json"
	"net/http/httptest"
	"net/url"
	"regexp"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestHistoryModelFilter(t *testing.T) {
	for _, model := range []string{"", "gpt-image-2", "gpt-image-1.5", "gpt-image-2.5-sunburst", "gemini-3.1-flash-image", "gemini-3-pro-image", "unknown' OR 1=1 --"} {
		for _, role := range []string{"user", "admin"} {
			t.Run(role+"/"+model, func(t *testing.T) {
				a := &app{}
				query := url.Values{"model": {model}, "status": {"failed"}, "q": {"熊猫"}, "page": {"2"}}
				r := httptest.NewRequest("GET", "/api/jobs?"+query.Encode(), nil)
				mock := mockSession(t, a, r, role)
				where := " WHERE 1=1 AND user_id=? AND LOCATE(?,prompt)>0 AND status=?"
				args := []driver.Value{strings.Repeat("b", 32), "熊猫", "failed"}
				if model != "" {
					where += " AND model=?"
					args = append(args, model)
				}
				mock.ExpectQuery(regexp.QuoteMeta("SELECT COUNT(*) FROM jobs"+where) + "$").WithArgs(args...).WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(0))
				pageArgs := append(append([]driver.Value{}, args...), 24, 24)
				mock.ExpectQuery(regexp.QuoteMeta("SELECT "+jobColumns+" FROM jobs"+where+" ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?") + "$").WithArgs(pageArgs...).WillReturnRows(sqlmock.NewRows([]string{"id"}))
				mock.ExpectQuery(regexp.QuoteMeta("SELECT status,COUNT(*) FROM jobs"+where+" GROUP BY status") + "$").WithArgs(args...).WillReturnRows(sqlmock.NewRows([]string{"status", "count"}))
				w := httptest.NewRecorder()
				a.routes(fstest.MapFS{}).ServeHTTP(w, r)
				var result struct {
					Items []job          `json:"items"`
					Total int            `json:"total"`
					Page  int            `json:"page"`
					Stats map[string]int `json:"stats"`
				}
				if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil || w.Code != 200 || result.Items == nil || result.Total != 0 || result.Page != 2 || result.Stats["total"] != 0 {
					t.Fatalf("unexpected history response: %d %s", w.Code, w.Body)
				}
			})
		}
	}
}

func TestHistoryModelFilterTooLong(t *testing.T) {
	a := &app{}
	r := httptest.NewRequest("GET", "/api/jobs?model="+strings.Repeat("a", 81), nil)
	mockSession(t, a, r, "user")
	w := httptest.NewRecorder()
	a.routes(fstest.MapFS{}).ServeHTTP(w, r)
	if w.Code != 400 {
		t.Fatalf("expected invalid model filter to be rejected, got %d %s", w.Code, w.Body)
	}
}
