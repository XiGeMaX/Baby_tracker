package app

import (
	"fmt"
	"net/http"
	"strings"
	"time"
)

var haIconMap = map[string]string{
	"breast_left":  "mdi:baby-bottle",
	"breast_right": "mdi:baby-bottle",
	"breast":       "mdi:baby-bottle",
	"formula":      "mdi:bottle-soda",
	"pumped":       "mdi:baby-bottle-outline",
	"water":        "mdi:cup-water",
	"urine":        "mdi:water",
	"stool":        "mdi:emoticon-poop",
	"both":         "mdi:baby-face-outline",
}

func (a *App) checkHAAPIKey(r *http.Request) bool {
	provided := strings.TrimSpace(r.URL.Query().Get("api_key"))
	if provided == "" {
		provided = strings.TrimSpace(r.Header.Get("X-API-Key"))
	}
	if provided == "" {
		provided = bearerToken(r)
	}
	if provided == "" {
		return false
	}
	row, err := a.queryOne(r.Context(),
		"SELECT value FROM settings WHERE key = 'ha_api_key'")
	if err != nil {
		return false
	}
	expected := stringValue(row["value"])
	return expected != "" && constantTimeStringEqual(provided, expected)
}

func (a *App) getHAAPIKey(w http.ResponseWriter, r *http.Request) {
	if !isAdmin(apiUser(r)) {
		writeError(w, http.StatusForbidden, "无权限")
		return
	}
	row, err := a.queryOne(r.Context(),
		"SELECT value FROM settings WHERE key = 'ha_api_key'")
	if err != nil && !isNoRows(err) {
		writeError(w, http.StatusInternalServerError, "加载 API 密钥失败")
		return
	}
	apiKey := ""
	if row != nil {
		apiKey = stringValue(row["value"])
	}
	writeJSON(w, http.StatusOK, map[string]any{"api_key": apiKey})
}

func (a *App) generateHAAPIKey(w http.ResponseWriter, r *http.Request) {
	user := apiUser(r)
	if !isAdmin(user) {
		writeError(w, http.StatusForbidden, "无权限")
		return
	}
	apiKey := randomToken(32)
	if _, err := a.db.ExecContext(r.Context(),
		`INSERT INTO settings (key, value) VALUES ('ha_api_key', ?)
		 ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now','localtime')`,
		apiKey); err != nil {
		writeError(w, http.StatusInternalServerError, "生成 API 密钥失败")
		return
	}
	a.addLog(r.Context(), user, "生成HA密钥", "settings", 0, "")
	writeJSON(w, http.StatusOK, map[string]any{"api_key": apiKey})
}

func (a *App) haStatus(w http.ResponseWriter, r *http.Request) {
	targetDate := queryValue(r, "date", today().Format("2006-01-02"))
	summary, err := a.todaySummaryData(r.Context(), targetDate, nil)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "加载今日概览失败")
		return
	}
	lastFeed, err := a.latestFeed(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "加载喂养记录失败")
		return
	}
	progress := mathRoundPercent(floatValue(summary["feed_progress"]) * 100)
	var lastFeedTime any
	if lastFeed != nil {
		lastFeedTime = lastFeed["timestamp"]
	}
	estimate, _ := summary["estimate"].(map[string]any)
	writeJSON(w, http.StatusOK, map[string]any{
		"state": summary["total_feed_ml"],
		"attributes": map[string]any{
			"unit_of_measurement":     "ml",
			"friendly_name":           "今日奶量",
			"icon":                    "mdi:baby-bottle",
			"date":                    summary["date"],
			"total_feed_ml":           summary["total_feed_ml"],
			"consumed_ml":             summary["total_feed_ml"],
			"feed_count":              summary["feed_count"],
			"target_ml":               summary["target_ml"],
			"remaining_ml":            summary["remaining_ml"],
			"feed_progress":           summary["feed_progress"],
			"progress_percent":        progress,
			"urine_count":             summary["urine_count"],
			"stool_count":             summary["stool_count"],
			"last_feed_time":          lastFeedTime,
			"estimated_feeds_per_day": summary["estimated_feeds_per_day"],
			"estimated_feeds_left":    summary["estimated_feeds_left"],
			"per_feed_ml":             summary["per_feed_ml"],
			"estimation_method":       stringValue(estimate["method"]),
		},
	})
}

func (a *App) haFeedToday(w http.ResponseWriter, r *http.Request) {
	targetDate := queryValue(r, "date", today().Format("2006-01-02"))
	start, end := dayRange(targetDate)
	feeds, err := a.queryMaps(r.Context(),
		`SELECT * FROM records
		 WHERE timestamp >= ? AND timestamp <= ? AND type = 'feed'
		 ORDER BY timestamp ASC, id ASC`, start, end)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "加载喂养记录失败")
		return
	}
	totalML := 0.0
	feedCount := 0
	for _, feed := range feeds {
		if stringValue(feed["sub_type"]) == "solid_food" {
			continue
		}
		feedCount++
		totalML += floatValue(feed["amount"])
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"state": round(totalML),
		"attributes": map[string]any{
			"unit_of_measurement": "ml",
			"friendly_name":       "今日喂养总量",
			"icon":                "mdi:baby-bottle-outline",
			"date":                targetDate,
			"feed_count":          feedCount,
			"feeds":               feeds,
		},
	})
}

