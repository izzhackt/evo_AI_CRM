#!/usr/bin/env bash

set -Eeuo pipefail

export LC_ALL=C
umask 077

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Migration 077 keeps its historical crm_primary fixture. This P8R6 harness
# intentionally preserves the migration-082 evo-inbox boundary as historical
# regression evidence so exact-main runtime checks cannot silently rewrite it.
exec bash "${SCRIPT_DIR}/test-p8v-runtime.sh" \
  "${1:?database container name is required}" \
  "${2:?database name is required}" \
  "evo-inbox" \
  "P8R6"
