package main

import (
	"database/sql"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"time"
)

// imageRefRe matches the URLs the editor inserts, e.g. ![](/api/images/ab12.png).
var imageRefRe = regexp.MustCompile(`/api/images/([A-Za-z0-9_-]+\.[A-Za-z0-9]+)`)

// referencedImages collects every uploaded file still mentioned by a note, a
// note version or a template. Trashed notes count: restoring one must not find
// its images gone.
func referencedImages(db *sql.DB) (map[string]bool, error) {
	refs := map[string]bool{}

	rows, err := db.Query(`
		SELECT content FROM notes
		UNION ALL SELECT content FROM note_versions
		UNION ALL SELECT content FROM templates`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var content string
		if err := rows.Scan(&content); err != nil {
			return nil, err
		}
		for _, m := range imageRefRe.FindAllStringSubmatch(content, -1) {
			refs[m[1]] = true
		}
	}
	return refs, rows.Err()
}

// sweepOrphanImages deletes uploads no note refers to any more. Files younger
// than grace are always kept: an image is uploaded before the note that embeds
// it is saved, and an unsaved draft may reference one for a while.
func sweepOrphanImages(db *sql.DB, dir string, grace time.Duration) (int, error) {
	if grace <= 0 {
		return 0, nil
	}

	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return 0, nil
		}
		return 0, err
	}

	refs, err := referencedImages(db)
	if err != nil {
		return 0, err
	}

	cutoff := time.Now().Add(-grace)
	removed := 0
	for _, entry := range entries {
		if entry.IsDir() || refs[entry.Name()] {
			continue
		}
		info, err := entry.Info()
		if err != nil || info.ModTime().After(cutoff) {
			continue
		}
		if err := os.Remove(filepath.Join(dir, entry.Name())); err == nil {
			removed++
		}
	}
	return removed, nil
}

// startImageSweeper reclaims orphaned uploads at startup and then periodically.
func startImageSweeper(db *sql.DB, dir string, grace time.Duration) {
	if grace <= 0 {
		log.Printf("image garbage collection disabled — orphaned uploads are kept")
		return
	}
	sweep := func() {
		n, err := sweepOrphanImages(db, dir, grace)
		if err != nil {
			log.Printf("image sweep failed: %v", err)
			return
		}
		if n > 0 {
			log.Printf("image sweep removed %d unreferenced upload(s)", n)
		}
	}
	sweep()

	go func() {
		ticker := time.NewTicker(12 * time.Hour)
		defer ticker.Stop()
		for range ticker.C {
			sweep()
		}
	}()
}
