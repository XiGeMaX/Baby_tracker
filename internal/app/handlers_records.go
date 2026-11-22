package app

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"
)

func apiUser(r *http.Request) map[string]any {
	state := requestStateFrom(r.Context())
	if state == nil {
		return nil
	}
	return state.User
}

func (a *App) getQuickButtons(w http.ResponseWriter, r *http.Request) {
	query := "SELECT * FROM quick_buttons WHERE is_active = 1 ORDER BY sort_order, id"
	if isAdmin(apiUser(r)) {
		query = "SELECT * FROM quick_buttons ORDER BY sort_order, id"
	}
	rows, err := a.queryMaps(r.Context(), query)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "加载按钮失败")
		return
	}
	writeJSON(w, http.StatusOK, rows)
}

func (a *App) createQuickButton(w http.ResponseWriter, r *http.Request) {
	user := apiUser(r)
	if !isAdmin(user) {
		writeError(w, http.StatusForbidden, "无权限")
		return
	}
	var input map[string]any
	if err := decodeJSON(w, r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "请求格式无效")
		return
	}
	typ := stringValue(input["type"])
	subType := stringValue(input["sub_type"])
	label := strings.TrimSpace(stringValue(input["label"]))
	if !validRecordType(typ) || subType == "" || label == "" {
		writeError(w, http.StatusBadRequest, "缺少必填字段")
		return
	}
	sortOrder := intValue(input["sort_order"])
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "添加按钮失败")
		return
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(r.Context(),
		"UPDATE quick_buttons SET sort_order = sort_order + 1 WHERE sort_order >= ?", sortOrder); err != nil {
		writeError(w, http.StatusInternalServerError, "添加按钮失败")
		return
	}
	result, err := tx.ExecContext(r.Context(),
		"INSERT INTO quick_buttons (type, sub_type, label, amount, sort_order, is_active, food_unit) VALUES (?, ?, ?, ?, ?, 1, ?)",
		typ, subType, label, floatValue(input["amount"]), sortOrder, stringValue(input["food_unit"]),
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "添加按钮失败")
		return
	}
	if err := tx.Commit(); err != nil {
		writeError(w, http.StatusInternalServerError, "添加按钮失败")
		return
	}
	id, _ := result.LastInsertId()
	a.addLog(r.Context(), user, "添加按钮", "quick_button", id, label)
	writeJSON(w, http.StatusCreated, map[string]any{"message": "已添加"})
}

func (a *App) updateQuickButton(w http.ResponseWriter, r *http.Request) {
	user := apiUser(r)
	if !isAdmin(user) {
		writeError(w, http.StatusForbidden, "无权限")
		return
	}
	id := pathID(r)
	existing, err := a.queryOne(r.Context(), "SELECT * FROM quick_buttons WHERE id = ?", id)
	if isNoRows(err) {
		writeError(w, http.StatusNotFound, "按钮不存在")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "加载按钮失败")
		return
	}
	var input map[string]any
	if err := decodeJSON(w, r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "请求格式无效")
		return
	}

	fields := []string{"type", "sub_type", "label", "amount", "sort_order", "is_active", "food_unit"}
	updates := make([]string, 0, len(fields))
	args := make([]any, 0, len(fields)+1)
	for _, field := range fields {
		value, ok := input[field]
		if !ok {
			continue
		}
		if field == "type" && !validRecordType(stringValue(value)) {
			writeError(w, http.StatusBadRequest, "无效的记录类型")
			return
		}
		updates = append(updates, field+" = ?")
		args = append(args, value)
	}
	if len(updates) == 0 {
		writeJSON(w, http.StatusOK, map[string]any{"message": "无变更"})
		return
	}

	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "更新按钮失败")
		return
	}
	defer tx.Rollback()
	if rawOrder, ok := input["sort_order"]; ok {
		oldOrder := intValue(existing["sort_order"])
		newOrder := intValue(rawOrder)
		if oldOrder != newOrder {
			if newOrder > oldOrder {
				_, err = tx.ExecContext(r.Context(),
					"UPDATE quick_buttons SET sort_order = sort_order - 1 WHERE sort_order > ? AND sort_order <= ? AND id != ?",
					oldOrder, newOrder, id)
			} else {
				_, err = tx.ExecContext(r.Context(),
					"UPDATE quick_buttons SET sort_order = sort_order + 1 WHERE sort_order >= ? AND sort_order < ? AND id != ?",
					newOrder, oldOrder, id)
			}
			if err != nil {
				writeError(w, http.StatusInternalServerError, "更新按钮排序失败")
				return
			}
		}
	}
	args = append(args, id)
	if _, err := tx.ExecContext(r.Context(),
		"UPDATE quick_buttons SET "+strings.Join(updates, ", ")+" WHERE id = ?", args...); err != nil {
		writeError(w, http.StatusInternalServerError, "更新按钮失败")
		return
	}
	if err := tx.Commit(); err != nil {
		writeError(w, http.StatusInternalServerError, "更新按钮失败")
		return
	}
	a.addLog(r.Context(), user, "修改按钮", "quick_button", id, stringValue(input["label"]))
	writeJSON(w, http.StatusOK, map[string]any{"message": "已更新"})
}

