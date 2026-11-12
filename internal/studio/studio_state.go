package studio

import (
	"errors"
	"fmt"
	_ "golang.org/x/image/webp"
	_ "image/gif"
	"net/http"
	"sort"
	"strings"
	"time"
)

func (a *App) studioState(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	actor := currentUser(r)
	scope, args := ownerScope(r, "jobs.user_id")
	workspace := r.URL.Query().Get("view") == "workspace"
	if workspace {
		watch := []string{}
		if raw := r.URL.Query().Get("watch"); raw != "" {
			watch = strings.Split(raw, ",")
			if len(watch) > 100 {
				apiError(w, 400, "跟踪任务过多")
				return
			}
			for _, id := range watch {
				if !ValidID(id) {
					apiError(w, 400, "无效的任务编号")
					return
				}
			}
		}
		batchIDs, err := a.workspaceBatchIDs(ctx, actor.ID)
		if err != nil {
			apiError(w, 500, "读取工作区失败")
			return
		}
		batchIDs = append(batchIDs, watch...)
		scope, args = selectedScope("jobs.batch_id", batchIDs)
		scope += " AND jobs.user_id=?"
		args = append(args, actor.ID)
	}
	users := []StudioUser{}
	userSQL := "SELECT id,username,role,active,created_at,credits FROM users"
	userArgs := []any{}
	if actor.Role != "admin" {
		userSQL += " WHERE id=?"
		userArgs = append(userArgs, actor.ID)
	}
	rows, err := a.DB.QueryContext(ctx, userSQL+" ORDER BY created_at DESC,id", userArgs...)
	if err != nil {
		apiError(w, 500, "读取账户失败")
		return
	}
	for rows.Next() {
		var u User
		if err = rows.Scan(&u.ID, &u.Username, &u.Role, &u.Active, &u.CreatedAt, &u.Credits); err != nil {
			break
		}
		users = append(users, toStudioUser(u))
	}
	err = errors.Join(err, rows.Err())
	rows.Close()
	if err != nil {
		apiError(w, 500, "读取账户失败")
		return
	}
	prices := map[string]int64{}
	versions := map[string]int{}
	updated := map[string]time.Time{}
	rows, err = a.DB.QueryContext(ctx, "SELECT model,credits,version,updated_at FROM model_prices")
	if err != nil {
		apiError(w, 500, "读取价格失败")
		return
	}
	for rows.Next() {
		var p modelPrice
		if err = rows.Scan(&p.Model, &p.Credits, &p.Version, &p.UpdatedAt); err != nil {
			break
		}
		prices[p.Model] = p.Credits
		versions[p.Model] = p.Version
		updated[p.Model] = p.UpdatedAt
	}
	err = errors.Join(err, rows.Err())
	rows.Close()
	if err != nil {
		apiError(w, 500, "读取价格失败")
		return
	}
	rows, err = a.DB.QueryContext(ctx, "SELECT "+jobColumns+" FROM jobs WHERE 1=1"+scope+" ORDER BY created_at,id", args...)
	if err != nil {
		apiError(w, 500, "读取任务失败")
		return
	}
	jobs := []Job{}
	for rows.Next() {
		var j Job
		j, err = ScanJob(rows)
		if err != nil {
			break
		}
		jobs = append(jobs, j)
	}
	err = errors.Join(err, rows.Err())
	rows.Close()
	if err != nil {
		apiError(w, 500, "读取任务失败")
		return
	}
	// Memberships and folders always belong to the current workspace, even for administrators.
	folders := []Folder{}
	rows, err = a.DB.QueryContext(ctx, "SELECT id,user_id,name,created_at FROM studio_folders WHERE user_id=? ORDER BY created_at,id", actor.ID)
	if err != nil {
		apiError(w, 500, "读取文件夹失败")
		return
	}
	for rows.Next() {
		var f Folder
		if err = rows.Scan(&f.ID, &f.UserID, &f.Name, &f.CreatedAt); err != nil {
			break
		}
		folders = append(folders, f)
	}
	err = errors.Join(err, rows.Err())
	rows.Close()
	if err != nil {
		apiError(w, 500, "读取文件夹失败")
		return
	}
	generations, assets, err := a.loadStudioHistory(ctx, jobs, actor.ID, false)
	if err != nil {
		apiError(w, 500, "读取图片历史失败")
		return
	}
	response := map[string]any{"version": 1, "users": users, "currentUserId": actor.ID, "prices": prices, "priceVersions": versions, "priceUpdatedAt": updated, "assets": assets, "folders": folders, "generations": generations, "preferences": map[string]any{"theme": "system", "enterToSend": true}}
	if workspace {
		summary, err := a.studioImageSummary(ctx, actor.ID)
		if err != nil {
			apiError(w, 500, "读取图片数量失败")
			return
		}
		response["imageSummary"] = summary
	}
	jsonResponse(w, 200, response)
}

