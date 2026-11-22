package app

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

const schemaSQL = `
CREATE TABLE IF NOT EXISTS babies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL DEFAULT '宝宝',
    gender TEXT NOT NULL DEFAULT 'male',
    birth_date TEXT NOT NULL,
    weight REAL NOT NULL DEFAULT 3.0,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    baby_id INTEGER NOT NULL DEFAULT 1,
    user_id INTEGER,
    type TEXT NOT NULL,
    sub_type TEXT NOT NULL,
    amount REAL,
    duration INTEGER,
    color TEXT,
    consistency TEXT,
    temperature REAL,
    note TEXT,
    timestamp TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL UNIQUE,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    nickname TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL DEFAULT 'user',
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS quick_buttons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    sub_type TEXT NOT NULL,
    label TEXT NOT NULL,
    amount REAL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    username TEXT NOT NULL DEFAULT '',
    action TEXT NOT NULL,
    target_type TEXT NOT NULL DEFAULT '',
    target_id INTEGER,
    detail TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS weight_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    baby_id INTEGER NOT NULL DEFAULT 1,
    weight REAL,
    height REAL,
    recorded_date TEXT NOT NULL,
    note TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    CHECK (weight IS NOT NULL OR height IS NOT NULL)
);
CREATE TABLE IF NOT EXISTS vaccine_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vaccine_name TEXT NOT NULL,
    dose_index INTEGER NOT NULL,
    vaccinated_date TEXT NOT NULL,
    note TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    UNIQUE(vaccine_name, dose_index)
);
CREATE TABLE IF NOT EXISTS vaccine_plan_overrides (
    vaccine_name TEXT NOT NULL,
    dose_index INTEGER NOT NULL,
    custom_due_date TEXT NOT NULL,
    UNIQUE(vaccine_name, dose_index)
);
CREATE TABLE IF NOT EXISTS vaccine_plan_deleted (
    vaccine_name TEXT NOT NULL,
    dose_index INTEGER NOT NULL,
    UNIQUE(vaccine_name, dose_index)
);
CREATE TABLE IF NOT EXISTS vaccine_custom_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vaccine_name TEXT NOT NULL,
    dose_index INTEGER NOT NULL,
    due_date TEXT NOT NULL,
    note TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    UNIQUE(vaccine_name, dose_index)
);
CREATE TABLE IF NOT EXISTS health_followup_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    label TEXT NOT NULL UNIQUE,
    completed_date TEXT NOT NULL,
    note TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS health_followup_overrides (
    label TEXT NOT NULL,
    custom_due_date TEXT NOT NULL,
    UNIQUE(label)
);
CREATE TABLE IF NOT EXISTS countdown_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    target_date TEXT NOT NULL,
    note TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_records_baby_id ON records(baby_id);
CREATE INDEX IF NOT EXISTS idx_records_type ON records(type);
CREATE INDEX IF NOT EXISTS idx_records_timestamp ON records(timestamp);
CREATE INDEX IF NOT EXISTS idx_records_user_id ON records(user_id);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at);
`

func openDatabase(path string) (*sql.DB, error) {
	if err := ensureParentDir(path); err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if _, err := db.ExecContext(ctx, "PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;"); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("configure sqlite: %w", err)
	}
	return db, nil
}

func ensureParentDir(path string) error {
	dir := filepath.Dir(path)
	if dir == "." || dir == "" {
		return nil
	}
	return mkdirAll(dir)
}

