//go:build boundaryprobe

// Build explicitly with provider.go and upstream_input.go. Each invocation sends
// one request using the production adapter, with an exclusive evidence record.
package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

type picture struct {
	MIME                 string
	Width, Height, Bytes int
	Content              []byte `json:"-"`
}
type job struct {
	Mode, Model, Prompt, EffectivePrompt, Ratio, Resolution string
	Input, Reference                                        []byte
	InputMIME, ReferenceMIME                                string
}
type probeTransport struct{ record map[string]any }

func (p probeTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	p.record["request_bytes"] = r.ContentLength
	p.record["endpoint"] = r.URL.Path
	response, err := http.DefaultTransport.RoundTrip(r)
	if err == nil {
		p.record["http_status"] = response.StatusCode
		p.record["request_id"] = response.Header.Get("X-Request-Id")
		if response.StatusCode >= 400 {
			raw, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
			response.Body.Close()
			response.Body = io.NopCloser(bytes.NewReader(raw))
			p.record["error_content_type"] = response.Header.Get("Content-Type")
			var envelope struct{ Error struct{ Type, Code string } }
			if json.Unmarshal(raw, &envelope) == nil {
				valid := regexp.MustCompile(`^[a-zA-Z0-9_.-]{1,80}$`)
				if valid.MatchString(envelope.Error.Type) {
					p.record["error_type"] = envelope.Error.Type
				}
				if valid.MatchString(envelope.Error.Code) {
					p.record["error_code"] = envelope.Error.Code
				}
			}
			matches := []string{}
			for _, word := range []string{"no available channel", "unsupported model", "Invalid input image file", "insufficient", "quota", "timeout", "upstream", "Bad Gateway"} {
				if bytes.Contains(bytes.ToLower(raw), bytes.ToLower([]byte(word))) {
					matches = append(matches, word)
				}
			}
			p.record["known_error_markers"] = matches
		}
	}
	return response, err
}
func main() {
	model := flag.String("model", "", "model")
	caseName := flag.String("case", "", "unique evidence case")
	baseFile := flag.String("input", "", "synthetic input file")
	refFile := flag.String("reference", "", "optional synthetic reference file")
	outDir := flag.String("out", "", "server-local evidence directory")
	execute := flag.Bool("execute", false, "send one potentially billed request")
	generate := flag.Bool("generate", false, "text-only route control")
	prepareOnly := flag.Bool("prepare-only", false, "offline preprocessing without credentials or API call")
	flag.Parse()
	if !models[*model] || *caseName == "" || filepath.Base(*caseName) != *caseName || *outDir == "" {
		panic("invalid model/case/output")
	}
	if *prepareOnly {
		b, e := os.ReadFile(*baseFile)
		if e != nil {
			panic(e)
		}
		pic, e := prepareUpstreamInput(context.Background(), b)
		if e != nil {
			fmt.Println(e)
			os.Exit(1)
		}
		json.NewEncoder(os.Stdout).Encode(pic)
		return
	}
	if !*execute {
		fmt.Println("Dry-run: add --execute to send one request; no retries.")
		return
	}
	if err := os.MkdirAll(*outDir, 0700); err != nil {
		panic(err)
	}
	path := filepath.Join(*outDir, *model+"-"+*caseName+".json")
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		panic("evidence exists or cannot be created; refusing request")
	}
	record := map[string]any{"model": *model, "case": *caseName, "state": "started", "started_at": time.Now().UTC().Format(time.RFC3339)}
	json.NewEncoder(f).Encode(record)
	f.Close()
	started := time.Now()
	defer func() {
		record["elapsed_seconds"] = time.Since(started).Seconds()
		b, _ := json.MarshalIndent(record, "", "  ")
		os.WriteFile(path, b, 0600)
		fmt.Println(string(b))
	}()
	config, err := os.ReadFile("/opt/img-gen/.env")
	if err != nil {
		record["error"] = "configuration unavailable"
		return
	}
	cfg := map[string]string{}
	for _, line := range strings.Split(string(config), "\n") {
		k, v, ok := strings.Cut(line, "=")
		if ok && !strings.HasPrefix(strings.TrimSpace(k), "#") {
			cfg[strings.TrimSpace(k)] = strings.Trim(strings.TrimSpace(v), "\"'")
		}
	}
	base := cfg["QISO_BASE_URL"]
	if base == "" {
		base = "https://api.qiso.io"
	}
	if base != "https://api.qiso.io" {
		record["error"] = "unexpected destination"
		return
	}
	j := job{Mode: "edit", Model: *model, Prompt: "Change the central orange circle to a blue pentagon. Keep the other shapes and the background. Return one edited image.", Ratio: "auto", Resolution: "default"}
	if *generate {
		j.Mode = "generate"
		j.Prompt = "Draw a blue pentagon on a plain beige background. Return one image."
	}
	inputs := []map[string]any{}
	for i, name := range []string{*baseFile, *refFile} {
		if name == "" {
			continue
		}
		b, e := os.ReadFile(name)
		if e != nil {
			record["error"] = "fixture read failed"
			return
		}
		pic, e := decodePicture(b)
		if e != nil {
			record["error"] = e.Error()
			return
		}
		hash := sha256.Sum256(b)
		inputs = append(inputs, map[string]any{"bytes": len(b), "width": pic.Width, "height": pic.Height, "mime": pic.MIME, "sha256": hex.EncodeToString(hash[:])})
		if i == 0 {
			j.Input = b
			j.InputMIME = pic.MIME
		} else {
			j.Reference = b
			j.ReferenceMIME = pic.MIME
		}
	}
	record["inputs"] = inputs
	if err = validateJob(&j); err != nil {
		record["error"] = err.Error()
		return
	}
	p := provider{base: base, key: cfg["QISO_API_KEY"], client: &http.Client{Timeout: 5 * time.Minute, Transport: probeTransport{record}, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}
	ctx, cancel := context.WithTimeout(context.Background(), 6*time.Minute)
	defer cancel()
	result, err := p.generate(ctx, j)
	if err != nil {
		record["state"] = "failed"
		record["error"] = err.Error()
		return
	}
	record["state"] = "success"
	record["actual_model"] = result.ActualModel
	record["request_id"] = result.RequestID
	images := []picture{}
	for i, pic := range result.Images {
		filename := fmt.Sprintf("%s-%s-%d.image", *model, *caseName, i)
		if e := os.WriteFile(filepath.Join(*outDir, filename), pic.Content, 0600); e != nil {
			record["save_error"] = "output write failed"
		}
		images = append(images, pic)
	}
	record["images"] = images
}