func (a *App) reorderQuickButtons(w http.ResponseWriter, r *http.Request) {
	user := apiUser(r)
	if !isAdmin(user) {
		writeError(w, http.StatusForbidden, "无权限")
		return
	}
	var input struct {
		IDs []int64 `json:"ids"`
	}
	if err := decodeJSON(w, r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "请求格式无效")
		return
	}
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "更新排序失败")
		return
	}
	defer tx.Rollback()
	for index, id := range input.IDs {
		if _, err := tx.ExecContext(r.Context(),
			"UPDATE quick_buttons SET sort_order = ? WHERE id = ?", index+1, id); err != nil {
			writeError(w, http.StatusInternalServerError, "更新排序失败")
			return
		}
	}
	if err := tx.Commit(); err != nil {
		writeError(w, http.StatusInternalServerError, "更新排序失败")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"message": "排序已更新"})
}

func (a *App) deleteQuickButton(w http.ResponseWriter, r *http.Request) {
	user := apiUser(r)
	if !isAdmin(user) {
		writeError(w, http.StatusForbidden, "无权限")
		return
	}
	id := pathID(r)
	existing, err := a.queryOne(r.Context(), "SELECT sort_order FROM quick_buttons WHERE id = ?", id)
	if err != nil && !isNoRows(err) {
		writeError(w, http.StatusInternalServerError, "删除按钮失败")
		return
	}
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "删除按钮失败")
		return
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(r.Context(), "DELETE FROM quick_buttons WHERE id = ?", id); err != nil {
		writeError(w, http.StatusInternalServerError, "删除按钮失败")
		return
	}
	if existing != nil {
		if _, err := tx.ExecContext(r.Context(),
			"UPDATE quick_buttons SET sort_order = sort_order - 1 WHERE sort_order > ?",
			intValue(existing["sort_order"])); err != nil {
			writeError(w, http.StatusInternalServerError, "删除按钮失败")
			return
		}
	}
	if err := tx.Commit(); err != nil {
		writeError(w, http.StatusInternalServerError, "删除按钮失败")
		return
	}
	a.addLog(r.Context(), user, "删除按钮", "quick_button", id, "")
	writeJSON(w, http.StatusOK, map[string]any{"message": "已删除"})
}