func studioHistory(jobs []Job, opts map[string]GenerationOptions, positions map[string]int, attachments map[string][]Attachment, memberships map[string][]string) ([]Generation, []Asset) {
	grouped := map[string][]Job{}
	keys := []string{}
	for _, j := range jobs {
		Key := j.BatchID + ":" + j.Model
		if _, ok := grouped[Key]; !ok {
			keys = append(keys, Key)
		}
		grouped[Key] = append(grouped[Key], j)
	}
	generations := []Generation{}
	assets := []Asset{}
	for _, Key := range keys {
		batch := grouped[Key]
		sort.SliceStable(batch, func(i, j int) bool { return positions[batch[i].ID] < positions[batch[j].ID] })
		first := batch[0]
		o, ok := opts[first.BatchID]
		if !ok {
			ratio := first.Ratio
			if ratio == "auto" {
				ratio = "自动"
			}
			o = GenerationOptions{ModelID: first.Model, Ratio: ratio, Count: len(batch)}
			if first.Resolution != "default" {
				o.Resolution = first.Resolution
			}
		}
		id := first.BatchID
		if !ok {
			id += "-" + first.Model
		}
		g := Generation{ID: id, UserID: first.UserID, Username: first.Username, Prompt: first.Prompt, Options: o, Status: "completed", ImageIDs: []string{}, Attachments: attachments[first.BatchID], CreatedAt: first.CreatedAt}
		if g.Attachments == nil {
			g.Attachments = []Attachment{}
		}
		if !ok && first.HasInput {
			g.Attachments = append(g.Attachments, Attachment{ID: first.ID + "-input", Name: "输入图片", URL: "/api/jobs/" + first.ID + "/input", PreviewURL: "/api/jobs/" + first.ID + "/input/preview/" + previewVersion})
		}
		if !ok && first.HasReference {
			g.Attachments = append(g.Attachments, Attachment{ID: first.ID + "-reference", Name: "参考图片", URL: "/api/jobs/" + first.ID + "/reference", PreviewURL: "/api/jobs/" + first.ID + "/reference/preview/" + previewVersion})
		}
		active, failed := false, false
		var started, finished *time.Time
		for i, j := range batch {
			// Use the same stable slot index as Asset.OutputIndex, including legacy batches.
			g.Outputs = append(g.Outputs, GenerationOutput{OutputIndex: i, Status: j.Status, StartedAt: j.StartedAt, FinishedAt: j.FinishedAt, ImageState: j.ImageState, ImageStates: j.ImageStates})
			active = active || j.Status == "queued" || j.Status == "running"
			failed = failed || j.Status == "failed"
			if j.Error != "" {
				if g.Error != "" {
					g.Error += "；"
				}
				g.Error += fmt.Sprintf("第 %d 张：%s", i+1, j.Error)
			}
			if j.CreditsState == "charged" || j.CreditsState == "reserved" {
				g.Cost += j.CreditsCost
			}
			if j.StartedAt != nil && (started == nil || j.StartedAt.Before(*started)) {
				started = j.StartedAt
			}
			if j.FinishedAt != nil && (finished == nil || j.FinishedAt.After(*finished)) {
				finished = j.FinishedAt
			}
			for _, p := range j.Images {
				fids := memberships[p.ID]
				if fids == nil {
					fids = []string{}
				}
				assets = append(assets, Asset{Attachment: Attachment{ID: p.ID, Name: "生成图片-" + p.ID + "." + strings.TrimPrefix(p.MIME, "image/"), URL: p.URL, Width: p.Width, Height: p.Height}, ThumbnailURL: p.ThumbnailURL, PreviewURL: p.PreviewURL, UserID: j.UserID, CreatedAt: j.CreatedAt, BatchID: id, OutputIndex: i, Prompt: j.Prompt, Options: o, FolderIDs: fids, TrashedAt: p.TrashedAt})
				g.ImageIDs = append(g.ImageIDs, p.ID)
			}
		}
		if active {
			g.Status = "processing"
		} else {
			g.CompletedAt = finished
			if started != nil && finished != nil {
				ms := finished.Sub(*started).Milliseconds()
				g.DurationMS = &ms
			}
			if failed {
				g.Status = "failed"
			}
		}
		generations = append(generations, g)
	}
	sort.SliceStable(generations, func(i, j int) bool { return generations[i].CreatedAt.Before(generations[j].CreatedAt) })
	sort.SliceStable(assets, func(i, j int) bool {
		if assets[i].BatchID == assets[j].BatchID {
			return assets[i].OutputIndex < assets[j].OutputIndex
		}
		return assets[i].CreatedAt.After(assets[j].CreatedAt)
	})
	return generations, assets
}
