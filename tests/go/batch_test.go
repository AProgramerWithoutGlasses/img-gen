package studio_test

import studio "github.com/AProgramerWithoutGlasses/img-gen/internal/studio"

import "testing"

func TestBatchGeminiResolutionPresets(t *testing.T) {
	for _, resolution := range []string{"1K", "2K", "4K"} {
		Base := studio.Job{Mode: "generate", Prompt: "相机", Ratio: "16:9", Resolution: resolution}
		flash := []studio.ModelSelection{{Model: "gemini-3.1-flash-image", Count: 2}}
		jobs, err := studio.ExpandBatch(Base, flash)
		if err != nil || len(jobs) != 2 {
			t.Fatalf("Flash %s: %v", resolution, err)
		}
		for _, j := range jobs {
			if j.Resolution != resolution || j.Ratio != "16:9" {
				t.Fatal("batch lost selected resolution")
			}
		}
		if jobs, err := studio.ExpandBatch(Base, append(flash, studio.ModelSelection{Model: "gpt-image-2", Count: 1})); err == nil || jobs != nil {
			t.Fatal("mixed GPT batch must reject the whole request")
		}
		jobs, err = studio.ExpandBatch(Base, append(flash, studio.ModelSelection{Model: "gemini-3-pro-image", Count: 1}))
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
	Base := studio.Job{Mode: "generate", Prompt: "共同提示词", Ratio: "auto", Resolution: "default"}
	selections := []studio.ModelSelection{{Model: "gpt-image-2", Count: 2}, {Model: "gemini-3.1-flash-image", Count: 3}}
	jobs, err := studio.ExpandBatch(Base, selections)
	if err != nil || len(jobs) != 5 {
		t.Fatalf("expand: %d jobs, %v", len(jobs), err)
	}
	for i, j := range jobs {
		want := "gpt-image-2"
		if i >= 2 {
			want = "gemini-3.1-flash-image"
		}
		if j.Model != want || j.Prompt != Base.Prompt || j.EffectivePrompt != Base.Prompt || j.Ratio != Base.Ratio || j.Resolution != Base.Resolution {
			t.Fatalf("wrong model/count or shared settings: %+v", j)
		}
	}
	for name, invalid := range map[string][]studio.ModelSelection{
		"empty":               nil,
		"duplicate":           {{Model: "gpt-image-2", Count: 1}, {Model: "gpt-image-2", Count: 1}},
		"zero":                {{Model: "gpt-image-2", Count: 0}},
		"negative":            {{Model: "gpt-image-2", Count: -1}},
		"too many":            {{Model: "gpt-image-2", Count: 5}},
		"unknown after valid": {{Model: "gpt-image-2", Count: 1}, {Model: "unknown", Count: 1}},
	} {
		t.Run(name, func(t *testing.T) {
			if jobs, err := studio.ExpandBatch(Base, invalid); err == nil || jobs != nil {
				t.Fatal("invalid batch must fail without partial results")
			}
		})
	}
	Base.Ratio = "16:9"
	if jobs, err := studio.ExpandBatch(Base, selections); err == nil || jobs != nil {
		t.Fatal("mixed default-resolution batch must reject unsupported Gemini ratio")
	}
	Base.Resolution = "2K"
	if jobs, err := studio.ExpandBatch(Base, selections); err == nil || jobs != nil {
		t.Fatal("mixed batch must reject GPT 2K")
	}
	Base.Mode, Base.Ratio, Base.Resolution = "edit", "auto", "default"
	Base.Input, Base.InputMIME = testPNG(), "image/png"
	if jobs, err := studio.ExpandBatch(Base, selections); err != nil || len(jobs) != 5 || len(jobs[4].Input) == 0 {
		t.Fatalf("shared reference missing: %v", err)
	}
	Base.Mode = "generate"
	all := []studio.ModelSelection{}
	for model := range models {
		all = append(all, studio.ModelSelection{Model: model, Count: 4})
	}
	if jobs, err := studio.ExpandBatch(Base, all); err != nil || len(jobs) != maxBatchImages {
		t.Fatalf("maximum batch: %d jobs, %v", len(jobs), err)
	}
	Base.Mode = "edit"
	Base.Reference, Base.ReferenceMIME = referencePNG(), "image/png"
	jobs, err = studio.ExpandBatch(Base, all)
	if err != nil || len(jobs) != maxBatchImages {
		t.Fatalf("all-model edit batch: %d jobs, %v", len(jobs), err)
	}
	for _, j := range jobs {
		if len(j.Input) != len(Base.Input) || len(j.Reference) != len(Base.Reference) || j.ReferenceMIME != Base.ReferenceMIME {
			t.Fatal("all-model edit batch lost image inputs")
		}
	}
}
