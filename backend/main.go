package main

import (
	"database/sql"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
)

// version is stamped in at build time by scripts/build-backend.sh
// (-X main.version). A plain `go build` leaves it as "dev".
var version = "dev"

type Config struct {
	Addr           string
	SQLitePath     string
	FrontendOrigin string
	ImagesDir      string

	CookieName   string
	CookieSecure bool

	SessionTTL      time.Duration
	TrashRetention  time.Duration
	MaxNoteVersions int
	ImageGCGrace    time.Duration
	AdminEmail      string
	AdminPassword   string
}

func getenv(key, def string) string {
	v := os.Getenv(key)
	if v == "" {
		return def
	}
	return v
}

func mustLoadConfig() Config {
	addr := getenv("ADDR", ":8080")
	sqlitePath := getenv("SQLITE_PATH", "./notes.db")
	frontendOrigin := getenv("FRONTEND_ORIGIN", "http://localhost:5173")
	imagesDir := getenv("IMAGES_DIR", filepath.Join(filepath.Dir(sqlitePath), "images"))

	cookieName := getenv("COOKIE_NAME", "notes_session")
	cookieSecure := getenv("COOKIE_SECURE", "0") == "1"

	ttlHours, err := strconv.Atoi(getenv("SESSION_TTL_HOURS", "168"))
	if err != nil || ttlHours <= 0 {
		ttlHours = 168
	}

	// 0 keeps trashed notes forever; negative values fall back to the default.
	trashDays, err := strconv.Atoi(getenv("TRASH_RETENTION_DAYS", "30"))
	if err != nil || trashDays < 0 {
		trashDays = 30
	}

	// 0 keeps every version of a note.
	maxVersions, err := strconv.Atoi(getenv("MAX_NOTE_VERSIONS", "50"))
	if err != nil || maxVersions < 0 {
		maxVersions = 50
	}

	// How long an unreferenced upload survives before the sweeper reclaims it.
	// Generous by default: an image is uploaded before the note is saved.
	imageGraceHours, err := strconv.Atoi(getenv("IMAGE_GC_GRACE_HOURS", "168"))
	if err != nil || imageGraceHours < 0 {
		imageGraceHours = 168
	}

	return Config{
		Addr:            addr,
		SQLitePath:      sqlitePath,
		FrontendOrigin:  frontendOrigin,
		ImagesDir:       imagesDir,
		CookieName:      cookieName,
		CookieSecure:    cookieSecure,
		SessionTTL:      time.Duration(ttlHours) * time.Hour,
		TrashRetention:  time.Duration(trashDays) * 24 * time.Hour,
		MaxNoteVersions: maxVersions,
		ImageGCGrace:    time.Duration(imageGraceHours) * time.Hour,
		AdminEmail:      getenv("ADMIN_EMAIL", ""),
		AdminPassword:   getenv("ADMIN_PASSWORD", ""),
	}
}

func main() {
	cfg := mustLoadConfig()

	if err := os.MkdirAll(cfg.ImagesDir, 0755); err != nil {
		log.Fatalf("cannot create images dir: %v", err)
	}

	db, err := openDB(cfg.SQLitePath)
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()
	if err := ensureAdminUser(db, cfg.AdminEmail, cfg.AdminPassword); err != nil {
		log.Fatal(err)
	}
	if err := initSearch(db); err != nil {
		log.Fatal(err)
	}
	if !ftsEnabled {
		log.Printf("FTS5 unavailable — search falls back to scanning (rebuild with -tags sqlite_fts5)")
	}
	startTrashSweeper(db, cfg.TrashRetention)
	startImageSweeper(db, cfg.ImagesDir, cfg.ImageGCGrace)

	r := buildRouter(db, cfg)

	log.Printf("GreyNote %s listening on %s (sqlite=%s, images=%s)", version, cfg.Addr, cfg.SQLitePath, cfg.ImagesDir)
	log.Fatal(r.Run(cfg.Addr))
}

