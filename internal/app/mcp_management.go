package app

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func (a *App) registerMCPFullTools(server *mcp.Server) {
	mcp.AddTool(server, mcpReadOnlyTool(
		"baby_tracker_get_vaccine_schedule",
		"读取疫苗计划",
		"读取当前宝宝的完整疫苗计划、接种状态和历史接种记录汇总。需要完全权限。",
	), a.mcpGetVaccineSchedule)
	mcp.AddTool(server, mcpReadOnlyTool(
		"baby_tracker_get_health_schedule",
		"读取健康随访计划",
		"读取当前宝宝的完整健康随访计划、完成状态和计划日期。需要完全权限。",
	), a.mcpGetHealthSchedule)
	mcp.AddTool(server, mcpReadOnlyTool(
		"baby_tracker_list_countdowns",
		"列出倒数日",
		"列出全部倒数日事件、目标日期和剩余天数。需要完全权限。",
	), a.mcpListCountdowns)
	mcp.AddTool(server, mcpReadOnlyTool(
		"baby_tracker_get_settings",
		"读取业务设置",
		"读取奶量目标、喂养次数等业务设置。密钥与控制面配置不会返回。需要完全权限。",
	), a.mcpGetSettings)
	mcp.AddTool(server, mcpReadOnlyTool(
		"baby_tracker_get_stats",
		"读取全量统计",
		"读取全部历史的记录数、喂养数、总奶量、记录天数和待审批用户数。需要完全权限。",
	), a.mcpGetStats)
	mcp.AddTool(server, mcpReadOnlyTool(
		"baby_tracker_list_users",
		"列出用户",
		"列出用户 ID、用户名、昵称、角色、审批状态和创建时间。不会返回密码哈希。需要完全权限。",
	), a.mcpListUsers)
	mcp.AddTool(server, mcpReadOnlyTool(
		"baby_tracker_list_audit_logs",
		"读取审计日志",
		"按时间倒序读取管理、记录和 MCP 操作日志。需要完全权限。",
	), a.mcpListAuditLogs)

	mcp.AddTool(server, mcpWriteTool(
		"baby_tracker_update_baby",
		"修改宝宝资料",
		"修改宝宝姓名、性别、出生日期、体重或早产标记。需要完全权限。",
		true,
	), a.mcpUpdateBaby)
	mcp.AddTool(server, mcpDestructiveTool(
		"baby_tracker_manage_records",
		"管理日常记录",
		"修改或删除已有喂养、排泄、症状和补充记录。需要完全权限。",
	), a.mcpManageRecords)
	mcp.AddTool(server, mcpDestructiveTool(
		"baby_tracker_manage_quick_buttons",
		"管理快捷按钮",
		"创建、修改、排序或删除快捷记录按钮。需要完全权限。",
	), a.mcpManageQuickButtons)
	mcp.AddTool(server, mcpWriteTool(
		"baby_tracker_update_settings",
		"修改业务设置",
		"批量修改奶量目标、喂养次数等业务设置。密钥、MCP 开关和权限档位不能通过 MCP 修改。",
		true,
	), a.mcpUpdateSettings)
	mcp.AddTool(server, mcpDestructiveTool(
		"baby_tracker_manage_growth_logs",
		"管理成长记录",
		"修改或删除已有体重和身高记录。需要完全权限。",
	), a.mcpManageGrowthLogs)
	mcp.AddTool(server, mcpDestructiveTool(
		"baby_tracker_manage_vaccines",
		"管理疫苗记录与计划",
		"删除接种记录、调整计划日期、删除计划或新增自定义疫苗计划。需要完全权限。",
	), a.mcpManageVaccines)
	mcp.AddTool(server, mcpDestructiveTool(
		"baby_tracker_manage_health_followups",
		"管理健康随访",
		"删除健康随访记录或调整计划日期。需要完全权限。",
	), a.mcpManageHealth)
	mcp.AddTool(server, mcpDestructiveTool(
		"baby_tracker_manage_countdowns",
		"管理倒数日",
		"新增、修改或删除倒数日事件。需要完全权限。",
	), a.mcpManageCountdowns)
	mcp.AddTool(server, mcpDestructiveTool(
		"baby_tracker_manage_users",
		"管理用户",
		"批准、拒绝、删除、改名或重置用户密码。需要完全权限。",
	), a.mcpManageUsers)
	mcp.AddTool(server, mcpDestructiveTool(
		"baby_tracker_clear_records",
		"清空日常记录",
		"永久删除全部喂养、排泄、症状和补充记录。必须提供确认短语 CLEAR_ALL_RECORDS。需要完全权限。",
	), a.mcpClearRecords)
}

type mcpGrowthLogsInput struct {
	StartDate string `json:"start_date,omitempty" jsonschema:"起始日期，格式 YYYY-MM-DD；基础与进阶档默认最近 30 天"`
	EndDate   string `json:"end_date,omitempty" jsonschema:"结束日期，格式 YYYY-MM-DD；基础与进阶档默认今天"`
	Limit     int    `json:"limit,omitempty" jsonschema:"每页条数，默认 50，最大 200"`
	Offset    int    `json:"offset,omitempty" jsonschema:"分页偏移量，默认 0"`
}

type mcpGrowthLogsOutput struct {
	StartDate string           `json:"start_date" jsonschema:"查询起始日期"`
	EndDate   string           `json:"end_date" jsonschema:"查询结束日期"`
	Logs      []map[string]any `json:"logs" jsonschema:"成长记录列表"`
	Total     int64            `json:"total" jsonschema:"范围内的总记录数"`
	Limit     int              `json:"limit" jsonschema:"当前分页大小"`
	Offset    int              `json:"offset" jsonschema:"当前分页偏移量"`
	HasMore   bool             `json:"has_more" jsonschema:"是否还有下一页"`
}

func (a *App) mcpListGrowthLogs(ctx context.Context, _ *mcp.CallToolRequest, input mcpGrowthLogsInput) (*mcp.CallToolResult, mcpGrowthLogsOutput, error) {
	permission, err := a.requireMCPPermission(ctx, mcpPermissionBasic)
	if err != nil {
		return nil, mcpGrowthLogsOutput{}, err
	}
	startDate := strings.TrimSpace(input.StartDate)
	endDate := strings.TrimSpace(input.EndDate)
	if startDate == "" {
		if permission == mcpPermissionFull {
			startDate = "0001-01-01"
		} else {
			startDate = mcpRecentStartDate()
		}
	}
	if endDate == "" {
		endDate = today().Format("2006-01-02")
	}
	startDate, err = normalizeMCPDate(startDate)
	if err != nil {
		return nil, mcpGrowthLogsOutput{}, err
	}
	endDate, err = normalizeMCPDate(endDate)
	if err != nil {
		return nil, mcpGrowthLogsOutput{}, err
	}
	if startDate > endDate {
		return nil, mcpGrowthLogsOutput{}, fmt.Errorf("start_date 不能晚于 end_date")
	}
	if permission != mcpPermissionFull {
		recentStart := mcpRecentStartDate()
		recentEnd := today().Format("2006-01-02")
		if startDate < recentStart || endDate > recentEnd {
			return nil, mcpGrowthLogsOutput{}, fmt.Errorf(
				"当前 MCP 权限为%s，只能访问 %s 至 %s 的成长数据",
				permission.label(),
				recentStart,
				recentEnd,
			)
		}
	}
	limit := input.Limit
	if limit <= 0 {
		limit = mcpDefaultListLimit
	}
	if limit > mcpMaxListLimit {
		limit = mcpMaxListLimit
	}
	offset := input.Offset
	if offset < 0 {
		offset = 0
	}
	countRow, err := a.queryOne(ctx,
		"SELECT COUNT(*) AS total FROM weight_logs WHERE recorded_date >= ? AND recorded_date <= ?",
		startDate, endDate)
	if err != nil {
		return nil, mcpGrowthLogsOutput{}, fmt.Errorf("统计成长记录失败: %w", err)
	}
	logs, err := a.queryMaps(ctx,
		`SELECT * FROM weight_logs
		 WHERE recorded_date >= ? AND recorded_date <= ?
		 ORDER BY recorded_date DESC, id DESC LIMIT ? OFFSET ?`,
		startDate, endDate, limit, offset)
	if err != nil {
		return nil, mcpGrowthLogsOutput{}, fmt.Errorf("加载成长记录失败: %w", err)
	}
	total := intValue(countRow["total"])
	return nil, mcpGrowthLogsOutput{
		StartDate: startDate,
		EndDate:   endDate,
		Logs:      logs,
		Total:     total,
		Limit:     limit,
		Offset:    offset,
		HasMore:   int64(offset+len(logs)) < total,
	}, nil
}

type mcpVaccineScheduleOutput struct {
	Schedule []map[string]any `json:"schedule" jsonschema:"完整疫苗计划与接种状态"`
	Overview map[string]any   `json:"overview,omitempty" jsonschema:"疫苗完成和临期汇总"`
	Message  string           `json:"message,omitempty" jsonschema:"需要先处理的问题"`
}

