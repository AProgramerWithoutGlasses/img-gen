package studio_test

import (
	"encoding/json"
	"net/http"
)

const (
	sessionCookie         = "qiso_session"
	loginIPLimit          = 20
	loginAccountLimit     = 10
	loginMaxEntries       = 4096
	loginMaxConcurrent    = 2
	loginWindow           = 15 * 60 * 1000000000
	maxBatchImages        = 20
	thumbnailVersion      = "1"
	previewVersion        = "1"
	previewCacheVersion   = "-1"
	upstreamInputMaxEdge  = 4096
	upstreamInputMaxBytes = 12 << 20
	polishModel           = "gpt-6-luna"
	referenceEditPrompt   = "第一张图片是基础图（待修改的画面），第二张图片是参考图（仅提供替换对象或外观）。请根据用户指令修改基础图，保留未要求修改的构图、主体、背景和风格；不要把参考图当作基础画面，不要输出拼图。用户修改指令："
)

var models = map[string]bool{"gpt-image-2": true, "gpt-image-1.5": true, "gpt-image-2.5-sunburst": true, "gemini-3.1-flash-image": true, "gemini-3-pro-image": true}
var ratioPrompts = map[string]string{"auto": "", "1:1": "请生成正方形1:1画布。", "16:9": "请生成一张16:9的横向宽幅图片，画布宽度明显大于高度。", "9:16": "请生成一张9:16的竖向长幅图片，画布高度明显大于宽度。", "3:2": "请生成横向3:2画布。"}

func jsonResponse(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

const jobColumns = `id,batch_id,mode,model,prompt,effective_prompt,ratio,resolution,status,error,actual_model,quality,request_id,endpoint,created_at,started_at,finished_at,(input_mime<>''),COALESCE(user_id,''),COALESCE((SELECT username FROM users WHERE users.id=jobs.user_id),'历史共享记录'),credits_cost,credits_state,(reference_mime<>'')`
