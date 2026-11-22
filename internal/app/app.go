package app

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/flosch/pongo2/v6"
)

// App owns the HTTP API, database, and in-memory Home Assistant switch state.
type App struct {
	cfg       Config
	db        *sql.DB
	templates *pongo2.TemplateSet
	mux       *http.ServeMux
	logger    *slog.Logger
	mcp       http.Handler

	haMu     sync.Mutex
	haStates map[int64]string
	haTimers map[int64]*time.Timer
}

// New creates an application, opens the SQLite database, and applies migrations.
func New(ctx context.Context, cfg Config) (*App, error) {
	dataDir, err := resolveDataDir(cfg.DataDir, cfg.LegacyDataDirs)
	if err != nil {
		return nil, err
	}
	cfg.DataDir = dataDir
	if cfg.SessionSecret == "" {
		secret, err := loadOrCreateSessionSecret(cfg.DataDir)
		if err != nil {
			return nil, err
		}
		cfg.SessionSecret = secret
	}
	dbPath := filepath.Join(cfg.DataDir, "baby.db")
	newDatabase, err := databaseIsNew(dbPath)
	if err != nil {
		return nil, err
	}
	db, err := openDatabase(dbPath)
	if err != nil {
		return nil, err
	}
	templateDir := filepath.Join(cfg.WebDir, "templates")
	if _, err := os.Stat(templateDir); err != nil {
		_ = db.Close()
		return nil, err
	}
	application := &App{
		cfg:       cfg,
		db:        db,
		templates: pongo2.NewSet("baby-tracker", pongo2.MustNewLocalFileSystemLoader(templateDir)),
		mux:       http.NewServeMux(),
		logger:    slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo})),
		haStates:  make(map[int64]string),
		haTimers:  make(map[int64]*time.Timer),
	}
	if err := application.initDatabase(ctx, newDatabase); err != nil {
		_ = db.Close()
		return nil, err
	}
	application.mcp = application.newMCPHandler()
	application.registerRoutes()
	return application, nil
}

func databaseIsNew(path string) (bool, error) {
	info, err := os.Stat(path)
	switch {
	case err == nil:
		if !info.Mode().IsRegular() {
			return false, fmt.Errorf("database path %s is not a regular file", path)
		}
		return info.Size() == 0, nil
	case os.IsNotExist(err):
		return true, nil
	default:
		return false, fmt.Errorf("inspect database %s: %w", path, err)
	}
}

// Close releases the database and cancels pending Home Assistant timers.
func (a *App) Close() error {
	a.haMu.Lock()
	for _, timer := range a.haTimers {
		timer.Stop()
	}
	a.haTimers = make(map[int64]*time.Timer)
	a.haStates = make(map[int64]string)
	a.haMu.Unlock()
	return a.db.Close()
}

// Handler returns the complete middleware and route stack.
func (a *App) Handler() http.Handler {
	return a.basePathMiddleware(a.authMiddleware(a.mux))
}

// DB exposes the underlying database for command-line maintenance.
func (a *App) DB() *sql.DB {
	return a.db
}

func loadOrCreateSessionSecret(dataDir string) (string, error) {
	if err := mkdirAll(dataDir); err != nil {
		return "", err
	}
	path := filepath.Join(dataDir, "secret_key")
	if raw, err := os.ReadFile(path); err == nil {
		secret := string(raw)
		if secret != "" {
			if err := os.Chmod(path, 0o600); err != nil {
				return "", fmt.Errorf("secure session secret: %w", err)
			}
			return secret, nil
		}
	} else if !os.IsNotExist(err) {
		return "", err
	}
	secret := randomToken(48)
	if err := os.WriteFile(path, []byte(secret), 0o600); err != nil {
		return "", err
	}
	if err := os.Chmod(path, 0o600); err != nil {
		return "", fmt.Errorf("secure session secret: %w", err)
	}
	return secret, nil
}
