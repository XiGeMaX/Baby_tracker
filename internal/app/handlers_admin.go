package app

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strings"
)

func (a *App) getBaby(w http.ResponseWriter, r *http.Request) {
	baby, err := a.queryOne(r.Context(), "SELECT * FROM babies ORDER BY id LIMIT 1")
	if isNoRows(err) {
		writeError(w, http.StatusNotFound, "未找到婴儿信息")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "加载婴儿信息失败")
		return
	}
	writeJSON(w, http.StatusOK, baby)
}

func (a *App) updateBaby(w http.ResponseWriter, r *http.Request) {
	user := apiUser(r)
	if !isAdmin(user) {
		writeError(w, http.StatusForbidden, "仅管理员可修改")
		return
	}
	var input map[string]any
	if err := decodeJSON(w, r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "请求格式无效")
		return
	}
	name := strings.TrimSpace(stringValue(input["name"]))
	if name == "" {
		name = "宝宝"
	}
	gender := strings.TrimSpace(stringValue(input["gender"]))
	if gender == "" {
		gender = "male"
	}
	birthDate := strings.TrimSpace(stringValue(input["birth_date"]))
	if birthDate == "" {
		birthDate = today().Format("2006-01-02")
	}
	if _, err := parseDate(birthDate); err != nil {
		writeError(w, http.StatusBadRequest, "出生日期格式无效")
		return
	}
	weight := floatValue(input["weight"])
	if weight <= 0 {
		weight = 3
	}
	premature := 0
	if boolValue(input["is_premature"]) {
		premature = 1
	}
	baby, err := a.queryOne(r.Context(), "SELECT id FROM babies ORDER BY id LIMIT 1")
	if err != nil && !isNoRows(err) {
		writeError(w, http.StatusInternalServerError, "加载婴儿信息失败")
		return
	}
	if baby == nil {
		_, err = a.db.ExecContext(r.Context(),
			"INSERT INTO babies (name, gender, birth_date, weight, is_premature) VALUES (?, ?, ?, ?, ?)",
			name, gender, birthDate, weight, premature)
	} else {
		_, err = a.db.ExecContext(r.Context(),
			"UPDATE babies SET name = ?, gender = ?, birth_date = ?, weight = ?, is_premature = ? WHERE id = ?",
			name, gender, birthDate, weight, premature, intValue(baby["id"]))
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "更新婴儿信息失败")
		return
	}
	kind := "足月儿"
	if premature == 1 {
		kind = "早产儿"
	}
	a.addLog(r.Context(), user, "修改婴儿信息", "baby", 1,
		fmt.Sprintf("%s/%skg/%s", name, formatNumber(weight), kind))
	writeJSON(w, http.StatusOK, map[string]any{"message": "已更新"})
}

func (a *App) getSettings(w http.ResponseWriter, r *http.Request) {
	settings, err := a.settingsMap(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "加载设置失败")
		return
	}
	for key := range settings {
		if isSensitiveSettingKey(key) {
			delete(settings, key)
		}
	}
	writeJSON(w, http.StatusOK, settings)
}

func (a *App) updateSettings(w http.ResponseWriter, r *http.Request) {
	user := apiUser(r)
	if !isAdmin(user) {
		writeError(w, http.StatusForbidden, "仅管理员可修改")
		return
	}
	var input map[string]any
	if err := decodeJSON(w, r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "请求格式无效")
		return
	}
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "更新设置失败")
		return
	}
	defer tx.Rollback()
	keys := make([]string, 0, len(input))
	for key := range input {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		if strings.TrimSpace(key) == "" {
			continue
		}
		if key == mcpEnabledSetting || key == mcpPermissionSetting {
			writeError(w, http.StatusBadRequest, "MCP 配置需使用专用接口")
			return
		}
		if isSensitiveSettingKey(key) {
			writeError(w, http.StatusBadRequest, "密钥设置需使用专用接口")
			return
		}
		value := stringValue(input[key])
		if _, err := tx.ExecContext(r.Context(),
			`INSERT INTO settings (key, value) VALUES (?, ?)
			 ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now','localtime')`,
			key, value); err != nil {
			writeError(w, http.StatusInternalServerError, "更新设置失败")
			return
		}
	}
	if err := tx.Commit(); err != nil {
		writeError(w, http.StatusInternalServerError, "更新设置失败")
		return
	}
	detail, _ := json.Marshal(input)
	a.addLog(r.Context(), user, "修改设置", "settings", 0, string(detail))
	writeJSON(w, http.StatusOK, map[string]any{"message": "设置已更新"})
}

