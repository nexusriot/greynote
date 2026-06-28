package main

import (
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
)

type Config struct {
	Addr           string
	SQLitePath     string
	FrontendOrigin string
	ImagesDir      string

	CookieName   string
	CookieSecure bool

	SessionTTL    time.Duration
	AdminEmail    string
	AdminPassword string
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

	return Config{
		Addr:           addr,
		SQLitePath:     sqlitePath,
		FrontendOrigin: frontendOrigin,
		ImagesDir:      imagesDir,
		CookieName:     cookieName,
		CookieSecure:   cookieSecure,
		SessionTTL:     time.Duration(ttlHours) * time.Hour,
		AdminEmail:     getenv("ADMIN_EMAIL", ""),
		AdminPassword:  getenv("ADMIN_PASSWORD", ""),
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

	r := gin.New()
	r.Use(gin.Logger(), gin.Recovery())
	r.Use(CORSMiddleware(cfg.FrontendOrigin))

	r.GET("/health", func(c *gin.Context) { c.String(http.StatusOK, "ok") })

	auth := NewAuthHandlers(db, cfg)
	notes := NewNotesHandlers(db)
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
			pr.GET("/notes", notes.List)
			pr.POST("/notes", notes.Create)
			pr.GET("/notes/:id", notes.Get)
			pr.PUT("/notes/:id", notes.Update)
			pr.DELETE("/notes/:id", notes.Delete)

			pr.POST("/notes/:id/pin", notes.TogglePin)
			pr.GET("/notes/:id/versions", notes.ListVersions)
			pr.GET("/notes/:id/versions/:vid", notes.GetVersion)
			pr.POST("/notes/:id/share", notes.CreateOrEnableShare)
			pr.POST("/notes/:id/share/disable", notes.DisableShare)
			pr.PUT("/notes/:id/share/password", notes.SetSharePassword)
			pr.PUT("/notes/:id/share/expiry", notes.SetShareExpiry)

			// images upload (serving is public above)
			pr.POST("/images", images.Upload)

			pr.GET("/sessions", auth.ListSessions)
			pr.DELETE("/sessions/:id", auth.RevokeSession)
		}
	}

	log.Printf("Backend listening on %s (sqlite=%s, images=%s)", cfg.Addr, cfg.SQLitePath, cfg.ImagesDir)
	log.Fatal(r.Run(cfg.Addr))
}
