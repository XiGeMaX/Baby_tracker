package app

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

const (
	mcpEndpoint               = "/mcp"
	mcpAPIKeySetting          = "mcp_api_key"
	mcpEnabledSetting         = "mcp_enabled"
	mcpMaxRequestBodyBytes    = 1 << 20
	mcpRateLimitPerMinute     = 60
	mcpRateLimitWindow        = time.Minute
	mcpDefaultListLimit       = 50
	mcpMaxListLimit           = 200
	mcpToolVersion            = "1.9.0"
	mcpListRecordsDescription = "列出指定日期的记录，按时间倒序分页返回"
)

type mcpRateLimiter struct {
	mu      sync.Mutex
	entries map[string]mcpRateEntry
	limit   int
	window  time.Duration
}

type mcpRateEntry struct {
	start time.Time
	count int
}

func newMCPRateLimiter(limit int, window time.Duration) *mcpRateLimiter {
	return &mcpRateLimiter{
		entries: make(map[string]mcpRateEntry),
		limit:   limit,
		window:  window,
	}
}

func (l *mcpRateLimiter) allow(key string, now time.Time) bool {
	l.mu.Lock()
	defer l.mu.Unlock()

	entry, ok := l.entries[key]
	if !ok || now.Sub(entry.start) >= l.window {
		l.entries[key] = mcpRateEntry{start: now, count: 1}
		return true
	}
	if entry.count >= l.limit {
		return false
	}
	entry.count++
	l.entries[key] = entry
	return true
}

func (a *App) newMCPHandler() http.Handler {
	streamable := mcp.NewStreamableHTTPHandler(func(*http.Request) *mcp.Server {
		return a.newMCPServer()
	}, &mcp.StreamableHTTPOptions{
		Stateless:                  true,
		JSONResponse:               true,
		Logger:                     a.logger,
		MaxRequestBodyBytes:        mcpMaxRequestBodyBytes,
		SessionTimeout:             30 * time.Minute,
		DisableLocalhostProtection: false,
	})

	protection := http.NewCrossOriginProtection()
	protection.SetDenyHandler(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		writeError(w, http.StatusForbidden, "MCP 请求来源不受信任")
	}))
	protectedStreamable := protection.Handler(streamable)
	limiter := newMCPRateLimiter(mcpRateLimitPerMinute, mcpRateLimitWindow)

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !a.mcpAvailable(r.Context()) {
			http.NotFound(w, r)
			return
		}
		if !a.checkMCPAPIKey(r) {
			w.Header().Set("WWW-Authenticate", `Bearer realm="baby-tracker-mcp"`)
			writeError(w, http.StatusUnauthorized, "未授权，请提供有效的 MCP API 密钥")
			return
		}
		if !limiter.allow(mcpRemoteKey(r), time.Now()) {
			w.Header().Set("Retry-After", "60")
			writeError(w, http.StatusTooManyRequests, "MCP 请求过于频繁，请稍后重试")
			return
		}
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		protectedStreamable.ServeHTTP(w, r)
	})
}

func (a *App) mcpAvailable(ctx context.Context) bool {
	return a.mcpEnabled(ctx)
}

func (a *App) mcpEnabled(ctx context.Context) bool {
	row, err := a.queryOne(ctx, "SELECT value FROM settings WHERE key = ?", mcpEnabledSetting)
	if err != nil || row == nil {
		return false
	}
	return boolValue(stringValue(row["value"]))
}

func (a *App) setMCPEnabled(ctx context.Context, enabled bool) error {
	value := "0"
	if enabled {
		value = "1"
	}
	_, err := a.db.ExecContext(ctx,
		`INSERT INTO settings (key, value) VALUES (?, ?)
		 ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now','localtime')`,
		mcpEnabledSetting, value)
	return err
}

func (a *App) mcpConfigData(ctx context.Context) map[string]any {
	enabled := a.mcpEnabled(ctx)
	return map[string]any{
		"enabled":   enabled,
		"available": enabled,
		"endpoint":  mcpEndpoint,
	}
}

