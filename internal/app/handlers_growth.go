package app

import (
	"context"
	"fmt"
	"math"
	"net/http"
	"strings"
	"time"
)

type vaccineDefinition struct {
	Name      string  `json:"name"`
	Short     string  `json:"short"`
	AgeMonths float64 `json:"age_months"`
	DoseIndex int     `json:"dose_index"`
	Note      string  `json:"note"`
}

type healthDefinition struct {
	Label         string  `json:"label"`
	AgeMonths     float64 `json:"age_months"`
	PrematureOnly bool    `json:"premature_only"`
	Location      string  `json:"location"`
}

const vaccineScheduleVersion = "2026年版"

// Vaccine definitions follow 国家免疫规划疫苗儿童免疫程序表（2026年版）.
var vaccineSchedule = []vaccineDefinition{
	{"乙肝疫苗", "HepB", 0, 1, "出生24小时内"},
	{"乙肝疫苗", "HepB", 1, 2, ""},
	{"乙肝疫苗", "HepB", 6, 3, ""},
	{"卡介苗", "BCG", 0, 1, "出生时"},
	{"脊灰灭活疫苗", "IPV", 2, 1, ""},
	{"脊灰灭活疫苗", "IPV", 3, 2, ""},
	{"脊灰减毒活疫苗", "bOPV", 4, 3, ""},
	{"脊灰减毒活疫苗", "bOPV", 48, 4, "4岁"},
	{"百白破疫苗", "DTaP", 2, 1, "基础免疫"},
	{"百白破疫苗", "DTaP", 4, 2, "基础免疫"},
	{"百白破疫苗", "DTaP", 6, 3, "基础免疫"},
	{"百白破疫苗", "DTaP", 18, 4, "18月龄加强"},
	{"百白破疫苗", "DTaP", 72, 5, "6岁加强"},
	{"A群流脑多糖疫苗", "MPSV-A", 6, 1, ""},
	{"A群流脑多糖疫苗", "MPSV-A", 9, 2, "间隔3月"},
	{"A群C群流脑多糖疫苗", "MPSV-AC", 36, 1, "3岁"},
	{"A群C群流脑多糖疫苗", "MPSV-AC", 72, 2, "6岁"},
	{"麻腮风疫苗", "MMR", 8, 1, ""},
	{"麻腮风疫苗", "MMR", 24, 2, "2岁"},
	{"乙脑减毒活疫苗", "JE-L", 8, 1, ""},
	{"乙脑减毒活疫苗", "JE-L", 24, 2, "2岁"},
	{"乙脑灭活疫苗", "JE-I", 8, 1, "减毒替代方案"},
	{"乙脑灭活疫苗", "JE-I", 8, 2, "间隔7-10天"},
	{"乙脑灭活疫苗", "JE-I", 24, 3, "2岁"},
	{"乙脑灭活疫苗", "JE-I", 156, 4, "13岁"},
	{"甲肝减毒活疫苗", "HepA-L", 18, 1, "18月龄"},
	{"甲肝灭活疫苗", "HepA-I", 18, 1, "减毒替代方案"},
	{"甲肝灭活疫苗", "HepA-I", 24, 2, "间隔6月"},
	{"双价人乳头瘤病毒疫苗", "2vHPV", 156, 1, "13岁"},
	{"双价人乳头瘤病毒疫苗", "2vHPV", 156, 2, "13岁，与第1剂间隔6个月"},
}

var healthFollowupSchedule = []healthDefinition{
	{"1月龄", 1, false, "社区（儿童健康管理建档）"},
	{"3月龄", 3, false, "社区、区妇幼、市妇幼"},
	{"6月龄", 6, false, "社区、区妇幼、市妇幼"},
	{"8月龄", 8, false, "社区、区妇幼、市妇幼"},
	{"12月龄", 12, false, "社区、区妇幼、市妇幼"},
	{"18月龄", 18, false, "社区、区妇幼、市妇幼"},
	{"24月龄", 24, false, "社区、区妇幼、市妇幼"},
	{"30月龄", 30, false, "社区、区妇幼、市妇幼"},
	{"36月龄", 36, false, "社区、区妇幼、市妇幼"},
	{"4岁", 48, false, "社区"},
	{"5岁", 60, false, "社区"},
	{"6岁", 72, false, "社区"},
	{"42天-2月龄", 1.4, true, "社区、区妇幼、市妇幼"},
	{"4月龄(早产)", 4, true, "社区、区妇幼、市妇幼"},
	{"5月龄(早产)", 5, true, "社区、区妇幼、市妇幼"},
	{"10月龄(早产)", 10, true, "社区、区妇幼、市妇幼"},
	{"15月龄(早产)", 15, true, "社区、区妇幼、市妇幼"},
	{"21月龄(早产)", 21, true, "社区、区妇幼、市妇幼"},
}

