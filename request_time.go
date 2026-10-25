package main

import (
	"errors"
	"net/url"
	"strconv"
	"time"
)

// Explicit dates carry offsets. Defaults use the browser's offset, or Shanghai.
func requestTimeRange(q url.Values, now time.Time) (time.Time, time.Time, error) {
	startText, endText := q.Get("start"), q.Get("end")
	if startText != "" || endText != "" {
		start, e1 := time.Parse(time.RFC3339Nano, startText)
		end, e2 := time.Parse(time.RFC3339Nano, endText)
		if e1 != nil || e2 != nil || !start.Before(end) {
			return time.Time{}, time.Time{}, errors.New("请选择有效的开始和结束时间，结束时间须晚于开始时间")
		}
		return start.UTC(), end.UTC(), nil
	}
	offset := -480
	if raw := q.Get("timezone_offset"); raw != "" {
		var err error
		offset, err = strconv.Atoi(raw)
		if err != nil || offset < -840 || offset > 840 {
			return time.Time{}, time.Time{}, errors.New("时区参数无效")
		}
	}
	local := now.In(time.FixedZone("browser", -offset*60))
	return time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, local.Location()).UTC(), now.UTC(), nil
}
