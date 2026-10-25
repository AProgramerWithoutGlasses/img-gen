package main

import (
	"net/url"
	"testing"
	"time"
)

func TestRequestTimeRange(t *testing.T) {
	now := time.Date(2026, 10, 25, 18, 23, 45, 0, time.UTC)
	start, end, err := requestTimeRange(url.Values{}, now)
	if err != nil || start.Format(time.RFC3339) != "2026-10-25T16:00:00Z" || !end.Equal(now) {
		t.Fatalf("Shanghai today: %v %v %v", start, end, err)
	}
	start, _, err = requestTimeRange(url.Values{"timezone_offset": {"300"}}, now)
	if err != nil || start.Format(time.RFC3339) != "2026-10-25T05:00:00Z" {
		t.Fatalf("browser timezone: %v %v", start, err)
	}
	start, end, err = requestTimeRange(url.Values{"start": {"2026-10-23T00:00:01+08:00"}, "end": {"2026-10-26T02:23:45+08:00"}}, now)
	if err != nil || start.Format(time.RFC3339) != "2026-10-22T16:00:01Z" || !end.Equal(now) {
		t.Fatalf("exact seconds: %v %v %v", start, end, err)
	}
	for _, q := range []url.Values{{"start": {"bad"}}, {"end": {"2026-10-26T00:00:00Z"}}, {"start": {"2026-10-26T00:00:00Z"}, "end": {"2026-10-25T00:00:00Z"}}, {"timezone_offset": {"9999"}}} {
		if _, _, err := requestTimeRange(q, now); err == nil {
			t.Errorf("invalid range accepted: %v", q)
		}
	}
}