func (a *App) getVaccineSchedule(w http.ResponseWriter, r *http.Request) {
	schedule, overview, message, err := a.vaccineScheduleData(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "加载疫苗计划失败")
		return
	}
	if message != "" {
		writeJSON(w, http.StatusOK, map[string]any{
			"error":    message,
			"schedule": []any{},
			"overview": nil,
		})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"schedule": schedule,
		"overview": overview,
	})
}

func (a *App) vaccineScheduleData(ctx context.Context) ([]map[string]any, map[string]any, string, error) {
	baby, err := a.queryOne(ctx, "SELECT * FROM babies ORDER BY id LIMIT 1")
	if err != nil && !isNoRows(err) {
		return nil, nil, "", err
	}
	if baby == nil || strings.TrimSpace(stringValue(baby["birth_date"])) == "" {
		return nil, nil, "请先设置宝宝出生日期", nil
	}
	birth, err := parseDate(stringValue(baby["birth_date"]))
	if err != nil {
		return nil, nil, "出生日期格式无效", nil
	}
	todayDate := today()
	ageDays := int(todayDate.Sub(birth).Hours() / 24)
	ageMonths := float64(ageDays) / 30.44

	recordRows, err := a.queryMaps(ctx, "SELECT * FROM vaccine_records ORDER BY vaccinated_date, id")
	if err != nil {
		return nil, nil, "", err
	}
	recordMap := make(map[string]map[string]any, len(recordRows))
	for _, row := range recordRows {
		recordMap[doseKey(stringValue(row["vaccine_name"]), intValue(row["dose_index"]))] = row
	}
	overrideRows, err := a.queryMaps(ctx, "SELECT * FROM vaccine_plan_overrides")
	if err != nil {
		return nil, nil, "", err
	}
	overrideMap := make(map[string]string, len(overrideRows))
	for _, row := range overrideRows {
		overrideMap[doseKey(stringValue(row["vaccine_name"]), intValue(row["dose_index"]))] =
			stringValue(row["custom_due_date"])
	}
	deletedRows, err := a.queryMaps(ctx, "SELECT * FROM vaccine_plan_deleted")
	if err != nil {
		return nil, nil, "", err
	}
	deleted := make(map[string]bool, len(deletedRows))
	for _, row := range deletedRows {
		deleted[doseKey(stringValue(row["vaccine_name"]), intValue(row["dose_index"]))] = true
	}
	customRows, err := a.queryMaps(ctx, "SELECT * FROM vaccine_custom_plans ORDER BY due_date, id")
	if err != nil {
		return nil, nil, "", err
	}
	customPlans := make(map[string]map[string]any, len(customRows))
	for _, row := range customRows {
		customPlans[doseKey(stringValue(row["vaccine_name"]), intValue(row["dose_index"]))] = row
	}

	jeDone, hepaDone, jeInactivated, hepaInactivated := false, false, false, false
	for _, row := range recordRows {
		name := stringValue(row["vaccine_name"])
		if strings.HasPrefix(name, "乙脑") {
			jeDone = true
		}
		if strings.HasPrefix(name, "甲肝") {
			hepaDone = true
		}
		if name == "乙脑灭活疫苗" {
			jeInactivated = true
		}
		if name == "甲肝灭活疫苗" {
			hepaInactivated = true
		}
	}

	todayString := todayDate.Format("2006-01-02")
	schedule := make([]map[string]any, 0, len(vaccineSchedule)+len(customPlans))
	standardNames := make(map[string]bool, len(vaccineSchedule))
	for _, vaccine := range vaccineSchedule {
		standardNames[vaccine.Name] = true
		key := doseKey(vaccine.Name, vaccine.DoseIndex)
		if deleted[key] {
			continue
		}
		if vaccine.Short == "JE-L" && jeInactivated {
			continue
		}
		if vaccine.Short == "JE-I" && !jeInactivated && jeDone {
			continue
		}
		if vaccine.Short == "HepA-L" && hepaInactivated {
			continue
		}
		if vaccine.Short == "HepA-I" && !hepaInactivated && hepaDone {
			continue
		}
		defaultDue := dueDateForAge(birth, vaccine.AgeMonths)
		record := recordMap[key]
		dueDate := defaultDue
		if record == nil && overrideMap[key] != "" {
			dueDate = overrideMap[key]
		}
		status := dueStatus(dueDate, todayString, record != nil)
		entry := map[string]any{
			"name":             vaccine.Name,
			"short":            vaccine.Short,
			"age_months":       vaccine.AgeMonths,
			"dose_index":       vaccine.DoseIndex,
			"note":             vaccine.Note,
			"due_date":         dueDate,
			"default_due_date": defaultDue,
			"status":           status,
			"vaccinated_date":  nil,
			"note_text":        vaccine.Note,
			"is_custom":        false,
		}
		if record != nil {
			entry["vaccinated_date"] = record["vaccinated_date"]
			entry["note_text"] = record["note"]
		}
		schedule = append(schedule, entry)
	}

	for key, plan := range customPlans {
		name := stringValue(plan["vaccine_name"])
		doseIndex := intValue(plan["dose_index"])
		record := recordMap[key]
		if record != nil {
			schedule = append(schedule, map[string]any{
				"name":            name,
				"short":           "Custom",
				"age_months":      0,
				"dose_index":      doseIndex,
				"note":            "",
				"due_date":        record["vaccinated_date"],
				"status":          "done",
				"vaccinated_date": record["vaccinated_date"],
				"note_text":       record["note"],
				"is_custom":       true,
			})
			continue
		}
		dueDate := stringValue(plan["due_date"])
		schedule = append(schedule, map[string]any{
			"name":             name,
			"short":            "Custom",
			"age_months":       0,
			"dose_index":       doseIndex,
			"note":             stringValue(plan["note"]),
			"due_date":         dueDate,
			"default_due_date": dueDate,
			"status":           dueStatus(dueDate, todayString, false),
			"vaccinated_date":  nil,
			"note_text":        stringValue(plan["note"]),
			"is_custom":        true,
		})
	}
	for _, record := range recordRows {
		name := stringValue(record["vaccine_name"])
		doseIndex := intValue(record["dose_index"])
		if standardNames[name] || customPlans[doseKey(name, doseIndex)] != nil {
			continue
		}
		schedule = append(schedule, map[string]any{
			"name":            name,
			"short":           "Custom",
			"age_months":      0,
			"dose_index":      doseIndex,
			"note":            "",
			"due_date":        record["vaccinated_date"],
			"status":          "done",
			"vaccinated_date": record["vaccinated_date"],
			"note_text":       record["note"],
			"is_custom":       true,
		})
	}

	var lastDone, nextUpcoming map[string]any
	doneCount, overdueCount := 0, 0
	for _, item := range schedule {
		status := stringValue(item["status"])
		if status == "done" {
			doneCount++
			lastDone = item
			continue
		}
		if status == "overdue" {
			overdueCount++
		}
		if nextUpcoming == nil || stringValue(item["due_date"]) < stringValue(nextUpcoming["due_date"]) {
			nextUpcoming = item
		}
	}
	overview := map[string]any{
		"age_months":    math.Round(ageMonths*10) / 10,
		"age_days":      ageDays,
		"total_doses":   len(schedule),
		"done_count":    doneCount,
		"overdue_count": overdueCount,
		"last_done":     lastDone,
		"next_upcoming": nextUpcoming,
	}
	if nextUpcoming != nil {
		if due, err := parseDate(stringValue(nextUpcoming["due_date"])); err == nil {
			overview["next_days"] = int(due.Sub(todayDate).Hours() / 24)
		}
	}
	return schedule, overview, "", nil
}

