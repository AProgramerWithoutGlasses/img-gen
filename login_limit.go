package main

import (
	"sync"
	"time"
)

const (
	loginWindow        = 15 * time.Minute
	loginIPLimit       = 20
	loginAccountLimit  = 10
	loginMaxEntries    = 4096
	loginMaxConcurrent = 2
)

type loginAttempt struct {
	Count int
	Until time.Time
}

// Single-instance, bounded in-memory protection. All admitted attempts count,
// including successful logins and nonexistent accounts. Restart resets quotas.
type loginLimiter struct {
	sync.Mutex
	entries     map[string]loginAttempt
	nextCleanup time.Time
	inFlight    int
}

// Returns the remaining wait, or zero when admitted. Rejections never extend
// a window. Keeping active keys at capacity prevents eviction-based bypasses.
func (l *loginLimiter) allow(key string, limit int, now time.Time) time.Duration {
	l.Lock()
	defer l.Unlock()
	if l.entries == nil {
		l.entries = make(map[string]loginAttempt)
	}
	if !now.Before(l.nextCleanup) {
		for k, attempt := range l.entries {
			if !now.Before(attempt.Until) {
				delete(l.entries, k)
			}
		}
		l.nextCleanup = now.Add(time.Minute)
	}
	attempt := l.entries[key]
	if !now.Before(attempt.Until) {
		delete(l.entries, key)
		attempt = loginAttempt{}
	}
	if attempt.Count >= limit {
		return attempt.Until.Sub(now)
	}
	if attempt.Count == 0 {
		if len(l.entries) >= loginMaxEntries {
			return l.nextCleanup.Sub(now)
		}
		attempt.Until = now.Add(loginWindow)
	}
	attempt.Count++
	l.entries[key] = attempt
	return 0
}

// Acquire before parsing or touching the database/PBKDF2. Never queue attackers.
func (l *loginLimiter) begin() bool {
	l.Lock()
	defer l.Unlock()
	if l.inFlight >= loginMaxConcurrent {
		return false
	}
	l.inFlight++
	return true
}

func (l *loginLimiter) end() {
	l.Lock()
	defer l.Unlock()
	l.inFlight--
}