func (a *App) getMCPConfig(w http.ResponseWriter, r *http.Request) {
	if !isAdmin(apiUser(r)) {
		writeError(w, http.StatusForbidden, "无权限")
		return
	}
	writeJSON(w, http.StatusOK, a.mcpConfigData(r.Context()))
}

func (a *App) updateMCPConfig(w http.ResponseWriter, r *http.Request) {
	user := apiUser(r)
	if !isAdmin(user) {
		writeError(w, http.StatusForbidden, "无权限")
		return
	}
	var input struct {
		Enabled *bool `json:"enabled"`
	}
	if err := decodeJSON(w, r, &input); err != nil || input.Enabled == nil {
		writeError(w, http.StatusBadRequest, "请求格式无效")
		return
	}
	enabled := *input.Enabled
	if err := a.setMCPEnabled(r.Context(), enabled); err != nil {
		writeError(w, http.StatusInternalServerError, "保存 MCP 开关失败")
		return
	}
	action := "关闭MCP服务"
	message := "MCP 服务已关闭"
	if enabled {
		action = "开启MCP服务"
		message = "MCP 服务已开启"
	}
	a.addLog(r.Context(), user, action, "settings", 0, "")
	payload := a.mcpConfigData(r.Context())
	payload["message"] = message
	writeJSON(w, http.StatusOK, payload)
}

func (a *App) checkMCPAPIKey(r *http.Request) bool {
	provided := bearerToken(r)
	if provided == "" {
		return false
	}
	row, err := a.queryOne(r.Context(),
		"SELECT value FROM settings WHERE key = ?", mcpAPIKeySetting)
	if err != nil {
		return false
	}
	expected := stringValue(row["value"])
	return expected != "" && constantTimeStringEqual(provided, expected)
}

func mcpRemoteKey(r *http.Request) string {
	host, _, err := net.SplitHostPort(strings.TrimSpace(r.RemoteAddr))
	if err == nil && host != "" {
		return host
	}
	if value := strings.TrimSpace(r.RemoteAddr); value != "" {
		return value
	}
	return "unknown"
}

func (a *App) getMCPAPIKey(w http.ResponseWriter, r *http.Request) {
	if !isAdmin(apiUser(r)) {
		writeError(w, http.StatusForbidden, "无权限")
		return
	}
	row, err := a.queryOne(r.Context(),
		"SELECT value FROM settings WHERE key = ?", mcpAPIKeySetting)
	if err != nil && !isNoRows(err) {
		writeError(w, http.StatusInternalServerError, "加载 MCP 密钥失败")
		return
	}
	apiKey := ""
	if row != nil {
		apiKey = stringValue(row["value"])
	}
	writeJSON(w, http.StatusOK, map[string]any{"api_key": apiKey})
}

func (a *App) generateMCPAPIKey(w http.ResponseWriter, r *http.Request) {
	user := apiUser(r)
	if !isAdmin(user) {
		writeError(w, http.StatusForbidden, "无权限")
		return
	}
	apiKey := randomToken(32)
	if _, err := a.db.ExecContext(r.Context(),
		`INSERT INTO settings (key, value) VALUES (?, ?)
		 ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now','localtime')`,
		mcpAPIKeySetting, apiKey); err != nil {
		writeError(w, http.StatusInternalServerError, "生成 MCP 密钥失败")
		return
	}
	a.addLog(r.Context(), user, "生成MCP密钥", "settings", 0, "")
	writeJSON(w, http.StatusOK, map[string]any{"api_key": apiKey})
}

func (a *App) newMCPServer() *mcp.Server {
	server := mcp.NewServer(&mcp.Implementation{
		Name:        "baby-tracker",
		Title:       "Baby Tracker",
		Description: "读取和记录 Baby Tracker 本地育儿数据",
		Version:     mcpToolVersion,
	}, &mcp.ServerOptions{
		Instructions: "此服务默认关闭，需由管理员显式启用并配置独立的 MCP API 密钥。",
		Logger:       a.logger,
	})
	a.registerMCPTools(server)
	return server
}

