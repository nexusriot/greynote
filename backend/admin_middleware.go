package main

import (
	"database/sql"
	"net/http"

	"github.com/gin-gonic/gin"
)

func AdminRequired(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID := getUserID(c)

		var v int
		if err := db.QueryRow(`SELECT is_admin FROM users WHERE id = ?`, userID).Scan(&v); err != nil || v != 1 {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "admin only"})
			return
		}

		c.Next()
	}
}
