package app

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"
)

const (
	minGrowthWeight = 0.1
	maxGrowthWeight = 100.0
	minGrowthHeight = 10.0
	maxGrowthHeight = 250.0
)

type growthQueryer interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func (a *App) getGrowthLogs(w http.ResponseWriter, r *http.Request) {
	rows, err := a.queryMaps(r.Context(),
		"SELECT * FROM weight_logs ORDER BY recorded_date DESC, id DESC")
	if err != nil {
		writeError(w, http.StatusInternalServerError, "加载成长记录失败")
		return
	}
	writeJSON(w, http.StatusOK, rows)
}

func (a *App) addGrowthLog(w http.ResponseWriter, r *http.Request) {
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
	weight, hasWeight, message := optionalGrowthValue(input, "weight", minGrowthWeight, maxGrowthWeight, "体重")
	if message != "" {
		writeError(w, http.StatusBadRequest, message)
		return
	}
	height, hasHeight, message := optionalGrowthValue(input, "height", minGrowthHeight, maxGrowthHeight, "身高")
	if message != "" {
		writeError(w, http.StatusBadRequest, message)
		return
	}
	recordedDate := strings.TrimSpace(stringValue(input["recorded_date"]))
	if !hasWeight && !hasHeight {
		writeError(w, http.StatusBadRequest, "请至少填写体重或身高")
		return
	}
	if recordedDate == "" {
		writeError(w, http.StatusBadRequest, "请选择日期")
		return
	}
	if _, err := parseDate(recordedDate); err != nil {
		writeError(w, http.StatusBadRequest, "日期格式无效")
		return
	}
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "记录成长数据失败")
		return
	}
	defer tx.Rollback()
	result, err := tx.ExecContext(r.Context(),
		"INSERT INTO weight_logs (baby_id, weight, height, recorded_date, note) VALUES (1, ?, ?, ?, ?)",
		nullableGrowthValue(weight, hasWeight), nullableGrowthValue(height, hasHeight),
		recordedDate, stringValue(input["note"]))
	if err == nil {
		err = updateBabyWeightFromLatest(r.Context(), tx)
	}
	if err == nil {
		err = tx.Commit()
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "记录成长数据失败")
		return
	}
	id, _ := result.LastInsertId()
	a.addLog(r.Context(), user, "记录成长数据", "growth_log", id,
		growthLogLabel(weight, hasWeight, height, hasHeight, recordedDate))
	writeJSON(w, http.StatusCreated, map[string]any{"id": id, "message": "已记录"})
}

func (a *App) updateGrowthLog(w http.ResponseWriter, r *http.Request) {
	user := apiUser(r)
	if !isApproved(user) {
		writeError(w, http.StatusForbidden, "无权限")
		return
	}
	var input map[string]any
	if err := decodeJSON(w, r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "请求格式无效")
		return
	}
	weight, hasWeight, message := optionalGrowthValue(input, "weight", minGrowthWeight, maxGrowthWeight, "体重")
	if message != "" {
		writeError(w, http.StatusBadRequest, message)
		return
	}
	height, hasHeight, message := optionalGrowthValue(input, "height", minGrowthHeight, maxGrowthHeight, "身高")
	if message != "" {
		writeError(w, http.StatusBadRequest, message)
		return
	}
	recordedDate := strings.TrimSpace(stringValue(input["recorded_date"]))
	if !hasWeight && !hasHeight {
		writeError(w, http.StatusBadRequest, "请至少填写体重或身高")
		return
	}
	if recordedDate == "" {
		writeError(w, http.StatusBadRequest, "请选择日期")
		return
	}
	if _, err := parseDate(recordedDate); err != nil {
		writeError(w, http.StatusBadRequest, "日期格式无效")
		return
	}
	id := pathID(r)
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "更新成长数据失败")
		return
	}
	defer tx.Rollback()
	result, err := tx.ExecContext(r.Context(),
		"UPDATE weight_logs SET weight = ?, height = ?, recorded_date = ?, note = ? WHERE id = ?",
		nullableGrowthValue(weight, hasWeight), nullableGrowthValue(height, hasHeight),
		recordedDate, stringValue(input["note"]), id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "更新成长数据失败")
		return
	}
	if affected, _ := result.RowsAffected(); affected == 0 {
		writeError(w, http.StatusNotFound, "成长记录不存在")
		return
	}
	if err := updateBabyWeightFromLatest(r.Context(), tx); err != nil {
		writeError(w, http.StatusInternalServerError, "更新成长数据失败")
		return
	}
	if err := tx.Commit(); err != nil {
		writeError(w, http.StatusInternalServerError, "更新成长数据失败")
		return
	}
	a.addLog(r.Context(), user, "编辑成长数据", "growth_log", id,
		growthLogLabel(weight, hasWeight, height, hasHeight, recordedDate))
	writeJSON(w, http.StatusOK, map[string]any{"message": "已更新"})
}

