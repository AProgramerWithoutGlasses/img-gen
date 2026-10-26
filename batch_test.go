package main

import "testing"

func TestBatchGeminiResolutionPresets(t *testing.T) {
	for _, resolution := range []string{"1K", "2K", "4K"} {
		base := job{Mode: "generate", Prompt: "相机", Ratio: "16:9", Resolution: resolution}
		flash := []modelSelection{{"gemini-3.1-flash-image", 2}}
		jobs, err := expandBatch(base, flash)
		if err != nil || len(jobs) != 2 {
			t.Fatalf("Flash %s: %v", resolution, err)
		}
		for _, j := range jobs {
			if j.Resolution != resolution || j.Ratio != "16:9" {
				t.Fatal("batch lost selected resolution")
			}
		}
		if jobs, err := expandBatch(base, append(flash, modelSelection{"gpt-image-2", 1})); err == nil || jobs != nil {
			t.Fatal("mixed GPT batch must reject the whole request")
		}
		jobs, err = expandBatch(base, append(flash, modelSelection{"gemini-3-pro-image", 1}))
		if resolution == "2K" {
			if err != nil || len(jobs) != 3 {
				t.Fatal("Gemini models should share 2K")
			}
		} else if err == nil || jobs != nil {
			t.Fatal("Pro must reject unverified preset for the whole batch")
		}
	}
}

func TestExpandBatch(t *testing.T) {
	base := job{Mode: "generate", Prompt: "共同提示词", Ratio: "auto", Resolution: "default"}
	selections := []modelSelection{{"gpt-image-2", 2}, {"gemini-3.1-flash-image", 3}}
	jobs, err := expandBatch(base, selections)
	if err != nil || len(jobs) != 5 {
		t.Fatalf("expand: %d jobs, %v", len(jobs), err)
	}
	for i, j := range jobs {
		want := "gpt-image-2"
		if i >= 2 {
			want = "gemini-3.1-flash-image"
		}
		if j.Model != want || j.Prompt != base.Prompt || j.EffectivePrompt != base.Prompt || j.Ratio != base.Ratio || j.Resolution != base.Resolution {
			t.Fatalf("wrong model/count or shared settings: %+v", j)
		}
	}
	for name, invalid := range map[string][]modelSelection{
		"empty":               nil,
		"duplicate":           {{"gpt-image-2", 1}, {"gpt-image-2", 1}},
		"zero":                {{"gpt-image-2", 0}},
		"negative":            {{"gpt-image-2", -1}},
		"too many":            {{"gpt-image-2", 5}},
		"unknown after valid": {{"gpt-image-2", 1}, {"unknown", 1}},
	} {
		t.Run(name, func(t *testing.T) {
			if jobs, err := expandBatch(base, invalid); err == nil || jobs != nil {
				t.Fatal("invalid batch must fail without partial results")
			}
		})
	}
	base.Ratio = "16:9"
	if jobs, err := expandBatch(base, selections); err == nil || jobs != nil {
		t.Fatal("mixed default-resolution batch must reject unsupported Gemini ratio")
	}
	base.Resolution = "2K"
	if jobs, err := expandBatch(base, selections); err == nil || jobs != nil {
		t.Fatal("mixed batch must reject GPT 2K")
	}
	base.Mode, base.Ratio, base.Resolution = "edit", "auto", "default"
	base.Input, base.InputMIME = testPNG(), "image/png"
	if jobs, err := expandBatch(base, selections); err != nil || len(jobs) != 5 || len(jobs[4].Input) == 0 {
		t.Fatalf("shared reference missing: %v", err)
	}
	if _, err := expandBatch(base, []modelSelection{{"gpt-image-1.5", 1}}); err == nil {
		t.Fatal("unverified edit model accepted")
	}
	base.Mode = "generate"
	all := []modelSelection{}
	for model := range models {
		all = append(all, modelSelection{model, 4})
	}
	if jobs, err := expandBatch(base, all); err != nil || len(jobs) != maxBatchImages {
		t.Fatalf("maximum batch: %d jobs, %v", len(jobs), err)
	}
}