func (a *App) addVaccineRecord(w http.ResponseWriter, r *http.Request) {
	user := apiUser(r)
	if !isApproved(user) {
		writeError(w, http.StatusForbidden, "无权限")
		return
	}
	var input map[string]any
	if err := decodeJSON(w, r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "参数不完整")
		return
	}
	name := strings.TrimSpace(stringValue(input["vaccine_name"]))
	doseIndex := intValue(input["dose_index"])
	vaccinatedDate := strings.TrimSpace(stringValue(input["vaccinated_date"]))
	if name == "" || doseIndex <= 0 || vaccinatedDate == "" {
		writeError(w, http.StatusBadRequest, "参数不完整")
		return
	}
	if _, err := parseDate(vaccinatedDate); err != nil {
		writeError(w, http.StatusBadRequest, "接种日期格式无效")
		return
	}
	if _, err := a.db.ExecContext(r.Context(),
		`INSERT OR REPLACE INTO vaccine_records
		 (vaccine_name, dose_index, vaccinated_date, note) VALUES (?, ?, ?, ?)`,
		name, doseIndex, vaccinatedDate, stringValue(input["note"])); err != nil {
		writeError(w, http.StatusInternalServerError, "记录疫苗失败")
		return
	}
	a.addLog(r.Context(), user, "记录疫苗", "vaccine", 0,
		fmt.Sprintf("%s第%d剂", name, doseIndex))
	writeJSON(w, http.StatusOK, map[string]any{"message": "已记录"})
}

func (a *App) deleteVaccineRecord(w http.ResponseWriter, r *http.Request) {
	user := apiUser(r)
	if !isApproved(user) {
		writeError(w, http.StatusForbidden, "无权限")
		return
	}
	var input map[string]any
	if err := decodeJSON(w, r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "参数不完整")
		return
	}
	name := strings.TrimSpace(stringValue(input["vaccine_name"]))
	doseIndex := intValue(input["dose_index"])
	if _, err := a.db.ExecContext(r.Context(),
		"DELETE FROM vaccine_records WHERE vaccine_name = ? AND dose_index = ?",
		name, doseIndex); err != nil {
		writeError(w, http.StatusInternalServerError, "删除疫苗记录失败")
		return
	}
	a.addLog(r.Context(), user, "删除疫苗记录", "vaccine", 0,
		fmt.Sprintf("%s第%d剂", name, doseIndex))
	writeJSON(w, http.StatusOK, map[string]any{"message": "已删除"})
}

