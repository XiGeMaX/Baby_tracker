package app

import (
	"crypto/subtle"
	"net/http"
	"strings"
)

func (a *App) login(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := decodeJSON(w, r, &input); err != nil || strings.TrimSpace(input.Username) == "" || input.Password == "" {
		writeError(w, http.StatusBadRequest, "请输入用户名和密码")
		return
	}
	user, err := a.queryOne(r.Context(), "SELECT * FROM users WHERE username = ?", strings.TrimSpace(input.Username))
	if err != nil || !checkPassword(stringValue(user["password_hash"]), input.Password) {
		writeError(w, http.StatusUnauthorized, "用户名或密码错误")
		return
	}
	switch stringValue(user["status"]) {
	case "pending":
		writeError(w, http.StatusForbidden, "账号待审批，请等待管理员审核")
		return
	case "rejected":
		writeError(w, http.StatusForbidden, "账号已被拒绝，请联系管理员")
		return
	}
	a.setSession(w, sessionState{UserID: userID(user)})
	a.addLog(r.Context(), user, "登录", "user", userID(user), "用户 "+stringValue(user["username"])+" 登录")
	writeJSON(w, http.StatusOK, map[string]any{
		"message": "登录成功",
		"user": map[string]any{
			"id":       user["id"],
			"username": user["username"],
			"nickname": user["nickname"],
			"role":     user["role"],
		},
	})
}

func (a *App) logout(w http.ResponseWriter, r *http.Request) {
	state := requestStateFrom(r.Context())
	if state != nil && state.User != nil {
		a.addLog(r.Context(), state.User, "登出", "user", userID(state.User), "用户 "+stringValue(state.User["username"])+" 登出")
	}
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})
	writeJSON(w, http.StatusOK, map[string]any{"message": "已退出"})
}

func (a *App) register(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Username string `json:"username"`
		Password string `json:"password"`
		Nickname string `json:"nickname"`
	}
	if err := decodeJSON(w, r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "请输入用户名和密码")
		return
	}
	input.Username = strings.TrimSpace(input.Username)
	input.Nickname = strings.TrimSpace(input.Nickname)
	if input.Nickname == "" {
		input.Nickname = input.Username
	}
	if len([]rune(input.Username)) < 3 {
		writeError(w, http.StatusBadRequest, "用户名至少3个字符")
		return
	}
	if len([]rune(input.Password)) < 6 {
		writeError(w, http.StatusBadRequest, "密码至少6个字符")
		return
	}
	if _, err := a.queryOne(r.Context(), "SELECT id FROM users WHERE username = ?", input.Username); err == nil {
		writeError(w, http.StatusConflict, "用户名已存在")
		return
	}
	result, err := a.db.ExecContext(r.Context(),
		"INSERT INTO users (username, password_hash, nickname, role, status) VALUES (?, ?, ?, 'user', 'pending')",
		input.Username, hashPassword(input.Password), input.Nickname,
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "注册失败")
		return
	}
	id, _ := result.LastInsertId()
	a.addLog(r.Context(), nil, "注册", "user", id, "新用户注册: "+input.Username)
	writeJSON(w, http.StatusCreated, map[string]any{"message": "注册成功，请等待管理员审批"})
}

func (a *App) me(w http.ResponseWriter, r *http.Request) {
	state := requestStateFrom(r.Context())
	if state == nil || state.User == nil {
		writeJSON(w, http.StatusOK, map[string]any{"user": nil})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"user": map[string]any{
			"id":       state.User["id"],
			"username": state.User["username"],
			"nickname": state.User["nickname"],
			"role":     state.User["role"],
			"status":   state.User["status"],
		},
	})
}

func (a *App) updateNickname(w http.ResponseWriter, r *http.Request) {
	state := requestStateFrom(r.Context())
	if state == nil || !isApproved(state.User) {
		writeError(w, http.StatusUnauthorized, "未登录")
		return
	}
	var input struct {
		Nickname string `json:"nickname"`
	}
	if err := decodeJSON(w, r, &input); err != nil || strings.TrimSpace(input.Nickname) == "" {
		writeError(w, http.StatusBadRequest, "昵称不能为空")
		return
	}
	oldName := stringValue(state.User["nickname"])
	if _, err := a.db.ExecContext(r.Context(), "UPDATE users SET nickname = ? WHERE id = ?", strings.TrimSpace(input.Nickname), userID(state.User)); err != nil {
		writeError(w, http.StatusInternalServerError, "更新昵称失败")
		return
	}
	a.addLog(r.Context(), state.User, "修改昵称", "user", userID(state.User), "'"+oldName+"' -> '"+strings.TrimSpace(input.Nickname)+"'")
	writeJSON(w, http.StatusOK, map[string]any{"message": "昵称已更新"})
}

func (a *App) setupAdminPassword(w http.ResponseWriter, r *http.Request) {
	state := requestStateFrom(r.Context())
	if state == nil || !isAdmin(state.User) {
		writeError(w, http.StatusForbidden, "仅管理员可以设置管理密码")
		return
	}
	var input struct {
		Password        string `json:"password"`
		ConfirmPassword string `json:"confirm_password"`
	}
	if err := decodeJSON(w, r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "请输入管理密码")
		return
	}
	if len([]rune(input.Password)) < 8 || len([]rune(input.Password)) > 128 {
		writeError(w, http.StatusBadRequest, "管理密码长度应为 8-128 位")
		return
	}
	if subtle.ConstantTimeCompare([]byte(input.Password), []byte(input.ConfirmPassword)) != 1 {
		writeError(w, http.StatusBadRequest, "两次输入的密码不一致")
		return
	}
	if _, err := a.db.ExecContext(r.Context(), "UPDATE users SET password_hash = ? WHERE id = ?", hashPassword(input.Password), userID(state.User)); err != nil {
		writeError(w, http.StatusInternalServerError, "设置管理密码失败")
		return
	}
	if err := a.markAdminPasswordInitialized(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, "保存管理密码状态失败")
		return
	}
	a.addLog(r.Context(), state.User, "设置管理密码", "user", userID(state.User), "为 "+stringValue(state.User["username"])+" 设置管理密码")
	writeJSON(w, http.StatusOK, map[string]any{"message": "管理密码已设置"})
}
