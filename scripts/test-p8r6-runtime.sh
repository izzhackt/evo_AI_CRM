#!/usr/bin/env bash

set -Eeuo pipefail

export LC_ALL=C
umask 077

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Migration 077 keeps its historical crm_primary fixture. The current-tip gate
# selects the exact post-082 authority explicitly so one call site cannot mask
# the other migration boundary.
exec bash "${SCRIPT_DIR}/test-p8v-runtime.sh" \
  "${1:?database container name is required}" \
  "${2:?database name is required}" \
  "evo-inbox" \
  "P8R6"