func (a *App) quickRecord(w http.ResponseWriter, r *http.Request) {
	user := apiUser(r)
	if !isApproved(user) {
		writeError(w, http.StatusUnauthorized, "请先登录")
		return
	}
	id := pathID(r)
	button, err := a.queryOne(r.Context(),
		"SELECT * FROM quick_buttons WHERE id = ? AND is_active = 1", id)
	if isNoRows(err) {
		writeError(w, http.StatusNotFound, "按钮不存在")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "加载按钮失败")
		return
	}
	var input map[string]any
	_ = decodeJSON(w, r, &input)
	timestamp := strings.TrimSpace(stringValue(input["timestamp"]))
	if timestamp == "" {
		timestamp = nowTimestamp()
	}
	targetDate := strings.TrimSpace(stringValue(input["date"]))
	result, err := a.db.ExecContext(r.Context(),
		`INSERT INTO records (baby_id, user_id, type, sub_type, amount, timestamp, food_unit)
		 VALUES (1, ?, ?, ?, ?, ?, ?)`,
		userID(user), stringValue(button["type"]), stringValue(button["sub_type"]),
		nullableNumber(button["amount"]), timestamp, stringValue(button["food_unit"]),
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "记录失败")
		return
	}
	recordID, _ := result.LastInsertId()
	a.addLog(r.Context(), user, "快速记录", "record", recordID,
		fmt.Sprintf("%s @ %s", stringValue(button["label"]), timestamp))
	summary, err := a.todaySummaryData(r.Context(), targetDate, user)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "加载今日概览失败")
		return
	}
	summary["message"] = "记录成功"
	summary["record_id"] = recordID
	writeJSON(w, http.StatusCreated, summary)
}

func (a *App) recordDates(w http.ResponseWriter, r *http.Request) {
	rows, err := a.queryMaps(r.Context(),
		"SELECT DISTINCT substr(timestamp, 1, 10) AS d FROM records ORDER BY d")
	if err != nil {
		writeError(w, http.StatusInternalServerError, "加载日期失败")
		return
	}
	dates := make([]string, 0, len(rows))
	for _, row := range rows {
		if date := stringValue(row["d"]); date != "" {
			dates = append(dates, date)
		}
	}
	writeJSON(w, http.StatusOK, dates)
}

func (a *App) getRecord(w http.ResponseWriter, r *http.Request) {
	record, err := a.queryOne(r.Context(), "SELECT * FROM records WHERE id = ?", pathID(r))
	if isNoRows(err) {
		writeError(w, http.StatusNotFound, "记录不存在")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "加载记录失败")
		return
	}
	writeJSON(w, http.StatusOK, record)
}

func (a *App) getRecords(w http.ResponseWriter, r *http.Request) {
	recordDate := queryValue(r, "date", today().Format("2006-01-02"))
	if _, err := parseDate(recordDate); err != nil {
		writeError(w, http.StatusBadRequest, "日期格式无效，需 YYYY-MM-DD")
		return
	}
	recordType := strings.TrimSpace(r.URL.Query().Get("type"))
	if recordType != "" && !validRecordType(recordType) {
		writeError(w, http.StatusBadRequest, "无效的记录类型")
		return
	}
	start, end := dayRange(recordDate)
	query := "SELECT * FROM records WHERE timestamp >= ? AND timestamp <= ?"
	args := []any{start, end}
	if recordType != "" {
		query += " AND type = ?"
		args = append(args, recordType)
	}
	query += " ORDER BY timestamp DESC, id DESC"
	rows, err := a.queryMaps(r.Context(), query, args...)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "加载记录失败")
		return
	}
	writeJSON(w, http.StatusOK, rows)
}