func (a *App) updateVaccinePlanDate(w http.ResponseWriter, r *http.Request) {
	user := apiUser(r)
	if !isApproved(user) {
		writeError(w, http.StatusForbidden, "无权限")
		return
	}
	var input map[string]any
	if err := decodeJSON(w, r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "参数不完整")
		return
	}
	name := strings.TrimSpace(stringValue(input["vaccine_name"]))
	doseIndex := intValue(input["dose_index"])
	customDueDate := strings.TrimSpace(stringValue(input["custom_due_date"]))
	if name == "" || doseIndex <= 0 || customDueDate == "" {
		writeError(w, http.StatusBadRequest, "参数不完整")
		return
	}
	if _, err := parseDate(customDueDate); err != nil {
		writeError(w, http.StatusBadRequest, "计划日期格式无效")
		return
	}
	record, _ := a.queryOne(r.Context(),
		"SELECT id FROM vaccine_records WHERE vaccine_name = ? AND dose_index = ?", name, doseIndex)
	if record != nil {
		writeError(w, http.StatusBadRequest, "已接种的项目不能修改计划日期")
		return
	}
	custom, _ := a.queryOne(r.Context(),
		"SELECT id FROM vaccine_custom_plans WHERE vaccine_name = ? AND dose_index = ?", name, doseIndex)
	var err error
	if custom != nil {
		_, err = a.db.ExecContext(r.Context(),
			"UPDATE vaccine_custom_plans SET due_date = ? WHERE vaccine_name = ? AND dose_index = ?",
			customDueDate, name, doseIndex)
	} else {
		_, err = a.db.ExecContext(r.Context(),
			"INSERT OR REPLACE INTO vaccine_plan_overrides (vaccine_name, dose_index, custom_due_date) VALUES (?, ?, ?)",
			name, doseIndex, customDueDate)
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "修改计划日期失败")
		return
	}
	a.addLog(r.Context(), user, "修改计划日期", "vaccine", 0,
		fmt.Sprintf("%s第%d剂 → %s", name, doseIndex, customDueDate))
	writeJSON(w, http.StatusOK, map[string]any{"message": "计划日期已更新"})
}

func (a *App) deleteVaccinePlan(w http.ResponseWriter, r *http.Request) {
	user := apiUser(r)
	if !isApproved(user) {
		writeError(w, http.StatusForbidden, "无权限")
		return
	}
	var input map[string]any
	if err := decodeJSON(w, r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "参数不完整")
		return
	}
	name := strings.TrimSpace(stringValue(input["vaccine_name"]))
	doseIndex := intValue(input["dose_index"])
	if name == "" || doseIndex <= 0 {
		writeError(w, http.StatusBadRequest, "参数不完整")
		return
	}
	record, _ := a.queryOne(r.Context(),
		"SELECT id FROM vaccine_records WHERE vaccine_name = ? AND dose_index = ?", name, doseIndex)
	if record != nil {
		writeError(w, http.StatusBadRequest, "已接种的项目不能删除")
		return
	}
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "删除疫苗计划失败")
		return
	}
	defer tx.Rollback()
	_, err = tx.ExecContext(r.Context(),
		"INSERT OR IGNORE INTO vaccine_plan_deleted (vaccine_name, dose_index) VALUES (?, ?)", name, doseIndex)
	if err == nil {
		_, err = tx.ExecContext(r.Context(),
			"DELETE FROM vaccine_plan_overrides WHERE vaccine_name = ? AND dose_index = ?", name, doseIndex)
	}
	if err == nil {
		err = tx.Commit()
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "删除疫苗计划失败")
		return
	}
	a.addLog(r.Context(), user, "删除疫苗计划", "vaccine", 0,
		fmt.Sprintf("%s第%d剂", name, doseIndex))
	writeJSON(w, http.StatusOK, map[string]any{"message": "已删除"})
}

