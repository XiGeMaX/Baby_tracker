#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

server_pid=""
smoke_dir=""

cleanup() {
    if [[ -n "${server_pid}" ]]; then
        kill "${server_pid}" 2>/dev/null || true
        wait "${server_pid}" 2>/dev/null || true
    fi
    if [[ -n "${smoke_dir}" ]]; then
        rm -rf "${smoke_dir}"
    fi
}

trap cleanup EXIT

command -v go >/dev/null || {
    echo "error: Go 1.26.11 or newer is required" >&2
    exit 1
}
command -v node >/dev/null || {
    echo "error: Node.js is required for the JavaScript syntax check" >&2
    exit 1
}

sh -n docker-entrypoint.sh

unformatted="$(gofmt -l cmd internal)"
if [[ -n "${unformatted}" ]]; then
    echo "error: Go files need formatting:" >&2
    printf '%s\n' "${unformatted}" >&2
    exit 1
fi

go vet ./...
go test ./...
go test -race ./...

while IFS= read -r -d '' file; do
    node --check "${file}"
done < <(find static -type f -name '*.js' ! -path 'static/vendor/*' -print0)

if [[ "${SMOKE_TEST:-0}" == "1" ]]; then
    command -v curl >/dev/null || {
        echo "error: curl is required for the smoke test" >&2
        exit 1
    }

    smoke_dir="$(mktemp -d)"
    go build -trimpath -o "${smoke_dir}/baby-tracker" ./cmd/baby-tracker
    port=$((18000 + ($$ % 10000)))
    BABY_TRACKER_WEB_DIR="${ROOT}" \
    BABY_TRACKER_DATA_DIR="${smoke_dir}/data" \
    BABY_TRACKER_LISTEN_ADDRESS="127.0.0.1:${port}" \
        "${smoke_dir}/baby-tracker" serve >"${smoke_dir}/server.log" 2>&1 &
    server_pid=$!

    ready=0
    for _ in {1..50}; do
        if curl --fail --silent \
            "http://127.0.0.1:${port}/login" >"${smoke_dir}/login.html"; then
            ready=1
            break
        fi
        if ! kill -0 "${server_pid}" 2>/dev/null; then
            cat "${smoke_dir}/server.log" >&2
            exit 1
        fi
        sleep 0.1
    done

    if [[ "${ready}" != "1" ]]; then
        cat "${smoke_dir}/server.log" >&2
        echo "error: server did not become ready" >&2
        exit 1
    fi
    grep -q "Baby Tracker" "${smoke_dir}/login.html"

    for asset in \
        tailwindcss.min.js \
        lucide.min.js \
        chart.js-4.4.7.min.js; do
        curl --fail --silent --show-error \
            "http://127.0.0.1:${port}/static/vendor/${asset}" \
            >/dev/null
    done

    curl --fail --silent --show-error \
        --cookie-jar "${smoke_dir}/cookies.txt" \
        --header "Content-Type: application/json" \
        --data '{"username":"admin","password":"admin123"}' \
        "http://127.0.0.1:${port}/api/auth/login" \
        >"${smoke_dir}/login.json"

    curl --fail --silent --show-error \
        --cookie "${smoke_dir}/cookies.txt" \
        --header "Content-Type: application/json" \
        --data '{"password":"smoke-test-password","confirm_password":"smoke-test-password"}' \
        "http://127.0.0.1:${port}/api/auth/setup-password" \
        >/dev/null

    curl --fail --silent --show-error \
        --cookie "${smoke_dir}/cookies.txt" \
        "http://127.0.0.1:${port}/admin" \
        >"${smoke_dir}/admin.html"
    section_count="$(grep -c '<details class="admin-details">' "${smoke_dir}/admin.html")"
    if [[ "${section_count}" != "8" ]]; then
        echo "error: admin page has ${section_count} collapsible sections, want 8" >&2
        exit 1
    fi
fi

echo "all checks passed"
