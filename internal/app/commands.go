package app

import (
	"context"
	"crypto/rand"
	"errors"
	"math/big"
	"strings"
)

// ResetAdminPassword replaces the first administrator's password and returns
// the generated credentials for the CLI command.
func (a *App) ResetAdminPassword(ctx context.Context) (string, string, error) {
	admin, err := a.queryOne(ctx,
		"SELECT id, username FROM users WHERE role = 'admin' ORDER BY id LIMIT 1")
	if isNoRows(err) {
		return "", "", errors.New("未找到管理员账户")
	}
	if err != nil {
		return "", "", err
	}
	const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	var builder strings.Builder
	builder.Grow(10)
	for range 10 {
		index, err := rand.Int(rand.Reader, big.NewInt(int64(len(alphabet))))
		if err != nil {
			return "", "", err
		}
		builder.WriteByte(alphabet[index.Int64()])
	}
	password := builder.String()
	if _, err := a.db.ExecContext(ctx,
		"UPDATE users SET password_hash = ? WHERE id = ?",
		hashPassword(password), intValue(admin["id"])); err != nil {
		return "", "", err
	}
	return stringValue(admin["username"]), password, nil
}