func (a *App) mcpGetVaccineSchedule(ctx context.Context, _ *mcp.CallToolRequest, _ mcpEmptyInput) (*mcp.CallToolResult, mcpVaccineScheduleOutput, error) {
	if _, err := a.requireMCPPermission(ctx, mcpPermissionFull); err != nil {
		return nil, mcpVaccineScheduleOutput{}, err
	}
	schedule, overview, message, err := a.vaccineScheduleData(ctx)
	if err != nil {
		return nil, mcpVaccineScheduleOutput{}, fmt.Errorf("加载疫苗计划失败: %w", err)
	}
	return nil, mcpVaccineScheduleOutput{Schedule: schedule, Overview: overview, Message: message}, nil
}

type mcpHealthScheduleOutput struct {
	Schedule []map[string]any `json:"schedule" jsonschema:"完整健康随访计划与完成状态"`
	Overview map[string]any   `json:"overview,omitempty" jsonschema:"健康随访汇总"`
	Message  string           `json:"message,omitempty" jsonschema:"需要先处理的问题"`
}

func (a *App) mcpGetHealthSchedule(ctx context.Context, _ *mcp.CallToolRequest, _ mcpEmptyInput) (*mcp.CallToolResult, mcpHealthScheduleOutput, error) {
	if _, err := a.requireMCPPermission(ctx, mcpPermissionFull); err != nil {
		return nil, mcpHealthScheduleOutput{}, err
	}
	schedule, overview, message, err := a.healthScheduleData(ctx)
	if err != nil {
		return nil, mcpHealthScheduleOutput{}, fmt.Errorf("加载健康随访计划失败: %w", err)
	}
	return nil, mcpHealthScheduleOutput{Schedule: schedule, Overview: overview, Message: message}, nil
}

type mcpCountdownsOutput struct {
	Countdowns []map[string]any `json:"countdowns" jsonschema:"全部倒数日事件"`
}

func (a *App) mcpListCountdowns(ctx context.Context, _ *mcp.CallToolRequest, _ mcpEmptyInput) (*mcp.CallToolResult, mcpCountdownsOutput, error) {
	if _, err := a.requireMCPPermission(ctx, mcpPermissionFull); err != nil {
		return nil, mcpCountdownsOutput{}, err
	}
	rows, err := a.queryMaps(ctx, "SELECT * FROM countdown_events ORDER BY target_date, id")
	if err != nil {
		return nil, mcpCountdownsOutput{}, fmt.Errorf("加载倒数日失败: %w", err)
	}
	todayDate := today()
	for _, row := range rows {
		target, err := parseDate(stringValue(row["target_date"]))
		if err != nil {
			row["days_left"] = nil
			continue
		}
		row["days_left"] = int(target.Sub(todayDate).Hours() / 24)
	}
	return nil, mcpCountdownsOutput{Countdowns: rows}, nil
}

type mcpSettingsOutput struct {
	Settings map[string]string `json:"settings" jsonschema:"可公开读取的业务设置"`
}

func (a *App) mcpGetSettings(ctx context.Context, _ *mcp.CallToolRequest, _ mcpEmptyInput) (*mcp.CallToolResult, mcpSettingsOutput, error) {
	if _, err := a.requireMCPPermission(ctx, mcpPermissionFull); err != nil {
		return nil, mcpSettingsOutput{}, err
	}
	settings, err := a.settingsMap(ctx)
	if err != nil {
		return nil, mcpSettingsOutput{}, fmt.Errorf("加载设置失败: %w", err)
	}
	for key := range settings {
		if isSensitiveSettingKey(key) || isMCPControlPlaneSetting(key) {
			delete(settings, key)
		}
	}
	return nil, mcpSettingsOutput{Settings: settings}, nil
}

func isMCPControlPlaneSetting(key string) bool {
	switch strings.TrimSpace(key) {
	case mcpEnabledSetting, mcpPermissionSetting:
		return true
	default:
		return false
	}
}

type mcpStatsOutput struct {
	Stats map[string]any `json:"stats" jsonschema:"全量业务统计"`
}

func (a *App) mcpGetStats(ctx context.Context, _ *mcp.CallToolRequest, _ mcpEmptyInput) (*mcp.CallToolResult, mcpStatsOutput, error) {
	if _, err := a.requireMCPPermission(ctx, mcpPermissionFull); err != nil {
		return nil, mcpStatsOutput{}, err
	}
	row, err := a.queryOne(ctx, `
		SELECT COUNT(*) AS total_records,
		       COALESCE(SUM(CASE WHEN type = 'feed' THEN 1 ELSE 0 END), 0) AS total_feeds,
		       COALESCE(SUM(CASE WHEN type = 'feed' THEN amount ELSE 0 END), 0) AS total_ml,
		       COUNT(DISTINCT date(timestamp)) AS tracked_days
		FROM records`)
	if err != nil {
		return nil, mcpStatsOutput{}, fmt.Errorf("加载统计失败: %w", err)
	}
	pending, err := a.queryOne(ctx, "SELECT COUNT(*) AS c FROM users WHERE status = 'pending'")
	if err != nil {
		return nil, mcpStatsOutput{}, fmt.Errorf("加载待审批用户数失败: %w", err)
	}
	return nil, mcpStatsOutput{Stats: map[string]any{
		"total_records": row["total_records"],
		"total_feeds":   row["total_feeds"],
		"total_ml":      round(floatValue(row["total_ml"])),
		"tracked_days":  row["tracked_days"],
		"pending_users": pending["c"],
	}}, nil
}

type mcpUsersOutput struct {
	Users []map[string]any `json:"users" jsonschema:"用户列表，不包含密码哈希"`
}

func (a *App) mcpListUsers(ctx context.Context, _ *mcp.CallToolRequest, _ mcpEmptyInput) (*mcp.CallToolResult, mcpUsersOutput, error) {
	if _, err := a.requireMCPPermission(ctx, mcpPermissionFull); err != nil {
		return nil, mcpUsersOutput{}, err
	}
	users, err := a.queryMaps(ctx,
		"SELECT id, username, nickname, role, status, created_at FROM users ORDER BY created_at DESC, id DESC")
	if err != nil {
		return nil, mcpUsersOutput{}, fmt.Errorf("加载用户失败: %w", err)
	}
	return nil, mcpUsersOutput{Users: users}, nil
}

type mcpAuditLogsInput struct {
	Limit int `json:"limit,omitempty" jsonschema:"返回条数，默认 100，最大 500"`
}

type mcpAuditLogsOutput struct {
	Logs []map[string]any `json:"logs" jsonschema:"审计日志列表"`
}

func (a *App) mcpListAuditLogs(ctx context.Context, _ *mcp.CallToolRequest, input mcpAuditLogsInput) (*mcp.CallToolResult, mcpAuditLogsOutput, error) {
	if _, err := a.requireMCPPermission(ctx, mcpPermissionFull); err != nil {
		return nil, mcpAuditLogsOutput{}, err
	}
	limit := input.Limit
	if limit <= 0 {
		limit = 100
	}
	if limit > 500 {
		limit = 500
	}
	logs, err := a.queryMaps(ctx,
		"SELECT * FROM audit_logs ORDER BY created_at DESC, id DESC LIMIT ?", limit)
	if err != nil {
		return nil, mcpAuditLogsOutput{}, fmt.Errorf("加载操作日志失败: %w", err)
	}
	return nil, mcpAuditLogsOutput{Logs: logs}, nil
}

type mcpGrowthLogInput struct {
	Weight       *float64 `json:"weight,omitempty" jsonschema:"体重，单位 kg"`
	Height       *float64 `json:"height,omitempty" jsonschema:"身高，单位 cm"`
	RecordedDate string   `json:"recorded_date" jsonschema:"记录日期，格式 YYYY-MM-DD"`
	Note         string   `json:"note,omitempty" jsonschema:"备注"`
}

type mcpGrowthLogOutput struct {
	Message string         `json:"message" jsonschema:"操作结果"`
	Log     map[string]any `json:"log,omitempty" jsonschema:"新增后的成长记录"`
}

func (a *App) mcpAddGrowthLog(ctx context.Context, _ *mcp.CallToolRequest, input mcpGrowthLogInput) (*mcp.CallToolResult, mcpGrowthLogOutput, error) {
	if _, err := a.requireMCPPermission(ctx, mcpPermissionAdvanced); err != nil {
		return nil, mcpGrowthLogOutput{}, err
	}
	recordedDate := strings.TrimSpace(input.RecordedDate)
	if recordedDate == "" {
		return nil, mcpGrowthLogOutput{}, fmt.Errorf("recorded_date 不能为空")
	}
	recordedDate, err := normalizeMCPDate(recordedDate)
	if err != nil {
		return nil, mcpGrowthLogOutput{}, err
	}
	if _, err := a.validateMCPDateAccess(ctx, recordedDate); err != nil {
		return nil, mcpGrowthLogOutput{}, err
	}
	if err := validateGrowthValues(input.Weight, input.Height); err != nil {
		return nil, mcpGrowthLogOutput{}, err
	}
	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, mcpGrowthLogOutput{}, fmt.Errorf("记录成长数据失败: %w", err)
	}
	defer tx.Rollback()
	result, err := tx.ExecContext(ctx,
		"INSERT INTO weight_logs (baby_id, weight, height, recorded_date, note) VALUES (1, ?, ?, ?, ?)",
		nullableFloatPointer(input.Weight), nullableFloatPointer(input.Height),
		recordedDate, strings.TrimSpace(input.Note))
	if err == nil {
		err = updateBabyWeightFromLatest(ctx, tx)
	}
	if err == nil {
		err = tx.Commit()
	}
	if err != nil {
		return nil, mcpGrowthLogOutput{}, fmt.Errorf("记录成长数据失败: %w", err)
	}
	id, _ := result.LastInsertId()
	log, err := a.queryOne(ctx, "SELECT * FROM weight_logs WHERE id = ?", id)
	if err != nil {
		return nil, mcpGrowthLogOutput{}, fmt.Errorf("成长记录已创建但加载详情失败: %w", err)
	}
	a.addLog(ctx, mcpServiceActor(), "MCP记录成长数据", "growth_log", id,
		growthLogLabel(pointerFloat(input.Weight), input.Weight != nil, pointerFloat(input.Height), input.Height != nil, recordedDate))
	return nil, mcpGrowthLogOutput{Message: "成长记录已创建", Log: log}, nil
}

