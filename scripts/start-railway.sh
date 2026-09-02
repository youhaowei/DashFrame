#!/bin/sh
set -eu

: "${PORT:?Railway must provide PORT}"
: "${RAILWAY_VOLUME_MOUNT_PATH:?Attach a Railway volume before starting DashFrame}"
: "${DASHFRAME_AUTH_TOKEN:?Set DASHFRAME_AUTH_TOKEN in Railway variables}"
: "${DASHFRAME_SECRET_KEY:?Set DASHFRAME_SECRET_KEY in Railway variables}"

volume_root="${RAILWAY_VOLUME_MOUNT_PATH}"
export DASHFRAME_PROJECT_DIR="${volume_root}/project"
export DASHFRAME_DATA_DIR="${volume_root}/host-data"

exec bun run --cwd apps/server start -- \
  --bind "0.0.0.0:${PORT}" \
  --mcp-mode stateless