func (a *App) addVaccineCustomPlan(w http.ResponseWriter, r *http.Request) {
	user := apiUser(r)
	if !isApproved(user) {
		writeError(w, http.StatusForbidden, "无权限")
		return
	}
	var input struct {
		VaccineName string           `json:"vaccine_name"`
		Doses       []map[string]any `json:"doses"`
	}
	if err := decodeJSON(w, r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "参数不完整")
		return
	}
	name := strings.TrimSpace(input.VaccineName)
	if name == "" {
		writeError(w, http.StatusBadRequest, "请输入疫苗名称")
		return
	}
	if len(input.Doses) == 0 {
		writeError(w, http.StatusBadRequest, "请至少添加一剂")
		return
	}
	todayString := today().Format("2006-01-02")
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "添加疫苗计划失败")
		return
	}
	defer tx.Rollback()
	added := 0
	for _, dose := range input.Doses {
		doseIndex := intValue(dose["dose_index"])
		if doseIndex <= 0 {
			doseIndex = 1
		}
		dueDate := strings.TrimSpace(stringValue(dose["due_date"]))
		if dueDate == "" {
			continue
		}
		note := stringValue(dose["note"])
		if dueDate == todayString {
			_, err = tx.ExecContext(r.Context(),
				`INSERT OR REPLACE INTO vaccine_records
				 (vaccine_name, dose_index, vaccinated_date, note) VALUES (?, ?, ?, ?)`,
				name, doseIndex, dueDate, note)
		} else {
			_, err = tx.ExecContext(r.Context(),
				`INSERT OR REPLACE INTO vaccine_custom_plans
				 (vaccine_name, dose_index, due_date, note) VALUES (?, ?, ?, ?)`,
				name, doseIndex, dueDate, note)
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "添加疫苗计划失败")
			return
		}
		added++
	}
	if err := tx.Commit(); err != nil {
		writeError(w, http.StatusInternalServerError, "添加疫苗计划失败")
		return
	}
	a.addLog(r.Context(), user, "添加疫苗计划", "vaccine", 0,
		fmt.Sprintf("%s %d剂", name, added))
	writeJSON(w, http.StatusOK, map[string]any{"message": fmt.Sprintf("已添加 %d 剂", added)})
}

func (a *App) deleteVaccineCustomPlan(w http.ResponseWriter, r *http.Request) {
	user := apiUser(r)
	if !isApproved(user) {
		writeError(w, http.StatusForbidden, "无权限")
		return
	}
	var input map[string]any
	if err := decodeJSON(w, r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "参数不完整")
		return
	}
	name := strings.TrimSpace(stringValue(input["vaccine_name"]))
	doseIndex := intValue(input["dose_index"])
	if _, err := a.db.ExecContext(r.Context(),
		"DELETE FROM vaccine_custom_plans WHERE vaccine_name = ? AND dose_index = ?",
		name, doseIndex); err != nil {
		writeError(w, http.StatusInternalServerError, "删除自定义计划失败")
		return
	}
	a.addLog(r.Context(), user, "删除自定义疫苗计划", "vaccine", 0,
		fmt.Sprintf("%s第%d剂", name, doseIndex))
	writeJSON(w, http.StatusOK, map[string]any{"message": "已删除"})
}

func (a *App) getVaccineDates(w http.ResponseWriter, r *http.Request) {
	result := map[string]any{
		"vaccinated": []string{},
		"overdue":    []string{},
		"upcoming":   []string{},
	}
	records, err := a.queryMaps(r.Context(), "SELECT vaccinated_date FROM vaccine_records")
	if err != nil {
		writeError(w, http.StatusInternalServerError, "加载疫苗日期失败")
		return
	}
	vaccinated := make([]string, 0, len(records))
	for _, row := range records {
		if date := stringValue(row["vaccinated_date"]); date != "" {
			vaccinated = append(vaccinated, date)
		}
	}
	result["vaccinated"] = vaccinated
	schedule, _, message, err := a.vaccineScheduleData(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "加载疫苗日期失败")
		return
	}
	if message != "" {
		writeJSON(w, http.StatusOK, result)
		return
	}
	overdue := make([]string, 0)
	upcoming := make([]string, 0)
	for _, item := range schedule {
		date := stringValue(item["due_date"])
		switch stringValue(item["status"]) {
		case "overdue":
			overdue = append(overdue, date)
		case "upcoming":
			upcoming = append(upcoming, date)
		}
	}
	result["overdue"] = overdue
	result["upcoming"] = upcoming
	writeJSON(w, http.StatusOK, result)
}

func (a *App) getVaccineDayRecords(w http.ResponseWriter, r *http.Request) {
	recordDate := queryValue(r, "date", today().Format("2006-01-02"))
	result := map[string]any{
		"vaccinated": []map[string]any{},
		"planned":    []map[string]any{},
	}
	records, err := a.queryMaps(r.Context(),
		"SELECT * FROM vaccine_records WHERE vaccinated_date = ? ORDER BY id", recordDate)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "加载疫苗记录失败")
		return
	}
	vaccinated := make([]map[string]any, 0, len(records))
	for _, row := range records {
		vaccinated = append(vaccinated, map[string]any{
			"name":            row["vaccine_name"],
			"dose_index":      row["dose_index"],
			"vaccinated_date": row["vaccinated_date"],
			"note":            stringValue(row["note"]),
		})
	}
	result["vaccinated"] = vaccinated
	schedule, _, message, err := a.vaccineScheduleData(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "加载疫苗计划失败")
		return
	}
	if message != "" {
		writeJSON(w, http.StatusOK, result)
		return
	}
	planned := make([]map[string]any, 0)
	for _, item := range schedule {
		if stringValue(item["status"]) == "done" || stringValue(item["due_date"]) != recordDate {
			continue
		}
		planned = append(planned, map[string]any{
			"name":       item["name"],
			"dose_index": item["dose_index"],
			"due_date":   item["due_date"],
			"status":     item["status"],
		})
	}
	result["planned"] = planned
	writeJSON(w, http.StatusOK, result)
}