func validateGrowthValues(weight, height *float64) error {
	if weight == nil && height == nil {
		return fmt.Errorf("weight 和 height 至少填写一项")
	}
	if weight != nil && (*weight < minGrowthWeight || *weight > maxGrowthWeight) {
		return fmt.Errorf("体重需在 %s-%s 之间", formatNumber(minGrowthWeight), formatNumber(maxGrowthWeight))
	}
	if height != nil && (*height < minGrowthHeight || *height > maxGrowthHeight) {
		return fmt.Errorf("身高需在 %s-%s 之间", formatNumber(minGrowthHeight), formatNumber(maxGrowthHeight))
	}
	return nil
}

func pointerFloat(value *float64) float64 {
	if value == nil {
		return 0
	}
	return *value
}

type mcpVaccineRecordInput struct {
	VaccineName    string `json:"vaccine_name" jsonschema:"疫苗名称"`
	DoseIndex      int    `json:"dose_index" jsonschema:"第几剂，必须大于 0"`
	VaccinatedDate string `json:"vaccinated_date" jsonschema:"接种日期，格式 YYYY-MM-DD"`
	Note           string `json:"note,omitempty" jsonschema:"备注"`
}

func (a *App) mcpRecordVaccine(ctx context.Context, _ *mcp.CallToolRequest, input mcpVaccineRecordInput) (*mcp.CallToolResult, mcpRecordOutput, error) {
	if _, err := a.requireMCPPermission(ctx, mcpPermissionAdvanced); err != nil {
		return nil, mcpRecordOutput{}, err
	}
	name := strings.TrimSpace(input.VaccineName)
	date := strings.TrimSpace(input.VaccinatedDate)
	if name == "" || input.DoseIndex <= 0 || date == "" {
		return nil, mcpRecordOutput{}, fmt.Errorf("vaccine_name、dose_index 和 vaccinated_date 不能为空")
	}
	date, err := normalizeMCPDate(date)
	if err != nil {
		return nil, mcpRecordOutput{}, err
	}
	if _, err := a.validateMCPDateAccess(ctx, date); err != nil {
		return nil, mcpRecordOutput{}, err
	}
	if _, err := a.db.ExecContext(ctx,
		`INSERT OR REPLACE INTO vaccine_records
		 (vaccine_name, dose_index, vaccinated_date, note) VALUES (?, ?, ?, ?)`,
		name, input.DoseIndex, date, strings.TrimSpace(input.Note)); err != nil {
		return nil, mcpRecordOutput{}, fmt.Errorf("记录疫苗失败: %w", err)
	}
	detail := fmt.Sprintf("%s第%d剂 @ %s", name, input.DoseIndex, date)
	a.addLog(ctx, mcpServiceActor(), "MCP记录疫苗", "vaccine", 0, detail)
	return nil, mcpRecordOutput{Message: "疫苗记录已保存", Record: map[string]any{
		"vaccine_name":    name,
		"dose_index":      input.DoseIndex,
		"vaccinated_date": date,
		"note":            strings.TrimSpace(input.Note),
	}}, nil
}

type mcpHealthRecordInput struct {
	Label         string `json:"label" jsonschema:"健康随访名称"`
	CompletedDate string `json:"completed_date,omitempty" jsonschema:"完成日期，格式 YYYY-MM-DD；省略时使用今天"`
	Note          string `json:"note,omitempty" jsonschema:"备注"`
}

func (a *App) mcpRecordHealthFollowup(ctx context.Context, _ *mcp.CallToolRequest, input mcpHealthRecordInput) (*mcp.CallToolResult, mcpRecordOutput, error) {
	if _, err := a.requireMCPPermission(ctx, mcpPermissionAdvanced); err != nil {
		return nil, mcpRecordOutput{}, err
	}
	label := strings.TrimSpace(input.Label)
	date := strings.TrimSpace(input.CompletedDate)
	if label == "" {
		return nil, mcpRecordOutput{}, fmt.Errorf("label 不能为空")
	}
	if date == "" {
		date = today().Format("2006-01-02")
	}
	date, err := normalizeMCPDate(date)
	if err != nil {
		return nil, mcpRecordOutput{}, err
	}
	if _, err := a.validateMCPDateAccess(ctx, date); err != nil {
		return nil, mcpRecordOutput{}, err
	}
	if _, err := a.db.ExecContext(ctx,
		"INSERT OR REPLACE INTO health_followup_records (label, completed_date, note) VALUES (?, ?, ?)",
		label, date, strings.TrimSpace(input.Note)); err != nil {
		return nil, mcpRecordOutput{}, fmt.Errorf("记录健康随访失败: %w", err)
	}
	a.addLog(ctx, mcpServiceActor(), "MCP记录健康随访", "health", 0, label+" @ "+date)
	return nil, mcpRecordOutput{Message: "健康随访已记录", Record: map[string]any{
		"label":          label,
		"completed_date": date,
		"note":           strings.TrimSpace(input.Note),
	}}, nil
}

type mcpUpdateBabyInput struct {
	Name        *string  `json:"name,omitempty" jsonschema:"宝宝姓名"`
	Gender      *string  `json:"gender,omitempty" jsonschema:"性别：male 或 female"`
	BirthDate   *string  `json:"birth_date,omitempty" jsonschema:"出生日期，格式 YYYY-MM-DD"`
	Weight      *float64 `json:"weight,omitempty" jsonschema:"当前体重，单位 kg"`
	IsPremature *bool    `json:"is_premature,omitempty" jsonschema:"是否早产儿"`
}

type mcpBabyUpdateOutput struct {
	Message string         `json:"message" jsonschema:"操作结果"`
	Baby    map[string]any `json:"baby" jsonschema:"修改后的宝宝资料"`
}

func (a *App) mcpUpdateBaby(ctx context.Context, _ *mcp.CallToolRequest, input mcpUpdateBabyInput) (*mcp.CallToolResult, mcpBabyUpdateOutput, error) {
	if _, err := a.requireMCPPermission(ctx, mcpPermissionFull); err != nil {
		return nil, mcpBabyUpdateOutput{}, err
	}
	baby, err := a.queryOne(ctx, "SELECT * FROM babies ORDER BY id LIMIT 1")
	if isNoRows(err) {
		return nil, mcpBabyUpdateOutput{}, fmt.Errorf("尚未配置宝宝资料")
	}
	if err != nil {
		return nil, mcpBabyUpdateOutput{}, fmt.Errorf("加载宝宝资料失败: %w", err)
	}
	updates := make([]string, 0, 5)
	args := make([]any, 0, 6)
	if input.Name != nil {
		name := strings.TrimSpace(*input.Name)
		if name == "" {
			return nil, mcpBabyUpdateOutput{}, fmt.Errorf("name 不能为空")
		}
		updates = append(updates, "name = ?")
		args = append(args, name)
	}
	if input.Gender != nil {
		gender := strings.ToLower(strings.TrimSpace(*input.Gender))
		if gender != "male" && gender != "female" {
			return nil, mcpBabyUpdateOutput{}, fmt.Errorf("gender 必须是 male 或 female")
		}
		updates = append(updates, "gender = ?")
		args = append(args, gender)
	}
	if input.BirthDate != nil {
		birthDate := strings.TrimSpace(*input.BirthDate)
		if _, err := parseDate(birthDate); err != nil {
			return nil, mcpBabyUpdateOutput{}, fmt.Errorf("birth_date 格式无效")
		}
		updates = append(updates, "birth_date = ?")
		args = append(args, birthDate)
	}
	if input.Weight != nil {
		if *input.Weight <= 0 || *input.Weight > maxGrowthWeight {
			return nil, mcpBabyUpdateOutput{}, fmt.Errorf("weight 必须是有效正数")
		}
		updates = append(updates, "weight = ?")
		args = append(args, *input.Weight)
	}
	if input.IsPremature != nil {
		updates = append(updates, "is_premature = ?")
		args = append(args, boolInt(*input.IsPremature))
	}
	if len(updates) == 0 {
		return nil, mcpBabyUpdateOutput{Message: "没有可更新的字段", Baby: baby}, nil
	}
	args = append(args, intValue(baby["id"]))
	if _, err := a.db.ExecContext(ctx,
		"UPDATE babies SET "+strings.Join(updates, ", ")+" WHERE id = ?", args...); err != nil {
		return nil, mcpBabyUpdateOutput{}, fmt.Errorf("更新宝宝资料失败: %w", err)
	}
	updated, err := a.queryOne(ctx, "SELECT * FROM babies WHERE id = ?", intValue(baby["id"]))
	if err != nil {
		return nil, mcpBabyUpdateOutput{}, fmt.Errorf("加载更新后的宝宝资料失败: %w", err)
	}
	a.addLog(ctx, mcpServiceActor(), "MCP修改婴儿信息", "baby", intValue(baby["id"]), "")
	return nil, mcpBabyUpdateOutput{Message: "宝宝资料已更新", Baby: updated}, nil
}

