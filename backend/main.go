package main

import (
	"log"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
)

type Config struct {
	Addr           string
	SQLitePath     string
	FrontendOrigin string

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

	cookieName := getenv("COOKIE_NAME", "notes_session")
	cookieSecure := getenv("COOKIE_SECURE", "0") == "1"

	ttlHours, err := strconv.Atoi(getenv("SESSION_TTL_HOURS", "168"))
	if err != nil || ttlHours <= 0 {
		ttlHours = 168
	}
	adminEmail := getenv("ADMIN_EMAIL", "")
	adminPassword := getenv("ADMIN_PASSWORD", "")

	return Config{
		Addr:           addr,
		SQLitePath:     sqlitePath,
		FrontendOrigin: frontendOrigin,
		CookieName:     cookieName,
		CookieSecure:   cookieSecure,
		SessionTTL:     time.Duration(ttlHours) * time.Hour,
		AdminEmail:     adminEmail,
		AdminPassword:  adminPassword,
	}
}

func main() {
	cfg := mustLoadConfig()

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

	// health
	r.GET("/health", func(c *gin.Context) { c.String(http.StatusOK, "ok") })

	auth := NewAuthHandlers(db, cfg)
	notes := NewNotesHandlers(db)

	api := r.Group("/api")
	{
		// auth (public)
		//api.POST("/register", auth.Register)
		api.POST("/login", auth.Login)
		api.POST("/logout", auth.Logout)

		// share (public)
		api.GET("/share/:token", notes.GetShared)

		// authenticated
		pr := api.Group("/")
		pr.Use(AuthRequired(db, cfg.CookieName))
		{
			admin := pr.Group("/admin")
			admin.Use(AdminRequired(db))
			{
				admin.POST("/users", auth.CreateUserAdmin)
				admin.PUT("/users/:id/admin", auth.SetAdminFlag)
				admin.GET("/users", auth.ListUsersAdmin) // optional
			}

			pr.GET("/me", auth.Me)

			pr.GET("/notes", notes.List)
			pr.POST("/notes", notes.Create)
			pr.GET("/notes/:id", notes.Get)
			pr.PUT("/notes/:id", notes.Update)
			pr.DELETE("/notes/:id", notes.Delete)

			pr.POST("/notes/:id/share", notes.CreateOrEnableShare)
			pr.POST("/notes/:id/share/disable", notes.DisableShare)
		}
	}

	log.Printf("Backend listening on %s (sqlite=%s)", cfg.Addr, cfg.SQLitePath)
	log.Fatal(r.Run(cfg.Addr))
}
