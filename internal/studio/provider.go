package studio

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
	"net/textproto"
	"strings"
)

type Provider struct {
	Base, Key string
	Client    *http.Client
}
type GenerationResult struct {
	Images                                    []Picture
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

const referenceEditPrompt = "第一张图片是基础图（待修改的画面），第二张图片是参考图（仅提供替换对象或外观）。请根据用户指令修改基础图，保留未要求修改的构图、主体、背景和风格；不要把参考图当作基础画面，不要输出拼图。用户修改指令："

func ValidateJob(j *Job) error {
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
	if j.Resolution != "default" && j.Resolution != "1K" && j.Resolution != "2K" && j.Resolution != "4K" {
		return errors.New("不支持的分辨率档位")
	}
	gemini := strings.HasPrefix(j.Model, "gemini-")
	if len(j.Reference) > 0 && j.Mode != "edit" {
		return errors.New("基础图 + 参考图仅用于编辑模式")
	}
	if j.Mode == "edit" {
		if len(j.Input) == 0 {
			return errors.New("请上传 PNG 或 JPEG 基础图")
		}
		if j.Ratio != "auto" || j.Resolution != "default" {
			return errors.New("编辑模式使用原图比例与默认分辨率")
		}
	}
	if gemini {
		// 1K and 4K were verified only with Flash; Pro retains its tested 2K preset.
		preset := j.Resolution == "2K" || j.Model == "gemini-3.1-flash-image" && (j.Resolution == "1K" || j.Resolution == "4K")
		if !((j.Ratio == "auto" && j.Resolution == "default") || (j.Ratio == "16:9" && preset)) {
			return errors.New("Gemini 仅开放默认配置或横向 16:9 档位：Flash 支持 1K / 2K / 4K，Pro 支持 2K")
		}
	} else if j.Resolution != "default" {
		return errors.New("GPT 仅支持默认分辨率，可通过提示词引导比例")
	}
	j.EffectivePrompt = j.Prompt
	if len(j.Reference) > 0 {
		j.EffectivePrompt = referenceEditPrompt + j.Prompt
	}
	if !gemini && j.Ratio != "auto" {
		j.EffectivePrompt += "。" + ratioPrompts[j.Ratio]
	}
	return nil
}

func DecodePicture(content []byte) (Picture, error) {
	if len(content) == 0 || len(content) > 24<<20 {
		return Picture{}, errors.New("图片内容为空或超过 24 MB")
	}
	cfg, format, err := image.DecodeConfig(bytes.NewReader(content))
	if err != nil || (format != "png" && format != "jpeg") || cfg.Width < 1 || cfg.Height < 1 || int64(cfg.Width)*int64(cfg.Height) > 64_000_000 {
		return Picture{}, errors.New("图片必须是有效的 PNG / JPEG，且不超过 6400 万像素")
	}
	return Picture{MIME: "image/" + format, Width: cfg.Width, Height: cfg.Height, Bytes: len(content), Content: content}, nil
}

func (p *Provider) Generate(ctx context.Context, j Job) (GenerationResult, error) {
	if j.Studio != nil {
		var err error
		j.StudioInputs, err = prepareStudioInputs(ctx, j.StudioInputs)
		if err != nil {
			return GenerationResult{}, err
		}
		if j.Studio.Ratio != "自动" {
			j.EffectivePrompt += "。请使用 " + strings.TrimSuffix(j.Studio.Ratio, " HD") + " 画布比例。"
		}
	} else if j.Mode == "edit" {
		input, err := PrepareUpstreamInput(ctx, j.Input)
		if err != nil {
			return GenerationResult{}, fmt.Errorf("基础图预处理失败：%w", err)
		}
		j.Input, j.InputMIME = input.Content, input.MIME
		if len(j.Reference) > 0 {
			reference, err := PrepareUpstreamInput(ctx, j.Reference)
			if err != nil {
				return GenerationResult{}, fmt.Errorf("参考图预处理失败：%w", err)
			}
			j.Reference, j.ReferenceMIME = reference.Content, reference.MIME
		}
	}
	var body bytes.Buffer
	contentType := "application/json"
	endpoint := "/v1/images/generations"
	gemini := strings.HasPrefix(j.Model, "gemini-")
	if gemini {
		endpoint = "/v1beta/models/" + j.Model + ":generateContent"
		parts := []any{map[string]any{"text": j.EffectivePrompt}}
		if j.Studio != nil {
			for _, input := range j.StudioInputs {
				parts = append(parts, map[string]any{"inlineData": map[string]any{"mimeType": input.MIME, "data": base64.StdEncoding.EncodeToString(input.Content)}})
			}
		} else if j.Mode == "edit" {
			parts = append(parts, map[string]any{"inlineData": map[string]any{"mimeType": j.InputMIME, "data": base64.StdEncoding.EncodeToString(j.Input)}})
			if len(j.Reference) > 0 {
				parts = append(parts, map[string]any{"inlineData": map[string]any{"mimeType": j.ReferenceMIME, "data": base64.StdEncoding.EncodeToString(j.Reference)}})
			}
		}
		config := map[string]any{"responseModalities": []string{"TEXT", "IMAGE"}}
		if j.Studio != nil {
			imageConfig := map[string]string{}
			if j.Studio.Ratio != "自动" {
				imageConfig["aspectRatio"] = j.Studio.Ratio
			}
			if j.Studio.Resolution != "" {
				size := j.Studio.Resolution
				if size == "0.5K" {
					size = "512"
				}
				imageConfig["imageSize"] = size
			}
			if len(imageConfig) > 0 {
				config["imageConfig"] = imageConfig
			}
		} else if j.Resolution == "1K" || j.Resolution == "2K" || j.Resolution == "4K" {
			config["imageConfig"] = map[string]string{"aspectRatio": "16:9", "imageSize": j.Resolution}
		}
		_ = json.NewEncoder(&body).Encode(map[string]any{"contents": []any{map[string]any{"role": "user", "parts": parts}}, "generationConfig": config})
	} else if j.Mode == "edit" {
		endpoint = "/v1/images/edits"
		writer := multipart.NewWriter(&body)
		_ = writer.WriteField("model", j.Model)
		_ = writer.WriteField("prompt", j.EffectivePrompt)
		if j.Studio != nil {
			if quality := studioQuality(*j.Studio); quality != "" {
				_ = writer.WriteField("quality", quality)
			}
			if j.Studio.Resolution != "" {
				_ = writer.WriteField("size", studioSize(*j.Studio))
			}
		}
		field := "image"
		inputs := []Picture{{Content: j.Input, MIME: j.InputMIME}}
		if len(j.Reference) > 0 {
			field = "image[]"
			inputs = append(inputs, Picture{Content: j.Reference, MIME: j.ReferenceMIME})
		}
		if j.Studio != nil {
			inputs = j.StudioInputs
			if len(inputs) > 1 {
				field = "image[]"
			}
		}
		for i, input := range inputs {
			ext := "png"
			if input.MIME == "image/jpeg" {
				ext = "jpg"
			}
			header := make(textproto.MIMEHeader)
			header.Set("Content-Disposition", fmt.Sprintf(`form-data; name="%s"; filename="input-%d.%s"`, field, i+1, ext))
			header.Set("Content-Type", input.MIME)
			part, err := writer.CreatePart(header)
			if err != nil {
				return GenerationResult{}, err
			}
			_, _ = part.Write(input.Content)
		}
		_ = writer.Close()
		contentType = writer.FormDataContentType()
	} else {
		payload := map[string]string{"model": j.Model, "prompt": j.EffectivePrompt}
		if j.Studio != nil {
			if quality := studioQuality(*j.Studio); quality != "" {
				payload["quality"] = quality
			}
			if j.Studio.Resolution != "" {
				payload["size"] = studioSize(*j.Studio)
			}
		}
		_ = json.NewEncoder(&body).Encode(payload)
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, p.Base+endpoint, &body)
	if err != nil {
		return GenerationResult{}, err
	}
	request.Header.Set("Authorization", "Bearer "+p.Key)
	request.Header.Set("Content-Type", contentType)
	response, err := p.Client.Do(request)
	if err != nil {
		return GenerationResult{}, &upstreamError{Message: "上游连接失败或超时，未自动重试以避免重复计费", Endpoint: endpoint}
	}
	defer response.Body.Close()
	requestID := response.Header.Get("X-Request-Id")
	if requestID == "" {
		requestID = response.Header.Get("Request-Id")
	}
	if len(requestID) > 160 {
		requestID = requestID[:160]
	}
	fail := func(message string) (GenerationResult, error) {
		return GenerationResult{}, &upstreamError{Message: message, RequestID: requestID, Endpoint: endpoint}
	}
	// Classify only known failure categories; never persist raw error bodies.
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		if response.StatusCode == 413 {
			return fail("上游拒绝了过大的请求（HTTP 413）；请缩小输入图片，未自动重试")
		}
		if response.StatusCode == 400 {
			diagnostic, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
			if bytes.Contains(diagnostic, []byte("Invalid input image file")) {
				return fail("上游拒绝了输入图片（HTTP 400）；请重新导出 PNG / JPEG 或缩小图片后手动提交，未自动重试")
			}
		}
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
		Model          string `json:"model"`
		ModelVersion   string `json:"modelVersion"`
		Quality        string `json:"quality"`
		PromptFeedback struct {
			BlockReason string `json:"blockReason"`
		} `json:"promptFeedback"`
		Data []struct {
			B64     string `json:"b64_json"`
			Quality string `json:"quality"`
		} `json:"data"`
		Candidates []struct {
			FinishReason string `json:"finishReason"`
			Content      struct {
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
	result := GenerationResult{ActualModel: wire.Model, Quality: wire.Quality, RequestID: requestID, Endpoint: endpoint}
	encoded := []string{}
	if gemini {
		result.ActualModel = wire.ModelVersion
		for _, c := range wire.Candidates {
			for _, part := range c.Content.Parts {
				if part.Thought {
					continue
				}
				if part.InlineData != nil && part.InlineData.Data != "" {
					encoded = append(encoded, part.InlineData.Data)
				} else if part.InlineSnake != nil && part.InlineSnake.Data != "" {
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
		if gemini {
			if wire.PromptFeedback.BlockReason != "" {
				return fail("上游内容检查拦截了输入，未返回图片；请调整图片或提示词，未自动重试")
			}
			for _, candidate := range wire.Candidates {
				switch candidate.FinishReason {
				case "PROHIBITED_CONTENT":
					return fail("上游内容检查拦截了本次请求（PROHIBITED_CONTENT），未返回图片；未自动重试")
				case "SAFETY", "IMAGE_SAFETY", "IMAGE_PROHIBITED_CONTENT":
					return fail("上游安全检查拦截了本次图片输出，未返回图片；未自动重试")
				}
			}
		}
		return fail("上游没有返回图片，可能被过滤或响应格式已变化")
	}
	if len(encoded) > 8 {
		return fail("上游返回图片数量异常")
	}
	for _, b64 := range encoded {
		encodedBytes := len(b64) - strings.Count(b64, "\r") - strings.Count(b64, "\n")
		if base64.StdEncoding.DecodedLen(encodedBytes) > (24<<20)+2 {
			return fail("上游图片超过 24 MB 限制")
		}
		data, err := base64.StdEncoding.DecodeString(b64)
		if err != nil {
			return fail("上游图片 base64 无效")
		}
		pic, err := DecodePicture(data)
		if err != nil {
			return fail(err.Error())
		}
		if err := validateOutputPicture(ctx, data); err != nil {
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

// A header alone is not a valid result. Decode before marking a paid job as
// successful, sharing the input gate to avoid simultaneous full-size decodes.
func validateOutputPicture(ctx context.Context, data []byte) error {
	select {
	case upstreamInputSlot <- struct{}{}:
		defer func() { <-upstreamInputSlot }()
	case <-ctx.Done():
		return ctx.Err()
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if _, _, err := image.Decode(bytes.NewReader(data)); err != nil {
		return errors.New("上游图片数据不完整或已损坏，未保存为成功作品；未自动重试")
	}
	return ctx.Err()
}
