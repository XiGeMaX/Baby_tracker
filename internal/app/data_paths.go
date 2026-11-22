package app

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type dataDirectoryState struct {
	path       string
	exists     bool
	disposable bool
}

func resolveDataDir(primary string, legacyDirs []string) (string, error) {
	candidates := append([]string{primary}, legacyDirs...)
	seen := make(map[string]bool, len(candidates))
	states := make([]dataDirectoryState, 0, len(candidates))
	for _, candidate := range candidates {
		candidate = filepath.Clean(strings.TrimSpace(candidate))
		if candidate == "." || seen[candidate] {
			continue
		}
		seen[candidate] = true
		state, err := inspectDataDirectory(candidate)
		if err != nil {
			return "", err
		}
		if state.exists {
			states = append(states, state)
		}
	}

	if len(states) == 0 {
		return primary, nil
	}
	if len(states) == 1 {
		return states[0].path, nil
	}

	var populated []dataDirectoryState
	for _, state := range states {
		if !state.disposable {
			populated = append(populated, state)
		}
	}
	switch len(populated) {
	case 0:
		return states[0].path, nil
	case 1:
		return populated[0].path, nil
	default:
		return "", fmt.Errorf(
			"found multiple Baby Tracker databases with existing data at %s and %s; set BABY_TRACKER_DATA_DIR to the database you want to keep",
			populated[0].path,
			populated[1].path,
		)
	}
}

func inspectDataDirectory(path string) (dataDirectoryState, error) {
	state := dataDirectoryState{path: path}
	databasePath := filepath.Join(path, "baby.db")
	info, err := os.Stat(databasePath)
	switch {
	case err == nil:
		if !info.Mode().IsRegular() {
			return state, fmt.Errorf("database path %s is not a regular file", databasePath)
		}
		state.exists = true
	case errors.Is(err, fs.ErrNotExist):
		return state, nil
	default:
		return state, fmt.Errorf("inspect existing database %s: %w", databasePath, err)
	}

	state.disposable, err = databaseIsFreshDefault(databasePath)
	if err != nil {
		return state, fmt.Errorf("inspect existing database %s: %w", databasePath, err)
	}
	return state, nil
}

func databaseIsFreshDefault(path string) (bool, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return false, err
	}
	defer db.Close()
	db.SetMaxOpenConns(1)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if _, err := db.ExecContext(ctx, "PRAGMA query_only = ON"); err != nil {
		return false, err
	}

	var userTableCount int
	if err := db.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'users'").Scan(&userTableCount); err != nil {
		return false, err
	}
	if userTableCount == 0 {
		return false, nil
	}

	rows, err := db.QueryContext(ctx,
		"SELECT username, password_hash, role, status FROM users ORDER BY id")
	if err != nil {
		return false, err
	}
	defer rows.Close()
	type storedUser struct {
		username     string
		passwordHash string
		role         string
		status       string
	}
	var users []storedUser
	for rows.Next() {
		var user storedUser
		if err := rows.Scan(&user.username, &user.passwordHash, &user.role, &user.status); err != nil {
			return false, err
		}
		users = append(users, user)
	}
	if err := rows.Err(); err != nil {
		return false, err
	}
	if len(users) != 1 {
		return false, nil
	}
	admin := users[0]
	if admin.username != "admin" || admin.role != "admin" || admin.status != "approved" ||
		!checkPassword(admin.passwordHash, "admin123") {
		return false, nil
	}

	var initializedCount int
	if err := db.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM settings WHERE key = 'admin_password_initialized'").Scan(&initializedCount); err != nil {
		return false, nil
	}
	if initializedCount > 0 {
		return false, nil
	}

	var babyCount int
	var babyName, babyGender string
	var babyWeight, babyPremature float64
	if err := db.QueryRowContext(ctx, `
		SELECT COUNT(*), COALESCE(MIN(name), ''), COALESCE(MIN(gender), ''),
			COALESCE(MIN(weight), 0), COALESCE(MIN(is_premature), 0)
		FROM babies
	`).Scan(&babyCount, &babyName, &babyGender, &babyWeight, &babyPremature); err != nil {
		return false, nil
	}
	if babyCount > 1 || (babyCount == 1 &&
		(babyName != "宝宝" || babyGender != "male" || babyWeight != 3.0 || babyPremature != 0)) {
		return false, nil
	}

	var customTarget, feedsPerDay, mcpEnabled, mcpPermission string
	if err := db.QueryRowContext(ctx, `
		SELECT
			COALESCE(MAX(CASE WHEN key = 'custom_daily_target' THEN value END), ''),
			COALESCE(MAX(CASE WHEN key = 'feeds_per_day' THEN value END), ''),
			COALESCE(MAX(CASE WHEN key = 'mcp_enabled' THEN value END), ''),
			COALESCE(MAX(CASE WHEN key = 'mcp_permission_level' THEN value END), '')
		FROM settings
	`).Scan(&customTarget, &feedsPerDay, &mcpEnabled, &mcpPermission); err != nil {
		return false, nil
	}
	if customTarget != "" || feedsPerDay != "8" || mcpEnabled != "0" || mcpPermission != "basic" {
		return false, nil
	}

	var quickButtonCount int
	if err := db.QueryRowContext(ctx, "SELECT COUNT(*) FROM quick_buttons").Scan(&quickButtonCount); err != nil {
		return false, nil
	}
	if quickButtonCount != 12 {
		return false, nil
	}

	var businessRecordCount int
	if err := db.QueryRowContext(ctx, `
		SELECT
			(SELECT COUNT(*) FROM records) +
			(SELECT COUNT(*) FROM weight_logs) +
			(SELECT COUNT(*) FROM vaccine_records) +
			(SELECT COUNT(*) FROM vaccine_plan_overrides) +
			(SELECT COUNT(*) FROM vaccine_plan_deleted) +
			(SELECT COUNT(*) FROM vaccine_custom_plans) +
			(SELECT COUNT(*) FROM health_followup_records) +
			(SELECT COUNT(*) FROM health_followup_overrides) +
			(SELECT COUNT(*) FROM countdown_events)
	`).Scan(&businessRecordCount); err != nil {
		return false, nil
	}
	return businessRecordCount == 0, nil
}