func (a *App) deleteGrowthLog(w http.ResponseWriter, r *http.Request) {
	user := apiUser(r)
	if !isAdmin(user) {
		writeError(w, http.StatusForbidden, "仅管理员可删除")
		return
	}
	id := pathID(r)
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "删除成长数据失败")
		return
	}
	defer tx.Rollback()
	result, err := tx.ExecContext(r.Context(), "DELETE FROM weight_logs WHERE id = ?", id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "删除成长数据失败")
		return
	}
	if affected, _ := result.RowsAffected(); affected == 0 {
		writeError(w, http.StatusNotFound, "成长记录不存在")
		return
	}
	if err := updateBabyWeightFromLatest(r.Context(), tx); err != nil {
		writeError(w, http.StatusInternalServerError, "删除成长数据失败")
		return
	}
	if err := tx.Commit(); err != nil {
		writeError(w, http.StatusInternalServerError, "删除成长数据失败")
		return
	}
	a.addLog(r.Context(), user, "删除成长数据", "growth_log", id, "")
	writeJSON(w, http.StatusOK, map[string]any{"message": "已删除"})
}

func optionalGrowthValue(input map[string]any, key string, minValue, maxValue float64, label string) (float64, bool, string) {
	raw, exists := input[key]
	if !exists || raw == nil || strings.TrimSpace(stringValue(raw)) == "" {
		return 0, false, ""
	}
	value := floatValue(raw)
	if value < minValue || value > maxValue {
		return 0, false, fmt.Sprintf("%s需在 %s-%s 之间", label, formatNumber(minValue), formatNumber(maxValue))
	}
	return value, true, ""
}

func nullableGrowthValue(value float64, present bool) any {
	if !present {
		return nil
	}
	return value
}

func growthLogLabel(weight float64, hasWeight bool, height float64, hasHeight bool, recordedDate string) string {
	parts := make([]string, 0, 2)
	if hasWeight {
		parts = append(parts, formatNumber(weight)+"kg")
	}
	if hasHeight {
		parts = append(parts, formatNumber(height)+"cm")
	}
	return fmt.Sprintf("%s @ %s", strings.Join(parts, " / "), recordedDate)
}

func updateBabyWeightFromLatest(ctx context.Context, queryer growthQueryer) error {
	var weight float64
	err := queryer.QueryRowContext(ctx,
		"SELECT weight FROM weight_logs WHERE weight IS NOT NULL ORDER BY recorded_date DESC, id DESC LIMIT 1").
		Scan(&weight)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("query latest weight: %w", err)
	}
	if _, err := queryer.ExecContext(ctx, "UPDATE babies SET weight = ? WHERE id = 1", weight); err != nil {
		return fmt.Errorf("update latest baby weight: %w", err)
	}
	return nil
}

