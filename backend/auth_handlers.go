package main

import (
	"database/sql"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
)

type AuthHandlers struct {
	DB  *sql.DB
	Cfg Config
}

func NewAuthHandlers(db *sql.DB, cfg Config) *AuthHandlers {
	return &AuthHandlers{DB: db, Cfg: cfg}
}

type authReq struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

func (h *AuthHandlers) Register(c *gin.Context) {
	var req authReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad json"})
		return
	}
	req.Email = strings.TrimSpace(strings.ToLower(req.Email))
	if req.Email == "" || len(req.Password) < 6 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "email required, password min 6"})
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "hash error"})
		return
	}

	_, err = h.DB.Exec(`INSERT INTO users(email, password_hash, created_at) VALUES(?,?,?)`, req.Email, string(hash), nowRFC3339())
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "user exists or db error"})
		return
	}

	c.Status(http.StatusCreated)
}

func (h *AuthHandlers) Login(c *gin.Context) {
	var req authReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad json"})
		return
	}
	req.Email = strings.TrimSpace(strings.ToLower(req.Email))
	if req.Email == "" || req.Password == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "email+password required"})
		return
	}

	var userID int64
	var passHash string
	err := h.DB.QueryRow(`SELECT id, password_hash FROM users WHERE email = ?`, req.Email).Scan(&userID, &passHash)
	if err != nil || bcrypt.CompareHashAndPassword([]byte(passHash), []byte(req.Password)) != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid credentials"})
		return
	}

	token, err := randomTokenURLSafe(32)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "token error"})
		return
	}

	expiresAt := time.Now().UTC().Add(h.Cfg.SessionTTL).Format(time.RFC3339)
	_, err = h.DB.Exec(
		`INSERT INTO sessions(user_id, token, expires_at, created_at) VALUES(?,?,?,?)`,
		userID, token, expiresAt, nowRFC3339(),
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "db error"})
		return
	}

	// Gin cookie: maxAge in seconds
	maxAge := int(h.Cfg.SessionTTL.Seconds())
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(h.Cfg.CookieName, token, maxAge, "/", "", h.Cfg.CookieSecure, true)

	c.Status(http.StatusNoContent)
}

func (h *AuthHandlers) Logout(c *gin.Context) {
	token, err := c.Cookie(h.Cfg.CookieName)
	if err == nil && strings.TrimSpace(token) != "" {
		_, _ = h.DB.Exec(`DELETE FROM sessions WHERE token = ?`, token)
	}

	c.SetSameSite(http.SameSiteLaxMode)
	// delete cookie: maxAge -1
	c.SetCookie(h.Cfg.CookieName, "", -1, "/", "", h.Cfg.CookieSecure, true)

	c.Status(http.StatusNoContent)
}

func (h *AuthHandlers) Me(c *gin.Context) {
	userID := getUserID(c)

	var email string
	err := h.DB.QueryRow(`SELECT email FROM users WHERE id = ?`, userID).Scan(&email)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"userId": userID, "email": email})
}
