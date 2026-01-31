package main

import (
	"database/sql"
	"errors"
	"strings"

	"golang.org/x/crypto/bcrypt"
)

func ensureAdminUser(db *sql.DB, email, password string) error {
	email = strings.TrimSpace(strings.ToLower(email))
	if email == "" && password == "" {
		return nil
	}
	if email == "" || password == "" {
		return errors.New("ADMIN_EMAIL and ADMIN_PASSWORD must both be set")
	}
	if len(password) < 8 {
		return errors.New("ADMIN_PASSWORD must be at least 8 chars")
	}

	var id int64
	err := db.QueryRow(`SELECT id FROM users WHERE email = ?`, email).Scan(&id)
	if err == nil {
		_, _ = db.Exec(`UPDATE users SET is_admin = 1 WHERE id = ?`, id)
		return nil
	}
	if err != sql.ErrNoRows {
		return err
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return err
	}

	_, err = db.Exec(
		`INSERT INTO users(email, password_hash, is_admin, created_at) VALUES(?,?,1,?)`,
		email, string(hash), nowRFC3339(),
	)
	return err
}
