#!/bin/sh
set -eu

: "${PORT:?Railway must provide PORT}"
: "${RAILWAY_VOLUME_MOUNT_PATH:?Attach a Railway volume before starting DashFrame}"

# The hosted entry validates authentication and vault configuration before serving.
exec sh scripts/with-hosted-volume-lock.sh bun apps/server/src/hosted.ts
