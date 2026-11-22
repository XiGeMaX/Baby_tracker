package app

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func createUserDatabase(t *testing.T, dataDir, username, passwordHash string) {
	t.Helper()
	db, err := sql.Open("sqlite", filepath.Join(dataDir, "baby.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.ExecContext(t.Context(), `
		CREATE TABLE users (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			username TEXT NOT NULL UNIQUE,
			password_hash TEXT NOT NULL,
			nickname TEXT NOT NULL DEFAULT '',
			role TEXT NOT NULL DEFAULT 'user',
			status TEXT NOT NULL DEFAULT 'pending',
			created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
		)
	`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(t.Context(), `
		INSERT INTO users (username, password_hash, nickname, role, status)
		VALUES (?, ?, '管理员', 'admin', 'approved')
	`, username, passwordHash); err != nil {
		t.Fatal(err)
	}
}

func createDefaultDatabase(t *testing.T, dataDir string) {
	t.Helper()
	db, err := openDatabase(filepath.Join(dataDir, "baby.db"))
	if err != nil {
		t.Fatal(err)
	}
	application := &App{db: db}
	if err := application.initDatabase(context.Background(), true); err != nil {
		_ = db.Close()
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
}

func webDirForTest(t *testing.T) string {
	t.Helper()
	webDir, err := filepath.Abs(filepath.Join("..", ".."))
	if err != nil {
		t.Fatal(err)
	}
	return webDir
}

func TestResolveDataDirPrefersLegacyDatabaseOverFreshDefaultDatabase(t *testing.T) {
	t.Parallel()
	primary := t.TempDir()
	legacy := t.TempDir()
	createDefaultDatabase(t, primary)
	createUserDatabase(t, legacy, "caregiver", hashPassword("existing-password"))

	got, err := resolveDataDir(primary, []string{legacy})
	if err != nil {
		t.Fatal(err)
	}
	if got != legacy {
		t.Fatalf("resolved data dir = %q, want legacy %q", got, legacy)
	}
}

func TestNewLoadsLegacyDataAndDoesNotReplaceExistingAdmin(t *testing.T) {
	t.Parallel()
	primary := t.TempDir()
	legacy := t.TempDir()
	const password = "existing-password"
	createDefaultDatabase(t, primary)
	createUserDatabase(t, legacy, "caregiver", hashPassword(password))

	application, err := New(t.Context(), Config{
		DataDir:        primary,
		LegacyDataDirs: []string{legacy},
		WebDir:         webDirForTest(t),
		SessionSecret:  "test-secret",
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := application.Close(); err != nil {
			t.Errorf("close app: %v", err)
		}
	})

	if application.cfg.DataDir != legacy {
		t.Fatalf("application data dir = %q, want legacy %q", application.cfg.DataDir, legacy)
	}
	var adminCount int
	if err := application.db.QueryRowContext(t.Context(),
		"SELECT COUNT(*) FROM users WHERE role = 'admin'").Scan(&adminCount); err != nil {
		t.Fatal(err)
	}
	if adminCount != 1 {
		t.Fatalf("admin count = %d, want 1", adminCount)
	}
	var username, passwordHash string
	if err := application.db.QueryRowContext(t.Context(),
		"SELECT username, password_hash FROM users WHERE role = 'admin'").Scan(&username, &passwordHash); err != nil {
		t.Fatal(err)
	}
	if username != "caregiver" || !checkPassword(passwordHash, password) {
		t.Fatalf("existing admin was not preserved: username=%q", username)
	}
	if application.adminPasswordSetupRequired(t.Context(), map[string]any{
		"role":   "admin",
		"status": "approved",
	}) {
		t.Fatal("migrated administrator was still forced through password setup")
	}
}

func TestExistingDatabaseWithoutAdminDoesNotSeedDefaultAccount(t *testing.T) {
	t.Parallel()
	dataDir := t.TempDir()
	db, err := openDatabase(filepath.Join(dataDir, "baby.db"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(t.Context(), schemaSQL); err != nil {
		_ = db.Close()
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}

	application, err := New(t.Context(), Config{
		DataDir:       dataDir,
		WebDir:        webDirForTest(t),
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

	var adminCount int
	if err := application.db.QueryRowContext(t.Context(),
		"SELECT COUNT(*) FROM users WHERE role = 'admin'").Scan(&adminCount); err != nil {
		t.Fatal(err)
	}
	if adminCount != 0 {
		t.Fatalf("admin count = %d, want 0 for an existing database", adminCount)
	}
}

func TestResolveDataDirRejectsAmbiguousPopulatedDatabases(t *testing.T) {
	t.Parallel()
	primary := t.TempDir()
	legacy := t.TempDir()
	createUserDatabase(t, primary, "primary-admin", hashPassword("primary-password"))
	createUserDatabase(t, legacy, "legacy-admin", hashPassword("legacy-password"))

	_, err := resolveDataDir(primary, []string{legacy})
	if err == nil {
		t.Fatal("expected ambiguous databases to fail")
	}
	if !strings.Contains(err.Error(), "multiple Baby Tracker databases") ||
		!strings.Contains(err.Error(), "BABY_TRACKER_DATA_DIR") {
		t.Fatalf("ambiguous database error is not actionable: %v", err)
	}
}

func TestInspectDataDirectoryReportsPathErrors(t *testing.T) {
	t.Parallel()
	parent := t.TempDir()
	notDirectory := filepath.Join(parent, "not-a-directory")
	if err := os.WriteFile(notDirectory, []byte("file"), 0o600); err != nil {
		t.Fatal(err)
	}

	_, err := inspectDataDirectory(notDirectory)
	if err == nil {
		t.Fatal("expected an unusable data path to fail")
	}
	if !strings.Contains(err.Error(), "baby.db") {
		t.Fatalf("path error does not identify the database: %v", err)
	}
}
