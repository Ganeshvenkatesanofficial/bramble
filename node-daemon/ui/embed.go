// Package ui embeds the local web UI that bramble serves at /.
//
// The release build copies the local UI's static export (local-ui/out, from
// ETH-182) into dist/ before `go build`. A checkout without that build only
// has dist/.keep, so bramble serves the placeholder page instead.
package ui

import (
	"embed"
	"io/fs"
)

//go:embed all:dist
var dist embed.FS

//go:embed placeholder
var placeholder embed.FS

// FS returns the built UI if dist/ holds one, else the placeholder page.
func FS() fs.FS {
	if sub, err := fs.Sub(dist, "dist"); err == nil {
		if _, err := fs.Stat(sub, "index.html"); err == nil {
			return sub
		}
	}
	sub, _ := fs.Sub(placeholder, "placeholder")
	return sub
}

// Built reports whether the real UI build is embedded.
func Built() bool {
	sub, err := fs.Sub(dist, "dist")
	if err != nil {
		return false
	}
	_, err = fs.Stat(sub, "index.html")
	return err == nil
}
