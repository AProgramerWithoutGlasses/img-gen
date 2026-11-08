package studio

import "fmt"

const maxBatchImages = 20

type ModelSelection struct {
	Model string `json:"model"`
	Count int    `json:"count"`
}

// Validate the entire batch before admitting any jobs to the durable queue.
func ExpandBatch(Base Job, selections []ModelSelection) ([]Job, error) {
	if len(selections) == 0 || len(selections) > len(models) {
		return nil, fmt.Errorf("请选择 1–%d 个模型", len(models))
	}
	seen := make(map[string]bool)
	jobs := []Job{}
	for _, selection := range selections {
		if seen[selection.Model] {
			return nil, fmt.Errorf("同一模型不能重复选择")
		}
		seen[selection.Model] = true
		if selection.Count < 1 || selection.Count > 4 {
			return nil, fmt.Errorf("每个模型可生成 1–4 张图片")
		}
		j := Base
		j.Model = selection.Model
		if err := ValidateJob(&j); err != nil {
			return nil, err
		}
		for i := 0; i < selection.Count; i++ {
			jobs = append(jobs, j)
		}
	}
	if len(jobs) > maxBatchImages {
		return nil, fmt.Errorf("每批最多生成 %d 张图片", maxBatchImages)
	}
	return jobs, nil
}
