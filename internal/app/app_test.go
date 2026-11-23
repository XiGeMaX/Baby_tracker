package app

import (
	"bytes"
	"context"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

func newTestApp(t *testing.T) *App {
	t.Helper()
	webDir, err := filepath.Abs(filepath.Join("..", ".."))
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	application, err := New(ctx, Config{
		DataDir:       t.TempDir(),
		WebDir:        webDir,
		SessionSecret: "test-secret",
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := application.Close(); err != nil {
			t.Errorf("close app: %v", err)
		}
	})
	if err := application.markAdminPasswordInitialized(ctx); err != nil {
		t.Fatal(err)
	}
	return application
}

func loginAsAdmin(t *testing.T, application *App) *http.Cookie {
	t.Helper()
	request := httptest.NewRequest(http.MethodPost, "/api/auth/login",
		strings.NewReader(`{"username":"admin","password":"admin123"}`))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	application.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("login status = %d, body = %s", response.Code, response.Body.String())
	}
	for _, cookie := range response.Result().Cookies() {
		if cookie.Name == sessionCookieName {
			return cookie
		}
	}
	t.Fatal("login did not set a session cookie")
	return nil
}

func performRequest(application *App, request *http.Request, cookie *http.Cookie) *httptest.ResponseRecorder {
	if cookie != nil {
		request.AddCookie(cookie)
	}
	response := httptest.NewRecorder()
	application.Handler().ServeHTTP(response, request)
	return response
}

func TestExportAndBackupWork(t *testing.T) {
	application := newTestApp(t)
	cookie := loginAsAdmin(t, application)

	directCSV := performRequest(application,
		httptest.NewRequest(http.MethodGet, "/api/export/csv", nil), cookie)
	if directCSV.Code != http.StatusOK {
		t.Fatalf("direct CSV status = %d, body = %s", directCSV.Code, directCSV.Body.String())
	}
	if !bytes.HasPrefix(directCSV.Body.Bytes(), []byte{0xEF, 0xBB, 0xBF}) {
		t.Fatal("direct CSV does not start with a UTF-8 BOM")
	}
	if disposition := directCSV.Header().Get("Content-Disposition"); !strings.Contains(disposition, "attachment") {
		t.Fatalf("direct CSV disposition = %q", disposition)
	}

	directBackup := performRequest(application,
		httptest.NewRequest(http.MethodGet, "/api/backup/export", nil), cookie)
	if directBackup.Code != http.StatusOK {
		t.Fatalf("direct backup status = %d, body = %s", directBackup.Code, directBackup.Body.String())
	}
	var backup backupPayload
	if err := json.Unmarshal(directBackup.Body.Bytes(), &backup); err != nil {
		t.Fatalf("decode direct backup: %v", err)
	}
	if backup.Tables == nil || len(backup.Tables) != len(backupColumns) {
		t.Fatalf("backup tables = %d, want %d", len(backup.Tables), len(backupColumns))
	}
}