func (a *App) getMilkEstimate(w http.ResponseWriter, r *http.Request) {
	baby, err := a.queryOne(r.Context(), "SELECT * FROM babies ORDER BY id LIMIT 1")
	if err != nil && !isNoRows(err) {
		writeError(w, http.StatusInternalServerError, "加载婴儿信息失败")
		return
	}
	settings, err := a.settingsMap(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "加载设置失败")
		return
	}
	estimate, err := estimateMilk(baby, settings)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, estimate)
}

func (a *App) getUsers(w http.ResponseWriter, r *http.Request) {
	if !isAdmin(apiUser(r)) {
		writeError(w, http.StatusForbidden, "无权限")
		return
	}
	users, err := a.queryMaps(r.Context(),
		"SELECT id, username, nickname, role, status, created_at FROM users ORDER BY created_at DESC, id DESC")
	if err != nil {
		writeError(w, http.StatusInternalServerError, "加载用户失败")
		return
	}
	writeJSON(w, http.StatusOK, users)
}

func (a *App) approveUser(w http.ResponseWriter, r *http.Request) {
	if !isAdmin(apiUser(r)) {
		writeError(w, http.StatusForbidden, "无权限")
		return
	}
	id := pathID(r)
	target, _ := a.queryOne(r.Context(), "SELECT username FROM users WHERE id = ?", id)
	if _, err := a.db.ExecContext(r.Context(),
		"UPDATE users SET status = 'approved' WHERE id = ?", id); err != nil {
		writeError(w, http.StatusInternalServerError, "批准用户失败")
		return
	}
	detail := fmt.Sprintf("批准 %v", id)
	if target != nil {
		detail = fmt.Sprintf("批准 %s", stringValue(target["username"]))
	}
	a.addLog(r.Context(), apiUser(r), "审批用户", "user", id, detail)
	writeJSON(w, http.StatusOK, map[string]any{"message": "已批准"})
}

func (a *App) rejectUser(w http.ResponseWriter, r *http.Request) {
	if !isAdmin(apiUser(r)) {
		writeError(w, http.StatusForbidden, "无权限")
		return
	}
	id := pathID(r)
	target, _ := a.queryOne(r.Context(), "SELECT username FROM users WHERE id = ?", id)
	if _, err := a.db.ExecContext(r.Context(),
		"UPDATE users SET status = 'rejected' WHERE id = ?", id); err != nil {
		writeError(w, http.StatusInternalServerError, "拒绝用户失败")
		return
	}
	detail := fmt.Sprintf("拒绝 %v", id)
	if target != nil {
		detail = fmt.Sprintf("拒绝 %s", stringValue(target["username"]))
	}
	a.addLog(r.Context(), apiUser(r), "审批用户", "user", id, detail)
	writeJSON(w, http.StatusOK, map[string]any{"message": "已拒绝"})
}

func (a *App) deleteUser(w http.ResponseWriter, r *http.Request) {
	if !isAdmin(apiUser(r)) {
		writeError(w, http.StatusForbidden, "无权限")
		return
	}
	id := pathID(r)
	target, err := a.queryOne(r.Context(), "SELECT * FROM users WHERE id = ?", id)
	if err != nil && !isNoRows(err) {
		writeError(w, http.StatusInternalServerError, "加载用户失败")
		return
	}
	if target != nil && stringValue(target["role"]) == "admin" {
		writeError(w, http.StatusBadRequest, "不能删除管理员")
		return
	}
	if _, err := a.db.ExecContext(r.Context(), "DELETE FROM users WHERE id = ?", id); err != nil {
		writeError(w, http.StatusInternalServerError, "删除用户失败")
		return
	}
	detail := ""
	if target != nil {
		detail = stringValue(target["username"])
	}
	a.addLog(r.Context(), apiUser(r), "删除用户", "user", id, detail)
	writeJSON(w, http.StatusOK, map[string]any{"message": "已删除"})
}

