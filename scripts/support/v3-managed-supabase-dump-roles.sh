#!/bin/bash
set -euo pipefail
case "${EVO_DUMP_EFFECTIVE_ROLE:-postgres}" in
  postgres|supabase_read_only_user) ;;
  *) exit 64 ;;
esac

# Uses Supabase CLI v2.116.0's role filter pipeline while the caller supplies
# a security-patched PostgreSQL client.
"$PG_DUMPALL_BIN" \
    --roles-only \
    --role "${EVO_DUMP_EFFECTIVE_ROLE:-postgres}" \
    --quote-all-identifier \
    --no-role-passwords \
    --no-comments \
| sed -E "s/^CREATE ROLE \"($RESERVED_ROLES)\"/-- &/" \
| sed -E "s/^ALTER ROLE \"($RESERVED_ROLES)\"/-- &/" \
| sed -E "s/ (NOSUPERUSER|NOREPLICATION)//g" \
| sed -E "s/^-- (.* SET \"($ALLOWED_CONFIGS)\" .*)/\1/" \
| sed -E "s/GRANT \".*\" TO \"($RESERVED_ROLES)\"/-- &/" \
| sed -E "${EXTRA_SED:-}" \
| uniq

echo "RESET ALL;"
