#!/bin/bash
set -euo pipefail

echo "SET session_replication_role = replica;
"

# Uses Supabase CLI v2.116.0's data filter pipeline while the caller supplies
# a security-patched PostgreSQL client.
"$PG_DUMP_BIN" \
    --data-only \
    --quote-all-identifier \
    --role "postgres" \
    --exclude-schema "${EXCLUDED_SCHEMAS:-}" \
    --exclude-table "auth.schema_migrations" \
    --exclude-table "storage.migrations" \
    --exclude-table "supabase_functions.migrations" \
    --schema "$INCLUDED_SCHEMAS" \
    ${EXTRA_FLAGS:-}

echo "RESET ALL;"
