package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"mime/multipart"
	"net/http"
	"strings"
)

type provider struct {
	base, key string
	client    *http.Client
}
type generationResult struct {
	Images                                    []picture
	ActualModel, Quality, RequestID, Endpoint string
}
type upstreamError struct{ Message, RequestID, Endpoint string }

func (e *upstreamError) Error() string { return e.Message }

var ratioPrompts = map[string]string{
	"auto": "",
	"1:1":  "请生成正方形1:1画布。",
	"16:9": "请生成一张16:9的横向宽幅图片，画布宽度明显大于高度。",
	"9:16": "请生成一张9:16的竖向长幅图片，画布高度明显大于宽度。",
	"3:2":  "请生成横向3:2画布。",
}
var models = map[string]bool{
	"gpt-image-2": true, "gpt-image-1.5": true, "gpt-image-2.5-sunburst": true,
	"gemini-3.1-flash-image": true, "gemini-3-pro-image": true,
}

func validateJob(j *job) error {
	j.Prompt = strings.TrimSpace(j.Prompt)
	if j.Prompt == "" || len([]rune(j.Prompt)) > 6000 {
		return errors.New("提示词需要 1–6000 个字符")
	}
	if !models[j.Model] {
		return errors.New("请选择已验证的模型")
	}
	if j.Mode != "generate" && j.Mode != "edit" {
		return errors.New("不支持的创作模式")
	}
	if _, ok := ratioPrompts[j.Ratio]; !ok {
		return errors.New("不支持的画面比例")
	}
	if j.Resolution != "default" && j.Resolution != "2K" {
		return errors.New("不支持的分辨率档位")
	}
	gemini := strings.HasPrefix(j.Model, "gemini-")
	if j.Mode == "edit" {
		if j.Model != "gpt-image-2" && j.Model != "gemini-3.1-flash-image" {
			return errors.New("参考图编辑仅开放已测通的 GPT Image 2 和 Gemini Flash")
		}
		if len(j.Input) == 0 {
			return errors.New("请上传 PNG 或 JPEG 参考图")
		}
		if j.Ratio != "auto" || j.Resolution != "default" {
			return errors.New("编辑模式使用原图比例与默认分辨率")
		}
	}
	if gemini {
		if !((j.Ratio == "auto" && j.Resolution == "default") || (j.Ratio == "16:9" && j.Resolution == "2K")) {
			return errors.New("Gemini 仅开放默认配置和已验证的 16:9 + 2K 组合")
		}
	} else if j.Resolution != "default" {
		return errors.New("GPT 没有已验证的 2K 档位")
	}
	j.EffectivePrompt = j.Prompt
	if !gemini && j.Ratio != "auto" {
		j.EffectivePrompt += "。" + ratioPrompts[j.Ratio]
	}
	return nil
}

func decodePicture(content []byte) (picture, error) {
	if len(content) == 0 || len(content) > 24<<20 {
		return picture{}, errors.New("图片内容为空或超过 24 MB")
	}
	cfg, format, err := image.DecodeConfig(bytes.NewReader(content))
	if err != nil || (format != "png" && format != "jpeg") || cfg.Width < 1 || cfg.Height < 1 || int64(cfg.Width)*int64(cfg.Height) > 64_000_000 {
		return picture{}, errors.New("图片必须是有效的 PNG / JPEG，且不超过 6400 万像素")
	}
	return picture{MIME: "image/" + format, Width: cfg.Width, Height: cfg.Height, Bytes: len(content), Content: content}, nil
}