func (a *App) initDatabase(ctx context.Context) error {
	if _, err := a.db.ExecContext(ctx, schemaSQL); err != nil {
		return fmt.Errorf("create schema: %w", err)
	}
	for _, migration := range []struct {
		table  string
		column string
		def    string
	}{
		{"babies", "is_premature", "INTEGER DEFAULT 0"},
		{"records", "food_unit", "TEXT DEFAULT ''"},
		{"quick_buttons", "food_unit", "TEXT DEFAULT ''"},
		{"weight_logs", "height", "REAL"},
	} {
		if err := ensureColumn(ctx, a.db, migration.table, migration.column, migration.def); err != nil {
			return err
		}
	}
	if err := ensureGrowthLogSchema(ctx, a.db); err != nil {
		return err
	}
	if err := a.rewriteLegacyCheckTables(ctx); err != nil {
		return err
	}

	defaultSettings := map[string]string{
		"custom_daily_target":   "",
		"feeds_per_day":         "8",
		"mcp_enabled":           "0",
		"reminder_interval_min": "180",
	}
	for key, value := range defaultSettings {
		if _, err := a.db.ExecContext(ctx, "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)", key, value); err != nil {
			return fmt.Errorf("insert setting %s: %w", key, err)
		}
	}
	coeffs := `{"day0":60,"day1":60,"day2_3":80,"day4_7":100,"day8_14":120,"day15_28":135,"month1_3":150,"month4_6":150,"month4_6_cap":900,"month6_12_base":800,"month6_12_decay":30,"month6_12_min":600,"year1_plus":500}`
	if _, err := a.db.ExecContext(ctx, "INSERT OR IGNORE INTO settings (key, value) VALUES ('milk_coefficients', ?)", coeffs); err != nil {
		return fmt.Errorf("insert milk coefficients: %w", err)
	}

	var babyCount int
	if err := a.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM babies").Scan(&babyCount); err != nil {
		return fmt.Errorf("count babies: %w", err)
	}
	if babyCount == 0 {
		_, err := a.db.ExecContext(ctx,
			"INSERT INTO babies (name, gender, birth_date, weight) VALUES ('宝宝', 'male', ?, 3.0)",
			today().Format("2006-01-02"),
		)
		if err != nil {
			return fmt.Errorf("insert default baby: %w", err)
		}
	}

	var buttonCount int
	if err := a.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM quick_buttons").Scan(&buttonCount); err != nil {
		return fmt.Errorf("count quick buttons: %w", err)
	}
	if buttonCount == 0 {
		buttons := []struct {
			typ, sub, label string
			amount          float64
			order           int
		}{
			{"feed", "formula", "配方奶 60ml", 60, 1},
			{"feed", "formula", "配方奶 90ml", 90, 2},
			{"feed", "formula", "配方奶 120ml", 120, 3},
			{"feed", "breast_left", "母乳(左)", 0, 4},
			{"feed", "breast_right", "母乳(右)", 0, 5},
			{"feed", "water", "喂水", 10, 6},
			{"excrete", "urine", "排尿", 0, 7},
			{"excrete", "stool", "排便", 0, 8},
			{"excrete", "both", "尿+便", 0, 9},
			{"symptom", "vomit", "吐奶", 0, 10},
			{"symptom", "fever", "发热", 0, 11},
			{"symptom", "jaundice", "黄疸", 0, 12},
		}
		for _, button := range buttons {
			_, err := a.db.ExecContext(ctx,
				"INSERT INTO quick_buttons (type, sub_type, label, amount, sort_order) VALUES (?, ?, ?, ?, ?)",
				button.typ, button.sub, button.label, button.amount, button.order,
			)
			if err != nil {
				return fmt.Errorf("insert default quick button: %w", err)
			}
		}
	}

	var adminCount int
	if err := a.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM users WHERE role = 'admin'").Scan(&adminCount); err != nil {
		return fmt.Errorf("count admins: %w", err)
	}
	if adminCount == 0 {
		_, err := a.db.ExecContext(ctx,
			"INSERT INTO users (username, password_hash, nickname, role, status) VALUES ('admin', ?, '管理员', 'admin', 'approved')",
			hashPassword("admin123"),
		)
		if err != nil {
			return fmt.Errorf("insert default admin: %w", err)
		}
	}
	return nil
}

func ensureColumn(ctx context.Context, db *sql.DB, table, column, definition string) error {
	rows, err := db.QueryContext(ctx, "PRAGMA table_info("+table+")")
	if err != nil {
		return fmt.Errorf("inspect %s columns: %w", table, err)
	}
	defer rows.Close()
	for rows.Next() {
		var cid int
		var name, typ string
		var notNull, pk int
		var defaultValue any
		if err := rows.Scan(&cid, &name, &typ, &notNull, &defaultValue, &pk); err != nil {
			return fmt.Errorf("scan %s columns: %w", table, err)
		}
		if name == column {
			return nil
		}
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("iterate %s columns: %w", table, err)
	}
	if _, err := db.ExecContext(ctx, fmt.Sprintf("ALTER TABLE %s ADD COLUMN %s %s", table, column, definition)); err != nil {
		return fmt.Errorf("add %s.%s: %w", table, column, err)
	}
	return nil
}