func boolInt(value bool) int {
	if value {
		return 1
	}
	return 0
}

type mcpManageRecordsInput struct {
	Action      string   `json:"action" jsonschema:"操作：update 或 delete"`
	RecordID    int64    `json:"record_id" jsonschema:"记录 ID"`
	Type        *string  `json:"type,omitempty" jsonschema:"记录类型"`
	SubType     *string  `json:"sub_type,omitempty" jsonschema:"记录子类型"`
	Amount      *float64 `json:"amount,omitempty" jsonschema:"数量"`
	Duration    *int     `json:"duration,omitempty" jsonschema:"持续时间，单位分钟"`
	Color       *string  `json:"color,omitempty" jsonschema:"颜色描述"`
	Consistency *string  `json:"consistency,omitempty" jsonschema:"性状描述"`
	Temperature *float64 `json:"temperature,omitempty" jsonschema:"体温，单位摄氏度"`
	Note        *string  `json:"note,omitempty" jsonschema:"备注"`
	Timestamp   *string  `json:"timestamp,omitempty" jsonschema:"记录时间，格式 YYYY-MM-DD HH:MM:SS 或 RFC3339"`
	FoodUnit    *string  `json:"food_unit,omitempty" jsonschema:"辅食单位"`
}

type mcpMutationOutput struct {
	Message string         `json:"message" jsonschema:"操作结果"`
	Record  map[string]any `json:"record,omitempty" jsonschema:"更新后的记录"`
}

func (a *App) mcpManageRecords(ctx context.Context, _ *mcp.CallToolRequest, input mcpManageRecordsInput) (*mcp.CallToolResult, mcpMutationOutput, error) {
	if _, err := a.requireMCPPermission(ctx, mcpPermissionFull); err != nil {
		return nil, mcpMutationOutput{}, err
	}
	if input.RecordID <= 0 {
		return nil, mcpMutationOutput{}, fmt.Errorf("record_id 必须是正整数")
	}
	existing, err := a.queryOne(ctx, "SELECT * FROM records WHERE id = ?", input.RecordID)
	if isNoRows(err) {
		return nil, mcpMutationOutput{}, fmt.Errorf("记录不存在")
	}
	if err != nil {
		return nil, mcpMutationOutput{}, fmt.Errorf("加载记录失败: %w", err)
	}
	switch strings.ToLower(strings.TrimSpace(input.Action)) {
	case "delete":
		if _, err := a.db.ExecContext(ctx, "DELETE FROM records WHERE id = ?", input.RecordID); err != nil {
			return nil, mcpMutationOutput{}, fmt.Errorf("删除记录失败: %w", err)
		}
		a.addLog(ctx, mcpServiceActor(), "MCP删除记录", "record", input.RecordID,
			fmt.Sprintf("%s/%s", stringValue(existing["type"]), stringValue(existing["sub_type"])))
		return nil, mcpMutationOutput{Message: "记录已删除"}, nil
	case "update":
		fields := make([]string, 0, 10)
		args := make([]any, 0, 11)
		if input.Type != nil {
			recordType := strings.TrimSpace(*input.Type)
			if !validRecordType(recordType) {
				return nil, mcpMutationOutput{}, fmt.Errorf("无效的记录类型")
			}
			fields = append(fields, "type = ?")
			args = append(args, recordType)
		}
		if input.SubType != nil {
			subType := strings.TrimSpace(*input.SubType)
			if subType == "" {
				return nil, mcpMutationOutput{}, fmt.Errorf("sub_type 不能为空")
			}
			fields = append(fields, "sub_type = ?")
			args = append(args, subType)
		}
		if input.Amount != nil {
			fields = append(fields, "amount = ?")
			args = append(args, *input.Amount)
		}
		if input.Duration != nil {
			fields = append(fields, "duration = ?")
			args = append(args, *input.Duration)
		}
		if input.Color != nil {
			fields = append(fields, "color = ?")
			args = append(args, strings.TrimSpace(*input.Color))
		}
		if input.Consistency != nil {
			fields = append(fields, "consistency = ?")
			args = append(args, strings.TrimSpace(*input.Consistency))
		}
		if input.Temperature != nil {
			fields = append(fields, "temperature = ?")
			args = append(args, *input.Temperature)
		}
		if input.Note != nil {
			fields = append(fields, "note = ?")
			args = append(args, strings.TrimSpace(*input.Note))
		}
		if input.Timestamp != nil {
			timestamp, err := normalizeMCPTimestamp(*input.Timestamp)
			if err != nil {
				return nil, mcpMutationOutput{}, err
			}
			fields = append(fields, "timestamp = ?")
			args = append(args, timestamp)
		}
		if input.FoodUnit != nil {
			fields = append(fields, "food_unit = ?")
			args = append(args, strings.TrimSpace(*input.FoodUnit))
		}
		if len(fields) == 0 {
			return nil, mcpMutationOutput{Message: "没有可更新的字段", Record: existing}, nil
		}
		args = append(args, input.RecordID)
		if _, err := a.db.ExecContext(ctx,
			"UPDATE records SET "+strings.Join(fields, ", ")+" WHERE id = ?", args...); err != nil {
			return nil, mcpMutationOutput{}, fmt.Errorf("更新记录失败: %w", err)
		}
		updated, err := a.queryOne(ctx, "SELECT * FROM records WHERE id = ?", input.RecordID)
		if err != nil {
			return nil, mcpMutationOutput{}, fmt.Errorf("加载更新后的记录失败: %w", err)
		}
		detail, _ := json.Marshal(input)
		a.addLog(ctx, mcpServiceActor(), "MCP编辑记录", "record", input.RecordID, string(detail))
		return nil, mcpMutationOutput{Message: "记录已更新", Record: updated}, nil
	default:
		return nil, mcpMutationOutput{}, fmt.Errorf("action 必须是 update 或 delete")
	}
}

type mcpManageQuickButtonsInput struct {
	Action    string   `json:"action" jsonschema:"操作：create、update、reorder 或 delete"`
	ButtonID  int64    `json:"button_id,omitempty" jsonschema:"按钮 ID；update/delete 需要"`
	Type      *string  `json:"type,omitempty" jsonschema:"记录类型"`
	SubType   *string  `json:"sub_type,omitempty" jsonschema:"记录子类型"`
	Label     *string  `json:"label,omitempty" jsonschema:"显示标签"`
	Amount    *float64 `json:"amount,omitempty" jsonschema:"预设数量"`
	SortOrder *int     `json:"sort_order,omitempty" jsonschema:"排序值"`
	IsActive  *bool    `json:"is_active,omitempty" jsonschema:"是否启用"`
	FoodUnit  *string  `json:"food_unit,omitempty" jsonschema:"辅食单位"`
	ButtonIDs []int64  `json:"button_ids,omitempty" jsonschema:"reorder 时的完整按钮 ID 顺序"`
}

type mcpQuickButtonOutput struct {
	Message string         `json:"message" jsonschema:"操作结果"`
	Button  map[string]any `json:"button,omitempty" jsonschema:"创建或修改后的按钮"`
}