// buildRouter wires every route. Kept separate from main so tests can drive the
// real router against a temporary database.
func buildRouter(db *sql.DB, cfg Config) *gin.Engine {
	r := gin.New()
	// Route on the raw path so a percent-encoded slash stays inside one path
	// segment; tag names may contain "/" (nested-tag convention).
	r.UseRawPath = true
	r.UnescapePathValues = true
	r.Use(gin.Logger(), gin.Recovery())
	r.Use(CORSMiddleware(cfg.FrontendOrigin))

	r.GET("/health", func(c *gin.Context) { c.String(http.StatusOK, "ok") })
	r.GET("/api/version", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"version": version}) })

	auth := NewAuthHandlers(db, cfg)
	notes := NewNotesHandlers(db, cfg.TrashRetention, cfg.MaxNoteVersions)
	tags := NewTagsHandlers(db)
	images := NewImagesHandlers(cfg.ImagesDir)

	api := r.Group("/api")
	{
		api.POST("/login", auth.Login)
		api.POST("/logout", auth.Logout)

		// public: share view and image serving
		api.GET("/share/:token", notes.GetShared)
		api.GET("/images/:filename", images.Serve)

		pr := api.Group("/")
		pr.Use(AuthRequired(db, cfg.CookieName))
		{
			admin := pr.Group("/admin")
			admin.Use(AdminRequired(db))
			{
				admin.GET("/users", auth.ListUsersAdmin)
				admin.POST("/users", auth.CreateUserAdmin)
				admin.PUT("/users/:id/admin", auth.SetAdminFlag)
				admin.DELETE("/users/:id", auth.DeleteUserAdmin)
			}

			pr.GET("/me", auth.Me)

			// account self-service
			pr.PUT("/account/password", auth.ChangePassword)
			pr.DELETE("/account", auth.DeleteAccount)

			// notes — static segments must be registered before :id wildcard
			pr.GET("/notes/export", notes.ExportZip)
			pr.GET("/notes/stats", notes.Stats)
			pr.GET("/notes/search", notes.Search)
			pr.GET("/notes/daily", notes.GetDailyNote)
			pr.POST("/notes/daily", notes.OpenDailyNote)
			pr.GET("/notes/daily/list", notes.ListDailyNotes)
			pr.GET("/notes/trash", notes.ListTrash)
			pr.DELETE("/notes/trash", notes.EmptyTrash)
			pr.POST("/notes/import", notes.Import)
			pr.GET("/notes", notes.List)
			pr.POST("/notes", notes.Create)
			pr.GET("/notes/:id", notes.Get)
			pr.PUT("/notes/:id", notes.Update)
			pr.DELETE("/notes/:id", notes.Delete)

			pr.POST("/notes/:id/pin", notes.TogglePin)
			pr.POST("/notes/:id/restore", notes.RestoreNote)
			pr.DELETE("/notes/:id/purge", notes.PurgeNote)
			pr.GET("/notes/:id/links", notes.Links)
			pr.GET("/notes/:id/versions", notes.ListVersions)
			pr.GET("/notes/:id/versions/:vid", notes.GetVersion)
			pr.POST("/notes/:id/share", notes.CreateOrEnableShare)
			pr.POST("/notes/:id/share/disable", notes.DisableShare)
			pr.PUT("/notes/:id/share/password", notes.SetSharePassword)
			pr.PUT("/notes/:id/share/expiry", notes.SetShareExpiry)

			// images upload (serving is public above)
			pr.POST("/images", images.Upload)

			pr.GET("/folders", notes.ListFolders)
			pr.PUT("/folders", notes.RenameFolder)
			pr.DELETE("/folders", notes.DeleteFolder)

			pr.GET("/templates", notes.ListTemplates)
			pr.POST("/templates", notes.CreateTemplate)
			pr.PUT("/templates/:id", notes.UpdateTemplate)
			pr.DELETE("/templates/:id", notes.DeleteTemplate)
			pr.POST("/templates/:id/apply", notes.ApplyTemplate)

			pr.GET("/tags", tags.List)
			pr.PUT("/tags/:name", tags.Rename)
			pr.POST("/tags/merge", tags.Merge)
			pr.DELETE("/tags/:name", tags.Delete)

			pr.GET("/sessions", auth.ListSessions)
			pr.DELETE("/sessions/:id", auth.RevokeSession)
		}
	}

	return r
}