func (a *App) haLastFeed(w http.ResponseWriter, r *http.Request) {
	feed, err := a.latestFeed(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "加载喂养记录失败")
		return
	}
	if feed == nil {
		writeJSON(w, http.StatusOK, map[string]any{
			"state": "unknown",
			"attributes": map[string]any{
				"friendly_name": "上次喂养",
				"icon":          "mdi:baby-bottle",
			},
		})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"state": feed["timestamp"],
		"attributes": map[string]any{
			"friendly_name": "上次喂养",
			"icon":          "mdi:baby-bottle",
			"sub_type":      feed["sub_type"],
			"amount_ml":     feed["amount"],
			"duration_min":  feed["duration"],
			"food_unit":     stringValue(feed["food_unit"]),
		},
	})
}

func (a *App) haExcreteToday(w http.ResponseWriter, r *http.Request) {
	targetDate := queryValue(r, "date", today().Format("2006-01-02"))
	start, end := dayRange(targetDate)
	excretes, err := a.queryMaps(r.Context(),
		`SELECT * FROM records
		 WHERE timestamp >= ? AND timestamp <= ? AND type = 'excrete'
		 ORDER BY timestamp ASC, id ASC`, start, end)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "加载排泄记录失败")
		return
	}
	urine, stool := 0, 0
	for _, record := range excretes {
		switch stringValue(record["sub_type"]) {
		case "urine":
			urine++
		case "stool":
			stool++
		case "both":
			urine++
			stool++
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"state": len(excretes),
		"attributes": map[string]any{
			"friendly_name": "今日排泄",
			"icon":          "mdi:diaper",
			"date":          targetDate,
			"urine_count":   urine,
			"stool_count":   stool,
			"total_count":   len(excretes),
		},
	})
}

func (a *App) haButtons(w http.ResponseWriter, r *http.Request) {
	buttons, err := a.queryMaps(r.Context(),
		"SELECT * FROM quick_buttons WHERE is_active = 1 ORDER BY sort_order, id")
	if err != nil {
		writeError(w, http.StatusInternalServerError, "加载按钮失败")
		return
	}
	a.haMu.Lock()
	defer a.haMu.Unlock()
	result := make([]map[string]any, 0, len(buttons))
	for _, button := range buttons {
		id := intValue(button["id"])
		state := a.haStates[id]
		if state == "" {
			state = "off"
		}
		result = append(result, map[string]any{
			"id":       button["id"],
			"label":    button["label"],
			"type":     button["type"],
			"sub_type": button["sub_type"],
			"amount":   button["amount"],
			"icon":     haIcon(stringValue(button["sub_type"])),
			"state":    state,
		})
	}
	writeJSON(w, http.StatusOK, result)
}

func (a *App) haButtonState(w http.ResponseWriter, r *http.Request) {
	id := pathID(r)
	button, err := a.queryOne(r.Context(),
		"SELECT * FROM quick_buttons WHERE id = ? AND is_active = 1", id)
	if isNoRows(err) {
		writeJSON(w, http.StatusNotFound, map[string]any{
			"state": "unavailable",
			"attributes": map[string]any{
				"friendly_name": "未知按钮",
			},
		})
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "加载按钮失败")
		return
	}
	a.haMu.Lock()
	state := a.haStates[id]
	a.haMu.Unlock()
	if state == "" {
		state = "off"
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"state": state,
		"attributes": map[string]any{
			"friendly_name": button["label"],
			"icon":          haIcon(stringValue(button["sub_type"])),
			"type":          button["type"],
			"sub_type":      button["sub_type"],
			"amount":        button["amount"],
		},
	})
}

func (a *App) haButtonPress(w http.ResponseWriter, r *http.Request) {
	if !a.checkHAAPIKey(r) {
		writeError(w, http.StatusUnauthorized, "未授权，请提供有效的 API 密钥")
		return
	}
	id := pathID(r)
	button, err := a.queryOne(r.Context(),
		"SELECT * FROM quick_buttons WHERE id = ? AND is_active = 1", id)
	if isNoRows(err) {
		writeJSON(w, http.StatusNotFound, map[string]any{"state": "unavailable"})
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "加载按钮失败")
		return
	}
	admin, err := a.queryOne(r.Context(),
		"SELECT id, username, nickname FROM users WHERE role = 'admin' ORDER BY id LIMIT 1")
	if err != nil {
		writeError(w, http.StatusInternalServerError, "无管理员账户")
		return
	}
	timestamp := nowTimestamp()
	result, err := a.db.ExecContext(r.Context(),
		`INSERT INTO records (baby_id, user_id, type, sub_type, amount, timestamp, note)
		 VALUES (1, ?, ?, ?, ?, ?, '[HA]')`,
		intValue(admin["id"]), stringValue(button["type"]), stringValue(button["sub_type"]),
		nullableNumber(button["amount"]), timestamp,
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "记录失败")
		return
	}
	recordID, _ := result.LastInsertId()
	a.addHALog(r.Context(), "HA快速记录", "record", recordID,
		fmt.Sprintf("%s @ %s", stringValue(button["label"]), timestamp))
	a.haMu.Lock()
	a.haStates[id] = "on"
	if timer := a.haTimers[id]; timer != nil {
		timer.Stop()
	}
	a.haTimers[id] = time.AfterFunc(2*time.Second, func() {
		a.haMu.Lock()
		a.haStates[id] = "off"
		delete(a.haTimers, id)
		a.haMu.Unlock()
	})
	a.haMu.Unlock()
	writeJSON(w, http.StatusOK, map[string]any{
		"state": "on",
		"attributes": map[string]any{
			"friendly_name": button["label"],
			"icon":          "mdi:check-circle",
			"last_pressed":  timestamp,
			"record_id":     recordID,
		},
	})
}

func haIcon(subType string) string {
	if icon := haIconMap[subType]; icon != "" {
		return icon
	}
	return "mdi:gesture-tap-button"
}

func mathRoundPercent(value float64) int64 {
	if value < 0 {
		value = 0
	}
	if value > 100 {
		value = 100
	}
	return round(value)
}
