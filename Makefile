SHELL := /bin/sh

GO ?= go
BIN_DIR ?= .build
BIN := $(BIN_DIR)/baby-tracker
WEB_DIR ?= $(CURDIR)
DATA_DIR ?= $(CURDIR)/data
LISTEN_ADDRESS ?= 0.0.0.0:8964
PID_FILE ?= $(DATA_DIR)/baby-tracker.pid
LOG_FILE ?= $(DATA_DIR)/baby-tracker.log

.PHONY: help setup deps build run start stop status logs bootstrap \
	reset-password test smoke clean

help:
	@printf '%s\n' \
		'make setup          Download and verify Go modules' \
		'make build          Build the local binary' \
		'make run            Build and run in the foreground' \
		'make start          Build and start in the background' \
		'make stop           Stop the background service' \
		'make status         Show background service status' \
		'make logs           Follow the background service log' \
		'make bootstrap      Create the database and initial data' \
		'make reset-password Reset the administrator password' \
		'make test           Run Go, race, and JavaScript checks' \
		'make smoke          Run checks plus a live HTTP smoke test' \
		'make clean          Remove local build output'

setup: deps
	@mkdir -p "$(DATA_DIR)"
	@printf 'runtime directories ready: %s\n' "$(DATA_DIR)"

deps:
	$(GO) mod download
	$(GO) mod verify

build:
	@mkdir -p "$(BIN_DIR)"
	CGO_ENABLED=0 $(GO) build -trimpath -ldflags="-s -w" -o "$(BIN)" ./cmd/baby-tracker

run: build
	BABY_TRACKER_WEB_DIR="$(WEB_DIR)" \
	BABY_TRACKER_DATA_DIR="$(DATA_DIR)" \
	BABY_TRACKER_LISTEN_ADDRESS="$(LISTEN_ADDRESS)" \
	"$(BIN)" serve

start: build
	@mkdir -p "$(DATA_DIR)"
	@if [ -s "$(PID_FILE)" ] && kill -0 "$$(cat "$(PID_FILE)")" 2>/dev/null; then \
		printf 'service already running with PID %s\n' "$$(cat "$(PID_FILE)")"; \
		exit 1; \
	fi
	@BABY_TRACKER_WEB_DIR="$(WEB_DIR)" \
	BABY_TRACKER_DATA_DIR="$(DATA_DIR)" \
	BABY_TRACKER_LISTEN_ADDRESS="$(LISTEN_ADDRESS)" \
	nohup "$(BIN)" serve >"$(LOG_FILE)" 2>&1 & \
	printf '%s\n' "$$!" >"$(PID_FILE)"
	@sleep 0.5
	@if ! kill -0 "$$(cat "$(PID_FILE)")" 2>/dev/null; then \
		cat "$(LOG_FILE)"; \
		printf 'service failed to start\n' >&2; \
		exit 1; \
	fi
	@printf 'service started with PID %s; log: %s\n' "$$(cat "$(PID_FILE)")" "$(LOG_FILE)"

stop:
	@if [ -s "$(PID_FILE)" ] && kill -0 "$$(cat "$(PID_FILE)")" 2>/dev/null; then \
		pid="$$(cat "$(PID_FILE)")"; \
		kill "$$pid"; \
		printf 'service stopped (PID %s)\n' "$$pid"; \
		: >"$(PID_FILE)"; \
	else \
		printf 'service is not running\n'; \
		: >"$(PID_FILE)"; \
	fi

status:
	@if [ -s "$(PID_FILE)" ] && kill -0 "$$(cat "$(PID_FILE)")" 2>/dev/null; then \
		printf 'service is running with PID %s\n' "$$(cat "$(PID_FILE)")"; \
	else \
		printf 'service is not running\n'; \
		exit 1; \
	fi

logs:
	tail -f "$(LOG_FILE)"

bootstrap: build
	BABY_TRACKER_WEB_DIR="$(WEB_DIR)" \
	BABY_TRACKER_DATA_DIR="$(DATA_DIR)" \
	"$(BIN)" bootstrap

reset-password: build
	BABY_TRACKER_WEB_DIR="$(WEB_DIR)" \
	BABY_TRACKER_DATA_DIR="$(DATA_DIR)" \
	"$(BIN)" reset-password

test:
	./scripts/test.sh

smoke:
	SMOKE_TEST=1 ./scripts/test.sh

clean:
	rm -rf "$(BIN_DIR)"