func (a *App) mcpManageQuickButtons(ctx context.Context, _ *mcp.CallToolRequest, input mcpManageQuickButtonsInput) (*mcp.CallToolResult, mcpQuickButtonOutput, error) {
	if _, err := a.requireMCPPermission(ctx, mcpPermissionFull); err != nil {
		return nil, mcpQuickButtonOutput{}, err
	}
	action := strings.ToLower(strings.TrimSpace(input.Action))
	switch action {
	case "create":
		recordType := pointerString(input.Type)
		subType := pointerString(input.SubType)
		label := pointerString(input.Label)
		if !validRecordType(recordType) || strings.TrimSpace(subType) == "" || strings.TrimSpace(label) == "" {
			return nil, mcpQuickButtonOutput{}, fmt.Errorf("create 需要有效的 type、sub_type 和 label")
		}
		sortOrder := 0
		if input.SortOrder != nil {
			sortOrder = *input.SortOrder
		}
		amount := pointerFloat(input.Amount)
		foodUnit := pointerString(input.FoodUnit)
		tx, err := a.db.BeginTx(ctx, nil)
		if err != nil {
			return nil, mcpQuickButtonOutput{}, fmt.Errorf("创建按钮失败: %w", err)
		}
		defer tx.Rollback()
		if _, err := tx.ExecContext(ctx,
			"UPDATE quick_buttons SET sort_order = sort_order + 1 WHERE sort_order >= ?", sortOrder); err != nil {
			return nil, mcpQuickButtonOutput{}, fmt.Errorf("创建按钮失败: %w", err)
		}
		result, err := tx.ExecContext(ctx,
			`INSERT INTO quick_buttons
			 (type, sub_type, label, amount, sort_order, is_active, food_unit)
			 VALUES (?, ?, ?, ?, ?, 1, ?)`,
			recordType, strings.TrimSpace(subType), strings.TrimSpace(label), amount, sortOrder, foodUnit)
		if err == nil {
			err = tx.Commit()
		}
		if err != nil {
			return nil, mcpQuickButtonOutput{}, fmt.Errorf("创建按钮失败: %w", err)
		}
		id, _ := result.LastInsertId()
		button, _ := a.queryOne(ctx, "SELECT * FROM quick_buttons WHERE id = ?", id)
		a.addLog(ctx, mcpServiceActor(), "MCP添加按钮", "quick_button", id, strings.TrimSpace(label))
		return nil, mcpQuickButtonOutput{Message: "按钮已创建", Button: button}, nil
	case "update":
		if input.ButtonID <= 0 {
			return nil, mcpQuickButtonOutput{}, fmt.Errorf("button_id 必须是正整数")
		}
		existing, err := a.queryOne(ctx, "SELECT * FROM quick_buttons WHERE id = ?", input.ButtonID)
		if isNoRows(err) {
			return nil, mcpQuickButtonOutput{}, fmt.Errorf("按钮不存在")
		}
		if err != nil {
			return nil, mcpQuickButtonOutput{}, fmt.Errorf("加载按钮失败: %w", err)
		}
		fields := make([]string, 0, 7)
		args := make([]any, 0, 8)
		if input.Type != nil {
			recordType := strings.TrimSpace(*input.Type)
			if !validRecordType(recordType) {
				return nil, mcpQuickButtonOutput{}, fmt.Errorf("无效的记录类型")
			}
			fields = append(fields, "type = ?")
			args = append(args, recordType)
		}
		if input.SubType != nil {
			subType := strings.TrimSpace(*input.SubType)
			if subType == "" {
				return nil, mcpQuickButtonOutput{}, fmt.Errorf("sub_type 不能为空")
			}
			fields = append(fields, "sub_type = ?")
			args = append(args, subType)
		}
		if input.Label != nil {
			label := strings.TrimSpace(*input.Label)
			if label == "" {
				return nil, mcpQuickButtonOutput{}, fmt.Errorf("label 不能为空")
			}
			fields = append(fields, "label = ?")
			args = append(args, label)
		}
		if input.Amount != nil {
			fields = append(fields, "amount = ?")
			args = append(args, *input.Amount)
		}
		if input.SortOrder != nil {
			fields = append(fields, "sort_order = ?")
			args = append(args, *input.SortOrder)
		}
		if input.IsActive != nil {
			fields = append(fields, "is_active = ?")
			args = append(args, boolInt(*input.IsActive))
		}
		if input.FoodUnit != nil {
			fields = append(fields, "food_unit = ?")
			args = append(args, strings.TrimSpace(*input.FoodUnit))
		}
		if len(fields) == 0 {
			return nil, mcpQuickButtonOutput{Message: "没有可更新的字段", Button: existing}, nil
		}
		tx, err := a.db.BeginTx(ctx, nil)
		if err != nil {
			return nil, mcpQuickButtonOutput{}, fmt.Errorf("更新按钮失败: %w", err)
		}
		defer tx.Rollback()
		if input.SortOrder != nil {
			oldOrder := intValue(existing["sort_order"])
			newOrder := int64(*input.SortOrder)
			if oldOrder != newOrder {
				if newOrder > oldOrder {
					_, err = tx.ExecContext(ctx,
						"UPDATE quick_buttons SET sort_order = sort_order - 1 WHERE sort_order > ? AND sort_order <= ? AND id != ?",
						oldOrder, newOrder, input.ButtonID)
				} else {
					_, err = tx.ExecContext(ctx,
						"UPDATE quick_buttons SET sort_order = sort_order + 1 WHERE sort_order >= ? AND sort_order < ? AND id != ?",
						newOrder, oldOrder, input.ButtonID)
				}
			}
		}
		if err == nil {
			args = append(args, input.ButtonID)
			_, err = tx.ExecContext(ctx,
				"UPDATE quick_buttons SET "+strings.Join(fields, ", ")+" WHERE id = ?", args...)
		}
		if err == nil {
			err = tx.Commit()
		}
		if err != nil {
			return nil, mcpQuickButtonOutput{}, fmt.Errorf("更新按钮失败: %w", err)
		}
		button, err := a.queryOne(ctx, "SELECT * FROM quick_buttons WHERE id = ?", input.ButtonID)
		if err != nil {
			return nil, mcpQuickButtonOutput{}, fmt.Errorf("加载更新后的按钮失败: %w", err)
		}
		a.addLog(ctx, mcpServiceActor(), "MCP修改按钮", "quick_button", input.ButtonID, stringValue(button["label"]))
		return nil, mcpQuickButtonOutput{Message: "按钮已更新", Button: button}, nil
	case "reorder":
		if len(input.ButtonIDs) == 0 {
			return nil, mcpQuickButtonOutput{}, fmt.Errorf("button_ids 不能为空")
		}
		tx, err := a.db.BeginTx(ctx, nil)
		if err != nil {
			return nil, mcpQuickButtonOutput{}, fmt.Errorf("更新排序失败: %w", err)
		}
		defer tx.Rollback()
		for index, id := range input.ButtonIDs {
			if id <= 0 {
				return nil, mcpQuickButtonOutput{}, fmt.Errorf("button_ids 只能包含正整数")
			}
			if _, err := tx.ExecContext(ctx,
				"UPDATE quick_buttons SET sort_order = ? WHERE id = ?", index+1, id); err != nil {
				return nil, mcpQuickButtonOutput{}, fmt.Errorf("更新排序失败: %w", err)
			}
		}
		if err := tx.Commit(); err != nil {
			return nil, mcpQuickButtonOutput{}, fmt.Errorf("更新排序失败: %w", err)
		}
		a.addLog(ctx, mcpServiceActor(), "MCP按钮排序", "quick_button", 0, fmt.Sprintf("%d个按钮", len(input.ButtonIDs)))
		return nil, mcpQuickButtonOutput{Message: "按钮排序已更新"}, nil
	case "delete":
		if input.ButtonID <= 0 {
			return nil, mcpQuickButtonOutput{}, fmt.Errorf("button_id 必须是正整数")
		}
		existing, err := a.queryOne(ctx, "SELECT sort_order, label FROM quick_buttons WHERE id = ?", input.ButtonID)
		if isNoRows(err) {
			return nil, mcpQuickButtonOutput{}, fmt.Errorf("按钮不存在")
		}
		if err != nil {
			return nil, mcpQuickButtonOutput{}, fmt.Errorf("加载按钮失败: %w", err)
		}
		tx, err := a.db.BeginTx(ctx, nil)
		if err != nil {
			return nil, mcpQuickButtonOutput{}, fmt.Errorf("删除按钮失败: %w", err)
		}
		defer tx.Rollback()
		if _, err := tx.ExecContext(ctx, "DELETE FROM quick_buttons WHERE id = ?", input.ButtonID); err != nil {
			return nil, mcpQuickButtonOutput{}, fmt.Errorf("删除按钮失败: %w", err)
		}
		if _, err := tx.ExecContext(ctx,
			"UPDATE quick_buttons SET sort_order = sort_order - 1 WHERE sort_order > ?",
			intValue(existing["sort_order"])); err != nil {
			return nil, mcpQuickButtonOutput{}, fmt.Errorf("删除按钮失败: %w", err)
		}
		if err := tx.Commit(); err != nil {
			return nil, mcpQuickButtonOutput{}, fmt.Errorf("删除按钮失败: %w", err)
		}
		a.addLog(ctx, mcpServiceActor(), "MCP删除按钮", "quick_button", input.ButtonID, stringValue(existing["label"]))
		return nil, mcpQuickButtonOutput{Message: "按钮已删除"}, nil
	default:
		return nil, mcpQuickButtonOutput{}, fmt.Errorf("action 必须是 create、update、reorder 或 delete")
	}
}

func pointerString(value *string) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(*value)
}

type mcpSettingValue struct {
	Key   string `json:"key" jsonschema:"设置键"`
	Value string `json:"value" jsonschema:"设置值"`
}

type mcpUpdateSettingsInput struct {
	Settings []mcpSettingValue `json:"settings" jsonschema:"要更新的设置项列表"`
}

func (a *App) mcpUpdateSettings(ctx context.Context, _ *mcp.CallToolRequest, input mcpUpdateSettingsInput) (*mcp.CallToolResult, mcpSettingsOutput, error) {
	if _, err := a.requireMCPPermission(ctx, mcpPermissionFull); err != nil {
		return nil, mcpSettingsOutput{}, err
	}
	if len(input.Settings) == 0 {
		return nil, mcpSettingsOutput{}, fmt.Errorf("settings 不能为空")
	}
	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, mcpSettingsOutput{}, fmt.Errorf("更新设置失败: %w", err)
	}
	defer tx.Rollback()
	keys := make([]string, 0, len(input.Settings))
	for _, setting := range input.Settings {
		key := strings.TrimSpace(setting.Key)
		if key == "" {
			continue
		}
		if isMCPControlPlaneSetting(key) || isSensitiveSettingKey(key) {
			return nil, mcpSettingsOutput{}, fmt.Errorf("设置 %s 不能通过 MCP 修改", key)
		}
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO settings (key, value) VALUES (?, ?)
			 ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now','localtime')`,
			key, setting.Value); err != nil {
			return nil, mcpSettingsOutput{}, fmt.Errorf("更新设置失败: %w", err)
		}
		keys = append(keys, key)
	}
	if len(keys) == 0 {
		return nil, mcpSettingsOutput{}, fmt.Errorf("settings 不能为空")
	}
	if err := tx.Commit(); err != nil {
		return nil, mcpSettingsOutput{}, fmt.Errorf("更新设置失败: %w", err)
	}
	sort.Strings(keys)
	a.addLog(ctx, mcpServiceActor(), "MCP修改设置", "settings", 0, strings.Join(keys, ","))
	settings, err := a.settingsMap(ctx)
	if err != nil {
		return nil, mcpSettingsOutput{}, fmt.Errorf("加载设置失败: %w", err)
	}
	for key := range settings {
		if isSensitiveSettingKey(key) || isMCPControlPlaneSetting(key) {
			delete(settings, key)
		}
	}
	return nil, mcpSettingsOutput{Settings: settings}, nil
}

