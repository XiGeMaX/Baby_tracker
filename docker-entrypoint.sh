#!/bin/sh
set -eu

prepare_data_dir() {
    data_dir="$1"
    [ -n "${data_dir}" ] || return 0
    mkdir -p "${data_dir}"
    if ! chown -R baby-tracker:baby-tracker "${data_dir}"; then
        echo "error: cannot give baby-tracker access to data directory ${data_dir}" >&2
        exit 1
    fi
}

if [ "$(id -u)" -eq 0 ]; then
    primary_data_dir="${BABY_TRACKER_DATA_DIR:-/var/lib/baby-tracker}"
    legacy_data_dir="${BABY_TRACKER_LEGACY_DATA_DIR:-/app/data}"

    prepare_data_dir "${primary_data_dir}"
    if [ "${primary_data_dir}" != "${legacy_data_dir}" ]; then
        prepare_data_dir "${legacy_data_dir}"
    fi

    exec su-exec baby-tracker:baby-tracker "$@"
fi

exec "$@"
