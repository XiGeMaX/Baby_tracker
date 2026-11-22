package app

import (
	"context"
	"crypto/rand"
	"fmt"
	"math/big"
	"strings"
)

// ResetAdminPassword replaces the first administrator's password and returns
// the generated credentials for the CLI command.
func (a *App) ResetAdminPassword(ctx context.Context) (string, string, error) {
	admin, err := a.queryOne(ctx,
		"SELECT id, username FROM users WHERE role = 'admin' ORDER BY id LIMIT 1")
	if err != nil {
		if isNoRows(err) {
			username := "admin"
			password, err := randomAdminPassword()
			if err != nil {
				return "", "", err
			}
			if _, insertErr := a.db.ExecContext(ctx,
				"INSERT INTO users (username, password_hash, nickname, role, status) VALUES (?, ?, '管理员', 'admin', 'approved')",
				username, hashPassword(password)); insertErr != nil {
				return "", "", fmt.Errorf("create missing administrator: %w", insertErr)
			}
			if markErr := a.markAdminPasswordInitialized(ctx); markErr != nil {
				return "", "", fmt.Errorf("mark new administrator password initialized: %w", markErr)
			}
			return username, password, nil
		}
		return "", "", err
	}
	password, err := randomAdminPassword()
	if err != nil {
		return "", "", err
	}
	if _, err := a.db.ExecContext(ctx,
		"UPDATE users SET password_hash = ? WHERE id = ?",
		hashPassword(password), intValue(admin["id"])); err != nil {
		return "", "", err
	}
	return stringValue(admin["username"]), password, nil
}

func randomAdminPassword() (string, error) {
	const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	var builder strings.Builder
	builder.Grow(10)
	for range 10 {
		index, err := rand.Int(rand.Reader, big.NewInt(int64(len(alphabet))))
		if err != nil {
			return "", err
		}
		builder.WriteByte(alphabet[index.Int64()])
	}
	return builder.String(), nil
}