type mcpManageGrowthLogsInput struct {
	Action       string   `json:"action" jsonschema:"操作：update 或 delete"`
	LogID        int64    `json:"log_id" jsonschema:"成长记录 ID"`
	Weight       *float64 `json:"weight,omitempty" jsonschema:"体重，单位 kg"`
	Height       *float64 `json:"height,omitempty" jsonschema:"身高，单位 cm"`
	RecordedDate *string  `json:"recorded_date,omitempty" jsonschema:"记录日期，格式 YYYY-MM-DD"`
	Note         *string  `json:"note,omitempty" jsonschema:"备注"`
}

func (a *App) mcpManageGrowthLogs(ctx context.Context, _ *mcp.CallToolRequest, input mcpManageGrowthLogsInput) (*mcp.CallToolResult, mcpGrowthLogOutput, error) {
	if _, err := a.requireMCPPermission(ctx, mcpPermissionFull); err != nil {
		return nil, mcpGrowthLogOutput{}, err
	}
	if input.LogID <= 0 {
		return nil, mcpGrowthLogOutput{}, fmt.Errorf("log_id 必须是正整数")
	}
	existing, err := a.queryOne(ctx, "SELECT * FROM weight_logs WHERE id = ?", input.LogID)
	if isNoRows(err) {
		return nil, mcpGrowthLogOutput{}, fmt.Errorf("成长记录不存在")
	}
	if err != nil {
		return nil, mcpGrowthLogOutput{}, fmt.Errorf("加载成长记录失败: %w", err)
	}
	action := strings.ToLower(strings.TrimSpace(input.Action))
	if action == "delete" {
		tx, err := a.db.BeginTx(ctx, nil)
		if err != nil {
			return nil, mcpGrowthLogOutput{}, fmt.Errorf("删除成长数据失败: %w", err)
		}
		defer tx.Rollback()
		if _, err := tx.ExecContext(ctx, "DELETE FROM weight_logs WHERE id = ?", input.LogID); err != nil {
			return nil, mcpGrowthLogOutput{}, fmt.Errorf("删除成长数据失败: %w", err)
		}
		if err := updateBabyWeightFromLatest(ctx, tx); err != nil {
			return nil, mcpGrowthLogOutput{}, fmt.Errorf("更新宝宝体重失败: %w", err)
		}
		if err := tx.Commit(); err != nil {
			return nil, mcpGrowthLogOutput{}, fmt.Errorf("删除成长数据失败: %w", err)
		}
		a.addLog(ctx, mcpServiceActor(), "MCP删除成长数据", "growth_log", input.LogID, "")
		return nil, mcpGrowthLogOutput{Message: "成长记录已删除"}, nil
	}
	if action != "update" {
		return nil, mcpGrowthLogOutput{}, fmt.Errorf("action 必须是 update 或 delete")
	}
	weight := existing["weight"]
	height := existing["height"]
	if input.Weight != nil {
		if *input.Weight < minGrowthWeight || *input.Weight > maxGrowthWeight {
			return nil, mcpGrowthLogOutput{}, fmt.Errorf("体重需在 %s-%s 之间", formatNumber(minGrowthWeight), formatNumber(maxGrowthWeight))
		}
		weight = *input.Weight
	}
	if input.Height != nil {
		if *input.Height < minGrowthHeight || *input.Height > maxGrowthHeight {
			return nil, mcpGrowthLogOutput{}, fmt.Errorf("身高需在 %s-%s 之间", formatNumber(minGrowthHeight), formatNumber(maxGrowthHeight))
		}
		height = *input.Height
	}
	if weight == nil && height == nil {
		return nil, mcpGrowthLogOutput{}, fmt.Errorf("weight 和 height 至少保留一项")
	}
	recordedDate := stringValue(existing["recorded_date"])
	if input.RecordedDate != nil {
		recordedDate = strings.TrimSpace(*input.RecordedDate)
		if _, err := parseDate(recordedDate); err != nil {
			return nil, mcpGrowthLogOutput{}, fmt.Errorf("recorded_date 格式无效")
		}
	}
	note := stringValue(existing["note"])
	if input.Note != nil {
		note = strings.TrimSpace(*input.Note)
	}
	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, mcpGrowthLogOutput{}, fmt.Errorf("更新成长数据失败: %w", err)
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx,
		"UPDATE weight_logs SET weight = ?, height = ?, recorded_date = ?, note = ? WHERE id = ?",
		weight, height, recordedDate, note, input.LogID); err != nil {
		return nil, mcpGrowthLogOutput{}, fmt.Errorf("更新成长数据失败: %w", err)
	}
	if err := updateBabyWeightFromLatest(ctx, tx); err != nil {
		return nil, mcpGrowthLogOutput{}, fmt.Errorf("更新宝宝体重失败: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return nil, mcpGrowthLogOutput{}, fmt.Errorf("更新成长数据失败: %w", err)
	}
	updated, err := a.queryOne(ctx, "SELECT * FROM weight_logs WHERE id = ?", input.LogID)
	if err != nil {
		return nil, mcpGrowthLogOutput{}, fmt.Errorf("加载更新后的成长记录失败: %w", err)
	}
	a.addLog(ctx, mcpServiceActor(), "MCP编辑成长数据", "growth_log", input.LogID, recordedDate)
	return nil, mcpGrowthLogOutput{Message: "成长记录已更新", Log: updated}, nil
}

type mcpVaccineDose struct {
	DoseIndex int    `json:"dose_index" jsonschema:"第几剂，必须大于 0"`
	DueDate   string `json:"due_date" jsonschema:"计划或接种日期，格式 YYYY-MM-DD"`
	Note      string `json:"note,omitempty" jsonschema:"备注"`
}

type mcpManageVaccinesInput struct {
	Action        string           `json:"action" jsonschema:"操作：delete_record、set_plan_date、delete_plan、add_custom_plan 或 delete_custom_plan"`
	VaccineName   string           `json:"vaccine_name,omitempty" jsonschema:"疫苗名称"`
	DoseIndex     int              `json:"dose_index,omitempty" jsonschema:"第几剂"`
	CustomDueDate string           `json:"custom_due_date,omitempty" jsonschema:"计划日期，格式 YYYY-MM-DD"`
	Doses         []mcpVaccineDose `json:"doses,omitempty" jsonschema:"自定义疫苗计划剂次"`
}