func (a *App) resetUserPassword(w http.ResponseWriter, r *http.Request) {
	if !isAdmin(apiUser(r)) {
		writeError(w, http.StatusForbidden, "无权限")
		return
	}
	var input struct {
		Password string `json:"password"`
	}
	if err := decodeJSON(w, r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "请求格式无效")
		return
	}
	password := strings.TrimSpace(input.Password)
	if !isPasswordLengthValid(password) {
		writeError(w, http.StatusBadRequest, passwordLengthError)
		return
	}
	id := pathID(r)
	target, err := a.queryOne(r.Context(), "SELECT username FROM users WHERE id = ?", id)
	if isNoRows(err) {
		writeError(w, http.StatusNotFound, "用户不存在")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "加载用户失败")
		return
	}
	if _, err := a.db.ExecContext(r.Context(),
		"UPDATE users SET password_hash = ? WHERE id = ?", hashPassword(password), id); err != nil {
		writeError(w, http.StatusInternalServerError, "重置密码失败")
		return
	}
	a.addLog(r.Context(), apiUser(r), "重置密码", "user", id,
		"重置 "+stringValue(target["username"])+" 的密码")
	writeJSON(w, http.StatusOK, map[string]any{"message": "密码已重置"})
}

func (a *App) updateUsername(w http.ResponseWriter, r *http.Request) {
	if !isAdmin(apiUser(r)) {
		writeError(w, http.StatusForbidden, "无权限")
		return
	}
	var input struct {
		Username string `json:"username"`
	}
	if err := decodeJSON(w, r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "请求格式无效")
		return
	}
	username := strings.TrimSpace(input.Username)
	if len([]rune(username)) < 2 {
		writeError(w, http.StatusBadRequest, "用户名至少2个字符")
		return
	}
	id := pathID(r)
	target, err := a.queryOne(r.Context(), "SELECT username FROM users WHERE id = ?", id)
	if isNoRows(err) {
		writeError(w, http.StatusNotFound, "用户不存在")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "加载用户失败")
		return
	}
	existing, err := a.queryOne(r.Context(),
		"SELECT id FROM users WHERE username = ? AND id != ?", username, id)
	if err == nil && existing != nil {
		writeError(w, http.StatusConflict, "用户名已存在")
		return
	}
	if err != nil && !isNoRows(err) {
		writeError(w, http.StatusInternalServerError, "检查用户名失败")
		return
	}
	oldUsername := stringValue(target["username"])
	if _, err := a.db.ExecContext(r.Context(),
		"UPDATE users SET username = ? WHERE id = ?", username, id); err != nil {
		writeError(w, http.StatusInternalServerError, "修改用户名失败")
		return
	}
	a.addLog(r.Context(), apiUser(r), "修改用户名", "user", id, oldUsername+" → "+username)
	writeJSON(w, http.StatusOK, map[string]any{
		"message":  "用户名已更新",
		"username": username,
	})
}

func (a *App) getAuditLogs(w http.ResponseWriter, r *http.Request) {
	if !isAdmin(apiUser(r)) {
		writeError(w, http.StatusForbidden, "无权限")
		return
	}
	limit := queryInt(r, "limit", 100)
	if limit < 1 {
		limit = 1
	}
	if limit > 500 {
		limit = 500
	}
	logs, err := a.queryMaps(r.Context(),
		"SELECT * FROM audit_logs ORDER BY created_at DESC, id DESC LIMIT ?", limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "加载操作日志失败")
		return
	}
	writeJSON(w, http.StatusOK, logs)
}

func (a *App) getStats(w http.ResponseWriter, r *http.Request) {
	row, err := a.queryOne(r.Context(), `
		SELECT COUNT(*) AS total_records,
		       COALESCE(SUM(CASE WHEN type = 'feed' THEN 1 ELSE 0 END), 0) AS total_feeds,
		       COALESCE(SUM(CASE WHEN type = 'feed' THEN amount ELSE 0 END), 0) AS total_ml,
		       COUNT(DISTINCT date(timestamp)) AS tracked_days
		FROM records`)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "加载统计失败")
		return
	}
	pending, err := a.queryOne(r.Context(),
		"SELECT COUNT(*) AS c FROM users WHERE status = 'pending'")
	if err != nil {
		writeError(w, http.StatusInternalServerError, "加载统计失败")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"total_records": row["total_records"],
		"total_feeds":   row["total_feeds"],
		"total_ml":      round(floatValue(row["total_ml"])),
		"tracked_days":  row["tracked_days"],
		"pending_users": pending["c"],
	})
}