func (p *provider) generate(ctx context.Context, j job) (generationResult, error) {
	var body bytes.Buffer
	contentType := "application/json"
	endpoint := "/v1/images/generations"
	gemini := strings.HasPrefix(j.Model, "gemini-")
	if gemini {
		endpoint = "/v1beta/models/" + j.Model + ":generateContent"
		parts := []any{map[string]any{"text": j.EffectivePrompt}}
		if j.Mode == "edit" {
			parts = append(parts, map[string]any{"inlineData": map[string]any{"mimeType": j.InputMIME, "data": base64.StdEncoding.EncodeToString(j.Input)}})
		}
		config := map[string]any{"responseModalities": []string{"TEXT", "IMAGE"}}
		if j.Resolution == "2K" {
			config["imageConfig"] = map[string]string{"aspectRatio": "16:9", "imageSize": "2K"}
		}
		_ = json.NewEncoder(&body).Encode(map[string]any{"contents": []any{map[string]any{"role": "user", "parts": parts}}, "generationConfig": config})
	} else if j.Mode == "edit" {
		endpoint = "/v1/images/edits"
		writer := multipart.NewWriter(&body)
		_ = writer.WriteField("model", j.Model)
		_ = writer.WriteField("prompt", j.EffectivePrompt)
		ext := "png"
		if j.InputMIME == "image/jpeg" {
			ext = "jpg"
		}
		part, err := writer.CreateFormFile("image", "reference."+ext)
		if err != nil {
			return generationResult{}, err
		}
		_, _ = part.Write(j.Input)
		_ = writer.Close()
		contentType = writer.FormDataContentType()
	} else {
		_ = json.NewEncoder(&body).Encode(map[string]string{"model": j.Model, "prompt": j.EffectivePrompt})
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, p.base+endpoint, &body)
	if err != nil {
		return generationResult{}, err
	}
	request.Header.Set("Authorization", "Bearer "+p.key)
	request.Header.Set("Content-Type", contentType)
	response, err := p.client.Do(request)
	if err != nil {
		return generationResult{}, &upstreamError{Message: "上游连接失败或超时，未自动重试以避免重复计费", Endpoint: endpoint}
	}
	defer response.Body.Close()
	requestID := response.Header.Get("X-Request-Id")
	if requestID == "" {
		requestID = response.Header.Get("Request-Id")
	}
	if len(requestID) > 160 {
		requestID = requestID[:160]
	}
	fail := func(message string) (generationResult, error) {
		return generationResult{}, &upstreamError{Message: message, RequestID: requestID, Endpoint: endpoint}
	}
	// Never persist or log raw upstream error bodies: they can contain credentials or base64.
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fail(fmt.Sprintf("上游返回 HTTP %d；请凭请求 ID 检查渠道、余额或模型权限", response.StatusCode))
	}
	raw, err := io.ReadAll(io.LimitReader(response.Body, (72<<20)+1))
	if err != nil {
		return fail("读取上游响应失败")
	}
	if len(raw) > 72<<20 {
		return fail("上游响应超过 72 MB 限制")
	}
	var wire struct {
		Model        string `json:"model"`
		ModelVersion string `json:"modelVersion"`
		Quality      string `json:"quality"`
		Data         []struct {
			B64     string `json:"b64_json"`
			Quality string `json:"quality"`
		} `json:"data"`
		Candidates []struct {
			Content struct {
				Parts []struct {
					Thought    bool `json:"thought"`
					InlineData *struct {
						Data string `json:"data"`
					} `json:"inlineData"`
					InlineSnake *struct {
						Data string `json:"data"`
					} `json:"inline_data"`
				} `json:"parts"`
			} `json:"content"`
		} `json:"candidates"`
	}
	if json.Unmarshal(raw, &wire) != nil {
		return fail("上游未返回有效的 JSON")
	}
	result := generationResult{ActualModel: wire.Model, Quality: wire.Quality, RequestID: requestID, Endpoint: endpoint}
	encoded := []string{}
	if gemini {
		result.ActualModel = wire.ModelVersion
		for _, c := range wire.Candidates {
			for _, part := range c.Content.Parts {
				if part.Thought {
					continue
				}
				if part.InlineData != nil {
					encoded = append(encoded, part.InlineData.Data)
				} else if part.InlineSnake != nil {
					encoded = append(encoded, part.InlineSnake.Data)
				}
			}
		}
	} else {
		for _, d := range wire.Data {
			if d.B64 != "" {
				encoded = append(encoded, d.B64)
			}
			if result.Quality == "" {
				result.Quality = d.Quality
			}
		}
	}
	if len(encoded) == 0 {
		return fail("上游没有返回图片，可能被过滤或响应格式已变化")
	}
	if len(encoded) > 8 {
		return fail("上游返回图片数量异常")
	}
	for _, b64 := range encoded {
		data, err := base64.StdEncoding.DecodeString(b64)
		if err != nil {
			return fail("上游图片 base64 无效")
		}
		pic, err := decodePicture(data)
		if err != nil {
			return fail(err.Error())
		}
		result.Images = append(result.Images, pic)
	}
	if len(result.ActualModel) > 120 {
		result.ActualModel = result.ActualModel[:120]
	}
	if len(result.Quality) > 40 {
		result.Quality = result.Quality[:40]
	}
	return result, nil
}