func (a *App) mcpManageVaccines(ctx context.Context, _ *mcp.CallToolRequest, input mcpManageVaccinesInput) (*mcp.CallToolResult, mcpMutationOutput, error) {
	if _, err := a.requireMCPPermission(ctx, mcpPermissionFull); err != nil {
		return nil, mcpMutationOutput{}, err
	}
	action := strings.ToLower(strings.TrimSpace(input.Action))
	name := strings.TrimSpace(input.VaccineName)
	switch action {
	case "delete_record":
		if name == "" || input.DoseIndex <= 0 {
			return nil, mcpMutationOutput{}, fmt.Errorf("vaccine_name 和 dose_index 不能为空")
		}
		if _, err := a.db.ExecContext(ctx,
			"DELETE FROM vaccine_records WHERE vaccine_name = ? AND dose_index = ?",
			name, input.DoseIndex); err != nil {
			return nil, mcpMutationOutput{}, fmt.Errorf("删除疫苗记录失败: %w", err)
		}
		a.addLog(ctx, mcpServiceActor(), "MCP删除疫苗记录", "vaccine", 0,
			fmt.Sprintf("%s第%d剂", name, input.DoseIndex))
		return nil, mcpMutationOutput{Message: "疫苗记录已删除"}, nil
	case "set_plan_date":
		date := strings.TrimSpace(input.CustomDueDate)
		if name == "" || input.DoseIndex <= 0 {
			return nil, mcpMutationOutput{}, fmt.Errorf("vaccine_name 和 dose_index 不能为空")
		}
		if _, err := parseDate(date); err != nil {
			return nil, mcpMutationOutput{}, fmt.Errorf("custom_due_date 格式无效")
		}
		record, err := a.queryOne(ctx,
			"SELECT id FROM vaccine_records WHERE vaccine_name = ? AND dose_index = ?", name, input.DoseIndex)
		if err != nil && !isNoRows(err) {
			return nil, mcpMutationOutput{}, fmt.Errorf("加载疫苗记录失败: %w", err)
		}
		if record != nil {
			return nil, mcpMutationOutput{}, fmt.Errorf("已接种的项目不能修改计划日期")
		}
		custom, err := a.queryOne(ctx,
			"SELECT id FROM vaccine_custom_plans WHERE vaccine_name = ? AND dose_index = ?", name, input.DoseIndex)
		if err != nil && !isNoRows(err) {
			return nil, mcpMutationOutput{}, fmt.Errorf("加载自定义疫苗计划失败: %w", err)
		}
		if custom != nil {
			_, err = a.db.ExecContext(ctx,
				"UPDATE vaccine_custom_plans SET due_date = ? WHERE vaccine_name = ? AND dose_index = ?",
				date, name, input.DoseIndex)
		} else {
			_, err = a.db.ExecContext(ctx,
				"INSERT OR REPLACE INTO vaccine_plan_overrides (vaccine_name, dose_index, custom_due_date) VALUES (?, ?, ?)",
				name, input.DoseIndex, date)
		}
		if err != nil {
			return nil, mcpMutationOutput{}, fmt.Errorf("修改计划日期失败: %w", err)
		}
		a.addLog(ctx, mcpServiceActor(), "MCP修改疫苗计划", "vaccine", 0,
			fmt.Sprintf("%s第%d剂 → %s", name, input.DoseIndex, date))
		return nil, mcpMutationOutput{Message: "疫苗计划日期已更新"}, nil
	case "delete_plan":
		if name == "" || input.DoseIndex <= 0 {
			return nil, mcpMutationOutput{}, fmt.Errorf("vaccine_name 和 dose_index 不能为空")
		}
		record, err := a.queryOne(ctx,
			"SELECT id FROM vaccine_records WHERE vaccine_name = ? AND dose_index = ?", name, input.DoseIndex)
		if err != nil && !isNoRows(err) {
			return nil, mcpMutationOutput{}, fmt.Errorf("加载疫苗记录失败: %w", err)
		}
		if record != nil {
			return nil, mcpMutationOutput{}, fmt.Errorf("已接种的项目不能删除计划")
		}
		tx, err := a.db.BeginTx(ctx, nil)
		if err != nil {
			return nil, mcpMutationOutput{}, fmt.Errorf("删除疫苗计划失败: %w", err)
		}
		defer tx.Rollback()
		if _, err := tx.ExecContext(ctx,
			"INSERT OR IGNORE INTO vaccine_plan_deleted (vaccine_name, dose_index) VALUES (?, ?)",
			name, input.DoseIndex); err != nil {
			return nil, mcpMutationOutput{}, fmt.Errorf("删除疫苗计划失败: %w", err)
		}
		if _, err := tx.ExecContext(ctx,
			"DELETE FROM vaccine_plan_overrides WHERE vaccine_name = ? AND dose_index = ?",
			name, input.DoseIndex); err != nil {
			return nil, mcpMutationOutput{}, fmt.Errorf("删除疫苗计划失败: %w", err)
		}
		if err := tx.Commit(); err != nil {
			return nil, mcpMutationOutput{}, fmt.Errorf("删除疫苗计划失败: %w", err)
		}
		a.addLog(ctx, mcpServiceActor(), "MCP删除疫苗计划", "vaccine", 0,
			fmt.Sprintf("%s第%d剂", name, input.DoseIndex))
		return nil, mcpMutationOutput{Message: "疫苗计划已删除"}, nil
	case "add_custom_plan":
		if name == "" || len(input.Doses) == 0 {
			return nil, mcpMutationOutput{}, fmt.Errorf("add_custom_plan 需要 vaccine_name 和 doses")
		}
		tx, err := a.db.BeginTx(ctx, nil)
		if err != nil {
			return nil, mcpMutationOutput{}, fmt.Errorf("添加疫苗计划失败: %w", err)
		}
		defer tx.Rollback()
		todayString := today().Format("2006-01-02")
		added := 0
		for _, dose := range input.Doses {
			doseIndex := dose.DoseIndex
			if doseIndex <= 0 {
				return nil, mcpMutationOutput{}, fmt.Errorf("doses.dose_index 必须是正整数")
			}
			dueDate := strings.TrimSpace(dose.DueDate)
			if _, err := parseDate(dueDate); err != nil {
				return nil, mcpMutationOutput{}, fmt.Errorf("doses.due_date 格式无效")
			}
			if dueDate == todayString {
				_, err = tx.ExecContext(ctx,
					`INSERT OR REPLACE INTO vaccine_records
					 (vaccine_name, dose_index, vaccinated_date, note) VALUES (?, ?, ?, ?)`,
					name, doseIndex, dueDate, strings.TrimSpace(dose.Note))
			} else {
				_, err = tx.ExecContext(ctx,
					`INSERT OR REPLACE INTO vaccine_custom_plans
					 (vaccine_name, dose_index, due_date, note) VALUES (?, ?, ?, ?)`,
					name, doseIndex, dueDate, strings.TrimSpace(dose.Note))
			}
			if err != nil {
				return nil, mcpMutationOutput{}, fmt.Errorf("添加疫苗计划失败: %w", err)
			}
			added++
		}
		if err := tx.Commit(); err != nil {
			return nil, mcpMutationOutput{}, fmt.Errorf("添加疫苗计划失败: %w", err)
		}
		a.addLog(ctx, mcpServiceActor(), "MCP添加疫苗计划", "vaccine", 0,
			fmt.Sprintf("%s %d剂", name, added))
		return nil, mcpMutationOutput{Message: fmt.Sprintf("已添加 %d 剂", added)}, nil
	case "delete_custom_plan":
		if name == "" || input.DoseIndex <= 0 {
			return nil, mcpMutationOutput{}, fmt.Errorf("vaccine_name 和 dose_index 不能为空")
		}
		if _, err := a.db.ExecContext(ctx,
			"DELETE FROM vaccine_custom_plans WHERE vaccine_name = ? AND dose_index = ?",
			name, input.DoseIndex); err != nil {
			return nil, mcpMutationOutput{}, fmt.Errorf("删除自定义疫苗计划失败: %w", err)
		}
		a.addLog(ctx, mcpServiceActor(), "MCP删除自定义疫苗计划", "vaccine", 0,
			fmt.Sprintf("%s第%d剂", name, input.DoseIndex))
		return nil, mcpMutationOutput{Message: "自定义疫苗计划已删除"}, nil
	default:
		return nil, mcpMutationOutput{}, fmt.Errorf("不支持的疫苗管理操作")
	}
}

type mcpManageHealthInput struct {
	Action        string `json:"action" jsonschema:"操作：delete_record 或 set_plan_date"`
	Label         string `json:"label" jsonschema:"健康随访名称"`
	CustomDueDate string `json:"custom_due_date,omitempty" jsonschema:"计划日期，格式 YYYY-MM-DD"`
}

func (a *App) mcpManageHealth(ctx context.Context, _ *mcp.CallToolRequest, input mcpManageHealthInput) (*mcp.CallToolResult, mcpMutationOutput, error) {
	if _, err := a.requireMCPPermission(ctx, mcpPermissionFull); err != nil {
		return nil, mcpMutationOutput{}, err
	}
	label := strings.TrimSpace(input.Label)
	if label == "" {
		return nil, mcpMutationOutput{}, fmt.Errorf("label 不能为空")
	}
	switch strings.ToLower(strings.TrimSpace(input.Action)) {
	case "delete_record":
		if _, err := a.db.ExecContext(ctx,
			"DELETE FROM health_followup_records WHERE label = ?", label); err != nil {
			return nil, mcpMutationOutput{}, fmt.Errorf("删除健康随访失败: %w", err)
		}
		a.addLog(ctx, mcpServiceActor(), "MCP删除健康随访", "health", 0, label)
		return nil, mcpMutationOutput{Message: "健康随访记录已删除"}, nil
	case "set_plan_date":
		date := strings.TrimSpace(input.CustomDueDate)
		if _, err := parseDate(date); err != nil {
			return nil, mcpMutationOutput{}, fmt.Errorf("custom_due_date 格式无效")
		}
		if _, err := a.db.ExecContext(ctx,
			"INSERT OR REPLACE INTO health_followup_overrides (label, custom_due_date) VALUES (?, ?)",
			label, date); err != nil {
			return nil, mcpMutationOutput{}, fmt.Errorf("修改健康随访计划失败: %w", err)
		}
		a.addLog(ctx, mcpServiceActor(), "MCP修改健康随访计划", "health", 0, label+" → "+date)
		return nil, mcpMutationOutput{Message: "健康随访计划日期已更新"}, nil
	default:
		return nil, mcpMutationOutput{}, fmt.Errorf("action 必须是 delete_record 或 set_plan_date")
	}
}

type mcpManageCountdownsInput struct {
	Action      string `json:"action" jsonschema:"操作：add、update 或 delete"`
	CountdownID int64  `json:"countdown_id,omitempty" jsonschema:"倒数日 ID；update/delete 需要"`
	Title       string `json:"title,omitempty" jsonschema:"标题"`
	TargetDate  string `json:"target_date,omitempty" jsonschema:"目标日期，格式 YYYY-MM-DD"`
	Note        string `json:"note,omitempty" jsonschema:"备注"`
}

