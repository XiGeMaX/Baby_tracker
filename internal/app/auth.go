package app

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
	"golang.org/x/crypto/pbkdf2"
	"golang.org/x/crypto/scrypt"
)

const (
	sessionCookieName = "baby_tracker_session"
	sessionLifetime   = 30 * 24 * time.Hour
)

type sessionState struct {
	UserID    int64 `json:"user_id,omitempty"`
	ExpiresAt int64 `json:"expires_at"`
}

type requestState struct {
	User map[string]any
}

type requestStateKey struct{}

func requestStateFrom(ctx context.Context) *requestState {
	state, _ := ctx.Value(requestStateKey{}).(*requestState)
	return state
}

func (a *App) sessionFromRequest(r *http.Request) (sessionState, bool) {
	cookie, err := r.Cookie(sessionCookieName)
	if err != nil || cookie.Value == "" {
		return sessionState{}, false
	}
	parts := strings.Split(cookie.Value, ".")
	if len(parts) != 2 {
		return sessionState{}, false
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return sessionState{}, false
	}
	signature, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return sessionState{}, false
	}
	expected := a.sign(payload)
	if subtle.ConstantTimeCompare(signature, expected) != 1 {
		return sessionState{}, false
	}
	var state sessionState
	if err := json.Unmarshal(payload, &state); err != nil {
		return sessionState{}, false
	}
	if state.ExpiresAt <= time.Now().Unix() {
		return sessionState{}, false
	}
	return state, true
}

func (a *App) setSession(w http.ResponseWriter, state sessionState) {
	state.ExpiresAt = time.Now().Add(sessionLifetime).Unix()
	payload, _ := json.Marshal(state)
	token := base64.RawURLEncoding.EncodeToString(payload) + "." +
		base64.RawURLEncoding.EncodeToString(a.sign(payload))
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    token,
		Path:     "/",
		MaxAge:   int(sessionLifetime.Seconds()),
		Expires:  time.Now().Add(sessionLifetime),
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})
}

func (a *App) sign(payload []byte) []byte {
	mac := hmac.New(sha256.New, []byte(a.cfg.SessionSecret))
	_, _ = mac.Write(payload)
	return mac.Sum(nil)
}

func hashPassword(password string) string {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		panic("crypto/rand unavailable")
	}
	saltText := base64.RawURLEncoding.EncodeToString(salt)
	digest := pbkdf2.Key([]byte(password), []byte(saltText), 600000, 32, sha256.New)
	return "pbkdf2:sha256:600000$" + saltText + "$" + hex.EncodeToString(digest)
}

func checkPassword(stored, password string) bool {
	switch {
	case strings.HasPrefix(stored, "$2a$"), strings.HasPrefix(stored, "$2b$"), strings.HasPrefix(stored, "$2y$"):
		return bcrypt.CompareHashAndPassword([]byte(stored), []byte(password)) == nil
	case strings.HasPrefix(stored, "pbkdf2:"):
		return checkPBKDF2(stored, password)
	case strings.HasPrefix(stored, "scrypt:"):
		return checkScrypt(stored, password)
	default:
		return false
	}
}

func checkPBKDF2(stored, password string) bool {
	parts := strings.Split(stored, "$")
	if len(parts) != 3 {
		return false
	}
	header := strings.Split(parts[0], ":")
	if len(header) < 3 || header[1] != "sha256" {
		return false
	}
	iterations, err := strconv.Atoi(header[2])
	if err != nil || iterations <= 0 {
		return false
	}
	want, err := hex.DecodeString(parts[2])
	if err != nil {
		return false
	}
	got := pbkdf2.Key([]byte(password), []byte(parts[1]), iterations, len(want), sha256.New)
	return subtle.ConstantTimeCompare(got, want) == 1
}

func checkScrypt(stored, password string) bool {
	parts := strings.Split(stored, "$")
	if len(parts) != 3 {
		return false
	}
	header := strings.Split(parts[0], ":")
	if len(header) != 4 {
		return false
	}
	n, errN := strconv.Atoi(header[1])
	r, errR := strconv.Atoi(header[2])
	p, errP := strconv.Atoi(header[3])
	if errN != nil || errR != nil || errP != nil || n <= 1 || r <= 0 || p <= 0 {
		return false
	}
	want, err := hex.DecodeString(parts[2])
	if err != nil {
		return false
	}
	got, err := scrypt.Key([]byte(password), []byte(parts[1]), n, r, p, len(want))
	if err != nil {
		return false
	}
	return subtle.ConstantTimeCompare(got, want) == 1
}

func (a *App) loadUser(ctx context.Context, id int64) (map[string]any, error) {
	if id <= 0 {
		return nil, errors.New("invalid user id")
	}
	return a.queryOne(ctx, "SELECT * FROM users WHERE id = ?", id)
}

func isApproved(user map[string]any) bool {
	return user != nil && stringValue(user["status"]) == "approved"
}

func isAdmin(user map[string]any) bool {
	return isApproved(user) && stringValue(user["role"]) == "admin"
}

func userID(user map[string]any) int64 {
	return intValue(user["id"])
}

func userDisplayName(user map[string]any) string {
	name := stringValue(user["nickname"])
	if name == "" {
		name = stringValue(user["username"])
	}
	return name
}

func userInitial(user map[string]any) string {
	name := userDisplayName(user)
	for _, r := range name {
		return string(r)
	}
	return ""
}

func (a *App) adminPasswordSetupRequired(ctx context.Context, user map[string]any) bool {
	if !isAdmin(user) {
		return false
	}
	row, err := a.queryOne(ctx, "SELECT value FROM settings WHERE key = 'admin_password_initialized'")
	if err != nil {
		return true
	}
	return stringValue(row["value"]) != "1"
}

func (a *App) markAdminPasswordInitialized(ctx context.Context) error {
	_, err := a.db.ExecContext(ctx,
		"INSERT INTO settings (key, value, updated_at) VALUES ('admin_password_initialized', '1', datetime('now','localtime')) "+
			"ON CONFLICT(key) DO UPDATE SET value = '1', updated_at = datetime('now','localtime')",
	)
	return err
}

func (a *App) addLog(ctx context.Context, user map[string]any, action, targetType string, targetID int64, detail string) {
	var id any
	if userID(user) > 0 {
		id = userID(user)
	}
	username := "system"
	if user != nil {
		username = userDisplayName(user)
	}
	_, _ = a.db.ExecContext(ctx,
		"INSERT INTO audit_logs (user_id, username, action, target_type, target_id, detail) VALUES (?, ?, ?, ?, ?, ?)",
		id, username, action, targetType, targetID, detail,
	)
}

func (a *App) addHALog(ctx context.Context, action, targetType string, targetID int64, detail string) {
	admin, _ := a.queryOne(ctx, "SELECT id, username, nickname FROM users WHERE role = 'admin' LIMIT 1")
	var id any
	username := "HA"
	if admin != nil {
		id = userID(admin)
		username = "HA/" + userDisplayName(admin)
	}
	_, _ = a.db.ExecContext(ctx,
		"INSERT INTO audit_logs (user_id, username, action, target_type, target_id, detail) VALUES (?, ?, ?, ?, ?, ?)",
		id, username, action, targetType, targetID, detail,
	)
}

func randomToken(byteCount int) string {
	raw := make([]byte, byteCount)
	if _, err := rand.Read(raw); err != nil {
		panic("crypto/rand unavailable")
	}
	return base64.RawURLEncoding.EncodeToString(raw)
}