func (a *App) registerMCPTools(server *mcp.Server) {
	mcp.AddTool(server, mcpReadOnlyTool(
		"baby_tracker_get_summary",
		"读取每日概览",
		"读取指定日期的奶量目标、喂养次数、排泄次数、上次喂养和快捷按钮。日期格式为 YYYY-MM-DD，省略时使用今天。",
	), a.mcpGetSummary)
	mcp.AddTool(server, mcpReadOnlyTool(
		"baby_tracker_list_records",
		"列出记录",
		mcpListRecordsDescription,
	), a.mcpListRecords)
	mcp.AddTool(server, mcpReadOnlyTool(
		"baby_tracker_get_baby",
		"读取宝宝资料",
		"读取当前宝宝姓名、性别、出生日期、体重和早产标记。",
	), a.mcpGetBaby)
	mcp.AddTool(server, mcpReadOnlyTool(
		"baby_tracker_list_quick_buttons",
		"列出快捷按钮",
		"列出已启用的快捷记录按钮及其类型、子类型、预设量和排序。",
	), a.mcpListQuickButtons)
	mcp.AddTool(server, mcpWriteTool(
		"baby_tracker_create_record",
		"创建记录",
		"创建一条喂养、排泄、症状或补充记录。优先提供准确时间；省略时使用当前本地时间。",
		false,
	), a.mcpCreateRecord)
	mcp.AddTool(server, mcpWriteTool(
		"baby_tracker_press_quick_button",
		"使用快捷按钮记录",
		"按快捷按钮 ID 创建一条记录。按钮必须存在且已启用；省略时间时使用当前本地时间。",
		false,
	), a.mcpPressQuickButton)
}

func mcpReadOnlyTool(name, title, description string) *mcp.Tool {
	openWorld := false
	return &mcp.Tool{
		Name:        name,
		Title:       title,
		Description: description,
		Annotations: &mcp.ToolAnnotations{
			Title:          title,
			ReadOnlyHint:   true,
			OpenWorldHint:  &openWorld,
			IdempotentHint: true,
		},
	}
}

func mcpWriteTool(name, title, description string, idempotent bool) *mcp.Tool {
	destructive := false
	openWorld := false
	return &mcp.Tool{
		Name:        name,
		Title:       title,
		Description: description,
		Annotations: &mcp.ToolAnnotations{
			Title:           title,
			ReadOnlyHint:    false,
			DestructiveHint: &destructive,
			OpenWorldHint:   &openWorld,
			IdempotentHint:  idempotent,
		},
	}
}

type mcpSummaryInput struct {
	Date string `json:"date,omitempty" jsonschema:"日期，格式 YYYY-MM-DD；省略时使用今天"`
}

type mcpSummaryOutput struct {
	Summary map[string]any `json:"summary" jsonschema:"指定日期的每日概览"`
}

func (a *App) mcpGetSummary(ctx context.Context, _ *mcp.CallToolRequest, input mcpSummaryInput) (*mcp.CallToolResult, mcpSummaryOutput, error) {
	targetDate, err := normalizeMCPDate(input.Date)
	if err != nil {
		return nil, mcpSummaryOutput{}, err
	}
	summary, err := a.todaySummaryData(ctx, targetDate, mcpServiceActor())
	if err != nil {
		return nil, mcpSummaryOutput{}, fmt.Errorf("加载每日概览失败: %w", err)
	}
	return nil, mcpSummaryOutput{Summary: summary}, nil
}