func (a *App) createRecord(w http.ResponseWriter, r *http.Request) {
	user := apiUser(r)
	if !isApproved(user) {
		writeError(w, http.StatusUnauthorized, "请先登录")
		return
	}
	var input map[string]any
	if err := decodeJSON(w, r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "缺少必填字段")
		return
	}
	typ := stringValue(input["type"])
	subType := strings.TrimSpace(stringValue(input["sub_type"]))
	if typ == "" || subType == "" {
		writeError(w, http.StatusBadRequest, "缺少必填字段")
		return
	}
	if !validRecordType(typ) {
		writeError(w, http.StatusBadRequest, "无效的记录类型")
		return
	}
	timestamp := strings.TrimSpace(stringValue(input["timestamp"]))
	if timestamp == "" {
		timestamp = nowTimestamp()
	}
	result, err := a.db.ExecContext(r.Context(),
		`INSERT INTO records
		 (baby_id, user_id, type, sub_type, amount, duration, color, consistency, temperature, note, timestamp, food_unit)
		 VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		userID(user), typ, subType, nullableNumber(input["amount"]), nullableNumber(input["duration"]),
		stringValue(input["color"]), stringValue(input["consistency"]), nullableNumber(input["temperature"]),
		stringValue(input["note"]), timestamp, stringValue(input["food_unit"]),
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "创建记录失败")
		return
	}
	recordID, _ := result.LastInsertId()
	a.addLog(r.Context(), user, "创建记录", "record", recordID,
		fmt.Sprintf("%s/%s %sml", typ, subType, stringValue(input["amount"])))
	summary, err := a.todaySummaryData(r.Context(), stringValue(input["_date"]), user)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "加载今日概览失败")
		return
	}
	summary["message"] = "记录成功"
	summary["record_id"] = recordID
	writeJSON(w, http.StatusCreated, summary)
}

func (a *App) updateRecord(w http.ResponseWriter, r *http.Request) {
	user := apiUser(r)
	if !isApproved(user) {
		writeError(w, http.StatusUnauthorized, "请先登录")
		return
	}
	id := pathID(r)
	existing, err := a.queryOne(r.Context(), "SELECT * FROM records WHERE id = ?", id)
	if isNoRows(err) {
		writeError(w, http.StatusNotFound, "记录不存在")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "加载记录失败")
		return
	}
	var input map[string]any
	if err := decodeJSON(w, r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "请求格式无效")
		return
	}
	if typ, ok := input["type"]; ok && !validRecordType(stringValue(typ)) {
		writeError(w, http.StatusBadRequest, "无效的记录类型")
		return
	}
	fields := []string{"type", "sub_type", "amount", "duration", "color", "consistency", "temperature", "note", "timestamp", "food_unit"}
	updates := make([]string, 0, len(fields))
	args := make([]any, 0, len(fields)+1)
	for _, field := range fields {
		value, ok := input[field]
		if !ok {
			continue
		}
		if field == "timestamp" {
			timestamp := strings.TrimSpace(stringValue(value))
			if timestamp == "" {
				writeError(w, http.StatusBadRequest, "时间不能为空")
				return
			}
			value = timestamp
		}
		updates = append(updates, field+" = ?")
		args = append(args, value)
	}
	if len(updates) > 0 {
		args = append(args, id)
		if _, err := a.db.ExecContext(r.Context(),
			"UPDATE records SET "+strings.Join(updates, ", ")+" WHERE id = ?", args...); err != nil {
			writeError(w, http.StatusInternalServerError, "更新记录失败")
			return
		}
	}
	a.addLog(r.Context(), user, "编辑记录", "record", id, recordChanges(existing, input))
	summary, err := a.todaySummaryData(r.Context(), stringValue(input["_date"]), user)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "加载今日概览失败")
		return
	}
	summary["message"] = "已更新"
	writeJSON(w, http.StatusOK, summary)
}

func (a *App) deleteRecord(w http.ResponseWriter, r *http.Request) {
	user := apiUser(r)
	if !isApproved(user) {
		writeError(w, http.StatusUnauthorized, "请先登录")
		return
	}
	id := pathID(r)
	existing, err := a.queryOne(r.Context(), "SELECT * FROM records WHERE id = ?", id)
	if isNoRows(err) {
		writeError(w, http.StatusNotFound, "记录不存在")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "加载记录失败")
		return
	}
	if _, err := a.db.ExecContext(r.Context(), "DELETE FROM records WHERE id = ?", id); err != nil {
		writeError(w, http.StatusInternalServerError, "删除记录失败")
		return
	}
	a.addLog(r.Context(), user, "删除记录", "record", id,
		fmt.Sprintf("%s/%s %sml @ %s", stringValue(existing["type"]), stringValue(existing["sub_type"]),
			stringValue(existing["amount"]), stringValue(existing["timestamp"])))
	summary, err := a.todaySummaryData(r.Context(), strings.TrimSpace(r.URL.Query().Get("date")), user)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "加载今日概览失败")
		return
	}
	summary["message"] = "已删除"
	writeJSON(w, http.StatusOK, summary)
}

func (a *App) todaySummary(w http.ResponseWriter, r *http.Request) {
	summary, err := a.todaySummaryData(
		r.Context(),
		strings.TrimSpace(r.URL.Query().Get("date")),
		apiUser(r),
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "加载今日概览失败")
		return
	}
	writeJSON(w, http.StatusOK, summary)
}

func (a *App) latestFeed(ctx context.Context) (map[string]any, error) {
	row, err := a.queryOne(ctx,
		"SELECT * FROM records WHERE type = 'feed' ORDER BY timestamp DESC, id DESC LIMIT 1")
	if isNoRows(err) {
		return nil, nil
	}
	return row, err
}

func (a *App) todaySummaryData(ctx context.Context, targetDate string, user map[string]any) (map[string]any, error) {
	if strings.TrimSpace(targetDate) == "" {
		targetDate = today().Format("2006-01-02")
	}
	if _, err := parseDate(targetDate); err != nil {
		return nil, fmt.Errorf("invalid date: %w", err)
	}
	baby, err := a.queryOne(ctx, "SELECT * FROM babies ORDER BY id LIMIT 1")
	if err != nil && !isNoRows(err) {
		return nil, err
	}
	settings, err := a.settingsMap(ctx)
	if err != nil {
		return nil, err
	}
	estimate, err := estimateMilk(baby, settings)
	if err != nil {
		return nil, err
	}
	start, end := dayRange(targetDate)
	records, err := a.queryMaps(ctx,
		`SELECT * FROM records
		 WHERE timestamp >= ? AND timestamp <= ? AND type IN ('feed', 'excrete')
		 ORDER BY timestamp ASC, id ASC`, start, end)
	if err != nil {
		return nil, err
	}
	var (
		totalFeedML float64
		feedCount   int64
		urineCount  int64
		stoolCount  int64
	)
	for _, record := range records {
		switch stringValue(record["type"]) {
		case "feed":
			if stringValue(record["sub_type"]) == "solid_food" {
				continue
			}
			feedCount++
			totalFeedML += floatValue(record["amount"])
		case "excrete":
			switch stringValue(record["sub_type"]) {
			case "urine", "both":
				urineCount++
			}
			switch stringValue(record["sub_type"]) {
			case "stool", "both":
				stoolCount++
			}
		}
	}
	targetML := intValue(estimate["daily_target_ml"])
	remainingML := math.Max(0, float64(targetML)-totalFeedML)
	feedsPerDay := intValue(estimate["estimated_feeds_per_day"])
	perFeedML := intValue(estimate["per_feed_ml"])
	if feedCount > 0 && totalFeedML > 0 {
		avgPerFeed := totalFeedML / float64(feedCount)
		dynamicFeeds := maxInt64(feedCount, round(float64(targetML)/avgPerFeed))
		if dynamicFeeds > feedCount {
			perFeedML = round(remainingML / float64(dynamicFeeds-feedCount))
		} else {
			perFeedML = round(avgPerFeed)
		}
		feedsPerDay = dynamicFeeds
	}
	feedsLeft := maxInt64(0, feedsPerDay-feedCount)
	feedProgress := 0.0
	if targetML > 0 {
		feedProgress = math.Min(1, totalFeedML/float64(targetML))
	}
	lastFeed, err := a.latestFeed(ctx)
	if err != nil {
		return nil, err
	}
	var lastFeedTime any
	if lastFeed != nil {
		lastFeedTime = lastFeed["timestamp"]
	}
	recent, err := a.queryMaps(ctx,
		"SELECT * FROM records ORDER BY timestamp DESC, id DESC LIMIT 5")
	if err != nil {
		return nil, err
	}
	buttons := make([]map[string]any, 0)
	if isApproved(user) {
		buttons, err = a.queryMaps(ctx,
			"SELECT * FROM quick_buttons WHERE is_active = 1 ORDER BY sort_order, id")
		if err != nil {
			return nil, err
		}
	}
	return map[string]any{
		"date":                    targetDate,
		"total_feed_ml":           round(totalFeedML),
		"feed_count":              feedCount,
		"target_ml":               targetML,
		"remaining_ml":            round(remainingML),
		"estimated_feeds_per_day": feedsPerDay,
		"estimated_feeds_left":    feedsLeft,
		"feed_progress":           math.Round(feedProgress*1000) / 1000,
		"per_feed_ml":             perFeedML,
		"urine_count":             urineCount,
		"stool_count":             stoolCount,
		"last_feed_time":          lastFeedTime,
		"estimate":                estimate,
		"recent_records":          recent,
		"quick_buttons":           buttons,
		"logged_in":               isApproved(user),
		"is_admin":                isAdmin(user),
	}, nil
}

func (a *App) settingsMap(ctx context.Context) (map[string]string, error) {
	rows, err := a.queryMaps(ctx, "SELECT key, value FROM settings")
	if err != nil {
		return nil, err
	}
	settings := make(map[string]string, len(rows))
	for _, row := range rows {
		settings[stringValue(row["key"])] = stringValue(row["value"])
	}
	return settings, nil
}

func estimateMilk(baby map[string]any, settings map[string]string) (map[string]any, error) {
	coefficients := map[string]float64{
		"day0": 60, "day1": 60, "day2_3": 80, "day4_7": 100, "day8_14": 120,
		"day15_28": 135, "month1_3": 150, "month4_6": 150, "month4_6_cap": 900,
		"month6_12_base": 800, "month6_12_decay": 30, "month6_12_min": 600,
		"year1_plus": 500,
	}
	if raw := strings.TrimSpace(settings["milk_coefficients"]); raw != "" {
		var custom map[string]float64
		if err := json.Unmarshal([]byte(raw), &custom); err == nil {
			for key, value := range custom {
				coefficients[key] = value
			}
		}
	}
	feedsPerDay := 8
	if parsed, err := strconv.Atoi(settings["feeds_per_day"]); err == nil && parsed > 0 {
		feedsPerDay = parsed
	}
	customTarget := strings.TrimSpace(settings["custom_daily_target"])
	var (
		target float64
		method string
		detail string
	)
	if customTarget != "" {
		parsed, err := strconv.ParseFloat(customTarget, 64)
		if err != nil {
			return nil, fmt.Errorf("invalid custom target: %w", err)
		}
		target = parsed
		method = "custom"
		detail = fmt.Sprintf("自定义目标: %.0fml/天", target)
	} else if baby != nil && floatValue(baby["weight"]) > 0 {
		birthDate, err := parseDate(stringValue(baby["birth_date"]))
		if err != nil {
			return nil, fmt.Errorf("invalid birth date: %w", err)
		}
		ageDays := int(today().Sub(birthDate).Hours() / 24)
		weight := floatValue(baby["weight"])
		coefficientFor := func(age int, key, label string) (float64, string, string) {
			coefficient := coefficients[key]
			value := weight * coefficient
			return value, "weight",
				fmt.Sprintf("%s: %s × %.0fml/kg = %.0fml/天", label, formatNumber(weight), coefficient, value)
		}
		switch {
		case ageDays <= 0:
			target = coefficients["day0"]
			method = "weight"
			detail = fmt.Sprintf("出生首日: 固定 %.0fml/天", target)
		case ageDays <= 1:
			target, method, detail = coefficientFor(ageDays, "day1", "日龄1天")
		case ageDays <= 3:
			target, method, detail = coefficientFor(ageDays, "day2_3", fmt.Sprintf("日龄%d天", ageDays))
		case ageDays <= 7:
			target, method, detail = coefficientFor(ageDays, "day4_7", fmt.Sprintf("日龄%d天", ageDays))
		case ageDays <= 14:
			target, method, detail = coefficientFor(ageDays, "day8_14", fmt.Sprintf("日龄%d天", ageDays))
		case ageDays <= 28:
			target, method, detail = coefficientFor(ageDays, "day15_28", fmt.Sprintf("日龄%d天", ageDays))
		case ageDays <= 90:
			target, method, detail = coefficientFor(ageDays, "month1_3", fmt.Sprintf("%d月龄", ageDays/30))
		case ageDays <= 180:
			coefficient := coefficients["month4_6"]
			cap := coefficients["month4_6_cap"]
			target = math.Min(weight*coefficient, cap)
			method = "weight"
			detail = fmt.Sprintf("%d月龄: %s × %.0fml/kg = %.0fml/天(上限%.0fml)",
				ageDays/30, formatNumber(weight), coefficient, target, cap)
		case ageDays <= 365:
			ageMonths := ageDays / 30
			target = math.Max(
				coefficients["month6_12_min"],
				coefficients["month6_12_base"]-float64(ageMonths-6)*coefficients["month6_12_decay"],
			)
			method = "age_monthly"
			detail = fmt.Sprintf("%d月龄: 月均参考 %.0fml/天", ageMonths, target)
		default:
			target = coefficients["year1_plus"]
			method = "age_monthly"
			detail = fmt.Sprintf("1岁以上: 建议 %.0fml/天", target)
		}
	} else {
		target = 500
		method = "default"
		detail = "默认值: 500ml/天"
	}
	perFeed := int64(0)
	if feedsPerDay > 0 {
		perFeed = round(target / float64(feedsPerDay))
	}
	if perFeed < 10 {
		perFeed = 10
	}
	coefficientMap := make(map[string]any, len(coefficients))
	for key, value := range coefficients {
		coefficientMap[key] = value
	}
	return map[string]any{
		"daily_target_ml":         round(target),
		"per_feed_ml":             perFeed,
		"estimated_feeds_per_day": feedsPerDay,
		"method":                  method,
		"calculation_detail":      detail,
		"coefficients":            coefficientMap,
	}, nil
}

func recordChanges(existing, input map[string]any) string {
	fields := []string{"type", "sub_type", "amount", "duration", "color", "consistency", "temperature", "note", "timestamp", "food_unit"}
	changes := make([]string, 0, len(fields))
	for _, field := range fields {
		value, ok := input[field]
		if !ok {
			continue
		}
		oldValue := stringValue(existing[field])
		newValue := stringValue(value)
		if oldValue != newValue {
			changes = append(changes, fmt.Sprintf("%s: '%s'->'%s'", field, oldValue, newValue))
		}
	}
	if len(changes) == 0 {
		return "无变更"
	}
	sort.Strings(changes)
	return strings.Join(changes, "; ")
}

func nullableNumber(value any) any {
	if value == nil || strings.TrimSpace(stringValue(value)) == "" {
		return nil
	}
	return floatValue(value)
}

func dayRange(date string) (string, string) {
	return date + " 00:00:00", date + " 23:59:59"
}

func nowTimestamp() string {
	return time.Now().Format("2006-01-02 15:04:05")
}

func maxInt64(a, b int64) int64 {
	if a > b {
		return a
	}
	return b
}

func formatNumber(value float64) string {
	return strings.TrimRight(strings.TrimRight(fmt.Sprintf("%.2f", value), "0"), ".")
}
