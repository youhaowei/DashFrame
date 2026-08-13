#!/usr/bin/env bash
# Compatibility entrypoint for Claude Preview. The shared web launcher starts
# the DashFrame server, then runs Vite through portless so it gets a stable
# HTTPS URL. The shared launcher assigns a stable, path-derived hostname so
# branch-based and detached-HEAD worktrees both run without route conflicts;
# `portless list` shows which route maps to which port.
# - No PORT env (terminal): portless auto-assigns a random free port.
# - PORT env set (Preview MCP): forward as --app-port so portless binds
#   where Preview will iframe.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec "${ROOT}/scripts/dev-web.sh" "$@"