func ensureGrowthLogSchema(ctx context.Context, db *sql.DB) error {
	rows, err := db.QueryContext(ctx, "PRAGMA table_info(weight_logs)")
	if err != nil {
		return fmt.Errorf("inspect weight_logs columns: %w", err)
	}
	weightNullable := true
	hasHeight := false
	for rows.Next() {
		var (
			cid          int
			name, typ    string
			notNull, pk  int
			defaultValue any
		)
		if err := rows.Scan(&cid, &name, &typ, &notNull, &defaultValue, &pk); err != nil {
			rows.Close()
			return fmt.Errorf("scan weight_logs columns: %w", err)
		}
		switch name {
		case "weight":
			weightNullable = notNull == 0
		case "height":
			hasHeight = true
		}
	}
	if err := rows.Close(); err != nil {
		return fmt.Errorf("close weight_logs columns: %w", err)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("iterate weight_logs columns: %w", err)
	}
	if weightNullable && hasHeight {
		return nil
	}

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin growth log migration: %w", err)
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, "ALTER TABLE weight_logs RENAME TO _weight_logs_legacy"); err != nil {
		return fmt.Errorf("rename legacy weight logs: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `CREATE TABLE weight_logs (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		baby_id INTEGER NOT NULL DEFAULT 1,
		weight REAL,
		height REAL,
		recorded_date TEXT NOT NULL,
		note TEXT DEFAULT '',
		created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
		CHECK (weight IS NOT NULL OR height IS NOT NULL)
	)`); err != nil {
		return fmt.Errorf("create growth log table: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO weight_logs
		(id, baby_id, weight, height, recorded_date, note, created_at)
		SELECT id, baby_id, weight, height, recorded_date, note, created_at
		FROM _weight_logs_legacy`); err != nil {
		return fmt.Errorf("copy legacy weight logs: %w", err)
	}
	if _, err := tx.ExecContext(ctx, "DROP TABLE _weight_logs_legacy"); err != nil {
		return fmt.Errorf("drop legacy weight logs: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit growth log migration: %w", err)
	}
	if _, err := db.ExecContext(ctx,
		"CREATE INDEX IF NOT EXISTS idx_weight_logs_recorded_date ON weight_logs(recorded_date, id)"); err != nil {
		return fmt.Errorf("index growth logs: %w", err)
	}
	return nil
}

func (a *App) rewriteLegacyCheckTables(ctx context.Context) error {
	var recordsSchema string
	err := a.db.QueryRowContext(ctx, "SELECT sql FROM sqlite_master WHERE type='table' AND name='records'").Scan(&recordsSchema)
	if err == nil && strings.Contains(recordsSchema, "CHECK") {
		tx, txErr := a.db.BeginTx(ctx, nil)
		if txErr != nil {
			return txErr
		}
		if _, txErr = tx.ExecContext(ctx, "ALTER TABLE records RENAME TO _records_old"); txErr == nil {
			_, txErr = tx.ExecContext(ctx, `CREATE TABLE records (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				baby_id INTEGER NOT NULL DEFAULT 1,
				user_id INTEGER,
				type TEXT NOT NULL,
				sub_type TEXT NOT NULL,
				amount REAL,
				duration INTEGER,
				color TEXT,
				consistency TEXT,
				temperature REAL,
				note TEXT,
				timestamp TEXT NOT NULL,
				food_unit TEXT DEFAULT '',
				created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
			)`)
		}
		if txErr == nil {
			_, txErr = tx.ExecContext(ctx, `INSERT INTO records
				(id,baby_id,user_id,type,sub_type,amount,duration,color,consistency,temperature,note,timestamp,food_unit,created_at)
				SELECT id,baby_id,user_id,type,sub_type,amount,duration,color,consistency,temperature,note,timestamp,food_unit,created_at
				FROM _records_old`)
		}
		if txErr == nil {
			_, txErr = tx.ExecContext(ctx, "DROP TABLE _records_old")
		}
		if txErr != nil {
			_ = tx.Rollback()
			return fmt.Errorf("migrate records table: %w", txErr)
		}
		if err := tx.Commit(); err != nil {
			return fmt.Errorf("commit records migration: %w", err)
		}
	}
	return nil
}

func (a *App) queryMaps(ctx context.Context, query string, args ...any) ([]map[string]any, error) {
	rows, err := a.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	columns, err := rows.Columns()
	if err != nil {
		return nil, err
	}
	result := make([]map[string]any, 0)
	for rows.Next() {
		values := make([]any, len(columns))
		targets := make([]any, len(columns))
		for i := range values {
			targets[i] = &values[i]
		}
		if err := rows.Scan(targets...); err != nil {
			return nil, err
		}
		item := make(map[string]any, len(columns))
		for i, column := range columns {
			value := values[i]
			if raw, ok := value.([]byte); ok {
				value = string(raw)
			}
			item[column] = value
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

func (a *App) queryOne(ctx context.Context, query string, args ...any) (map[string]any, error) {
	rows, err := a.queryMaps(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, sql.ErrNoRows
	}
	return rows[0], nil
}

func isNoRows(err error) bool {
	return errors.Is(err, sql.ErrNoRows)
}