func TestSessionSecretPersistsWithPrivatePermissions(t *testing.T) {
	dataDir := t.TempDir()
	first, err := loadOrCreateSessionSecret(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	if first == "" {
		t.Fatal("generated session secret is empty")
	}

	path := filepath.Join(dataDir, "secret_key")
	if err := os.Chmod(path, 0o644); err != nil {
		t.Fatal(err)
	}
	second, err := loadOrCreateSessionSecret(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	if second != first {
		t.Fatal("session secret changed after reload")
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if got := info.Mode().Perm(); got != 0o600 {
		t.Fatalf("session secret permissions = %o, want 600", got)
	}
}

func TestAdminPageRendersAllCollapsibleSectionsWithSinglePrefix(t *testing.T) {
	application := newTestApp(t)
	cookie := loginAsAdmin(t, application)
	application.cfg.BasePath = "/baby-tracker"
	request := httptest.NewRequest(http.MethodGet, "/baby-tracker/admin", nil)
	response := performRequest(application, request, cookie)
	if response.Code != http.StatusOK {
		t.Fatalf("admin status = %d, body = %s", response.Code, response.Body.String())
	}
	body := response.Body.String()
	if count := strings.Count(body, `<details class="admin-details">`); count != 8 {
		t.Fatalf("admin collapsible section count = %d, want 8", count)
	}
	if strings.Contains(body, "/baby-tracker/baby-tracker") {
		t.Fatal("rendered admin page contains a duplicated base path")
	}
	if !strings.Contains(body, `data-app-base="/baby-tracker"`) {
		t.Fatal("rendered admin page is missing the base path")
	}
}

func TestLatestFeedUsesCrossDayAndIDTieBreak(t *testing.T) {
	application := newTestApp(t)
	ctx := context.Background()
	todayString := today().Format("2006-01-02")
	yesterdayString := today().AddDate(0, 0, -1).Format("2006-01-02")

	if _, err := application.db.ExecContext(ctx,
		"INSERT INTO records (baby_id, type, sub_type, amount, timestamp) VALUES (1, 'feed', 'breast_left', 70, ?)",
		yesterdayString+" 23:30:00"); err != nil {
		t.Fatal(err)
	}
	summary, err := application.todaySummaryData(ctx, todayString, nil)
	if err != nil {
		t.Fatal(err)
	}
	if got := intValue(summary["total_feed_ml"]); got != 0 {
		t.Fatalf("today feed total = %d, want 0", got)
	}
	if got := stringValue(summary["last_feed_time"]); got != yesterdayString+" 23:30:00" {
		t.Fatalf("last feed = %q", got)
	}

	timestamp := todayString + " 08:00:00"
	if _, err := application.db.ExecContext(ctx,
		"INSERT INTO records (baby_id, type, sub_type, amount, timestamp) VALUES (1, 'feed', 'formula', 60, ?)",
		timestamp); err != nil {
		t.Fatal(err)
	}
	if _, err := application.db.ExecContext(ctx,
		"INSERT INTO records (baby_id, type, sub_type, amount, timestamp) VALUES (1, 'feed', 'formula', 80, ?)",
		timestamp); err != nil {
		t.Fatal(err)
	}
	latest, err := application.latestFeed(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if got := intValue(latest["amount"]); got != 80 {
		t.Fatalf("latest feed amount = %d, want 80", got)
	}
}

func TestHAStatusUsesStandardSensorPayload(t *testing.T) {
	application := newTestApp(t)
	cookie := loginAsAdmin(t, application)
	ctx := context.Background()
	todayString := today().Format("2006-01-02")
	yesterdayString := today().AddDate(0, 0, -1).Format("2006-01-02")
	records := []struct {
		typ, subType, timestamp string
		amount                  any
	}{
		{"feed", "formula", todayString + " 08:00:00", 120},
		{"excrete", "urine", todayString + " 09:00:00", nil},
		{"excrete", "both", todayString + " 10:00:00", nil},
		{"feed", "breast_right", yesterdayString + " 23:00:00", 90},
	}
	for _, record := range records {
		if _, err := application.db.ExecContext(ctx,
			"INSERT INTO records (baby_id, type, sub_type, amount, timestamp) VALUES (1, ?, ?, ?, ?)",
			record.typ, record.subType, record.amount, record.timestamp); err != nil {
			t.Fatal(err)
		}
	}

	request := httptest.NewRequest(http.MethodGet, "/api/ha/status?date="+todayString, nil)
	response := performRequest(application, request, cookie)
	if response.Code != http.StatusOK {
		t.Fatalf("HA status = %d, body = %s", response.Code, response.Body.String())
	}
	var payload struct {
		State      float64 `json:"state"`
		Attributes struct {
			TotalFeedML  float64 `json:"total_feed_ml"`
			FeedCount    float64 `json:"feed_count"`
			UrineCount   float64 `json:"urine_count"`
			StoolCount   float64 `json:"stool_count"`
			LastFeedTime string  `json:"last_feed_time"`
		} `json:"attributes"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.State != 120 || payload.Attributes.TotalFeedML != 120 {
		t.Fatalf("HA state = %v, total = %v", payload.State, payload.Attributes.TotalFeedML)
	}
	if payload.Attributes.FeedCount != 1 || payload.Attributes.UrineCount != 2 || payload.Attributes.StoolCount != 1 {
		t.Fatalf("HA counts = %+v", payload.Attributes)
	}
	if payload.Attributes.LastFeedTime != todayString+" 08:00:00" {
		t.Fatalf("HA last feed = %q", payload.Attributes.LastFeedTime)
	}
}

func TestAPIReadEndpointsRequireAuthentication(t *testing.T) {
	application := newTestApp(t)

	readPaths := []string{
		"/api/quick-buttons",
		"/api/records/dates",
		"/api/records/today",
		"/api/records/1",
		"/api/records",
		"/api/baby",
		"/api/settings",
		"/api/milk-estimate",
		"/api/users",
		"/api/audit-logs",
		"/api/export/csv",
		"/api/backup/export",
		"/api/stats",
		"/api/growth-logs",
		"/api/weight-logs",
		"/api/stats/trends",
		"/api/vaccine/schedule",
		"/api/vaccine/dates",
		"/api/vaccine/day-records",
		"/api/health/schedule",
		"/api/health/dates",
		"/api/health/day-records",
		"/api/countdowns",
		"/api/mcp/config",
		"/api/mcp/api-key",
		"/api/ha/status",
		"/api/ha/feed-today",
		"/api/ha/last-feed",
		"/api/ha/excrete-today",
		"/api/ha/buttons",
		"/api/ha/button/1",
	}
	for _, path := range readPaths {
		t.Run(path, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, path, nil)
			response := performRequest(application, request, nil)
			if response.Code != http.StatusUnauthorized {
				t.Fatalf("anonymous GET %s = %d, want %d", path, response.Code, http.StatusUnauthorized)
			}
		})
	}

	meRequest := httptest.NewRequest(http.MethodGet, "/api/auth/me", nil)
	meResponse := performRequest(application, meRequest, nil)
	if meResponse.Code != http.StatusOK {
		t.Fatalf("anonymous auth probe = %d, want %d", meResponse.Code, http.StatusOK)
	}
	var mePayload struct {
		User any `json:"user"`
	}
	if err := json.Unmarshal(meResponse.Body.Bytes(), &mePayload); err != nil {
		t.Fatalf("decode anonymous auth probe: %v", err)
	}
	if mePayload.User != nil {
		t.Fatalf("anonymous auth probe user = %v, want null", mePayload.User)
	}

	apiKeyRequest := httptest.NewRequest(http.MethodGet, "/api/ha/api-key", nil)
	apiKeyResponse := performRequest(application, apiKeyRequest, nil)
	if apiKeyResponse.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous HA API key GET = %d, want %d", apiKeyResponse.Code, http.StatusUnauthorized)
	}

	pressRequest := httptest.NewRequest(http.MethodPost, "/api/ha/button/1", nil)
	pressResponse := performRequest(application, pressRequest, nil)
	if pressResponse.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous HA button POST = %d, want %d", pressResponse.Code, http.StatusUnauthorized)
	}
}

func TestHAReadEndpointsAcceptAPIKey(t *testing.T) {
	application := newTestApp(t)
	if _, err := application.db.ExecContext(context.Background(),
		"INSERT INTO settings (key, value) VALUES ('ha_api_key', 'sensor-key')"); err != nil {
		t.Fatal(err)
	}

	readPaths := []string{
		"/api/ha/status",
		"/api/ha/feed-today",
		"/api/ha/last-feed",
		"/api/ha/excrete-today",
		"/api/ha/buttons",
		"/api/ha/button/1",
	}
	for _, path := range readPaths {
		t.Run(path, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, path, nil)
			request.Header.Set("X-API-Key", "sensor-key")
			response := performRequest(application, request, nil)
			if response.Code != http.StatusOK {
				t.Fatalf("API-key GET %s = %d, body = %s", path, response.Code, response.Body.String())
			}
		})
	}
}

func TestVaccineScheduleMatches2026Edition(t *testing.T) {
	application := newTestApp(t)
	schedule, _, message, err := application.vaccineScheduleData(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if message != "" {
		t.Fatal(message)
	}
	if len(schedule) != len(vaccineSchedule) || len(schedule) != 30 {
		t.Fatalf("schedule length = %d, want 30", len(schedule))
	}
	ages := make(map[string][]int)
	for _, item := range schedule {
		short := stringValue(item["short"])
		ages[short] = append(ages[short], int(intValue(item["age_months"])))
	}
	if got := joinInts(ages["MMR"]); got != "8,24" {
		t.Fatalf("MMR ages = %s", got)
	}
	if len(ages["JE-I"]) != 4 || len(ages["2vHPV"]) != 2 {
		t.Fatalf("JE-I ages = %v, 2vHPV ages = %v", ages["JE-I"], ages["2vHPV"])
	}
}

func joinInts(values []int) string {
	parts := make([]string, len(values))
	for index, value := range values {
		parts[index] = strconv.Itoa(value)
	}
	return strings.Join(parts, ",")
}

func TestWerkzeugPasswordHashesRemainValid(t *testing.T) {
	tests := []struct {
		name     string
		stored   string
		password string
	}{
		{
			name:     "pbkdf2",
			stored:   "pbkdf2:sha256:600000$test-salt$a0517ff63f490f853971bb304215bd2e02e0f49196297eed927e5650c9cc7479",
			password: "correct horse",
		},
		{
			name:     "scrypt",
			stored:   "scrypt:32768:8:1$test-salt$03a8dc6eb997146c7a421eedfa645ca61b1d41633731ee4ae30adb2d2e0f4850",
			password: "correct horse",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if !checkPassword(test.stored, test.password) {
				t.Fatal("stored Werkzeug hash was rejected")
			}
			if checkPassword(test.stored, "wrong password") {
				t.Fatal("incorrect password was accepted")
			}
		})
	}
}

func TestBackupRestoreReplacesEmptyTablesAndRejectsInvalidColumns(t *testing.T) {
	application := newTestApp(t)
	cookie := loginAsAdmin(t, application)
	ctx := context.Background()
	if _, err := application.db.ExecContext(ctx,
		"INSERT INTO records (baby_id, type, sub_type, amount, timestamp) VALUES (1, 'feed', 'formula', 60, ?)",
		testNowTimestamp()); err != nil {
		t.Fatal(err)
	}

	invalid := mustBackupJSON(t, backupPayload{
		Version: 1,
		Tables: map[string]backupTable{
			"records": {Columns: []string{"id", "not_a_column"}, Rows: []map[string]any{{"id": 1}}},
		},
	})
	invalidResponse := performRestore(application, cookie, invalid)
	if invalidResponse.Code != http.StatusBadRequest {
		t.Fatalf("invalid restore status = %d, body = %s", invalidResponse.Code, invalidResponse.Body.String())
	}
	if count := tableCount(t, application, "records"); count != 1 {
		t.Fatalf("records after rejected restore = %d, want 1", count)
	}

	invalidRows := mustBackupJSON(t, backupPayload{
		Version: 1,
		Tables: map[string]backupTable{
			"records": {Columns: []string{"id"}, Rows: []map[string]any{{"id": 2}}},
		},
	})
	invalidRowsResponse := performRestore(application, cookie, invalidRows)
	if invalidRowsResponse.Code != http.StatusBadRequest {
		t.Fatalf("invalid rows status = %d, body = %s", invalidRowsResponse.Code, invalidRowsResponse.Body.String())
	}
	if count := tableCount(t, application, "records"); count != 1 {
		t.Fatalf("records after invalid row restore = %d, want 1", count)
	}

	empty := mustBackupJSON(t, backupPayload{
		Version: 1,
		Tables: map[string]backupTable{
			"records": {Columns: backupColumns["records"], Rows: []map[string]any{}},
		},
	})
	emptyResponse := performRestore(application, cookie, empty)
	if emptyResponse.Code != http.StatusOK {
		t.Fatalf("empty restore status = %d, body = %s", emptyResponse.Code, emptyResponse.Body.String())
	}
	if count := tableCount(t, application, "records"); count != 0 {
		t.Fatalf("records after empty restore = %d, want 0", count)
	}
}

func mustBackupJSON(t *testing.T, payload backupPayload) []byte {
	t.Helper()
	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func performRestore(application *App, cookie *http.Cookie, raw []byte) *httptest.ResponseRecorder {
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("file", "backup.json")
	if err != nil {
		panic(err)
	}
	if _, err := part.Write(raw); err != nil {
		panic(err)
	}
	if err := writer.Close(); err != nil {
		panic(err)
	}
	request := httptest.NewRequest(http.MethodPost, "/api/backup/restore", &body)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	return performRequest(application, request, cookie)
}

func tableCount(t *testing.T, application *App, table string) int {
	t.Helper()
	var count int
	if err := application.db.QueryRowContext(context.Background(), "SELECT COUNT(*) FROM "+table).Scan(&count); err != nil {
		t.Fatal(err)
	}
	return count
}

func testNowTimestamp() string {
	return time.Now().Format("2006-01-02 15:04:05")
}
