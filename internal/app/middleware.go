package app

import (
	"net/http"
	"strings"
)

var publicPaths = map[string]bool{
	"/login":             true,
	"/register":          true,
	"/api/auth/login":    true,
	"/api/auth/register": true,
	"/api/auth/me":       true,
	"/api/auth/logout":   true,
	"/favicon.ico":       true,
}

func isPublicPath(path string) bool {
	return path == mcpEndpoint || publicPaths[path] || strings.HasPrefix(path, "/static/")
}

func (a *App) authMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		state := requestStateFrom(r.Context())
		if state == nil {
			http.Error(w, "invalid request state", http.StatusInternalServerError)
			return
		}

		session, hasSession := a.sessionFromRequest(r)
		if hasSession && session.UserID > 0 {
			if user, err := a.loadUser(r.Context(), session.UserID); err == nil {
				state.User = user
			}
		}

		if isPublicPath(r.URL.Path) {
			next.ServeHTTP(w, r)
			return
		}

		if strings.HasPrefix(r.URL.Path, "/api/ha/") && r.URL.Path != "/api/ha/api-key" {
			if a.checkHAAPIKey(r) || isApproved(state.User) {
				next.ServeHTTP(w, r)
				return
			}
			writeError(w, http.StatusUnauthorized, "未授权，请提供有效的 API 密钥")
			return
		}

		if !isApproved(state.User) {
			if strings.HasPrefix(r.URL.Path, "/api/") {
				writeError(w, http.StatusUnauthorized, "未登录或账号未通过审批")
				return
			}
			http.Redirect(w, r, a.appURL(r, "/login"), http.StatusFound)
			return
		}

		if a.adminPasswordSetupRequired(r.Context(), state.User) {
			switch r.URL.Path {
			case "/setup-password", "/api/auth/setup-password":
			default:
				if strings.HasPrefix(r.URL.Path, "/api/") {
					writeJSON(w, http.StatusForbidden, map[string]any{
						"error":                   "请先设置管理密码",
						"password_setup_required": true,
					})
					return
				}
				http.Redirect(w, r, a.appURL(r, "/setup-password"), http.StatusFound)
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}