func (a *App) getTrends(w http.ResponseWriter, r *http.Request) {
	days := queryInt(r, "days", 14)
	if days < 1 {
		days = 1
	}
	if days > 90 {
		days = 90
	}
	mode := queryValue(r, "mode", "day")
	if mode != "day" && mode != "month" && mode != "hour" {
		mode = "day"
	}
	growthDays := queryInt(r, "growth_days", queryInt(r, "weight_days", days))
	if growthDays < 1 {
		growthDays = 1
	}
	if growthDays > 1825 {
		growthDays = 1825
	}
	hourDate := strings.TrimSpace(r.URL.Query().Get("date"))
	if _, err := parseDate(hourDate); err != nil {
		hourDate = ""
	}

	todayDate := today()
	startDate := todayDate.AddDate(0, 0, -(days - 1))
	growthStart := todayDate.AddDate(0, 0, -(growthDays - 1))
	startString := startDate.Format("2006-01-02")

	var (
		feedData    []map[string]any
		excreteData []map[string]any
		foodData    []map[string]any
		err         error
	)
	periodFormat := "%Y-%m-%d"
	if mode == "month" {
		periodFormat = "%Y-%m"
	} else if mode == "hour" {
		periodFormat = "%H"
	}
	periodExpr := "CAST(strftime('" + periodFormat + "', timestamp) AS INTEGER)"
	if mode != "hour" {
		periodExpr = "strftime('" + periodFormat + "', timestamp)"
	}
	feedQuery := `SELECT ` + periodExpr + ` AS period,
		       COALESCE(SUM(amount), 0) AS total_ml,
		       COUNT(*) AS feed_count
		FROM records
		WHERE type = 'feed' AND sub_type != 'solid_food'`
	excreteQuery := `SELECT ` + periodExpr + ` AS period,
		       SUM(CASE WHEN sub_type IN ('urine','both') THEN 1 ELSE 0 END) AS urine_count,
		       SUM(CASE WHEN sub_type IN ('stool','both') THEN 1 ELSE 0 END) AS stool_count
		FROM records
		WHERE type = 'excrete'`
	foodQuery := `SELECT ` + periodExpr + ` AS period,
		       food_unit,
		       COALESCE(SUM(amount), 0) AS total_amount,
		       COUNT(*) AS food_count
		FROM records
		WHERE type = 'feed' AND sub_type = 'solid_food'`
	if mode == "hour" && hourDate != "" {
		feedData, err = a.queryMaps(r.Context(), feedQuery+" AND date(timestamp) = ? GROUP BY period ORDER BY period", hourDate)
		if err == nil {
			excreteData, err = a.queryMaps(r.Context(), excreteQuery+" AND date(timestamp) = ? GROUP BY period ORDER BY period", hourDate)
		}
		if err == nil {
			foodData, err = a.queryMaps(r.Context(), foodQuery+" AND date(timestamp) = ? GROUP BY period, food_unit ORDER BY period", hourDate)
		}
	} else {
		feedData, err = a.queryMaps(r.Context(), feedQuery+" AND timestamp >= ? GROUP BY period ORDER BY period", startString)
		if err == nil {
			excreteData, err = a.queryMaps(r.Context(), excreteQuery+" AND timestamp >= ? GROUP BY period ORDER BY period", startString)
		}
		if err == nil {
			foodData, err = a.queryMaps(r.Context(), foodQuery+" AND timestamp >= ? GROUP BY period, food_unit ORDER BY period", startString)
		}
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "加载趋势失败")
		return
	}

	feedMap := indexByPeriod(feedData)
	excreteMap := indexByPeriod(excreteData)
	daily := make([]map[string]any, 0)
	switch mode {
	case "hour":
		for hour := 0; hour < 24; hour++ {
			key := fmt.Sprint(hour)
			feed := feedMap[key]
			excrete := excreteMap[key]
			daily = append(daily, map[string]any{
				"label":       fmt.Sprintf("%02d:00", hour),
				"feed_ml":     mapNumeric(feed, "total_ml"),
				"feed_count":  mapNumeric(feed, "feed_count"),
				"urine_count": mapNumeric(excrete, "urine_count"),
				"stool_count": mapNumeric(excrete, "stool_count"),
			})
		}
	case "month":
		cursor := time.Date(startDate.Year(), startDate.Month(), 1, 0, 0, 0, 0, startDate.Location())
		endMonth := time.Date(todayDate.Year(), todayDate.Month(), 1, 0, 0, 0, 0, todayDate.Location())
		for !cursor.After(endMonth) {
			key := cursor.Format("2006-01")
			feed := feedMap[key]
			excrete := excreteMap[key]
			daily = append(daily, map[string]any{
				"label":       key,
				"feed_ml":     mapNumeric(feed, "total_ml"),
				"feed_count":  mapNumeric(feed, "feed_count"),
				"urine_count": mapNumeric(excrete, "urine_count"),
				"stool_count": mapNumeric(excrete, "stool_count"),
			})
			cursor = cursor.AddDate(0, 1, 0)
		}
	default:
		for offset := 0; offset < days; offset++ {
			key := startDate.AddDate(0, 0, offset).Format("2006-01-02")
			feed := feedMap[key]
			excrete := excreteMap[key]
			daily = append(daily, map[string]any{
				"label":       key,
				"date":        key,
				"feed_ml":     mapNumeric(feed, "total_ml"),
				"feed_count":  mapNumeric(feed, "feed_count"),
				"urine_count": mapNumeric(excrete, "urine_count"),
				"stool_count": mapNumeric(excrete, "stool_count"),
			})
		}
	}

	feedHours, err := a.queryMaps(r.Context(), `
		SELECT CAST(strftime('%H', timestamp) AS INTEGER) AS hour, COUNT(*) AS count
		FROM records WHERE type = 'feed' AND timestamp >= ?
		GROUP BY hour ORDER BY hour`, startString)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "加载趋势失败")
		return
	}
	feedHoursByDay, err := a.queryMaps(r.Context(), `
		SELECT date(timestamp) AS date,
		       CAST(strftime('%H', timestamp) AS INTEGER) AS hour,
		       COUNT(*) AS count
		FROM records WHERE type = 'feed' AND timestamp >= ?
		GROUP BY date, hour ORDER BY date, hour`, startString)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "加载趋势失败")
		return
	}
	growthLogs, err := a.queryMaps(r.Context(), `
			SELECT id, weight, height, recorded_date, note FROM weight_logs
			WHERE recorded_date >= ? ORDER BY recorded_date, id`, growthStart.Format("2006-01-02"))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "加载成长数据失败")
		return
	}
	baby, _ := a.queryOne(r.Context(), "SELECT * FROM babies ORDER BY id LIMIT 1")
	settings, err := a.settingsMap(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "加载设置失败")
		return
	}
	estimate, err := estimateMilk(baby, settings)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "计算奶量失败")
		return
	}
	foodByUnit := make(map[string][]map[string]any)
	for _, row := range foodData {
		unit := stringValue(row["food_unit"])
		if unit == "" {
			unit = "g"
		}
		foodByUnit[unit] = append(foodByUnit[unit], row)
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"daily":             daily,
		"feed_hours":        feedHours,
		"feed_hours_by_day": feedHoursByDay,
		"food_by_unit":      foodByUnit,
		"growth":            growthLogs,
		"growth_days":       growthDays,
		"weights":           growthLogs,
		"target_ml":         estimate["daily_target_ml"],
		"days":              days,
		"weight_days":       growthDays,
		"mode":              mode,
	})
}

func indexByPeriod(rows []map[string]any) map[string]map[string]any {
	result := make(map[string]map[string]any, len(rows))
	for _, row := range rows {
		result[stringValue(row["period"])] = row
	}
	return result
}

func mapNumeric(row map[string]any, key string) any {
	if row == nil {
		return 0
	}
	return row[key]
}