func (a *App) getHealthSchedule(w http.ResponseWriter, r *http.Request) {
	schedule, overview, message, err := a.healthScheduleData(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "加载健康随访失败")
		return
	}
	if message != "" {
		writeJSON(w, http.StatusOK, map[string]any{
			"error":    message,
			"schedule": []any{},
			"overview": nil,
		})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"schedule": schedule,
		"overview": overview,
	})
}

func (a *App) healthScheduleData(ctx context.Context) ([]map[string]any, map[string]any, string, error) {
	baby, err := a.queryOne(ctx, "SELECT * FROM babies ORDER BY id LIMIT 1")
	if err != nil && !isNoRows(err) {
		return nil, nil, "", err
	}
	if baby == nil || strings.TrimSpace(stringValue(baby["birth_date"])) == "" {
		return nil, nil, "请先设置宝宝出生日期", nil
	}
	birth, err := parseDate(stringValue(baby["birth_date"]))
	if err != nil {
		return nil, nil, "出生日期格式无效", nil
	}
	isPremature := boolValue(baby["is_premature"])
	records, err := a.queryMaps(ctx, "SELECT * FROM health_followup_records")
	if err != nil {
		return nil, nil, "", err
	}
	recordMap := make(map[string]map[string]any, len(records))
	for _, row := range records {
		recordMap[stringValue(row["label"])] = row
	}
	overrides, err := a.queryMaps(ctx, "SELECT * FROM health_followup_overrides")
	if err != nil {
		return nil, nil, "", err
	}
	overrideMap := make(map[string]string, len(overrides))
	for _, row := range overrides {
		overrideMap[stringValue(row["label"])] = stringValue(row["custom_due_date"])
	}
	todayString := today().Format("2006-01-02")
	schedule := make([]map[string]any, 0, len(healthFollowupSchedule))
	scheduleLabels := make(map[string]bool, len(healthFollowupSchedule))
	for _, followup := range healthFollowupSchedule {
		if followup.PrematureOnly && !isPremature {
			continue
		}
		scheduleLabels[followup.Label] = true
		defaultDue := dueDateForAge(birth, followup.AgeMonths)
		record := recordMap[followup.Label]
		dueDate := defaultDue
		if record == nil && overrideMap[followup.Label] != "" {
			dueDate = overrideMap[followup.Label]
		}
		entry := map[string]any{
			"label":            followup.Label,
			"age_months":       followup.AgeMonths,
			"premature_only":   followup.PrematureOnly,
			"location":         followup.Location,
			"due_date":         dueDate,
			"default_due_date": defaultDue,
			"status":           dueStatus(dueDate, todayString, record != nil),
			"completed_date":   nil,
			"note_text":        "",
			"is_premature":     followup.PrematureOnly,
		}
		if record != nil {
			entry["completed_date"] = record["completed_date"]
			entry["note_text"] = record["note"]
		}
		schedule = append(schedule, entry)
	}
	for _, record := range records {
		label := stringValue(record["label"])
		if scheduleLabels[label] {
			continue
		}
		schedule = append(schedule, map[string]any{
			"label":            label,
			"age_months":       nil,
			"premature_only":   false,
			"location":         "",
			"due_date":         record["completed_date"],
			"default_due_date": record["completed_date"],
			"status":           "done",
			"completed_date":   record["completed_date"],
			"note_text":        stringValue(record["note"]),
			"is_premature":     false,
			"is_custom":        true,
		})
	}
	var nextUpcoming map[string]any
	doneCount, overdueCount := 0, 0
	for _, item := range schedule {
		switch stringValue(item["status"]) {
		case "done":
			doneCount++
		case "overdue":
			overdueCount++
		}
		if stringValue(item["status"]) != "done" &&
			(nextUpcoming == nil || stringValue(item["due_date"]) < stringValue(nextUpcoming["due_date"])) {
			nextUpcoming = item
		}
	}
	overview := map[string]any{
		"is_premature":  isPremature,
		"total":         len(schedule),
		"done_count":    doneCount,
		"overdue_count": overdueCount,
		"next_upcoming": nextUpcoming,
	}
	if nextUpcoming != nil {
		if due, err := parseDate(stringValue(nextUpcoming["due_date"])); err == nil {
			overview["next_days"] = int(due.Sub(today()).Hours() / 24)
		}
	}
	return schedule, overview, "", nil
}