type mcpListRecordsInput struct {
	Date   string `json:"date,omitempty" jsonschema:"日期，格式 YYYY-MM-DD；省略时使用今天"`
	Type   string `json:"type,omitempty" jsonschema:"记录类型：feed、excrete、symptom 或 supplement；省略时返回全部类型"`
	Limit  int    `json:"limit,omitempty" jsonschema:"每页条数，默认 50，最大 200"`
	Offset int    `json:"offset,omitempty" jsonschema:"分页偏移量，默认 0"`
}

type mcpListRecordsOutput struct {
	Date    string           `json:"date" jsonschema:"查询日期"`
	Records []map[string]any `json:"records" jsonschema:"记录列表"`
	Total   int64            `json:"total" jsonschema:"该日期与类型下的总记录数"`
	Limit   int              `json:"limit" jsonschema:"当前分页大小"`
	Offset  int              `json:"offset" jsonschema:"当前分页偏移量"`
	HasMore bool             `json:"has_more" jsonschema:"是否还有下一页"`
}

func (a *App) mcpListRecords(ctx context.Context, _ *mcp.CallToolRequest, input mcpListRecordsInput) (*mcp.CallToolResult, mcpListRecordsOutput, error) {
	targetDate, err := normalizeMCPDate(input.Date)
	if err != nil {
		return nil, mcpListRecordsOutput{}, err
	}
	recordType := strings.TrimSpace(input.Type)
	if recordType != "" && !validRecordType(recordType) {
		return nil, mcpListRecordsOutput{}, fmt.Errorf("无效的记录类型 %q，可用类型为 feed、excrete、symptom、supplement", recordType)
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
	start, end := dayRange(targetDate)
	where := " WHERE timestamp >= ? AND timestamp <= ?"
	args := []any{start, end}
	if recordType != "" {
		where += " AND type = ?"
		args = append(args, recordType)
	}
	countRow, err := a.queryOne(ctx, "SELECT COUNT(*) AS total FROM records"+where, args...)
	if err != nil {
		return nil, mcpListRecordsOutput{}, fmt.Errorf("统计记录失败: %w", err)
	}
	queryArgs := append(append([]any{}, args...), limit, offset)
	records, err := a.queryMaps(ctx,
		"SELECT * FROM records"+where+" ORDER BY timestamp DESC, id DESC LIMIT ? OFFSET ?",
		queryArgs...)
	if err != nil {
		return nil, mcpListRecordsOutput{}, fmt.Errorf("加载记录失败: %w", err)
	}
	total := intValue(countRow["total"])
	return nil, mcpListRecordsOutput{
		Date:    targetDate,
		Records: records,
		Total:   total,
		Limit:   limit,
		Offset:  offset,
		HasMore: int64(offset+len(records)) < total,
	}, nil
}

type mcpEmptyInput struct{}

type mcpBabyOutput struct {
	Baby map[string]any `json:"baby" jsonschema:"宝宝资料"`
}

func (a *App) mcpGetBaby(ctx context.Context, _ *mcp.CallToolRequest, _ mcpEmptyInput) (*mcp.CallToolResult, mcpBabyOutput, error) {
	baby, err := a.queryOne(ctx, "SELECT * FROM babies ORDER BY id LIMIT 1")
	if isNoRows(err) {
		return nil, mcpBabyOutput{}, fmt.Errorf("尚未配置宝宝资料")
	}
	if err != nil {
		return nil, mcpBabyOutput{}, fmt.Errorf("加载宝宝资料失败: %w", err)
	}
	return nil, mcpBabyOutput{Baby: baby}, nil
}

type mcpQuickButtonsOutput struct {
	Buttons []map[string]any `json:"buttons" jsonschema:"已启用的快捷按钮"`
}

func (a *App) mcpListQuickButtons(ctx context.Context, _ *mcp.CallToolRequest, _ mcpEmptyInput) (*mcp.CallToolResult, mcpQuickButtonsOutput, error) {
	buttons, err := a.queryMaps(ctx,
		`SELECT id, type, sub_type, label, amount, sort_order, food_unit
		 FROM quick_buttons WHERE is_active = 1 ORDER BY sort_order, id`)
	if err != nil {
		return nil, mcpQuickButtonsOutput{}, fmt.Errorf("加载快捷按钮失败: %w", err)
	}
	return nil, mcpQuickButtonsOutput{Buttons: buttons}, nil
}

type mcpCreateRecordInput struct {
	Type        string   `json:"type" jsonschema:"记录类型，必须是 feed、excrete、symptom 或 supplement"`
	SubType     string   `json:"sub_type" jsonschema:"记录子类型，例如 formula、urine、stool、vomit、vitamin_d"`
	Amount      *float64 `json:"amount,omitempty" jsonschema:"数量；奶量按 ml，辅食按 food_unit，其他记录按实际含义"`
	Duration    *int     `json:"duration,omitempty" jsonschema:"持续时间，单位分钟"`
	Color       string   `json:"color,omitempty" jsonschema:"颜色描述"`
	Consistency string   `json:"consistency,omitempty" jsonschema:"性状描述"`
	Temperature *float64 `json:"temperature,omitempty" jsonschema:"体温，单位摄氏度"`
	Note        string   `json:"note,omitempty" jsonschema:"备注"`
	Timestamp   string   `json:"timestamp,omitempty" jsonschema:"本地时间，格式 YYYY-MM-DD HH:MM:SS；省略时使用当前时间"`
	FoodUnit    string   `json:"food_unit,omitempty" jsonschema:"辅食单位，例如 g、勺、块"`
}

type mcpRecordOutput struct {
	Message string         `json:"message" jsonschema:"操作结果"`
	Record  map[string]any `json:"record" jsonschema:"创建后的完整记录"`
}

func (a *App) mcpCreateRecord(ctx context.Context, _ *mcp.CallToolRequest, input mcpCreateRecordInput) (*mcp.CallToolResult, mcpRecordOutput, error) {
	recordType := strings.TrimSpace(input.Type)
	subType := strings.TrimSpace(input.SubType)
	if !validRecordType(recordType) {
		return nil, mcpRecordOutput{}, fmt.Errorf("无效的记录类型 %q，可用类型为 feed、excrete、symptom、supplement", recordType)
	}
	if subType == "" {
		return nil, mcpRecordOutput{}, fmt.Errorf("sub_type 不能为空")
	}
	timestamp, err := normalizeMCPTimestamp(input.Timestamp)
	if err != nil {
		return nil, mcpRecordOutput{}, err
	}
	result, err := a.db.ExecContext(ctx,
		`INSERT INTO records
		 (baby_id, user_id, type, sub_type, amount, duration, color, consistency, temperature, note, timestamp, food_unit)
		 VALUES (1, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		recordType, subType, nullableFloatPointer(input.Amount), nullableIntPointer(input.Duration),
		strings.TrimSpace(input.Color), strings.TrimSpace(input.Consistency), nullableFloatPointer(input.Temperature),
		strings.TrimSpace(input.Note), timestamp, strings.TrimSpace(input.FoodUnit),
	)
	if err != nil {
		return nil, mcpRecordOutput{}, fmt.Errorf("创建记录失败: %w", err)
	}
	recordID, _ := result.LastInsertId()
	record, err := a.queryOne(ctx, "SELECT * FROM records WHERE id = ?", recordID)
	if err != nil {
		return nil, mcpRecordOutput{}, fmt.Errorf("记录已创建但加载详情失败: %w", err)
	}
	a.addLog(ctx, mcpServiceActor(), "MCP创建记录", "record", recordID,
		fmt.Sprintf("%s/%s @ %s", recordType, subType, timestamp))
	return nil, mcpRecordOutput{Message: "记录已创建", Record: record}, nil
}

type mcpPressQuickButtonInput struct {
	ButtonID  int64  `json:"button_id" jsonschema:"已启用的快捷按钮 ID"`
	Timestamp string `json:"timestamp,omitempty" jsonschema:"本地时间，格式 YYYY-MM-DD HH:MM:SS；省略时使用当前时间"`
}

type mcpQuickButtonRecordOutput struct {
	Message string         `json:"message" jsonschema:"操作结果"`
	Button  map[string]any `json:"button" jsonschema:"使用的快捷按钮"`
	Record  map[string]any `json:"record" jsonschema:"创建后的完整记录"`
}

func (a *App) mcpPressQuickButton(ctx context.Context, _ *mcp.CallToolRequest, input mcpPressQuickButtonInput) (*mcp.CallToolResult, mcpQuickButtonRecordOutput, error) {
	if input.ButtonID <= 0 {
		return nil, mcpQuickButtonRecordOutput{}, fmt.Errorf("button_id 必须是正整数")
	}
	button, err := a.queryOne(ctx,
		"SELECT * FROM quick_buttons WHERE id = ? AND is_active = 1", input.ButtonID)
	if isNoRows(err) {
		return nil, mcpQuickButtonRecordOutput{}, fmt.Errorf("快捷按钮 %d 不存在或未启用", input.ButtonID)
	}
	if err != nil {
		return nil, mcpQuickButtonRecordOutput{}, fmt.Errorf("加载快捷按钮失败: %w", err)
	}
	timestamp, err := normalizeMCPTimestamp(input.Timestamp)
	if err != nil {
		return nil, mcpQuickButtonRecordOutput{}, err
	}
	result, err := a.db.ExecContext(ctx,
		`INSERT INTO records (baby_id, user_id, type, sub_type, amount, timestamp, food_unit)
		 VALUES (1, NULL, ?, ?, ?, ?, ?)`,
		stringValue(button["type"]), stringValue(button["sub_type"]),
		nullableNumber(button["amount"]), timestamp, stringValue(button["food_unit"]),
	)
	if err != nil {
		return nil, mcpQuickButtonRecordOutput{}, fmt.Errorf("快捷记录失败: %w", err)
	}
	recordID, _ := result.LastInsertId()
	record, err := a.queryOne(ctx, "SELECT * FROM records WHERE id = ?", recordID)
	if err != nil {
		return nil, mcpQuickButtonRecordOutput{}, fmt.Errorf("记录已创建但加载详情失败: %w", err)
	}
	label := stringValue(button["label"])
	a.addLog(ctx, mcpServiceActor(), "MCP快捷记录", "record", recordID,
		fmt.Sprintf("%s @ %s", label, timestamp))
	return nil, mcpQuickButtonRecordOutput{
		Message: "快捷记录已创建",
		Button:  button,
		Record:  record,
	}, nil
}

func normalizeMCPDate(value string) (string, error) {
	targetDate := strings.TrimSpace(value)
	if targetDate == "" {
		return today().Format("2006-01-02"), nil
	}
	if _, err := parseDate(targetDate); err != nil {
		return "", fmt.Errorf("日期格式无效，需要 YYYY-MM-DD")
	}
	return targetDate, nil
}

func normalizeMCPTimestamp(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return nowTimestamp(), nil
	}
	for _, layout := range []string{
		"2006-01-02 15:04:05",
		"2006-01-02T15:04:05",
		time.RFC3339,
	} {
		parsed, err := time.ParseInLocation(layout, value, time.Local)
		if err == nil {
			return parsed.In(time.Local).Format("2006-01-02 15:04:05"), nil
		}
	}
	return "", fmt.Errorf("timestamp 格式无效，需要 YYYY-MM-DD HH:MM:SS 或 RFC3339")
}

func nullableFloatPointer(value *float64) any {
	if value == nil {
		return nil
	}
	return *value
}

func nullableIntPointer(value *int) any {
	if value == nil {
		return nil
	}
	return *value
}

func mcpServiceActor() map[string]any {
	return map[string]any{
		"username": "mcp",
		"nickname": "MCP",
		"role":     "service",
		"status":   "approved",
	}
}
