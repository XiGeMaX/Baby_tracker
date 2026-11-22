package app

import (
	"path/filepath"
	"testing"
)

func TestLoadConfigReadsLegacyDataDir(t *testing.T) {
	primary := filepath.Join(t.TempDir(), "current")
	legacy := filepath.Join(t.TempDir(), "legacy")
	t.Setenv("BABY_TRACKER_DATA_DIR", primary)
	t.Setenv("BABY_TRACKER_LEGACY_DATA_DIR", legacy)

	cfg := LoadConfig()

	if cfg.DataDir != primary {
		t.Fatalf("data dir = %q, want %q", cfg.DataDir, primary)
	}
	if len(cfg.LegacyDataDirs) != 1 || cfg.LegacyDataDirs[0] != legacy {
		t.Fatalf("legacy data dirs = %v, want [%s]", cfg.LegacyDataDirs, legacy)
	}
}