func (a *App) addHealthRecord(w http.ResponseWriter, r *http.Request) {
	user := apiUser(r)
	if !isApproved(user) {
		writeError(w, http.StatusForbidden, "无权限")
		return
	}
	var input map[string]any
	if err := decodeJSON(w, r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "参数不完整")
		return
	}
	label := strings.TrimSpace(stringValue(input["label"]))
	completedDate := strings.TrimSpace(stringValue(input["completed_date"]))
	if completedDate == "" {
		completedDate = today().Format("2006-01-02")
	}
	if label == "" {
		writeError(w, http.StatusBadRequest, "缺少随访名称")
		return
	}
	if _, err := parseDate(completedDate); err != nil {
		writeError(w, http.StatusBadRequest, "随访日期格式无效")
		return
	}
	if _, err := a.db.ExecContext(r.Context(),
		"INSERT OR REPLACE INTO health_followup_records (label, completed_date, note) VALUES (?, ?, ?)",
		label, completedDate, strings.TrimSpace(stringValue(input["note"]))); err != nil {
		writeError(w, http.StatusInternalServerError, "记录随访失败")
		return
	}
	a.addLog(r.Context(), user, "健康随访", "health", 0, label+" → "+completedDate)
	writeJSON(w, http.StatusCreated, map[string]any{"message": "已记录"})
}

func (a *App) deleteHealthRecord(w http.ResponseWriter, r *http.Request) {
	user := apiUser(r)
	if !isApproved(user) {
		writeError(w, http.StatusForbidden, "无权限")
		return
	}
	label := strings.TrimSpace(r.URL.Query().Get("label"))
	if label == "" {
		writeError(w, http.StatusBadRequest, "缺少随访名称")
		return
	}
	if _, err := a.db.ExecContext(r.Context(),
		"DELETE FROM health_followup_records WHERE label = ?", label); err != nil {
		writeError(w, http.StatusInternalServerError, "删除随访失败")
		return
	}
	a.addLog(r.Context(), user, "删除随访", "health", 0, label)
	writeJSON(w, http.StatusOK, map[string]any{"message": "已删除"})
}

func (a *App) updateHealthPlanDate(w http.ResponseWriter, r *http.Request) {
	user := apiUser(r)
	if !isApproved(user) {
		writeError(w, http.StatusForbidden, "无权限")
		return
	}
	var input map[string]any
	if err := decodeJSON(w, r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "参数不完整")
		return
	}
	label := strings.TrimSpace(stringValue(input["label"]))
	customDueDate := strings.TrimSpace(stringValue(input["custom_due_date"]))
	if label == "" || customDueDate == "" {
		writeError(w, http.StatusBadRequest, "参数不完整")
		return
	}
	if _, err := parseDate(customDueDate); err != nil {
		writeError(w, http.StatusBadRequest, "计划日期格式无效")
		return
	}
	if _, err := a.db.ExecContext(r.Context(),
		"INSERT OR REPLACE INTO health_followup_overrides (label, custom_due_date) VALUES (?, ?)",
		label, customDueDate); err != nil {
		writeError(w, http.StatusInternalServerError, "修改随访日期失败")
		return
	}
	a.addLog(r.Context(), user, "修改随访日期", "health", 0, label+" → "+customDueDate)
	writeJSON(w, http.StatusOK, map[string]any{"message": "计划日期已更新"})
}

func (a *App) getHealthDates(w http.ResponseWriter, r *http.Request) {
	result := map[string]any{
		"completed": []string{},
		"upcoming":  []string{},
		"overdue":   []string{},
	}
	schedule, _, message, err := a.healthScheduleData(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "加载随访日期失败")
		return
	}
	if message != "" {
		writeJSON(w, http.StatusOK, result)
		return
	}
	completed := make([]string, 0)
	upcoming := make([]string, 0)
	overdue := make([]string, 0)
	for _, item := range schedule {
		switch stringValue(item["status"]) {
		case "done":
			completed = append(completed, stringValue(item["completed_date"]))
		case "upcoming":
			upcoming = append(upcoming, stringValue(item["due_date"]))
		case "overdue":
			overdue = append(overdue, stringValue(item["due_date"]))
		}
	}
	result["completed"] = completed
	result["upcoming"] = upcoming
	result["overdue"] = overdue
	writeJSON(w, http.StatusOK, result)
}

func (a *App) getHealthDayRecords(w http.ResponseWriter, r *http.Request) {
	recordDate := queryValue(r, "date", today().Format("2006-01-02"))
	result := map[string]any{
		"completed": []map[string]any{},
		"planned":   []map[string]any{},
	}
	records, err := a.queryMaps(r.Context(),
		"SELECT * FROM health_followup_records WHERE completed_date = ? ORDER BY id", recordDate)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "加载随访失败")
		return
	}
	completed := make([]map[string]any, 0, len(records))
	for _, row := range records {
		completed = append(completed, map[string]any{
			"label":          row["label"],
			"completed_date": row["completed_date"],
			"note":           stringValue(row["note"]),
		})
	}
	result["completed"] = completed
	schedule, _, message, err := a.healthScheduleData(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "加载随访失败")
		return
	}
	if message != "" {
		writeJSON(w, http.StatusOK, result)
		return
	}
	planned := make([]map[string]any, 0)
	for _, item := range schedule {
		if stringValue(item["status"]) == "done" || stringValue(item["due_date"]) != recordDate {
			continue
		}
		planned = append(planned, map[string]any{
			"label":    item["label"],
			"due_date": item["due_date"],
			"location": item["location"],
			"status":   item["status"],
		})
	}
	result["planned"] = planned
	writeJSON(w, http.StatusOK, result)
}

