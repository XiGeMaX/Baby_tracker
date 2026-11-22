package app

import (
	"path/filepath"
	"testing"
)

func TestResetAdminPasswordCreatesAdminForExistingDatabase(t *testing.T) {
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

	username, password, err := application.ResetAdminPassword(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	if username != "admin" || password == "" {
		t.Fatalf("reset credentials = %q/%q", username, password)
	}

	var passwordHash string
	if err := application.db.QueryRowContext(t.Context(),
		"SELECT password_hash FROM users WHERE username = 'admin' AND role = 'admin' AND status = 'approved'").
		Scan(&passwordHash); err != nil {
		t.Fatal(err)
	}
	if !checkPassword(passwordHash, password) {
		t.Fatal("created administrator password hash does not match the generated password")
	}
}