func (a *App) mcpManageCountdowns(ctx context.Context, _ *mcp.CallToolRequest, input mcpManageCountdownsInput) (*mcp.CallToolResult, mcpMutationOutput, error) {
	if _, err := a.requireMCPPermission(ctx, mcpPermissionFull); err != nil {
		return nil, mcpMutationOutput{}, err
	}
	switch strings.ToLower(strings.TrimSpace(input.Action)) {
	case "add":
		title := strings.TrimSpace(input.Title)
		targetDate := strings.TrimSpace(input.TargetDate)
		if title == "" || targetDate == "" {
			return nil, mcpMutationOutput{}, fmt.Errorf("title 和 target_date 不能为空")
		}
		if _, err := parseDate(targetDate); err != nil {
			return nil, mcpMutationOutput{}, fmt.Errorf("target_date 格式无效")
		}
		result, err := a.db.ExecContext(ctx,
			"INSERT INTO countdown_events (title, target_date, note) VALUES (?, ?, ?)",
			title, targetDate, strings.TrimSpace(input.Note))
		if err != nil {
			return nil, mcpMutationOutput{}, fmt.Errorf("添加倒数日失败: %w", err)
		}
		id, _ := result.LastInsertId()
		a.addLog(ctx, mcpServiceActor(), "MCP添加倒数日", "countdown", id, title+" → "+targetDate)
		return nil, mcpMutationOutput{Message: "倒数日已添加", Record: map[string]any{
			"id": id, "title": title, "target_date": targetDate, "note": strings.TrimSpace(input.Note),
		}}, nil
	case "update":
		if input.CountdownID <= 0 {
			return nil, mcpMutationOutput{}, fmt.Errorf("countdown_id 必须是正整数")
		}
		title := strings.TrimSpace(input.Title)
		targetDate := strings.TrimSpace(input.TargetDate)
		if title == "" || targetDate == "" {
			return nil, mcpMutationOutput{}, fmt.Errorf("title 和 target_date 不能为空")
		}
		if _, err := parseDate(targetDate); err != nil {
			return nil, mcpMutationOutput{}, fmt.Errorf("target_date 格式无效")
		}
		result, err := a.db.ExecContext(ctx,
			"UPDATE countdown_events SET title = ?, target_date = ?, note = ? WHERE id = ?",
			title, targetDate, strings.TrimSpace(input.Note), input.CountdownID)
		if err != nil {
			return nil, mcpMutationOutput{}, fmt.Errorf("更新倒数日失败: %w", err)
		}
		if affected, _ := result.RowsAffected(); affected == 0 {
			return nil, mcpMutationOutput{}, fmt.Errorf("倒数日不存在")
		}
		a.addLog(ctx, mcpServiceActor(), "MCP修改倒数日", "countdown", input.CountdownID, title+" → "+targetDate)
		return nil, mcpMutationOutput{Message: "倒数日已更新"}, nil
	case "delete":
		if input.CountdownID <= 0 {
			return nil, mcpMutationOutput{}, fmt.Errorf("countdown_id 必须是正整数")
		}
		result, err := a.db.ExecContext(ctx,
			"DELETE FROM countdown_events WHERE id = ?", input.CountdownID)
		if err != nil {
			return nil, mcpMutationOutput{}, fmt.Errorf("删除倒数日失败: %w", err)
		}
		if affected, _ := result.RowsAffected(); affected == 0 {
			return nil, mcpMutationOutput{}, fmt.Errorf("倒数日不存在")
		}
		a.addLog(ctx, mcpServiceActor(), "MCP删除倒数日", "countdown", input.CountdownID, "")
		return nil, mcpMutationOutput{Message: "倒数日已删除"}, nil
	default:
		return nil, mcpMutationOutput{}, fmt.Errorf("action 必须是 add、update 或 delete")
	}
}

type mcpManageUsersInput struct {
	Action      string `json:"action" jsonschema:"操作：approve、reject、delete、rename 或 reset_password"`
	UserID      int64  `json:"user_id" jsonschema:"用户 ID"`
	Username    string `json:"username,omitempty" jsonschema:"rename 时的新用户名"`
	NewPassword string `json:"new_password,omitempty" jsonschema:"reset_password 时的新密码，长度 8-128"`
}

func (a *App) mcpManageUsers(ctx context.Context, _ *mcp.CallToolRequest, input mcpManageUsersInput) (*mcp.CallToolResult, mcpMutationOutput, error) {
	if _, err := a.requireMCPPermission(ctx, mcpPermissionFull); err != nil {
		return nil, mcpMutationOutput{}, err
	}
	if input.UserID <= 0 {
		return nil, mcpMutationOutput{}, fmt.Errorf("user_id 必须是正整数")
	}
	user, err := a.queryOne(ctx,
		"SELECT id, username, role, status FROM users WHERE id = ?", input.UserID)
	if isNoRows(err) {
		return nil, mcpMutationOutput{}, fmt.Errorf("用户不存在")
	}
	if err != nil {
		return nil, mcpMutationOutput{}, fmt.Errorf("加载用户失败: %w", err)
	}
	action := strings.ToLower(strings.TrimSpace(input.Action))
	switch action {
	case "approve":
		if _, err := a.db.ExecContext(ctx,
			"UPDATE users SET status = 'approved' WHERE id = ?", input.UserID); err != nil {
			return nil, mcpMutationOutput{}, fmt.Errorf("批准用户失败: %w", err)
		}
		a.addLog(ctx, mcpServiceActor(), "MCP审批用户", "user", input.UserID,
			"批准 "+stringValue(user["username"]))
		return nil, mcpMutationOutput{Message: "用户已批准"}, nil
	case "reject":
		if _, err := a.db.ExecContext(ctx,
			"UPDATE users SET status = 'rejected' WHERE id = ?", input.UserID); err != nil {
			return nil, mcpMutationOutput{}, fmt.Errorf("拒绝用户失败: %w", err)
		}
		a.addLog(ctx, mcpServiceActor(), "MCP审批用户", "user", input.UserID,
			"拒绝 "+stringValue(user["username"]))
		return nil, mcpMutationOutput{Message: "用户已拒绝"}, nil
	case "delete":
		if stringValue(user["role"]) == "admin" {
			return nil, mcpMutationOutput{}, fmt.Errorf("不能删除管理员")
		}
		if _, err := a.db.ExecContext(ctx, "DELETE FROM users WHERE id = ?", input.UserID); err != nil {
			return nil, mcpMutationOutput{}, fmt.Errorf("删除用户失败: %w", err)
		}
		a.addLog(ctx, mcpServiceActor(), "MCP删除用户", "user", input.UserID,
			stringValue(user["username"]))
		return nil, mcpMutationOutput{Message: "用户已删除"}, nil
	case "rename":
		username := strings.TrimSpace(input.Username)
		if len([]rune(username)) < 2 {
			return nil, mcpMutationOutput{}, fmt.Errorf("用户名至少 2 个字符")
		}
		existing, err := a.queryOne(ctx,
			"SELECT id FROM users WHERE username = ? AND id != ?", username, input.UserID)
		if err != nil && !isNoRows(err) {
			return nil, mcpMutationOutput{}, fmt.Errorf("检查用户名失败: %w", err)
		}
		if existing != nil {
			return nil, mcpMutationOutput{}, fmt.Errorf("用户名已存在")
		}
		if _, err := a.db.ExecContext(ctx,
			"UPDATE users SET username = ? WHERE id = ?", username, input.UserID); err != nil {
			return nil, mcpMutationOutput{}, fmt.Errorf("修改用户名失败: %w", err)
		}
		a.addLog(ctx, mcpServiceActor(), "MCP修改用户名", "user", input.UserID,
			stringValue(user["username"])+" → "+username)
		return nil, mcpMutationOutput{Message: "用户名已更新"}, nil
	case "reset_password":
		password := strings.TrimSpace(input.NewPassword)
		if len([]rune(password)) < 8 || len([]rune(password)) > 128 {
			return nil, mcpMutationOutput{}, fmt.Errorf("密码长度应为 8-128 位")
		}
		if _, err := a.db.ExecContext(ctx,
			"UPDATE users SET password_hash = ? WHERE id = ?", hashPassword(password), input.UserID); err != nil {
			return nil, mcpMutationOutput{}, fmt.Errorf("重置密码失败: %w", err)
		}
		a.addLog(ctx, mcpServiceActor(), "MCP重置密码", "user", input.UserID,
			"重置 "+stringValue(user["username"])+" 的密码")
		return nil, mcpMutationOutput{Message: "密码已重置"}, nil
	default:
		return nil, mcpMutationOutput{}, fmt.Errorf("action 必须是 approve、reject、delete、rename 或 reset_password")
	}
}

type mcpClearRecordsInput struct {
	Confirmation string `json:"confirmation" jsonschema:"必须填写 CLEAR_ALL_RECORDS"`
}

func (a *App) mcpClearRecords(ctx context.Context, _ *mcp.CallToolRequest, input mcpClearRecordsInput) (*mcp.CallToolResult, mcpMutationOutput, error) {
	if _, err := a.requireMCPPermission(ctx, mcpPermissionFull); err != nil {
		return nil, mcpMutationOutput{}, err
	}
	if strings.TrimSpace(input.Confirmation) != "CLEAR_ALL_RECORDS" {
		return nil, mcpMutationOutput{}, fmt.Errorf("confirmation 必须为 CLEAR_ALL_RECORDS")
	}
	result, err := a.db.ExecContext(ctx, "DELETE FROM records")
	if err != nil {
		return nil, mcpMutationOutput{}, fmt.Errorf("清除记录失败: %w", err)
	}
	affected, _ := result.RowsAffected()
	a.addLog(ctx, mcpServiceActor(), "MCP清除数据", "data", 0, fmt.Sprintf("清除%d条日常记录", affected))
	return nil, mcpMutationOutput{Message: fmt.Sprintf("已清除 %d 条日常记录", affected)}, nil
}
