package app

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type roundTripperFunc func(*http.Request) (*http.Response, error)

func (f roundTripperFunc) RoundTrip(r *http.Request) (*http.Response, error) {
	return f(r)
}

func configureMCPKey(t *testing.T, application *App, apiKey string) {
	t.Helper()
	if apiKey != "" {
		if _, err := application.db.ExecContext(context.Background(),
			`INSERT INTO settings (key, value) VALUES (?, ?)
			 ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
			mcpAPIKeySetting, apiKey); err != nil {
			t.Fatal(err)
		}
	}
}

func enableMCPForTest(t *testing.T, application *App) {
	t.Helper()
	if err := application.setMCPEnabled(context.Background(), true); err != nil {
		t.Fatal(err)
	}
}

func setMCPPermissionForTest(t *testing.T, application *App, permission mcpPermission) {
	t.Helper()
	if err := application.setMCPPermissionLevel(context.Background(), permission); err != nil {
		t.Fatal(err)
	}
}

func listMCPToolsForPermission(t *testing.T, application *App, permission mcpPermission) map[string]bool {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	serverTransport, clientTransport := mcp.NewInMemoryTransports()
	serverSession, err := application.newMCPServer(permission).Connect(ctx, serverTransport, nil)
	if err != nil {
		t.Fatalf("connect in-memory MCP server: %v", err)
	}
	defer serverSession.Close()

	client := mcp.NewClient(&mcp.Implementation{Name: "permission-test", Version: "1.0.0"}, nil)
	session, err := client.Connect(ctx, clientTransport, nil)
	if err != nil {
		t.Fatalf("connect in-memory MCP client: %v", err)
	}
	defer session.Close()

	listed, err := session.ListTools(ctx, nil)
	if err != nil {
		t.Fatalf("list MCP tools: %v", err)
	}
	toolNames := make(map[string]bool, len(listed.Tools))
	for _, tool := range listed.Tools {
		toolNames[tool.Name] = true
	}
	return toolNames
}

func sessionCookieForUser(t *testing.T, application *App, userID int64) *http.Cookie {
	t.Helper()
	payload, err := json.Marshal(sessionState{
		UserID:    userID,
		ExpiresAt: time.Now().Add(time.Hour).Unix(),
	})
	if err != nil {
		t.Fatal(err)
	}
	token := base64.RawURLEncoding.EncodeToString(payload) + "." +
		base64.RawURLEncoding.EncodeToString(application.sign(payload))
	return &http.Cookie{Name: sessionCookieName, Value: token}
}

func mcpInitializeRequest(t *testing.T, apiKey string) *http.Request {
	t.Helper()
	request := httptest.NewRequest(http.MethodPost, mcpEndpoint,
		strings.NewReader(`{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}`))
	request.Header.Set("Authorization", "Bearer "+apiKey)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json, text/event-stream")
	return request
}

func TestMCPRequiresEnabledSwitchAndAPIKey(t *testing.T) {
	application := newTestApp(t)
	application.mcp = application.newMCPHandler()

	disabledByDefault := performRequest(application, mcpInitializeRequest(t, "not-configured"), nil)
	if disabledByDefault.Code != http.StatusNotFound {
		t.Fatalf("MCP while switch is off status = %d, want %d", disabledByDefault.Code, http.StatusNotFound)
	}

	configureMCPKey(t, application, "valid-key")
	enableMCPForTest(t, application)
	missingKey := httptest.NewRequest(http.MethodPost, mcpEndpoint, strings.NewReader(`{}`))
	missingKey.Header.Set("Content-Type", "application/json")
	missingKey.Header.Set("Accept", "application/json, text/event-stream")
	missingKeyResponse := performRequest(application, missingKey, nil)
	if missingKeyResponse.Code != http.StatusUnauthorized {
		t.Fatalf("MCP missing key status = %d, want %d", missingKeyResponse.Code, http.StatusUnauthorized)
	}

	wrongKey := performRequest(application, mcpInitializeRequest(t, "wrong-key"), nil)
	if wrongKey.Code != http.StatusUnauthorized {
		t.Fatalf("MCP wrong key status = %d, want %d", wrongKey.Code, http.StatusUnauthorized)
	}
}

func TestMCPRejectsCrossOriginRequests(t *testing.T) {
	application := newTestApp(t)
	application.mcp = application.newMCPHandler()
	configureMCPKey(t, application, "valid-key")
	enableMCPForTest(t, application)

	request := mcpInitializeRequest(t, "valid-key")
	request.Host = "127.0.0.1:18964"
	request.Header.Set("Origin", "https://malicious.example")
	request.Header.Set("Sec-Fetch-Site", "cross-site")
	response := performRequest(application, request, nil)
	if response.Code != http.StatusForbidden {
		t.Fatalf("cross-origin MCP status = %d, want %d", response.Code, http.StatusForbidden)
	}
}

func TestMCPRateLimit(t *testing.T) {
	application := newTestApp(t)
	application.mcp = application.newMCPHandler()
	configureMCPKey(t, application, "valid-key")
	enableMCPForTest(t, application)

	for index := 0; index < mcpRateLimitPerMinute; index++ {
		response := performRequest(application, mcpInitializeRequest(t, "valid-key"), nil)
		if response.Code == http.StatusTooManyRequests {
			t.Fatalf("request %d was rate limited too early", index+1)
		}
	}
	limited := performRequest(application, mcpInitializeRequest(t, "valid-key"), nil)
	if limited.Code != http.StatusTooManyRequests {
		t.Fatalf("rate-limited status = %d, want %d", limited.Code, http.StatusTooManyRequests)
	}
}

func TestMCPManagementRotatesKeyAndHidesSecretFromSettings(t *testing.T) {
	application := newTestApp(t)
	application.mcp = application.newMCPHandler()
	configureMCPKey(t, application, "")
	enableMCPForTest(t, application)
	cookie := loginAsAdmin(t, application)

	first := performRequest(application,
		httptest.NewRequest(http.MethodPost, "/api/mcp/api-key", nil), cookie)
	if first.Code != http.StatusOK {
		t.Fatalf("generate first MCP key status = %d, body = %s", first.Code, first.Body.String())
	}
	var firstPayload struct {
		APIKey string `json:"api_key"`
	}
	if err := json.Unmarshal(first.Body.Bytes(), &firstPayload); err != nil {
		t.Fatal(err)
	}
	if firstPayload.APIKey == "" {
		t.Fatal("first MCP key is empty")
	}

	second := performRequest(application,
		httptest.NewRequest(http.MethodPost, "/api/mcp/api-key", nil), cookie)
	if second.Code != http.StatusOK {
		t.Fatalf("generate second MCP key status = %d, body = %s", second.Code, second.Body.String())
	}
	var secondPayload struct {
		APIKey string `json:"api_key"`
	}
	if err := json.Unmarshal(second.Body.Bytes(), &secondPayload); err != nil {
		t.Fatal(err)
	}
	if secondPayload.APIKey == "" || secondPayload.APIKey == firstPayload.APIKey {
		t.Fatalf("rotated MCP key = %q, first = %q", secondPayload.APIKey, firstPayload.APIKey)
	}

	oldKeyRequest := performRequest(application, mcpInitializeRequest(t, firstPayload.APIKey), nil)
	if oldKeyRequest.Code != http.StatusUnauthorized {
		t.Fatalf("old MCP key status = %d, want %d", oldKeyRequest.Code, http.StatusUnauthorized)
	}
	newKeyRequest := performRequest(application, mcpInitializeRequest(t, secondPayload.APIKey), nil)
	if newKeyRequest.Code != http.StatusOK {
		t.Fatalf("new MCP key status = %d, body = %s", newKeyRequest.Code, newKeyRequest.Body.String())
	}

	settings := performRequest(application, httptest.NewRequest(http.MethodGet, "/api/settings", nil), cookie)
	if settings.Code != http.StatusOK {
		t.Fatalf("settings status = %d, body = %s", settings.Code, settings.Body.String())
	}
	var settingsPayload map[string]any
	if err := json.Unmarshal(settings.Body.Bytes(), &settingsPayload); err != nil {
		t.Fatal(err)
	}
	if _, exists := settingsPayload[mcpAPIKeySetting]; exists {
		t.Fatal("ordinary settings response exposed the MCP API key")
	}
}

func TestMCPSDKInitializesListsToolsAndCreatesRecords(t *testing.T) {
	application := newTestApp(t)
	application.mcp = application.newMCPHandler()
	const apiKey = "sdk-test-key"
	configureMCPKey(t, application, apiKey)
	enableMCPForTest(t, application)
	setMCPPermissionForTest(t, application, mcpPermissionAdvanced)

	httpServer := httptest.NewServer(application.Handler())
	defer httpServer.Close()

	httpClient := &http.Client{Transport: roundTripperFunc(func(request *http.Request) (*http.Response, error) {
		request.Header.Set("Authorization", "Bearer "+apiKey)
		return http.DefaultTransport.RoundTrip(request)
	})}
	client := mcp.NewClient(&mcp.Implementation{Name: "baby-tracker-test", Version: "1.0.0"}, nil)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	session, err := client.Connect(ctx, &mcp.StreamableClientTransport{
		Endpoint:             httpServer.URL + mcpEndpoint,
		HTTPClient:           httpClient,
		MaxRetries:           -1,
		DisableStandaloneSSE: true,
	}, nil)
	if err != nil {
		t.Fatalf("connect MCP client: %v", err)
	}
	defer session.Close()

	listed, err := session.ListTools(ctx, nil)
	if err != nil {
		t.Fatalf("list MCP tools: %v", err)
	}
	toolNames := make(map[string]bool, len(listed.Tools))
	for _, tool := range listed.Tools {
		toolNames[tool.Name] = true
	}
	for _, name := range []string{
		"baby_tracker_get_summary",
		"baby_tracker_list_records",
		"baby_tracker_list_growth_logs",
		"baby_tracker_get_baby",
		"baby_tracker_list_quick_buttons",
		"baby_tracker_create_record",
		"baby_tracker_press_quick_button",
		"baby_tracker_add_growth_log",
		"baby_tracker_record_vaccine",
		"baby_tracker_record_health_followup",
	} {
		if !toolNames[name] {
			t.Errorf("MCP tool %q is missing", name)
		}
	}

	timestamp := today().Format("2006-01-02") + " 10:00:00"
	if _, err := session.CallTool(ctx, &mcp.CallToolParams{
		Name: "baby_tracker_create_record",
		Arguments: map[string]any{
			"type":      "feed",
			"sub_type":  "formula",
			"amount":    75,
			"timestamp": timestamp,
		},
	}); err != nil {
		t.Fatalf("call create record tool: %v", err)
	}
	if _, err := session.CallTool(ctx, &mcp.CallToolParams{
		Name:      "baby_tracker_press_quick_button",
		Arguments: map[string]any{"button_id": 1, "timestamp": timestamp},
	}); err != nil {
		t.Fatalf("call quick button tool: %v", err)
	}

	var count int
	if err := application.db.QueryRow("SELECT COUNT(*) FROM records").Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 2 {
		t.Fatalf("record count after MCP writes = %d, want 2", count)
	}
}

func TestMCPPermissionToolExposure(t *testing.T) {
	tests := []struct {
		name       string
		permission mcpPermission
		included   []string
		excluded   []string
	}{
		{
			name:       "basic",
			permission: mcpPermissionBasic,
			included: []string{
				"baby_tracker_get_summary",
				"baby_tracker_list_records",
				"baby_tracker_list_growth_logs",
				"baby_tracker_get_baby",
				"baby_tracker_list_quick_buttons",
			},
			excluded: []string{
				"baby_tracker_create_record",
				"baby_tracker_add_growth_log",
				"baby_tracker_update_baby",
				"baby_tracker_clear_records",
			},
		},
		{
			name:       "advanced",
			permission: mcpPermissionAdvanced,
			included: []string{
				"baby_tracker_create_record",
				"baby_tracker_press_quick_button",
				"baby_tracker_add_growth_log",
				"baby_tracker_record_vaccine",
				"baby_tracker_record_health_followup",
			},
			excluded: []string{
				"baby_tracker_update_baby",
				"baby_tracker_manage_users",
				"baby_tracker_clear_records",
			},
		},
		{
			name:       "full",
			permission: mcpPermissionFull,
			included: []string{
				"baby_tracker_update_baby",
				"baby_tracker_manage_quick_buttons",
				"baby_tracker_update_settings",
				"baby_tracker_manage_users",
				"baby_tracker_clear_records",
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			application := newTestApp(t)
			toolNames := listMCPToolsForPermission(t, application, tt.permission)
			for _, name := range tt.included {
				if !toolNames[name] {
					t.Errorf("permission %s is missing tool %q", tt.permission, name)
				}
			}
			for _, name := range tt.excluded {
				if toolNames[name] {
					t.Errorf("permission %s unexpectedly exposes tool %q", tt.permission, name)
				}
			}
		})
	}
}

func TestMCPPermissionEnforcesRuntimeAccess(t *testing.T) {
	t.Run("basic rejects writes", func(t *testing.T) {
		application := newTestApp(t)
		setMCPPermissionForTest(t, application, mcpPermissionBasic)

		_, _, err := application.mcpCreateRecord(context.Background(), nil, mcpCreateRecordInput{
			Type:      "feed",
			SubType:   "formula",
			Timestamp: today().Format("2006-01-02") + " 10:00:00",
		})
		if err == nil || !strings.Contains(err.Error(), "需要进阶权限") {
			t.Fatalf("basic write error = %v, want advanced permission error", err)
		}
		var count int
		if err := application.db.QueryRow("SELECT COUNT(*) FROM records").Scan(&count); err != nil {
			t.Fatal(err)
		}
		if count != 0 {
			t.Fatalf("basic permission created %d records, want 0", count)
		}
	})

	t.Run("basic rejects data outside recent window", func(t *testing.T) {
		application := newTestApp(t)
		setMCPPermissionForTest(t, application, mcpPermissionBasic)
		oldDate := today().AddDate(0, 0, -mcpRecentDataDays).Format("2006-01-02")

		_, _, err := application.mcpListRecords(context.Background(), nil, mcpListRecordsInput{Date: oldDate})
		if err == nil || !strings.Contains(err.Error(), "只能访问") {
			t.Fatalf("basic old-date error = %v, want recent-window error", err)
		}

		setMCPPermissionForTest(t, application, mcpPermissionFull)
		if _, _, err := application.mcpListRecords(context.Background(), nil, mcpListRecordsInput{Date: oldDate}); err != nil {
			t.Fatalf("full permission old-date read failed: %v", err)
		}
	})

	t.Run("advanced rejects full management", func(t *testing.T) {
		application := newTestApp(t)
		setMCPPermissionForTest(t, application, mcpPermissionAdvanced)

		_, _, err := application.mcpClearRecords(context.Background(), nil, mcpClearRecordsInput{
			Confirmation: "CLEAR_ALL_RECORDS",
		})
		if err == nil || !strings.Contains(err.Error(), "需要完全权限") {
			t.Fatalf("advanced full-management error = %v, want full permission error", err)
		}
	})

	t.Run("full normalizes old and invalid dates", func(t *testing.T) {
		application := newTestApp(t)
		setMCPPermissionForTest(t, application, mcpPermissionFull)
		oldDate := today().AddDate(0, 0, -mcpRecentDataDays).Format("2006-01-02")
		weight := 5.2

		if _, _, err := application.mcpAddGrowthLog(context.Background(), nil, mcpGrowthLogInput{
			Weight:       &weight,
			RecordedDate: oldDate,
		}); err != nil {
			t.Fatalf("full permission old growth log failed: %v", err)
		}
		if _, _, err := application.mcpAddGrowthLog(context.Background(), nil, mcpGrowthLogInput{
			Weight:       &weight,
			RecordedDate: "2026-1-01",
		}); err == nil {
			t.Fatal("invalid growth date was accepted")
		}
	})
}

func TestMCPRateLimiterUsesFixedWindow(t *testing.T) {
	limiter := newMCPRateLimiter(2, time.Minute)
	start := time.Unix(1000, 0)
	if !limiter.allow("client", start) || !limiter.allow("client", start.Add(time.Second)) {
		t.Fatal("limiter rejected requests inside the allowance")
	}
	if limiter.allow("client", start.Add(2*time.Second)) {
		t.Fatal("limiter accepted a request over the allowance")
	}
	if !limiter.allow("client", start.Add(time.Minute)) {
		t.Fatal("limiter did not reset after its window")
	}
}

func TestMCPConfigSwitchControlsAvailability(t *testing.T) {
	application := newTestApp(t)
	application.mcp = application.newMCPHandler()
	cookie := loginAsAdmin(t, application)

	initial := performRequest(application,
		httptest.NewRequest(http.MethodGet, "/api/mcp/config", nil), cookie)
	if initial.Code != http.StatusOK {
		t.Fatalf("get MCP config status = %d, body = %s", initial.Code, initial.Body.String())
	}
	var initialPayload struct {
		Enabled         bool   `json:"enabled"`
		Available       bool   `json:"available"`
		PermissionLevel string `json:"permission_level"`
	}
	if err := json.Unmarshal(initial.Body.Bytes(), &initialPayload); err != nil {
		t.Fatal(err)
	}
	if initialPayload.Enabled || initialPayload.Available {
		t.Fatalf("default MCP config = %+v, want all disabled", initialPayload)
	}
	if initialPayload.PermissionLevel != string(mcpPermissionBasic) {
		t.Fatalf("default MCP permission = %q, want basic", initialPayload.PermissionLevel)
	}

	bypassSettings := httptest.NewRequest(http.MethodPut, "/api/settings",
		strings.NewReader(`{"mcp_enabled":"1"}`))
	bypassSettings.Header.Set("Content-Type", "application/json")
	bypassResponse := performRequest(application, bypassSettings, cookie)
	if bypassResponse.Code != http.StatusBadRequest {
		t.Fatalf("generic settings MCP bypass status = %d, body = %s",
			bypassResponse.Code, bypassResponse.Body.String())
	}
	permissionBypass := httptest.NewRequest(http.MethodPut, "/api/settings",
		strings.NewReader(`{"mcp_permission_level":"full"}`))
	permissionBypass.Header.Set("Content-Type", "application/json")
	permissionBypassResponse := performRequest(application, permissionBypass, cookie)
	if permissionBypassResponse.Code != http.StatusBadRequest {
		t.Fatalf("generic settings MCP permission bypass status = %d, body = %s",
			permissionBypassResponse.Code, permissionBypassResponse.Body.String())
	}

	newEnableRequest := func() *http.Request {
		request := httptest.NewRequest(http.MethodPut, "/api/mcp/config",
			strings.NewReader(`{"enabled":true}`))
		request.Header.Set("Content-Type", "application/json")
		return request
	}
	configureMCPKey(t, application, "switch-test-key")
	enableResponse := performRequest(application, newEnableRequest(), cookie)
	if enableResponse.Code != http.StatusOK {
		t.Fatalf("enable MCP status = %d, body = %s",
			enableResponse.Code, enableResponse.Body.String())
	}
	var enabledPayload struct {
		Enabled   bool   `json:"enabled"`
		Available bool   `json:"available"`
		Message   string `json:"message"`
	}
	if err := json.Unmarshal(enableResponse.Body.Bytes(), &enabledPayload); err != nil {
		t.Fatal(err)
	}
	if !enabledPayload.Enabled || !enabledPayload.Available {
		t.Fatalf("enabled MCP config = %+v", enabledPayload)
	}
	if enabledPayload.Message != "MCP 服务已开启" {
		t.Fatalf("enable MCP message = %q", enabledPayload.Message)
	}

	initialize := performRequest(application, mcpInitializeRequest(t, "switch-test-key"), nil)
	if initialize.Code != http.StatusOK {
		t.Fatalf("MCP request after enabling status = %d, body = %s",
			initialize.Code, initialize.Body.String())
	}

	disableRequest := httptest.NewRequest(http.MethodPut, "/api/mcp/config",
		strings.NewReader(`{"enabled":false}`))
	disableRequest.Header.Set("Content-Type", "application/json")
	disableResponse := performRequest(application, disableRequest, cookie)
	if disableResponse.Code != http.StatusOK {
		t.Fatalf("disable MCP status = %d, body = %s",
			disableResponse.Code, disableResponse.Body.String())
	}
	afterDisable := performRequest(application, mcpInitializeRequest(t, "switch-test-key"), nil)
	if afterDisable.Code != http.StatusNotFound {
		t.Fatalf("MCP request after disabling status = %d, want %d",
			afterDisable.Code, http.StatusNotFound)
	}
}

func TestMCPPermissionConfigRequiresFullAccessAcknowledgement(t *testing.T) {
	application := newTestApp(t)
	cookie := loginAsAdmin(t, application)

	request := func(body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPut, "/api/mcp/config", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		return performRequest(application, req, cookie)
	}

	rejected := request(`{"permission_level":"full"}`)
	if rejected.Code != http.StatusBadRequest {
		t.Fatalf("full permission without acknowledgement status = %d, body = %s",
			rejected.Code, rejected.Body.String())
	}

	accepted := request(`{"permission_level":"full","acknowledge_full_access":true}`)
	if accepted.Code != http.StatusOK {
		t.Fatalf("full permission with acknowledgement status = %d, body = %s",
			accepted.Code, accepted.Body.String())
	}
	var payload struct {
		PermissionLevel string `json:"permission_level"`
		Message         string `json:"message"`
		FullAccessWarn  string `json:"full_access_warning"`
	}
	if err := json.Unmarshal(accepted.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.PermissionLevel != string(mcpPermissionFull) {
		t.Fatalf("full permission level = %q", payload.PermissionLevel)
	}
	if payload.Message != "MCP 权限已设为完全" {
		t.Fatalf("full permission message = %q", payload.Message)
	}
	if !strings.Contains(payload.FullAccessWarn, "备份") {
		t.Fatalf("full access warning = %q, want backup guidance", payload.FullAccessWarn)
	}

	downgraded := request(`{"permission_level":"advanced"}`)
	if downgraded.Code != http.StatusOK {
		t.Fatalf("downgrade permission status = %d, body = %s",
			downgraded.Code, downgraded.Body.String())
	}
	if permission, err := application.mcpPermissionLevel(context.Background()); err != nil || permission != mcpPermissionAdvanced {
		t.Fatalf("stored permission = %q, err = %v", permission, err)
	}
}

func TestMCPConfigRejectsNonAdmin(t *testing.T) {
	application := newTestApp(t)
	configureMCPKey(t, application, "")
	result, err := application.db.ExecContext(context.Background(),
		`INSERT INTO users (username, password_hash, nickname, role, status)
		 VALUES ('member', 'unused', '成员', 'user', 'approved')`)
	if err != nil {
		t.Fatal(err)
	}
	userID, err := result.LastInsertId()
	if err != nil {
		t.Fatal(err)
	}
	cookie := sessionCookieForUser(t, application, userID)

	request := httptest.NewRequest(http.MethodPut, "/api/mcp/config",
		strings.NewReader(`{"enabled":true}`))
	request.Header.Set("Content-Type", "application/json")
	response := performRequest(application, request, cookie)
	if response.Code != http.StatusForbidden {
		t.Fatalf("non-admin MCP config status = %d, body = %s",
			response.Code, response.Body.String())
	}
	if application.mcpEnabled(context.Background()) {
		t.Fatal("non-admin changed the MCP switch")
	}
}
