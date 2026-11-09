package studio

import (
	"errors"
	"fmt"
	_ "golang.org/x/image/webp"
	_ "image/gif"
	"net/http"
)

func (a *App) studioRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/studio/state", a.studioState)
	mux.HandleFunc("GET /api/studio/models", func(w http.ResponseWriter, r *http.Request) { jsonResponse(w, 200, studioModels()) })
	mux.HandleFunc("POST /api/studio/attachments", a.uploadStudioAttachment)
	mux.HandleFunc("GET /api/studio/attachments/{id}", a.getStudioAttachment)
	mux.HandleFunc("GET /api/studio/attachments/{id}/{kind}/{version}", a.getStudioAttachmentRendition)
	mux.HandleFunc("POST /api/studio/generations", a.createStudioGeneration)
	mux.HandleFunc("POST /api/studio/folders", a.createStudioFolder)
	mux.HandleFunc("PATCH /api/studio/folders/{id}", a.renameStudioFolder)
	mux.HandleFunc("DELETE /api/studio/folders/{id}", a.deleteStudioFolder)
	mux.HandleFunc("POST /api/studio/folder-memberships", a.studioMemberships)
}

func studioModels() []map[string]any {
	gptRatios := []string{"自动", "1:1", "16:9", "9:16", "3:2"}
	geminiRatios := []string{"自动", "21:9", "16:9", "4:3", "1:1", "9:16"}
	return []map[string]any{
		{"id": "gpt-image-2", "name": "GPT Image 2", "qualities": []string{}, "resolutions": []string{}, "ratios": gptRatios},
		{"id": "gpt-image-1.5", "name": "GPT Image 1.5", "qualities": []string{}, "resolutions": []string{}, "ratios": gptRatios},
		{"id": "gpt-image-2.5-sunburst", "name": "GPT Image 2.5 Sunburst", "qualities": []string{}, "resolutions": []string{}, "ratios": gptRatios},
		{"id": "gemini-3.1-flash-image", "name": "Gemini 3.1 Flash Image", "qualities": []string{}, "resolutions": []string{"0.5K", "1K", "2K", "4K"}, "ratios": geminiRatios},
		{"id": "gemini-3-pro-image", "name": "Gemini 3 Pro Image", "qualities": []string{}, "resolutions": []string{"0.5K", "1K", "2K", "4K"}, "ratios": []string{"自动", "1:1", "9:16", "16:9"}},
	}
}

func validateStudioOptions(o GenerationOptions, editing bool) error {
	if o.Count < 1 || o.Count > 4 {
		return errors.New("每次可生成 1–4 张图片")
	}
	for _, m := range studioModels() {
		if m["id"] != o.ModelID {
			continue
		}
		for _, field := range []struct{ k, v string }{{"ratios", o.Ratio}, {"qualities", o.Quality}, {"resolutions", o.Resolution}} {
			values := m[field.k].([]string)
			if editing && field.k == "resolutions" {
				values = []string{}
			}
			valid := len(values) == 0 && field.v == ""
			for _, v := range values {
				valid = valid || v == field.v
			}
			if !valid {
				return fmt.Errorf("无效的模型参数：%s", field.k)
			}
		}
		return nil
	}
	return errors.New("请选择有效模型")
}
