package studio

import (
	"encoding/json"
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
	// Read metadata in bulk; no binary image content is included in the snapshot.
	opts := map[string]GenerationOptions{}
	positions := map[string]int{}
	attachments := map[string][]Attachment{}
	batchScope, batchArgs := ownerScope(r, "b.user_id")
	rows, err = a.DB.QueryContext(ctx, "SELECT b.id,b.options FROM studio_batches b WHERE 1=1"+batchScope, batchArgs...)
	if err != nil {
		apiError(w, 500, "读取任务参数失败")
		return
	}
	for rows.Next() {
		var id string
		var raw []byte
		var o GenerationOptions
		if err = rows.Scan(&id, &raw); err != nil {
			break
		}
		if err = json.Unmarshal(raw, &o); err != nil {
			break
		}
		opts[id] = o
	}
	err = errors.Join(err, rows.Err())
	rows.Close()
	if err != nil {
		apiError(w, 500, "读取任务参数失败")
		return
	}
	rows, err = a.DB.QueryContext(ctx, "SELECT bj.job_id,bj.output_index FROM studio_batch_jobs bj JOIN studio_batches b ON b.id=bj.batch_id WHERE 1=1"+batchScope, batchArgs...)
	if err != nil {
		apiError(w, 500, "读取输出顺序失败")
		return
	}
	for rows.Next() {
		var id string
		var pos int
		if err = rows.Scan(&id, &pos); err != nil {
			break
		}
		positions[id] = pos
	}
	err = errors.Join(err, rows.Err())
	rows.Close()
	if err != nil {
		apiError(w, 500, "读取输出顺序失败")
		return
	}
	rows, err = a.DB.QueryContext(ctx, "SELECT b.id,a.id,a.name,a.width,a.height FROM studio_batch_attachments ba JOIN studio_batches b ON b.id=ba.batch_id JOIN studio_attachments a ON a.id=ba.attachment_id WHERE 1=1"+batchScope+" ORDER BY ba.position", batchArgs...)
	if err != nil {
		apiError(w, 500, "读取附件失败")
		return
	}
	for rows.Next() {
		var id string
		var att Attachment
		if err = rows.Scan(&id, &att.ID, &att.Name, &att.Width, &att.Height); err != nil {
			break
		}
		att.URL = "/api/studio/attachments/" + att.ID
		attachments[id] = append(attachments[id], att)
	}
	err = errors.Join(err, rows.Err())
	rows.Close()
	if err != nil {
		apiError(w, 500, "读取附件失败")
		return
	}
	// Memberships and folders always belong to the current workspace, even for administrators.
	folders := []Folder{}
	memberships := map[string][]string{}
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
	rows, err = a.DB.QueryContext(ctx, "SELECT m.image_id,m.folder_id FROM studio_image_folders m JOIN studio_folders f ON f.id=m.folder_id WHERE f.user_id=?", actor.ID)
	if err != nil {
		apiError(w, 500, "读取归类失败")
		return
	}
	for rows.Next() {
		var id, fid string
		if err = rows.Scan(&id, &fid); err != nil {
			break
		}
		memberships[id] = append(memberships[id], fid)
	}
	err = errors.Join(err, rows.Err())
	rows.Close()
	if err != nil {
		apiError(w, 500, "读取归类失败")
		return
	}
	// Read image metadata once for the whole authorized snapshot. Querying once
	// per job made startup and every poll slower as history accumulated.
	rows, err = a.DB.QueryContext(ctx, `SELECT images.job_id,images.id,images.mime,images.width,images.height,images.byte_size
		FROM images JOIN jobs ON jobs.id=images.job_id WHERE 1=1`+scope+` ORDER BY images.job_id,images.id`, args...)
	if err != nil {
		apiError(w, 500, "读取图片失败")
		return
	}
	pictures := map[string][]Picture{}
	for rows.Next() {
		var jobID string
		var p Picture
		if err = rows.Scan(&jobID, &p.ID, &p.MIME, &p.Width, &p.Height, &p.Bytes); err != nil {
			break
		}
		p.URL = "/api/images/" + p.ID
		p.ThumbnailURL = p.URL + "/thumbnail/" + thumbnailVersion
		p.PreviewURL = p.URL + "/preview/" + previewVersion
		pictures[jobID] = append(pictures[jobID], p)
	}
	err = errors.Join(err, rows.Err())
	rows.Close()
	if err != nil {
		apiError(w, 500, "读取图片失败")
		return
	}
	for i := range jobs {
		jobs[i].Images = pictures[jobs[i].ID]
	}
	generations, assets := studioHistory(jobs, opts, positions, attachments, memberships)
	jsonResponse(w, 200, map[string]any{"version": 1, "users": users, "currentUserId": actor.ID, "prices": prices, "priceVersions": versions, "priceUpdatedAt": updated, "assets": assets, "folders": folders, "generations": generations, "preferences": map[string]any{"theme": "system", "enterToSend": true}})
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
			g.Attachments = append(g.Attachments, Attachment{ID: first.ID + "-input", Name: "输入图片", URL: "/api/jobs/" + first.ID + "/input"})
		}
		if !ok && first.HasReference {
			g.Attachments = append(g.Attachments, Attachment{ID: first.ID + "-reference", Name: "参考图片", URL: "/api/jobs/" + first.ID + "/reference"})
		}
		active, failed := false, false
		var started, finished *time.Time
		for i, j := range batch {
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
				assets = append(assets, Asset{Attachment: Attachment{p.ID, "生成图片-" + p.ID + "." + strings.TrimPrefix(p.MIME, "image/"), p.URL, p.Width, p.Height}, ThumbnailURL: p.ThumbnailURL, PreviewURL: p.PreviewURL, UserID: j.UserID, CreatedAt: j.CreatedAt, BatchID: id, OutputIndex: i, Prompt: j.Prompt, Options: o, FolderIDs: fids})
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
