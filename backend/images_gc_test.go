package main

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

// writeImage drops a file into the images dir with a given age.
func writeImage(t *testing.T, dir, name string, age time.Duration) string {
	t.Helper()

	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, []byte("fake image bytes"), 0644); err != nil {
		t.Fatal(err)
	}
	when := time.Now().Add(-age)
	if err := os.Chtimes(path, when, when); err != nil {
		t.Fatal(err)
	}
	return path
}

func exists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func TestImageSweepKeepsReferencedAndRecentFiles(t *testing.T) {
	env := newTestEnv(t)
	_, cookie := env.user("images@example.com")

	used := writeImage(t, env.Cfg.ImagesDir, "used.png", 30*24*time.Hour)
	orphan := writeImage(t, env.Cfg.ImagesDir, "orphan.png", 30*24*time.Hour)
	fresh := writeImage(t, env.Cfg.ImagesDir, "fresh.png", time.Hour)

	env.createNote(cookie, "With image", "![](/api/images/used.png)", "")

	removed, err := sweepOrphanImages(env.DB, env.Cfg.ImagesDir, 7*24*time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if removed != 1 {
		t.Fatalf("removed = %d, want 1", removed)
	}
	if !exists(used) {
		t.Error("an image a note still embeds was deleted")
	}
	if !exists(fresh) {
		t.Error("a freshly uploaded image was deleted before the grace period")
	}
	if exists(orphan) {
		t.Error("the orphaned image should have been removed")
	}
}

func TestImageSweepKeepsImagesOfTrashedNotesAndVersions(t *testing.T) {
	env := newTestEnv(t)
	_, cookie := env.user("trash-images@example.com")

	trashed := writeImage(t, env.Cfg.ImagesDir, "trashed.png", 30*24*time.Hour)
	historic := writeImage(t, env.Cfg.ImagesDir, "historic.png", 30*24*time.Hour)

	id := env.createNote(cookie, "Trash me", "![](/api/images/trashed.png)", "")
	env.do("DELETE", "/api/notes/"+itoa(id), nil, cookie).expect(204)

	// A note whose current body dropped the image, but whose history still has it.
	histID := env.createNote(cookie, "Edited", "![](/api/images/historic.png)", "")
	env.do("PUT", "/api/notes/"+itoa(histID), map[string]any{"title": "Edited", "content": "no image now"}, cookie).
		expect(200)

	if _, err := sweepOrphanImages(env.DB, env.Cfg.ImagesDir, 7*24*time.Hour); err != nil {
		t.Fatal(err)
	}
	if !exists(trashed) {
		t.Error("a trashed note's image was deleted — restoring it would break")
	}
	if !exists(historic) {
		t.Error("an image referenced only by version history was deleted")
	}
}

func TestImageSweepDisabled(t *testing.T) {
	env := newTestEnv(t)
	orphan := writeImage(t, env.Cfg.ImagesDir, "orphan.png", 365*24*time.Hour)

	removed, err := sweepOrphanImages(env.DB, env.Cfg.ImagesDir, 0)
	if err != nil {
		t.Fatal(err)
	}
	if removed != 0 || !exists(orphan) {
		t.Error("a zero grace period must disable the sweep entirely")
	}
}

func TestReferencedImagesIgnoresOtherPaths(t *testing.T) {
	env := newTestEnv(t)
	_, cookie := env.user("refs@example.com")
	env.createNote(cookie, "Links", "![](https://example.com/api/images/remote.png) and /api/images/local.jpg", "")

	refs, err := referencedImages(env.DB)
	if err != nil {
		t.Fatal(err)
	}
	if !refs["local.jpg"] || !refs["remote.png"] {
		t.Errorf("expected both filenames to be treated as referenced, got %v", refs)
	}
}
