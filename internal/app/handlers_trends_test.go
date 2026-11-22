package app

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

func TestGrowthLogMigrationPreservesWeightsAndAllowsHeightOnly(t *testing.T) {
	dataDir := t.TempDir()
	databasePath := filepath.Join(dataDir, "baby.db")
	createUserDatabase(t, dataDir, "admin", hashPassword("admin123"))
	legacy, err := sql.Open("sqlite", databasePath)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := legacy.ExecContext(context.Background(), `CREATE TABLE weight_logs (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		baby_id INTEGER NOT NULL DEFAULT 1,
		weight REAL NOT NULL,
		recorded_date TEXT NOT NULL,
		note TEXT DEFAULT '',
		created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
	)`); err != nil {
		t.Fatal(err)
	}
	if _, err := legacy.ExecContext(context.Background(),
		"INSERT INTO weight_logs (baby_id, weight, recorded_date, note) VALUES (1, 4.25, ?, '')",
		today().Format("2006-01-02")); err != nil {
		t.Fatal(err)
	}
	if err := legacy.Close(); err != nil {
		t.Fatal(err)
	}

	webDir, err := filepath.Abs(filepath.Join("..", ".."))
	if err != nil {
		t.Fatal(err)
	}
	application, err := New(context.Background(), Config{
		DataDir:       dataDir,
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
	if err := application.markAdminPasswordInitialized(context.Background()); err != nil {
		t.Fatal(err)
	}

	var weightNotNull, hasHeight int
	rows, err := application.db.QueryContext(context.Background(), "PRAGMA table_info(weight_logs)")
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var (
			cid          int
			name, typ    string
			notNull, pk  int
			defaultValue any
		)
		if err := rows.Scan(&cid, &name, &typ, &notNull, &defaultValue, &pk); err != nil {
			t.Fatal(err)
		}
		if name == "weight" {
			weightNotNull = notNull
		}
		if name == "height" {
			hasHeight = 1
		}
	}
	if err := rows.Close(); err != nil {
		t.Fatal(err)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if weightNotNull != 0 || hasHeight != 1 {
		t.Fatalf("weight NOT NULL = %d, has height = %d; want 0, 1", weightNotNull, hasHeight)
	}

	cookie := loginAsAdmin(t, application)
	response := performRequest(application, httptest.NewRequest(http.MethodPost, "/api/growth-logs",
		strings.NewReader(`{"height":62.5,"recorded_date":"`+today().Format("2006-01-02")+`","note":""}`)), cookie)
	if response.Code != http.StatusCreated {
		t.Fatalf("create height-only growth log status = %d, body = %s", response.Code, response.Body.String())
	}

	var (
		legacyWeight float64
		heightOnly   float64
		heightWeight sql.NullFloat64
	)
	if err := application.db.QueryRowContext(context.Background(),
		"SELECT weight FROM weight_logs ORDER BY id LIMIT 1").Scan(&legacyWeight); err != nil {
		t.Fatal(err)
	}
	if err := application.db.QueryRowContext(context.Background(),
		"SELECT height, weight FROM weight_logs ORDER BY id DESC LIMIT 1").Scan(&heightOnly, &heightWeight); err != nil {
		t.Fatal(err)
	}
	if legacyWeight != 4.25 || heightOnly != 62.5 || heightWeight.Valid {
		t.Fatalf("legacy weight = %v, height = %v, height-only weight = %+v", legacyWeight, heightOnly, heightWeight)
	}
}

func TestGrowthLogsFeedGrowthTrends(t *testing.T) {
	application := newTestApp(t)
	cookie := loginAsAdmin(t, application)
	date := today().Format("2006-01-02")
	create := performRequest(application, httptest.NewRequest(http.MethodPost, "/api/growth-logs",
		strings.NewReader(`{"weight":6.42,"height":63.5,"recorded_date":"`+date+`","note":"满月"}`)), cookie)
	if create.Code != http.StatusCreated {
		t.Fatalf("create growth log status = %d, body = %s", create.Code, create.Body.String())
	}

	response := performRequest(application, httptest.NewRequest(http.MethodGet,
		"/api/stats/trends?growth_days=30&mode=day", nil), cookie)
	if response.Code != http.StatusOK {
		t.Fatalf("trends status = %d, body = %s", response.Code, response.Body.String())
	}
	var payload struct {
		GrowthDays int `json:"growth_days"`
		Growth     []struct {
			Weight *float64 `json:"weight"`
			Height *float64 `json:"height"`
		} `json:"growth"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.GrowthDays != 30 || len(payload.Growth) != 1 {
		t.Fatalf("growth days = %d, growth count = %d", payload.GrowthDays, len(payload.Growth))
	}
	if payload.Growth[0].Weight == nil || *payload.Growth[0].Weight != 6.42 {
		t.Fatalf("growth weight = %v", payload.Growth[0].Weight)
	}
	if payload.Growth[0].Height == nil || *payload.Growth[0].Height != 63.5 {
		t.Fatalf("growth height = %v", payload.Growth[0].Height)
	}
}

func TestGrowthTrendsSupportsThreeAndFiveYearRanges(t *testing.T) {
	application := newTestApp(t)
	cookie := loginAsAdmin(t, application)
	olderDate := today().AddDate(-4, 0, 0).Format("2006-01-02")
	if _, err := application.db.ExecContext(context.Background(), `
		INSERT INTO weight_logs (baby_id, weight, height, recorded_date, note)
		VALUES (1, 14.2, 102.5, ?, 'older growth log')`, olderDate); err != nil {
		t.Fatal(err)
	}

	tests := []struct {
		name     string
		days     int
		wantLogs int
	}{
		{name: "three years", days: 1095, wantLogs: 0},
		{name: "five years", days: 1825, wantLogs: 1},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			response := performRequest(application, httptest.NewRequest(http.MethodGet,
				"/api/stats/trends?growth_days="+strconv.Itoa(test.days)+"&mode=day", nil), cookie)
			if response.Code != http.StatusOK {
				t.Fatalf("growth days %d status = %d, body = %s", test.days, response.Code, response.Body.String())
			}
			var payload struct {
				GrowthDays int   `json:"growth_days"`
				Growth     []any `json:"growth"`
			}
			if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
				t.Fatal(err)
			}
			if payload.GrowthDays != test.days || len(payload.Growth) != test.wantLogs {
				t.Fatalf("growth days %d = %d, logs = %d; want days %d, logs %d",
					test.days, payload.GrowthDays, len(payload.Growth), test.days, test.wantLogs)
			}
		})
	}
}

func TestAddingOlderWeightDoesNotReplaceCurrentWeight(t *testing.T) {
	application := newTestApp(t)
	cookie := loginAsAdmin(t, application)
	todayDate := today().Format("2006-01-02")
	olderDate := today().AddDate(0, 0, -7).Format("2006-01-02")

	for _, body := range []string{
		`{"weight":7.1,"recorded_date":"` + todayDate + `"}`,
		`{"weight":5.2,"recorded_date":"` + olderDate + `"}`,
	} {
		response := performRequest(application, httptest.NewRequest(http.MethodPost, "/api/growth-logs",
			strings.NewReader(body)), cookie)
		if response.Code != http.StatusCreated {
			t.Fatalf("create growth log status = %d, body = %s", response.Code, response.Body.String())
		}
	}

	var currentWeight float64
	if err := application.db.QueryRowContext(context.Background(),
		"SELECT weight FROM babies WHERE id = 1").Scan(&currentWeight); err != nil {
		t.Fatal(err)
	}
	if currentWeight != 7.1 {
		t.Fatalf("current baby weight = %v, want 7.1", currentWeight)
	}
}

func TestGrowthLogsListIncludesRecordsOutsideTrendRange(t *testing.T) {
	application := newTestApp(t)
	cookie := loginAsAdmin(t, application)
	recentDate := today().Format("2006-01-02")
	olderDate := today().AddDate(0, 0, -120).Format("2006-01-02")

	for _, body := range []string{
		`{"weight":6.4,"height":63.5,"recorded_date":"` + recentDate + `"}`,
		`{"weight":3.6,"height":51.8,"recorded_date":"` + olderDate + `"}`,
	} {
		response := performRequest(application, httptest.NewRequest(http.MethodPost, "/api/growth-logs",
			strings.NewReader(body)), cookie)
		if response.Code != http.StatusCreated {
			t.Fatalf("create growth log status = %d, body = %s", response.Code, response.Body.String())
		}
	}

	trendsResponse := performRequest(application, httptest.NewRequest(http.MethodGet,
		"/api/stats/trends?growth_days=30&mode=day", nil), cookie)
	if trendsResponse.Code != http.StatusOK {
		t.Fatalf("trends status = %d, body = %s", trendsResponse.Code, trendsResponse.Body.String())
	}
	var trendsPayload struct {
		Growth []any `json:"growth"`
	}
	if err := json.Unmarshal(trendsResponse.Body.Bytes(), &trendsPayload); err != nil {
		t.Fatal(err)
	}
	if len(trendsPayload.Growth) != 1 {
		t.Fatalf("trend growth count = %d, want 1", len(trendsPayload.Growth))
	}

	logsResponse := performRequest(application, httptest.NewRequest(http.MethodGet,
		"/api/growth-logs", nil), cookie)
	if logsResponse.Code != http.StatusOK {
		t.Fatalf("growth logs status = %d, body = %s", logsResponse.Code, logsResponse.Body.String())
	}
	var logs []struct {
		RecordedDate string `json:"recorded_date"`
	}
	if err := json.Unmarshal(logsResponse.Body.Bytes(), &logs); err != nil {
		t.Fatal(err)
	}
	if len(logs) != 2 || logs[1].RecordedDate != olderDate {
		t.Fatalf("growth logs = %+v, want records through %s", logs, olderDate)
	}
}
