package web

import "embed"

// Files contains only the compiled frontend. Run npm run build before Go checks.
//go:embed studio
var Files embed.FS
