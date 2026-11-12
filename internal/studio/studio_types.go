package studio

import (
	_ "golang.org/x/image/webp"
	_ "image/gif"
	"time"
)

type GenerationOptions struct {
	ModelID    string `json:"modelId"`
	Quality    string `json:"quality,omitempty"`
	Resolution string `json:"resolution,omitempty"`
	Ratio      string `json:"ratio"`
	Count      int    `json:"count"`
}

type Attachment struct {
	ID              string `json:"id"`
	Name            string `json:"name"`
	URL             string `json:"url"`
	Width           int    `json:"width"`
	Height          int    `json:"height"`
	ThumbnailURL    string `json:"thumbnailUrl,omitempty"`
	PreviewURL      string `json:"previewUrl,omitempty"`
	PreviewLargeURL string `json:"previewLargeUrl,omitempty"`
}

type Asset struct {
	Attachment
	ThumbnailURL string            `json:"thumbnailUrl"`
	PreviewURL   string            `json:"previewUrl"`
	UserID       string            `json:"userId"`
	CreatedAt    time.Time         `json:"createdAt"`
	BatchID      string            `json:"batchId"`
	OutputIndex  int               `json:"outputIndex"`
	Prompt       string            `json:"prompt"`
	Options      GenerationOptions `json:"options"`
	FolderIDs    []string          `json:"folderIds"`
	TrashedAt    *time.Time        `json:"trashedAt,omitempty"`
}

type GenerationOutput struct {
	OutputIndex int               `json:"outputIndex"`
	Status      string            `json:"status"`
	StartedAt   *time.Time        `json:"startedAt,omitempty"`
	FinishedAt  *time.Time        `json:"finishedAt,omitempty"`
	ImageState  string            `json:"imageState,omitempty"`
	ImageStates map[string]string `json:"imageStates,omitempty"`
}

type Generation struct {
	ID          string             `json:"id"`
	UserID      string             `json:"userId"`
	Username    string             `json:"username"`
	Prompt      string             `json:"prompt"`
	Attachments []Attachment       `json:"attachments"`
	Options     GenerationOptions  `json:"options"`
	Status      string             `json:"status"`
	ImageIDs    []string           `json:"imageIds"`
	Outputs     []GenerationOutput `json:"outputs,omitempty"`
	CreatedAt   time.Time          `json:"createdAt"`
	CompletedAt *time.Time         `json:"completedAt,omitempty"`
	DurationMS  *int64             `json:"durationMs,omitempty"`
	Cost        int64              `json:"cost"`
	Error       string             `json:"error,omitempty"`
}

type Folder struct {
	ID        string    `json:"id"`
	UserID    string    `json:"userId"`
	Name      string    `json:"name"`
	CreatedAt time.Time `json:"createdAt"`
}

type StudioUser struct {
	ID        string    `json:"id"`
	Username  string    `json:"username"`
	Role      string    `json:"role"`
	Status    string    `json:"status"`
	Balance   int64     `json:"balance"`
	CreatedAt time.Time `json:"createdAt"`
}

func toStudioUser(u User) StudioUser {
	status := "disabled"
	if u.Active {
		status = "enabled"
	}
	return StudioUser{u.ID, u.Username, u.Role, status, u.Credits, u.CreatedAt}
}