func (a *App) getCountdowns(w http.ResponseWriter, r *http.Request) {
	rows, err := a.queryMaps(r.Context(),
		"SELECT * FROM countdown_events ORDER BY target_date, id")
	if err != nil {
		writeError(w, http.StatusInternalServerError, "加载倒数日失败")
		return
	}
	todayDate := today()
	for _, row := range rows {
		target, err := parseDate(stringValue(row["target_date"]))
		if err != nil {
			row["days_left"] = nil
		} else {
			row["days_left"] = int(target.Sub(todayDate).Hours() / 24)
		}
	}
	writeJSON(w, http.StatusOK, rows)
}

func (a *App) addCountdown(w http.ResponseWriter, r *http.Request) {
	user := apiUser(r)
	if !isApproved(user) {
		writeError(w, http.StatusForbidden, "无权限")
		return
	}
	var input map[string]any
	if err := decodeJSON(w, r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "标题和日期不能为空")
		return
	}
	title := strings.TrimSpace(stringValue(input["title"]))
	targetDate := strings.TrimSpace(stringValue(input["target_date"]))
	if title == "" || targetDate == "" {
		writeError(w, http.StatusBadRequest, "标题和日期不能为空")
		return
	}
	if _, err := parseDate(targetDate); err != nil {
		writeError(w, http.StatusBadRequest, "日期格式无效")
		return
	}
	if _, err := a.db.ExecContext(r.Context(),
		"INSERT INTO countdown_events (title, target_date, note) VALUES (?, ?, ?)",
		title, targetDate, strings.TrimSpace(stringValue(input["note"]))); err != nil {
		writeError(w, http.StatusInternalServerError, "添加倒数日失败")
		return
	}
	a.addLog(r.Context(), user, "添加倒数日", "countdown", 0, title+" → "+targetDate)
	writeJSON(w, http.StatusCreated, map[string]any{"message": "已添加"})
}

func (a *App) updateCountdown(w http.ResponseWriter, r *http.Request) {
	user := apiUser(r)
	if !isApproved(user) {
		writeError(w, http.StatusForbidden, "无权限")
		return
	}
	var input map[string]any
	if err := decodeJSON(w, r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "标题和日期不能为空")
		return
	}
	title := strings.TrimSpace(stringValue(input["title"]))
	targetDate := strings.TrimSpace(stringValue(input["target_date"]))
	if title == "" || targetDate == "" {
		writeError(w, http.StatusBadRequest, "标题和日期不能为空")
		return
	}
	if _, err := parseDate(targetDate); err != nil {
		writeError(w, http.StatusBadRequest, "日期格式无效")
		return
	}
	id := pathID(r)
	if _, err := a.db.ExecContext(r.Context(),
		"UPDATE countdown_events SET title = ?, target_date = ?, note = ? WHERE id = ?",
		title, targetDate, strings.TrimSpace(stringValue(input["note"])), id); err != nil {
		writeError(w, http.StatusInternalServerError, "更新倒数日失败")
		return
	}
	a.addLog(r.Context(), user, "修改倒数日", "countdown", id, title+" → "+targetDate)
	writeJSON(w, http.StatusOK, map[string]any{"message": "已更新"})
}

func (a *App) deleteCountdown(w http.ResponseWriter, r *http.Request) {
	user := apiUser(r)
	if !isApproved(user) {
		writeError(w, http.StatusForbidden, "无权限")
		return
	}
	id := pathID(r)
	if _, err := a.db.ExecContext(r.Context(),
		"DELETE FROM countdown_events WHERE id = ?", id); err != nil {
		writeError(w, http.StatusInternalServerError, "删除倒数日失败")
		return
	}
	a.addLog(r.Context(), user, "删除倒数日", "countdown", id, "")
	writeJSON(w, http.StatusOK, map[string]any{"message": "已删除"})
}

func dueDateForAge(birth time.Time, ageMonths float64) string {
	return birth.AddDate(0, 0, int(ageMonths*30.44)).Format("2006-01-02")
}

func dueStatus(dueDate, todayString string, done bool) string {
	if done {
		return "done"
	}
	if dueDate <= todayString {
		return "overdue"
	}
	return "upcoming"
}

func doseKey(name string, doseIndex any) string {
	return name + "\x00" + stringValue(doseIndex)
}
