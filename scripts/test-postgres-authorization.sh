#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
deadline_runner="$repo_root/scripts/run-command-with-deadline.mjs"
container_name="evo-platform-authz-$RANDOM-$$"
postgres_image="$("$repo_root/scripts/resolve-postgres-test-image.sh")"
test_database="evo_platform_authorization"
health_timeout_seconds="${EVO_POSTGRES_HEALTH_TIMEOUT_SECONDS:-300}"
p2b_drift_log="$(mktemp -t evo-p2b-owner-drift.XXXXXX)"
p2h_acl_mutation_log="$(mktemp -t evo-p2h-acl-mutation.XXXXXX)"
p2h_policy_mutation_log="$(mktemp -t evo-p2h-policy-mutation.XXXXXX)"
p2h_download_order_mutation_log="$(
  mktemp -t evo-p2h-download-order-mutation.XXXXXX
)"
p2h_review_order_mutation_log="$(
  mktemp -t evo-p2h-review-order-mutation.XXXXXX
)"
p6c_concurrency_setup_log="$(mktemp -t evo-p6c-concurrency-setup.XXXXXX)"
p6c_concurrency_worker_a_log="$(mktemp -t evo-p6c-concurrency-a.XXXXXX)"
p6c_concurrency_worker_b_log="$(mktemp -t evo-p6c-concurrency-b.XXXXXX)"
p6c_concurrency_assert_log="$(mktemp -t evo-p6c-concurrency-assert.XXXXXX)"
p6c_concurrency_worker_a_pid=""
p6d_concurrency_worker_a_log="$(mktemp -t evo-p6d-concurrency-a.XXXXXX)"
p6d_concurrency_worker_b_log="$(mktemp -t evo-p6d-concurrency-b.XXXXXX)"
p6d_concurrency_assert_log="$(mktemp -t evo-p6d-concurrency-assert.XXXXXX)"
p6d_concurrency_worker_a_pid=""
p8r4_cutover_guard_log="$(mktemp -t evo-p8r4-cutover-guard.XXXXXX)"
u2_concurrency_worker_a_log="$(mktemp -t evo-u2-concurrency-a.XXXXXX)"
u2_concurrency_worker_b_log="$(mktemp -t evo-u2-concurrency-b.XXXXXX)"
u2_concurrency_assert_log="$(mktemp -t evo-u2-concurrency-assert.XXXXXX)"
u2_concurrency_worker_a_pid=""
u6c_concurrency_setup_log="$(mktemp -t evo-u6c-concurrency-setup.XXXXXX)"
u6c_concurrency_worker_a_log="$(mktemp -t evo-u6c-concurrency-a.XXXXXX)"
u6c_concurrency_worker_b_log="$(mktemp -t evo-u6c-concurrency-b.XXXXXX)"
u6c_concurrency_assert_log="$(mktemp -t evo-u6c-concurrency-assert.XXXXXX)"
u6c_concurrency_worker_a_pid=""

cleanup() {
  if [[ -n "$p6c_concurrency_worker_a_pid" ]]; then
    kill "$p6c_concurrency_worker_a_pid" >/dev/null 2>&1 || true
    wait "$p6c_concurrency_worker_a_pid" >/dev/null 2>&1 || true
  fi
  if [[ -n "$p6d_concurrency_worker_a_pid" ]]; then
    kill "$p6d_concurrency_worker_a_pid" >/dev/null 2>&1 || true
    wait "$p6d_concurrency_worker_a_pid" >/dev/null 2>&1 || true
  fi
  if [[ -n "$u2_concurrency_worker_a_pid" ]]; then
    kill "$u2_concurrency_worker_a_pid" >/dev/null 2>&1 || true
    wait "$u2_concurrency_worker_a_pid" >/dev/null 2>&1 || true
  fi
  if [[ -n "$u6c_concurrency_worker_a_pid" ]]; then
    kill "$u6c_concurrency_worker_a_pid" >/dev/null 2>&1 || true
    wait "$u6c_concurrency_worker_a_pid" >/dev/null 2>&1 || true
  fi
  node "$deadline_runner" 30000 docker rm -f "$container_name" \
    >/dev/null 2>&1 || true
  rm -f -- \
    "$p2b_drift_log" \
    "$p2h_acl_mutation_log" \
    "$p2h_policy_mutation_log" \
    "$p2h_download_order_mutation_log" \
    "$p2h_review_order_mutation_log" \
    "$p6c_concurrency_setup_log" \
    "$p6c_concurrency_worker_a_log" \
    "$p6c_concurrency_worker_b_log" \
    "$p6c_concurrency_assert_log" \
    "$p6d_concurrency_worker_a_log" \
    "$p6d_concurrency_worker_b_log" \
    "$p6d_concurrency_assert_log" \
    "$p8r4_cutover_guard_log" \
    "$u2_concurrency_worker_a_log" \
    "$u2_concurrency_worker_b_log" \
    "$u2_concurrency_assert_log" \
    "$u6c_concurrency_setup_log" \
    "$u6c_concurrency_worker_a_log" \
    "$u6c_concurrency_worker_b_log" \
    "$u6c_concurrency_assert_log"
}
trap cleanup EXIT

if [[ ! "$health_timeout_seconds" =~ ^[0-9]+$ ]] \
  || (( health_timeout_seconds < 60 || health_timeout_seconds > 600 )); then
  echo "EVO_POSTGRES_HEALTH_TIMEOUT_SECONDS must be an integer from 60 to 600" >&2
  exit 1
fi

node "$deadline_runner" 120000 docker run \
  --detach \
  --name "$container_name" \
  --network none \
  --env POSTGRES_PASSWORD=postgres \
  --mount "type=bind,src=$repo_root,dst=/workspace,readonly" \
  "$postgres_image" >/dev/null

health_status=""
health_deadline=$((SECONDS + health_timeout_seconds))
while (( SECONDS < health_deadline )); do
  if health_status="$(
    node "$deadline_runner" 15000 docker inspect \
      --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' \
      "$container_name" 2>/dev/null
  )"; then
    :
  else
    health_status="docker_unavailable"
  fi
  [[ "$health_status" == "healthy" ]] && break
  sleep 1
done

if [[ "$health_status" != "healthy" ]]; then
  echo \
    "Pinned Supabase Postgres container did not become healthy within ${health_timeout_seconds}s (last status: ${health_status:-unknown})" \
    >&2
  node "$deadline_runner" 15000 docker logs --tail 120 "$container_name" \
    >&2 || true
  exit 1
fi

docker exec "$container_name" \
  pg_isready -h 127.0.0.1 -U postgres -d postgres >/dev/null
postgres_image_id="$(
  docker inspect --format '{{.Image}}' "$container_name"
)"
docker exec "$container_name" \
  psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "postgres" \
  -c "CREATE DATABASE ${test_database} TEMPLATE template0;"
docker exec "$container_name" \
  psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
  -c "COMMENT ON DATABASE ${test_database} IS 'EVO disposable authorization and queue contract test';"
docker exec \
  --env PGPASSWORD=postgres \
  "$container_name" \
  psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U supabase_admin -d "$test_database" \
  -c "GRANT anon, authenticated, service_role, supabase_auth_admin, supabase_admin TO postgres;"
docker exec "$container_name" \
  psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
  -f /workspace/supabase/tests/bootstrap_supabase.sql

# Prove migration 040 fails closed instead of adopting a browser-owned object
# from a pre-existing namespace. The ordinary migration loop then proves that
# empty owner drift is safely normalized and remains idempotent.
docker exec "$container_name" \
  psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
  -c "SET ROLE authenticated; CREATE TABLE platform.p2b_untrusted_owner_probe (id integer); RESET ROLE;"

if docker exec "$container_name" \
  psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
  -f /workspace/supabase/migrations/040_platform_namespaces_and_secret_containment.sql \
  >"$p2b_drift_log" 2>&1; then
  echo "migration 040 unexpectedly adopted a browser-owned schema object" >&2
  exit 1
fi

if ! grep -Fq \
  "Platform schema owner drift contains non-postgres objects" \
  "$p2b_drift_log"; then
  echo "migration 040 failed for the wrong owner-drift reason" >&2
  sed -n '1,80p' "$p2b_drift_log" >&2
  exit 1
fi

docker exec "$container_name" \
  psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
  -c "DROP TABLE platform.p2b_untrusted_owner_probe;"

while IFS= read -r migration; do
  # Preserve one migration-060-compatible direct-chat identity just before
  # 085. Its short numeric identifier is intentionally outside U3's supported
  # E.164-sized range, so the forward migration must leave it untouched rather
  # than aborting the whole upgrade.
  if [[ "$(basename "$migration")" == 085_* ]]; then
    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -f /workspace/supabase/tests/platform_waha_receive_only_sales_pre085.sql
  fi

  # P8R4 must refuse a cutover while earlier synthetic acceptance fixtures
  # still contain queued work on a non-target WAHA session. Prove the guard
  # first, then normalize only those disposable fixture identities so the
  # exact target migration and its current-boundary suite can run.
  if [[ "$(basename "$migration")" == 080_* ]]; then
    if docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -f "/workspace/$migration" >"$p8r4_cutover_guard_log" 2>&1; then
      echo "migration 080 unexpectedly accepted non-target queued manual work" >&2
      exit 1
    fi
    if ! grep -Fq \
      "Live manual-send work uses a non-target WAHA session" \
      "$p8r4_cutover_guard_log"; then
      echo "migration 080 failed for the wrong cutover-guard reason" >&2
      sed -n '1,120p' "$p8r4_cutover_guard_log" >&2
      exit 1
    fi

    docker exec -i "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" <<'SQL'
SET session_replication_role = replica;
UPDATE platform.communication_conversations AS conversation
SET waha_session_name = 'evo-inbox'
WHERE conversation.waha_session_name LIKE 'evo-inbox-synthetic-%'
  AND EXISTS (
    SELECT 1
    FROM platform_private.durable_work_items AS item
    JOIN platform.manual_send_authorizations AS authorization_row
      ON authorization_row.organization_id = item.organization_id
     AND authorization_row.id = item.manual_send_authorization_id
    WHERE item.kind = 'manual_whatsapp_send'
      AND item.state IN ('queued', 'leased', 'retry_wait')
      AND authorization_row.organization_id = conversation.organization_id
      AND authorization_row.conversation_id = conversation.id
  );
SET session_replication_role = origin;
SQL
  fi

  # Seed one exact historical crm_primary health/observation tuple before
  # migration 082. The post-migration acceptance proves it is not renamed,
  # deleted or exposed as current health, then the harness removes the fixture.
  if [[ "$(basename "$migration")" == 082_* ]]; then
    docker exec -i "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" <<'SQL'
SET session_replication_role = replica;
INSERT INTO platform.organizations (id, name)
VALUES (
  '82000000-0000-4000-8000-000000000900',
  'P8R6 historical session fixture'
);

INSERT INTO platform_private.provider_webhook_events (
  id, organization_id, provider, provider_account_ref,
  provider_conversation_ref, provider_event_variant_ref,
  provider_request_id, waha_session_name, payload_id, event_type,
  provider_occurred_at, verification_status, raw_payload,
  verification_headers, verification_evidence_ref, payload_sha256,
  received_at, request_id
) VALUES (
  '82000000-0000-4000-8000-000000000901',
  '82000000-0000-4000-8000-000000000900',
  'waha', 'waha:crm_primary', NULL, NULL,
  'p8r6-historical-crm-status', 'crm_primary',
  'p8r6-historical-crm-status', 'session.status',
  '2026-08-22 09:00:00+06', 'verified',
  '{"event":"session.status","session":"crm_primary","payload":{"name":"crm_primary","status":"LEGACY_WORKING"}}',
  '{"hmac_verified":true}', 'synthetic:p8r6:historical-crm',
  repeat('82', 32), '2026-08-22 09:00:01+06',
  '82000000-0000-4000-8000-000000000903'
);

INSERT INTO platform_private.waha_session_observations (
  id, organization_id, source_webhook_event_id, waha_session_name,
  status, observed_at, request_id, created_at
) VALUES (
  '82000000-0000-4000-8000-000000000902',
  '82000000-0000-4000-8000-000000000900',
  '82000000-0000-4000-8000-000000000901',
  'crm_primary', 'LEGACY_WORKING', '2026-08-22 09:00:00+06',
  '82000000-0000-4000-8000-000000000904',
  '2026-08-22 09:00:02+06'
);

INSERT INTO platform.waha_session_health (
  organization_id, waha_session_name, status, observed_at
) VALUES (
  '82000000-0000-4000-8000-000000000900',
  'crm_primary', 'LEGACY_WORKING', '2026-08-22 09:00:00+06'
);
SET session_replication_role = origin;
SQL
  fi

  # Seed one durable U3-era stage immediately before 086. The post-migration
  # U4 suite proves the only allowed legacy normalization and its system audit.
  if [[ "$(basename "$migration")" == 086_* ]]; then
    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -v u4_seed_pre086=1 \
      -f /workspace/supabase/tests/platform_sales_workflow_rls.sql
  fi

  # Seed one immutable evo-inbox status event/observation at the migration-101
  # boundary. Migration 102 must preserve that evidence, remove it from current
  # health and reject every attempt to reactivate it.
  if [[ "$(basename "$migration")" == 102_* ]]; then
    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -f /workspace/supabase/tests/platform_crm_primary_waha_authority_pre102.sql
  fi

  docker exec "$container_name" \
    psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
    -f "/workspace/$migration"

  # Preserve the P2B namespace/grant acceptance test at its exact migration
  # boundary. Later Platform migrations intentionally add relations, so this
  # proof must run immediately after 040 rather than against the final schema.
  if [[ "$(basename "$migration")" == 040_* ]]; then
    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -f /workspace/supabase/tests/platform_grants.sql

    # Exercise the retained 038/039 hardening migrations and an interrupted
    # 040 deploy retry while 040 is still the schema tip. Re-running 040 after
    # P2C would incorrectly restore P2B's temporary broad service_role defaults.
    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -f /workspace/supabase/migrations/038_authorization_containment.sql
    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -f /workspace/supabase/migrations/039_private_inbox_media.sql
    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -f /workspace/supabase/migrations/040_platform_namespaces_and_secret_containment.sql
  fi

  # P2C owns an exact ten-table identity/RBAC boundary. Run that acceptance
  # suite at migration 041 before later Platform domain tables are added. The
  # synthetic live memberships it leaves behind also prove that 042 upgrades
  # existing active, inactive and blocked authority rather than only clean
  # databases.
  if [[ "$(basename "$migration")" == 041_* ]]; then
    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -f /workspace/supabase/tests/platform_identity_rbac.sql
  fi

  # P2D owns the exact migration-042 admissions catalog and leaves behind the
  # two-organization/two-student fixtures that P2E must upgrade from immutable
  # v2 bundles. Preserve both admissions suites at that boundary before 043
  # intentionally adds new Platform relations and v3 permissions.
  if [[ "$(basename "$migration")" == 042_* ]]; then
    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -f /workspace/supabase/tests/platform_admissions_rls.sql
    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -f /workspace/supabase/tests/platform_inventory.sql
  fi

  # P2E owns the exact migration-043 documents/finance/notifications boundary
  # and leaves the two-organization/two-student fixtures plus immutable v3
  # memberships that P2F must upgrade. Run both suites before migration 044.
  if [[ "$(basename "$migration")" == 043_* ]]; then
    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -f /workspace/supabase/tests/platform_documents_finance_notifications_rls.sql
    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -f /workspace/supabase/tests/platform_documents_finance_notifications_inventory.sql
  fi

  # P2F owns the exact migration-044 communications/provider/draft-only AI
  # boundary. Run its stateful RLS suite and catalog inventory at that boundary
  # so a later migration cannot accidentally satisfy or mask a missing 044
  # contract.
  if [[ "$(basename "$migration")" == 044_* ]]; then
    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -f /workspace/supabase/tests/platform_communications_rls.sql
    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -f /workspace/supabase/tests/platform_communications_inventory.sql
  fi

  # P2G owns the exact migration-045 PGMQ, durable-work and manual-review
  # boundary. The SQL suites prove catalog/RLS behavior against the fixtures
  # carried forward from P2F before the separate-session runtime gate runs.
  if [[ "$(basename "$migration")" == 045_* ]]; then
    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -f /workspace/supabase/tests/platform_queues_rls.sql
    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -f /workspace/supabase/tests/platform_queues_inventory.sql
    bash "$repo_root/scripts/test-p2g-queues-runtime.sh" \
      "$container_name" \
      "$test_database"
  fi

  # The migration-077 outcome check extends the durable queue fixture with
  # canonical provider ingress and no-authority manual-send replay proof. It runs
  # only after 077 exists; running it at the historical P2G boundary would
  # falsely require future functions from migration 045.
  if [[ "$(basename "$migration")" == 077_* ]]; then
    bash "$repo_root/scripts/test-platform-migration-077-runtime.sh" \
      "$container_name" \
      "$test_database"
  fi

  # P2H owns the private document Storage metadata/policy contract. These SQL
  # suites run immediately after migration 046; the separate local Supabase
  # reset exercises the provider-owned Storage API and object bytes.
  if [[ "$(basename "$migration")" == 046_* ]]; then
    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -f /workspace/supabase/tests/platform_document_storage_rls.sql

    # Exercise every privileged-role/write-operation cell independently. A
    # combined mutation could remain red for one role while silently losing
    # coverage for the other. The failing psql session closes with its
    # transaction open, so PostgreSQL rolls each mutation back before the next
    # cell and the final clean inventory run.
    for p2h_role in service_role supabase_auth_admin; do
      for p2h_privilege in INSERT UPDATE DELETE TRUNCATE; do
        if docker exec -i "$container_name" \
          psql -X -v ON_ERROR_STOP=1 \
            -h 127.0.0.1 -U postgres -d "$test_database" \
          >"$p2h_acl_mutation_log" 2>&1 <<SQL
BEGIN;
GRANT $p2h_privilege
  ON platform_private.document_upload_reservations
  TO $p2h_role;
\i /workspace/supabase/tests/platform_document_storage_inventory.sql
ROLLBACK;
SQL
        then
          echo \
            "P2H ACL inventory unexpectedly accepted $p2h_role:$p2h_privilege" \
            >&2
          exit 1
        fi

        if ! grep -Fq \
          "Private P2H table document_upload_reservations has forbidden direct privileges:" \
          "$p2h_acl_mutation_log" ||
          ! grep -Fq \
            "$p2h_role:$p2h_privilege" \
            "$p2h_acl_mutation_log"; then
          echo \
            "P2H ACL mutation failed for the wrong cell: $p2h_role:$p2h_privilege" \
            >&2
          sed -n '1,120p' "$p2h_acl_mutation_log" >&2
          exit 1
        fi

        if [[ "$(
          docker exec "$container_name" \
            psql -X -A -t -v ON_ERROR_STOP=1 \
              -h 127.0.0.1 -U postgres -d "$test_database" \
              -c "
                SELECT has_table_privilege(
                  '$p2h_role',
                  'platform_private.document_upload_reservations',
                  '$p2h_privilege'
                );
              "
        )" != "f" ]]; then
          echo \
            "P2H ACL mutation did not roll back: $p2h_role:$p2h_privilege" \
            >&2
          exit 1
        fi
      done
    done

    # An unknown broad admin policy must fail even when it never names the
    # platform-documents bucket. Exact allowlisting also protects the existing
    # avatar, flow-media and chat-media policy contracts from silent drift.
    if docker exec -i "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      >"$p2h_policy_mutation_log" 2>&1 <<'SQL'
BEGIN;
CREATE POLICY "P2H mutation unknown broad admin select"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING ((SELECT auth.jwt() ->> 'platform_role') = 'admin');
\i /workspace/supabase/tests/platform_document_storage_inventory.sql
ROLLBACK;
SQL
    then
      echo "P2H policy inventory unexpectedly accepted an unknown broad policy" >&2
      exit 1
    fi

    if ! grep -Fq \
      "storage.objects policy allowlist drifted:" \
      "$p2h_policy_mutation_log" ||
      ! grep -Fq \
        "P2H mutation unknown broad admin select" \
        "$p2h_policy_mutation_log"; then
      echo "P2H policy mutation failed for the wrong reason" >&2
      sed -n '1,120p' "$p2h_policy_mutation_log" >&2
      exit 1
    fi

    if [[ "$(
      docker exec "$container_name" \
        psql -X -A -t -v ON_ERROR_STOP=1 \
          -h 127.0.0.1 -U postgres -d "$test_database" \
          -c "
            SELECT count(*)
            FROM pg_policies
            WHERE schemaname = 'storage'
              AND tablename = 'objects'
              AND policyname = 'P2H mutation unknown broad admin select';
          "
    )" != "0" ]]; then
      echo "P2H policy mutation was not rolled back cleanly" >&2
      exit 1
    fi

    # Prove the definition oracle rejects a future download function that
    # takes the version before the case. The replacement keeps the production
    # signature and the other guarded markers, exists only inside this
    # disposable transaction, and is rolled back when the inventory aborts.
    if docker exec -i "$container_name" \
      psql -X -v ON_ERROR_STOP=1 \
        -h 127.0.0.1 -U postgres -d "$test_database" \
      >"$p2h_download_order_mutation_log" 2>&1 <<'SQL'
BEGIN;
CREATE OR REPLACE FUNCTION platform.grant_document_download(
  p_organization_id UUID,
  p_document_version_id UUID,
  p_access_purpose TEXT,
  p_expires_in_seconds INTEGER,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $mutation$
DECLARE
  actor RECORD;
  preliminary_version RECORD;
  case_row platform.student_cases%ROWTYPE;
  version_row platform.document_versions%ROWTYPE;
  download_grant platform_private.document_download_grants%ROWTYPE;
  actor_hourly_limit CONSTANT INTEGER := 120;
BEGIN
  IF FALSE THEN
    RAISE EXCEPTION 'mutation' USING ERRCODE = 'PT409';
    RAISE EXCEPTION 'mutation' USING ERRCODE = 'PT429';
  END IF;

  SELECT *
  INTO actor
  FROM platform_private.require_domain_actor(
    p_organization_id,
    'document.download'
  );

  SELECT version.student_case_id
  INTO preliminary_version
  FROM platform.document_versions AS version
  WHERE version.organization_id = p_organization_id
    AND version.id = p_document_version_id;

  SELECT *
  INTO version_row
  FROM platform.document_versions AS version
  WHERE version.organization_id = p_organization_id
    AND version.id = p_document_version_id
    AND version.student_case_id = case_row.id
  FOR UPDATE;

  SELECT *
  INTO case_row
  FROM platform.student_cases AS student_case
  WHERE student_case.organization_id = p_organization_id
    AND student_case.id = preliminary_version.student_case_id
  FOR UPDATE;

  IF download_grant.organization_id = p_organization_id THEN
    PERFORM count(*)
    FROM platform_private.document_download_consumptions;
  END IF;

  RETURN '{}'::JSONB;
END
$mutation$;
\i /workspace/supabase/tests/platform_document_storage_inventory.sql
ROLLBACK;
SQL
    then
      echo "P2H inventory unexpectedly accepted reversed download row locks" >&2
      exit 1
    fi

    if ! grep -Fq \
      "P2H download lock-order contract drifted" \
      "$p2h_download_order_mutation_log"; then
      echo "P2H download lock-order mutation failed for the wrong reason" >&2
      sed -n '1,160p' "$p2h_download_order_mutation_log" >&2
      exit 1
    fi

    # Repeat against the inherited review RPC. Review must keep actor
    # resolution before case -> slot -> version even though the function was
    # introduced before P2H.
    if docker exec -i "$container_name" \
      psql -X -v ON_ERROR_STOP=1 \
        -h 127.0.0.1 -U postgres -d "$test_database" \
      >"$p2h_review_order_mutation_log" 2>&1 <<'SQL'
BEGIN;
CREATE OR REPLACE FUNCTION platform.review_document_version(
  p_organization_id UUID,
  p_document_version_id UUID,
  p_decision platform.document_review_decision,
  p_reason TEXT,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $mutation$
DECLARE
  preliminary_version RECORD;
  actor RECORD;
  target_case platform.student_cases%ROWTYPE;
  slot_row platform.document_slots%ROWTYPE;
  version_row platform.document_versions%ROWTYPE;
BEGIN
  PERFORM platform_private.lock_p2e_request(p_request_id);

  SELECT
    version.student_case_id,
    version.document_slot_id
  INTO preliminary_version
  FROM platform.document_versions AS version
  WHERE version.organization_id = p_organization_id
    AND version.id = p_document_version_id;

  SELECT *
  INTO actor
  FROM platform_private.require_case_operator(
    p_organization_id,
    preliminary_version.student_case_id,
    'document.review'
  );

  SELECT *
  INTO version_row
  FROM platform.document_versions AS version
  WHERE version.organization_id = p_organization_id
    AND version.id = p_document_version_id
    AND version.document_slot_id = slot_row.id
  FOR UPDATE;

  SELECT *
  INTO target_case
  FROM platform.student_cases AS student_case
  WHERE student_case.organization_id = p_organization_id
    AND student_case.id = preliminary_version.student_case_id
  FOR UPDATE;

  SELECT *
  INTO slot_row
  FROM platform.document_slots AS slot
  WHERE slot.organization_id = p_organization_id
    AND slot.id = preliminary_version.document_slot_id
    AND slot.student_case_id = target_case.id
  FOR UPDATE;

  RETURN jsonb_build_object(
    'decision',
    p_decision,
    'reason',
    NULLIF(btrim(p_reason), ''),
    'actor_profile_id',
    actor.actor_profile_id
  );
END
$mutation$;
\i /workspace/supabase/tests/platform_document_storage_inventory.sql
ROLLBACK;
SQL
    then
      echo "P2H inventory unexpectedly accepted reversed review row locks" >&2
      exit 1
    fi

    if ! grep -Fq \
      "P2H review lock-order contract drifted" \
      "$p2h_review_order_mutation_log"; then
      echo "P2H review lock-order mutation failed for the wrong reason" >&2
      sed -n '1,160p' "$p2h_review_order_mutation_log" >&2
      exit 1
    fi

    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -f /workspace/supabase/tests/platform_document_storage_inventory.sql
  fi

  # P3C owns migrations 049-050. Run its catalog and stateful authorization
  # checks only after the forward controller hardening is present, while the
  # immutable P2F suite remains an honest migration-044 proof.
  if [[ "$(basename "$migration")" == 050_* ]]; then
    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -f /workspace/supabase/tests/platform_messaging_workflow_rls.sql
    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -f /workspace/supabase/tests/platform_messaging_workflow_inventory.sql
  fi

  # BW1 owns the additive migration-051 workflow/domain/source contract. Run
  # both the catalog/grant inventory and the stateful tenant/RBAC/versioning
  # suite at that exact boundary so later workflow repositories cannot mask a
  # missing source-provenance or fail-closed authorization contract.
  if [[ "$(basename "$migration")" == 051_* ]]; then
    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -f /workspace/supabase/tests/platform_business_workflow_contracts_inventory.sql
    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -f /workspace/supabase/tests/platform_business_workflow_contracts_rls.sql
  fi

  # BW2 owns migration 052's workflow-to-case binding and fixed staff
  # repository projections. Prove its catalog/ACL posture before exercising
  # the stateful case/handoff/application authorization and replay contract.
  if [[ "$(basename "$migration")" == 052_* ]]; then
    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -f /workspace/supabase/tests/platform_workflow_case_bindings_inventory.sql
    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -f /workspace/supabase/tests/platform_workflow_case_bindings_rls.sql
  fi

  # BW3 owns migration 053's minimized Student Profile and immutable country
  # requirement binding. Test at this exact boundary so later migrations cannot
  # mask grant, RLS, version-retention or cross-student authorization drift.
  if [[ "$(basename "$migration")" == 053_* ]]; then
    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -f /workspace/supabase/tests/platform_student_profile_requirements_inventory.sql
    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -f /workspace/supabase/tests/platform_student_profile_requirements_rls.sql
  fi

  # BW4 owns migration 054's append-only decision backlog and private prompt
  # artifact lifecycle. Run at the exact boundary so later catalog work cannot
  # mask raw-content grants, pin swapping, stale authority or history drift.
  if [[ "$(basename "$migration")" == 054_* ]]; then
    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -f /workspace/supabase/tests/platform_decision_prompt_lifecycle_inventory.sql
    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -f /workspace/supabase/tests/platform_decision_prompt_lifecycle_rls.sql
  fi

  # BW5 owns migration 056's approved institution catalog and reviewable,
  # typed import boundary. Test at this exact boundary so later contract work
  # cannot mask source-revision, no-direct-approval or role-matrix drift.
  if [[ "$(basename "$migration")" == 056_* ]]; then
    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -f /workspace/supabase/tests/platform_university_catalog_import_boundary_inventory.sql
    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -f /workspace/supabase/tests/platform_university_catalog_import_boundary_rls.sql
  fi

  # BW6 owns migration 057's source-reviewed contract templates, immutable
  # contract/report versions and the audited mutable post-contract checklist.
  # Run at the exact boundary so later integrations cannot mask role/state,
  # provenance, rendering, idempotency or transition drift.
  if [[ "$(basename "$migration")" == 057_* ]]; then
    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -f /workspace/supabase/tests/platform_contract_draft_report_inventory.sql
    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -f /workspace/supabase/tests/platform_contract_draft_report_rls.sql
  fi

  # P4A owns migration 058's private, immutable and account-specific amoCRM
  # mapping-discovery versions. Run both suites at the exact boundary so later
  # provider/webhook work cannot mask service-ingest or Admin-read drift.
  if [[ "$(basename "$migration")" == 058_* ]]; then
    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -f /workspace/supabase/tests/platform_amocrm_mapping_discovery_inventory.sql
    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -f /workspace/supabase/tests/platform_amocrm_mapping_discovery_rls.sql
  fi

  # P5A keeps both verified WAHA message aliases as raw evidence while the
  # durable queue coalesces them by session + payload.id. Run this only after
  # migration 059 replaces the webhook enqueue wrapper.
  if [[ "$(basename "$migration")" == 059_* ]]; then
    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -f /workspace/supabase/tests/platform_waha_message_alias_queue_rls.sql
  fi

  # P5B consumes only leased provider-webhook work and projects verified WAHA
  # observations into the unified Platform history. Prove at migration 060 that
  # other queue lanes remain untouched and that WAHA-only rows do not acquire
  # fabricated amoCRM/Kommo identity.
  if [[ "$(basename "$migration")" == 060_* ]]; then
    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -f /workspace/supabase/tests/platform_waha_work_projection_rls.sql
  fi

  # P5C imports only read-only WAHA history observations. Prove at migration
  # 061 that its resumable cursor, private identifiers, tenant/session checks,
  # inbound/outbound provenance and browser RLS remain fail-closed.
  if [[ "$(basename "$migration")" == 061_* ]]; then
    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -f /workspace/supabase/tests/platform_waha_history_reconciliation_rls.sql
  fi

  # P5D archives media only for already-projected P5B/P5C messages. Prove at
  # migration 062 that raw provider/Storage identity stays private, archive
  # claims and finishes are service-only, and human download grants remain
  # live-authority, tenant, assignment and one-time scoped.
  if [[ "$(basename "$migration")" == 062_* ]]; then
    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -f /workspace/supabase/tests/platform_waha_private_media_rls.sql
  fi

  # P5E extends the same exact-session worker lane to ACK/session observations
  # and private Realtime invalidation. Prove delivery monotonicity, replay,
  # safe staff reads and receive-only tenant topic authorization at migration
  # 063 before later schema can mask the boundary.
  if [[ "$(basename "$migration")" == 063_* ]]; then
    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -f /workspace/supabase/tests/platform_waha_ack_session_realtime_rls.sql
  fi

  # P4R1 stores only sanitized read evidence and a bounded current projection.
  # Prove append-only/idempotent service writes plus live tenant/conversation
  # read authority at migration 064 before later schema can mask the boundary.
  if [[ "$(basename "$migration")" == 064_* ]]; then
    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -f /workspace/supabase/tests/platform_amocrm_canonical_context_rls.sql
  fi

  # P5F1 owns only private, append-only conversation AI memory and approved-
  # knowledge retrieval evidence. Prove exact staff authority, literal chunk
  # publication, degraded lexical behavior and the absence of any provider or
  # autonomous-send surface at the migration 065 boundary.
  if [[ "$(basename "$migration")" == 065_* ]]; then
    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -f /workspace/supabase/tests/platform_ai_memory_retrieval_rls.sql
  fi

  # P5F2 binds a stateless Gemini proposal to the latest inbound Platform
  # message and keeps its prompt/context/provider evidence private. Prove the
  # exact service boundary, append-only audit, safe staff projection and zero
  # autonomous authority at migration 066.
  if [[ "$(basename "$migration")" == 066_* ]]; then
    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -f /workspace/supabase/tests/platform_gemini_proposals_rls.sql
  fi

  # P5F3 adds only deterministic exact-inbound autonomous reply intent,
  # single-use attempt and provider/ACK evidence. Prove private-table
  # containment, service-only mutation, staff control/read authority and
  # no-replay transport semantics at migration 067.
  if [[ "$(basename "$migration")" == 067_* ]]; then
    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -f /workspace/supabase/tests/platform_autonomous_inbound_replies_rls.sql
  fi

  # P6B adds one in-app-only Student Portal notification/read lifecycle over
  # negative document-review source events. Prove the exact additive schema,
  # atomic producer, current-version staff read, self-only RPCs and private
  # membership-scoped Realtime policy at migration 068.
  if [[ "$(basename "$migration")" == 068_* ]]; then
    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -f /workspace/supabase/tests/platform_student_portal_notifications_rls.sql
  fi

  # P6C adds a disabled-by-default transition producer over explicit task and
  # payment due data. Prove bounded task-before-payment processing, immutable
  # replay, episode resolution/reopen, self-only v2 read/ack and zero delivery
  # intent at migration 069.
  if [[ "$(basename "$migration")" == 069_* ]]; then
    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -f /workspace/supabase/tests/platform_student_portal_overdue_notifications_rls.sql

    # Exercise the cross-worker lease with two genuinely overlapping database
    # sessions. Worker A owns the enabled organization's control-row lock;
    # worker B must finish a distinct request with zero work while that lock is
    # still held. A transaction-scoped advisory lock is only a readiness marker
    # for this harness; production arbitration remains the control-row lock.
    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -v p6c_concurrency_setup=1 \
      -f /workspace/supabase/tests/platform_student_portal_overdue_notifications_concurrency.sql \
      >"$p6c_concurrency_setup_log" 2>&1

    node "$deadline_runner" 30000 docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -c "BEGIN;
          SELECT control.organization_id
          FROM platform_private.student_portal_overdue_notification_runtime_controls AS control
          JOIN platform.case_tasks AS task
            ON task.organization_id = control.organization_id
          WHERE task.id = '46906900-0000-4000-8000-000000000010'
          FOR UPDATE OF control;
          SELECT pg_advisory_xact_lock(469069001);
          SELECT pg_sleep(12);
          SET LOCAL request.jwt.claims = '{\"role\":\"service_role\"}';
          SET LOCAL ROLE service_role;
          SELECT platform.process_student_portal_overdue_notifications_v1(
            '46906900-0000-4000-8000-000000000020',
            'p6c:concurrent-a'
          );
          COMMIT;" \
      >"$p6c_concurrency_worker_a_log" 2>&1 &
    p6c_concurrency_worker_a_pid=$!

    p6c_concurrency_ready=0
    for _ in {1..50}; do
      p6c_concurrency_marker="$({
        node "$deadline_runner" 3000 docker exec "$container_name" \
          psql -X -qAt -v ON_ERROR_STOP=1 \
          -h 127.0.0.1 -U postgres -d "$test_database" \
          -c "SELECT count(*)
              FROM pg_locks
              WHERE locktype = 'advisory'
                AND database = (
                  SELECT oid FROM pg_database WHERE datname = current_database()
                )
                AND classid = 0
                AND objid = 469069001
                AND objsubid = 1
                AND granted;" 2>/dev/null
      } || true)"
      if [[ "$p6c_concurrency_marker" == "1" ]]; then
        p6c_concurrency_ready=1
        break
      fi
      sleep 0.1
    done

    if [[ "$p6c_concurrency_ready" != "1" ]]; then
      echo "P6C lock-owning worker did not reach the overlap marker." >&2
      cat "$p6c_concurrency_worker_a_log" >&2
      exit 1
    fi

    if ! node "$deadline_runner" 8000 docker exec "$container_name" \
      psql -X -qAt -v ON_ERROR_STOP=1 \
      -h 127.0.0.1 -U postgres -d "$test_database" \
      -c "BEGIN;
          SET LOCAL request.jwt.claims = '{\"role\":\"service_role\"}';
          SET LOCAL ROLE service_role;
          SELECT platform.process_student_portal_overdue_notifications_v1(
            '46906900-0000-4000-8000-000000000021',
            'p6c:concurrent-b'
          );
          COMMIT;" \
      >"$p6c_concurrency_worker_b_log" 2>&1; then
      echo "P6C overlapping worker did not finish within its bound." >&2
      cat "$p6c_concurrency_worker_b_log" >&2
      exit 1
    fi

    if ! kill -0 "$p6c_concurrency_worker_a_pid" >/dev/null 2>&1; then
      echo "P6C lock-owning worker ended before the overlapping call." >&2
      cat "$p6c_concurrency_worker_a_log" >&2
      exit 1
    fi

    if ! wait "$p6c_concurrency_worker_a_pid"; then
      p6c_concurrency_worker_a_pid=""
      echo "P6C lock-owning worker failed." >&2
      cat "$p6c_concurrency_worker_a_log" >&2
      exit 1
    fi
    p6c_concurrency_worker_a_pid=""

    if ! docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -v p6c_concurrency_assert=1 \
      -f /workspace/supabase/tests/platform_student_portal_overdue_notifications_concurrency.sql \
      >"$p6c_concurrency_assert_log" 2>&1; then
      echo "P6C concurrent-worker durable-state assertions failed." >&2
      cat "$p6c_concurrency_assert_log" >&2
      exit 1
    fi
  fi

  # P6D adds only exact-case staff projections over accepted visa/finance
  # state and a database-derived full-settlement wrapper. Prove two-Student
  # object scope, cross-organization isolation, safe DTOs, evidence/replay and
  # case-before-obligation lock order at migration 070.
  if [[ "$(basename "$migration")" == 070_* ]]; then
    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -f /workspace/supabase/tests/platform_portal_cross_domain_closure_rls.sql

    # A direct ledger writer acquires Finance authority before the parent case,
    # matching the production writer and P6D wrapper. Hold both locks while a
    # second authorized worker starts so the proof exercises the shared
    # authority -> case -> obligation order without manufacturing an inverse-
    # order deadlock in the harness itself.
    node "$deadline_runner" 30000 docker exec "$container_name" \
      psql -X -qAt -v ON_ERROR_STOP=1 \
      -h 127.0.0.1 -U postgres -d "$test_database" \
      -c "BEGIN;
          DO \$\$
          DECLARE
            target_count BIGINT;
            finance_count BIGINT;
            target_organization_id UUID;
            target_case_id UUID;
            target_obligation_id UUID;
            target_currency TEXT;
            finance_auth_user_id UUID;
            finance_access_version BIGINT;
          BEGIN
            SELECT
              count(*),
              (array_agg(student_case.organization_id ORDER BY student_case.id))[1],
              (array_agg(student_case.id ORDER BY student_case.id))[1],
              (array_agg(obligation.id ORDER BY student_case.id))[1],
              (array_agg(obligation.currency ORDER BY student_case.id))[1]
            INTO
              target_count,
              target_organization_id,
              target_case_id,
              target_obligation_id,
              target_currency
            FROM platform.student_cases AS student_case
            JOIN platform.payment_obligations AS obligation
              ON obligation.organization_id = student_case.organization_id
              AND obligation.student_case_id = student_case.id
            WHERE student_case.source_key = 'synthetic:amocrm:lead:b'
              AND obligation.label = 'Synthetic third-party study cost';

            IF target_count <> 1 THEN
              RAISE EXCEPTION
                'P6D worker A expected exactly one Student B payment target, found %',
                target_count;
            END IF;

            SELECT
              count(*),
              (array_agg(profile.auth_user_id ORDER BY membership.id))[1],
              (array_agg(profile.access_version ORDER BY membership.id))[1]
            INTO
              finance_count,
              finance_auth_user_id,
              finance_access_version
            FROM platform.organization_memberships AS membership
            JOIN platform.profiles AS profile
              ON profile.id = membership.profile_id
            WHERE membership.organization_id = target_organization_id
              AND membership.\"current_role\" = 'finance'
              AND membership.status = 'active';

            IF finance_count <> 1 THEN
              RAISE EXCEPTION
                'P6D worker A expected exactly one active Finance actor in Student B organization %, found %',
                target_organization_id,
                finance_count;
            END IF;

            PERFORM set_config(
              'evo.p6d_organization_id',
              target_organization_id::TEXT,
              TRUE
            );
            PERFORM set_config(
              'evo.p6d_case_id',
              target_case_id::TEXT,
              TRUE
            );
            PERFORM set_config(
              'evo.p6d_obligation_id',
              target_obligation_id::TEXT,
              TRUE
            );
            PERFORM set_config(
              'evo.p6d_currency',
              target_currency,
              TRUE
            );
            PERFORM set_config(
              'evo.p6d_finance_auth_user_id',
              finance_auth_user_id::TEXT,
              TRUE
            );
            PERFORM set_config(
              'evo.p6d_finance_access_version',
              finance_access_version::TEXT,
              TRUE
            );
          END
          \$\$;

          DO \$\$
          BEGIN
            PERFORM set_config(
              'request.jwt.claims',
              jsonb_build_object(
                'sub', current_setting('evo.p6d_finance_auth_user_id')::UUID,
                'role', 'authenticated',
                'platform_role', 'finance',
                'platform_access_version',
                  current_setting('evo.p6d_finance_access_version')::BIGINT
              )::TEXT,
              TRUE
            );

            PERFORM 1
            FROM platform_private.require_finance_actor(
              current_setting('evo.p6d_organization_id')::UUID,
              'finance.event.confirm'
            );
          END
          \$\$;

          DO \$\$
          DECLARE
            locked_case_id UUID;
          BEGIN
            SELECT student_case.id
            INTO locked_case_id
            FROM platform.student_cases AS student_case
            WHERE student_case.organization_id =
                current_setting('evo.p6d_organization_id')::UUID
              AND student_case.id = current_setting('evo.p6d_case_id')::UUID
            FOR UPDATE;

            IF locked_case_id IS NULL THEN
              RAISE EXCEPTION
                'P6D worker A could not lock frozen Student B case % in organization %',
                current_setting('evo.p6d_case_id'),
                current_setting('evo.p6d_organization_id');
            END IF;

            PERFORM pg_advisory_xact_lock(470070001);
            PERFORM pg_sleep(8);
          END
          \$\$;

          SET LOCAL ROLE authenticated;
          WITH worker_a_call AS MATERIALIZED (
            SELECT platform.record_payment_event(
              current_setting('evo.p6d_organization_id')::UUID,
              current_setting('evo.p6d_obligation_id')::UUID,
              'payment',
              NULL,
              100,
              current_setting('evo.p6d_currency'),
              transaction_timestamp(),
              'synthetic:p6d:concurrency:direct',
              'synthetic:p6d:evidence:concurrency:direct',
              'Synthetic P6D direct writer overlap',
              '47007000-0000-4000-8000-000000000001'
            ) AS receipt
          )
          SELECT 'P6D_WORKER_A_RECEIPT=' || receipt::TEXT
          FROM worker_a_call
          WHERE jsonb_typeof(receipt) = 'object'
            AND receipt ->> 'organization_id' =
              current_setting('evo.p6d_organization_id')
            AND receipt ->> 'student_case_id' =
              current_setting('evo.p6d_case_id')
            AND receipt ->> 'payment_obligation_id' =
              current_setting('evo.p6d_obligation_id')
            AND (receipt ->> 'amount_minor')::BIGINT = 100
            AND receipt ->> 'currency' = current_setting('evo.p6d_currency');
          COMMIT;" \
      >"$p6d_concurrency_worker_a_log" 2>&1 &
    p6d_concurrency_worker_a_pid=$!

    p6d_concurrency_ready=0
    for _ in {1..50}; do
      p6d_concurrency_marker="$({
        node "$deadline_runner" 3000 docker exec "$container_name" \
          psql -X -qAt -v ON_ERROR_STOP=1 \
          -h 127.0.0.1 -U postgres -d "$test_database" \
          -c "SELECT count(*)
              FROM pg_locks
              WHERE locktype = 'advisory'
                AND database = (
                  SELECT oid FROM pg_database WHERE datname = current_database()
                )
                AND classid = 0
                AND objid = 470070001
                AND objsubid = 1
                AND granted;" 2>/dev/null
      } || true)"
      if [[ "$p6d_concurrency_marker" == "1" ]]; then
        p6d_concurrency_ready=1
        break
      fi
      sleep 0.1
    done

    if [[ "$p6d_concurrency_ready" != "1" ]]; then
      echo "P6D direct writer did not acquire the parent-case proof lock." >&2
      cat "$p6d_concurrency_worker_a_log" >&2
      exit 1
    fi

    if ! node "$deadline_runner" 30000 docker exec "$container_name" \
      psql -X -qAt -v ON_ERROR_STOP=1 \
      -h 127.0.0.1 -U postgres -d "$test_database" \
      -c "BEGIN;
          DO \$\$
          DECLARE
            target_count BIGINT;
            finance_count BIGINT;
            target_organization_id UUID;
            target_case_id UUID;
            target_obligation_id UUID;
            target_currency TEXT;
            finance_auth_user_id UUID;
            finance_access_version BIGINT;
          BEGIN
            SELECT
              count(*),
              (array_agg(student_case.organization_id ORDER BY student_case.id))[1],
              (array_agg(student_case.id ORDER BY student_case.id))[1],
              (array_agg(obligation.id ORDER BY student_case.id))[1],
              (array_agg(obligation.currency ORDER BY student_case.id))[1]
            INTO
              target_count,
              target_organization_id,
              target_case_id,
              target_obligation_id,
              target_currency
            FROM platform.student_cases AS student_case
            JOIN platform.payment_obligations AS obligation
              ON obligation.organization_id = student_case.organization_id
              AND obligation.student_case_id = student_case.id
            WHERE student_case.source_key = 'synthetic:amocrm:lead:b'
              AND obligation.label = 'Synthetic third-party study cost';

            IF target_count <> 1 THEN
              RAISE EXCEPTION
                'P6D worker B expected exactly one Student B payment target, found %',
                target_count;
            END IF;

            SELECT
              count(*),
              (array_agg(profile.auth_user_id ORDER BY membership.id))[1],
              (array_agg(profile.access_version ORDER BY membership.id))[1]
            INTO
              finance_count,
              finance_auth_user_id,
              finance_access_version
            FROM platform.organization_memberships AS membership
            JOIN platform.profiles AS profile
              ON profile.id = membership.profile_id
            WHERE membership.organization_id = target_organization_id
              AND membership.\"current_role\" = 'finance'
              AND membership.status = 'active';

            IF finance_count <> 1 THEN
              RAISE EXCEPTION
                'P6D worker B expected exactly one active Finance actor in Student B organization %, found %',
                target_organization_id,
                finance_count;
            END IF;

            PERFORM set_config(
              'evo.p6d_organization_id',
              target_organization_id::TEXT,
              TRUE
            );
            PERFORM set_config(
              'evo.p6d_case_id',
              target_case_id::TEXT,
              TRUE
            );
            PERFORM set_config(
              'evo.p6d_obligation_id',
              target_obligation_id::TEXT,
              TRUE
            );
            PERFORM set_config(
              'evo.p6d_currency',
              target_currency,
              TRUE
            );
            PERFORM set_config(
              'evo.p6d_finance_auth_user_id',
              finance_auth_user_id::TEXT,
              TRUE
            );
            PERFORM set_config(
              'evo.p6d_finance_access_version',
              finance_access_version::TEXT,
              TRUE
            );
            PERFORM set_config(
              'request.jwt.claims',
              jsonb_build_object(
                'sub', finance_auth_user_id,
                'role', 'authenticated',
                'platform_role', 'finance',
                'platform_access_version', finance_access_version
              )::TEXT,
              TRUE
            );
          END
          \$\$;
          SET LOCAL ROLE authenticated;
          WITH worker_b_call AS MATERIALIZED (
            SELECT platform.settle_payment_obligation(
              current_setting('evo.p6d_organization_id')::UUID,
              current_setting('evo.p6d_case_id')::UUID,
              current_setting('evo.p6d_obligation_id')::UUID,
              'synthetic:p6d:concurrency:settle',
              'synthetic:p6d:evidence:concurrency:settle',
              'Synthetic P6D wrapper overlap',
              '47007000-0000-4000-8000-000000000002'
            ) AS receipt
          )
          SELECT 'P6D_WORKER_B_RECEIPT=' || receipt::TEXT
          FROM worker_b_call
          WHERE jsonb_typeof(receipt) = 'object'
            AND receipt ->> 'organization_id' =
              current_setting('evo.p6d_organization_id')
            AND receipt ->> 'student_case_id' =
              current_setting('evo.p6d_case_id')
            AND receipt ->> 'payment_obligation_id' =
              current_setting('evo.p6d_obligation_id')
            AND (receipt ->> 'amount_minor')::BIGINT = 400
            AND receipt ->> 'currency' = current_setting('evo.p6d_currency');
          COMMIT;" \
      >"$p6d_concurrency_worker_b_log" 2>&1; then
      echo "P6D wrapper failed during the overlapping lock-order proof." >&2
      cat "$p6d_concurrency_worker_b_log" >&2
      cat "$p6d_concurrency_worker_a_log" >&2
      exit 1
    fi

    p6d_worker_b_receipt_rows="$(
      grep -c '^P6D_WORKER_B_RECEIPT=' "$p6d_concurrency_worker_b_log" || true
    )"
    if [[ "$p6d_worker_b_receipt_rows" != "1" ]] \
      || ! grep -Eq '^P6D_WORKER_B_RECEIPT=\{.+\}$' \
        "$p6d_concurrency_worker_b_log"; then
      echo "P6D wrapper did not return exactly one validated settlement receipt." >&2
      cat "$p6d_concurrency_worker_b_log" >&2
      cat "$p6d_concurrency_worker_a_log" >&2
      exit 1
    fi

    if ! wait "$p6d_concurrency_worker_a_pid"; then
      echo "P6D direct writer failed during the overlapping proof." >&2
      cat "$p6d_concurrency_worker_a_log" >&2
      exit 1
    fi
    p6d_concurrency_worker_a_pid=""

    p6d_worker_a_receipt_rows="$(
      grep -c '^P6D_WORKER_A_RECEIPT=' "$p6d_concurrency_worker_a_log" || true
    )"
    if [[ "$p6d_worker_a_receipt_rows" != "1" ]] \
      || ! grep -Eq '^P6D_WORKER_A_RECEIPT=\{.+\}$' \
        "$p6d_concurrency_worker_a_log"; then
      echo "P6D direct writer did not return exactly one validated payment receipt." >&2
      cat "$p6d_concurrency_worker_a_log" >&2
      exit 1
    fi

    if ! docker exec "$container_name" \
      psql -X -qAt -v ON_ERROR_STOP=1 \
      -h 127.0.0.1 -U postgres -d "$test_database" \
      -c "DO \$\$
          DECLARE
            target_rows BIGINT;
            direct_rows BIGINT;
            wrapper_rows BIGINT;
            target_outstanding BIGINT;
            direct_amount BIGINT;
            wrapper_amount BIGINT;
          BEGIN
            SELECT
              count(*),
              min(
                obligation.amount_minor
                  - (obligation.total_paid_minor - obligation.total_refunded_minor)
              )
            INTO target_rows, target_outstanding
            FROM platform.payment_obligations AS obligation
            JOIN platform.student_cases AS student_case
              ON student_case.id = obligation.student_case_id
            WHERE obligation.label = 'Synthetic third-party study cost'
              AND student_case.source_key = 'synthetic:amocrm:lead:b';

            SELECT count(*), min(event.amount_minor)
            INTO direct_rows, direct_amount
            FROM platform.payment_events AS event
            WHERE event.request_id =
              '47007000-0000-4000-8000-000000000001';

            SELECT count(*), min(event.amount_minor)
            INTO wrapper_rows, wrapper_amount
            FROM platform.payment_events AS event
            WHERE event.request_id =
              '47007000-0000-4000-8000-000000000002';

            IF target_rows <> 1 THEN
              RAISE EXCEPTION
                'P6D durable-state assertion failed: expected one Student B obligation, found %',
                target_rows;
            END IF;

            IF direct_rows <> 1 THEN
              RAISE EXCEPTION
                'P6D durable-state assertion failed: expected one direct writer event, found %',
                direct_rows;
            END IF;

            IF wrapper_rows <> 1 THEN
              RAISE EXCEPTION
                'P6D durable-state assertion failed: expected one wrapper event, found %',
                wrapper_rows;
            END IF;

            IF COALESCE(target_outstanding, -1) <> 0 THEN
              RAISE EXCEPTION
                'P6D durable-state assertion failed: obligation balance mismatch (outstanding=%)',
                target_outstanding;
            END IF;

            IF COALESCE(direct_amount, -1) <> 100 THEN
              RAISE EXCEPTION
                'P6D durable-state assertion failed: direct writer event mismatch (amount=%)',
                direct_amount;
            END IF;

            IF COALESCE(wrapper_amount, -1) <> 400 THEN
              RAISE EXCEPTION
                'P6D durable-state assertion failed: wrapper settle event mismatch (amount=%)',
                wrapper_amount;
            END IF;
          END
          \$\$;" \
      >"$p6d_concurrency_assert_log" 2>&1; then
      echo "P6D overlapping settlement durable-state assertion failed." >&2
      cat "$p6d_concurrency_assert_log" >&2
      exit 1
    fi
  fi

  # P7A removes authenticated raw audit-table reads and exposes only the
  # actor-derived, safe search/export projection with immutable replay.
  if [[ "$(basename "$migration")" == 071_* ]]; then
    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -f /workspace/supabase/tests/platform_audit_search_export_rls.sql
  fi

  # P7B1 exposes one bounded global operational snapshot to service_role only.
  # Prove exact grants, safe aggregation, the operational-organization union,
  # transactional audit probing and the tenant/state/time query plans at 072.
  if [[ "$(basename "$migration")" == 072_* ]]; then
    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -f /workspace/supabase/tests/platform_observability_rls.sql
  fi

  # P5F2 consultative-sales v2 extends the exact proposal policy and memory
  # fact vocabulary after the historical migration-066 boundary has passed.
  if [[ "$(basename "$migration")" == 076_* ]]; then
    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -f /workspace/supabase/tests/platform_consultative_sales_memory.sql
  fi

  # Migration 078 replaces cap-prone queue/history RPCs with bounded keyset
  # pages and direct snapshots. Keep this proof at the exact replacement
  # boundary so later migrations cannot mask a missing drop, signature or ACL.
  if [[ "$(basename "$migration")" == 078_* ]]; then
    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -f /workspace/supabase/tests/platform_paged_read_models_current.sql
  fi

  # Migration 079 makes Lead-Agent session projection a Supabase-native module
  # and requires callers to select one exact canonical WAHA session.
  if [[ "$(basename "$migration")" == 079_* ]]; then
    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -f /workspace/supabase/tests/platform_unified_lead_agent_sync_current.sql
  fi

  # Migration 082 makes evo-inbox the only forward signed Lead-Agent and
  # current staff-health session while retaining old rows only as history.
  if [[ "$(basename "$migration")" == 082_* ]]; then
    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -f /workspace/supabase/tests/platform_waha_session_authority_current.sql

    docker exec -i "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" <<'SQL'
SET session_replication_role = replica;
DELETE FROM platform.waha_session_health
WHERE organization_id = '82000000-0000-4000-8000-000000000900';
DELETE FROM platform_private.waha_session_observations
WHERE organization_id = '82000000-0000-4000-8000-000000000900';
DELETE FROM platform_private.provider_webhook_events
WHERE organization_id = '82000000-0000-4000-8000-000000000900';
DELETE FROM platform.organizations
WHERE id = '82000000-0000-4000-8000-000000000900';
SET session_replication_role = origin;
SQL
  fi

  # U2 migration 084 owns the canonical person/lead schema, v12 authority,
  # object-scoped read models and concurrency-safe provider-key arbitration.
  if [[ "$(basename "$migration")" == 084_* ]]; then
    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -f /workspace/supabase/tests/platform_canonical_client_lead_inventory.sql

    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -f /workspace/supabase/tests/platform_canonical_client_lead_rls.sql

    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -f /workspace/supabase/tests/platform_canonical_client_lead_concurrency_setup.sql

    node "$deadline_runner" 15000 docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -v u2_hold_lock=1 \
      -v u2_hold_seconds=4 \
      -v u2_worker_ref=worker-a \
      -f /workspace/supabase/tests/platform_canonical_client_lead_concurrency_worker.sql \
      >"$u2_concurrency_worker_a_log" 2>&1 &
    u2_concurrency_worker_a_pid=$!

    u2_concurrency_ready=0
    for _ in {1..50}; do
      u2_concurrency_marker="$({
        node "$deadline_runner" 3000 docker exec "$container_name" \
          psql -X -qAt -v ON_ERROR_STOP=1 \
          -h 127.0.0.1 -U postgres -d "$test_database" \
          -c "SELECT count(*)
              FROM pg_locks
              WHERE locktype = 'advisory'
                AND database = (
                  SELECT oid FROM pg_database WHERE datname = current_database()
                )
                AND classid = 0
                AND objid = 840084001
                AND objsubid = 1
                AND granted;" 2>/dev/null
      } || true)"
      if [[ "$u2_concurrency_marker" == "1" ]]; then
        u2_concurrency_ready=1
        break
      fi
      sleep 0.1
    done

    if [[ "$u2_concurrency_ready" != "1" ]]; then
      echo "U2 concurrency worker did not reach the overlap marker." >&2
      cat "$u2_concurrency_worker_a_log" >&2
      exit 1
    fi

    if ! node "$deadline_runner" 12000 docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -v u2_hold_lock=0 \
      -v u2_hold_seconds=0 \
      -v u2_worker_ref=worker-b \
      -f /workspace/supabase/tests/platform_canonical_client_lead_concurrency_worker.sql \
      >"$u2_concurrency_worker_b_log" 2>&1; then
      echo "U2 overlapping create-or-link worker failed." >&2
      cat "$u2_concurrency_worker_b_log" >&2
      exit 1
    fi

    if ! wait "$u2_concurrency_worker_a_pid"; then
      u2_concurrency_worker_a_pid=""
      echo "U2 lock-owning create-or-link worker failed." >&2
      cat "$u2_concurrency_worker_a_log" >&2
      exit 1
    fi
    u2_concurrency_worker_a_pid=""

    u2_worker_a_client="$({
      sed -n 's/^U2_CONCURRENT_CLIENT=//p' "$u2_concurrency_worker_a_log"
    } | tail -1)"
    u2_worker_b_client="$({
      sed -n 's/^U2_CONCURRENT_CLIENT=//p' "$u2_concurrency_worker_b_log"
    } | tail -1)"
    if [[ -z "$u2_worker_a_client" ]] \
      || [[ "$u2_worker_a_client" != "$u2_worker_b_client" ]]; then
      echo "U2 concurrent workers returned different canonical UUIDs." >&2
      cat "$u2_concurrency_worker_a_log" >&2
      cat "$u2_concurrency_worker_b_log" >&2
      exit 1
    fi

    if ! docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -f /workspace/supabase/tests/platform_canonical_client_lead_concurrency_assert.sql \
      >"$u2_concurrency_assert_log" 2>&1; then
      echo "U2 concurrent create-or-link durable-state assertion failed." >&2
      cat "$u2_concurrency_assert_log" >&2
      exit 1
    fi
  fi

  # Migration 085 binds verified receive-only WAHA intake to canonical
  # lead/conversation identity and exposes the bounded safe Sales intake RPCs.
  if [[ "$(basename "$migration")" == 085_* ]]; then
    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -f /workspace/supabase/tests/platform_waha_receive_only_sales_current.sql

    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -f /workspace/supabase/tests/platform_waha_receive_only_sales_rls.sql
  fi

  # Migration 086 adds the bounded, audited Sales qualification workflow.
  if [[ "$(basename "$migration")" == 086_* ]]; then
    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -f /workspace/supabase/tests/platform_sales_workflow_rls.sql
  fi

  # Migration 093 tightens the Sales detail conversation projection to the
  # same exact verified intake predicate enforced by the nested transcript
  # link RPC. Re-run only the forward-correction assertions at that boundary.
  if [[ "$(basename "$migration")" == 093_* ]]; then
    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -v u4_post093=1 \
      -f /workspace/supabase/tests/platform_sales_workflow_rls.sql
  fi

  # Migration 094 aligns both Sales queue connection fields and their filter
  # with the exact verified intake predicate already used by migration 093.
  if [[ "$(basename "$migration")" == 094_* ]]; then
    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -v u4_post094=1 \
      -f /workspace/supabase/tests/platform_sales_workflow_rls.sql
  fi

  # Migration 087 adds the individual-permission contract/payment gate and its
  # explicit normal-versus-exceptional Admissions handoff assertion boundary.
  if [[ "$(basename "$migration")" == 087_* ]]; then
    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -f /workspace/supabase/tests/platform_contract_payment_gate_rls.sql
  fi

  # Migration 088 adds the audited Sales-to-Admissions handoff over U5's gate,
  # one canonical active case, immutable handoff evidence and stable starter
  # tasks without broadening Student Portal access.
  if [[ "$(basename "$migration")" == 088_* ]]; then
    if ! docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -f /workspace/supabase/tests/platform_sales_admissions_handoff_concurrency_setup.sql \
      >"$u6c_concurrency_setup_log" 2>&1; then
      echo "U6 concurrency setup failed." >&2
      cat "$u6c_concurrency_setup_log" >&2
      exit 1
    fi

    node "$deadline_runner" 15000 docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -v u6c_hold_lock=1 \
      -v u6c_hold_seconds=4 \
      -v u6c_worker_ref=worker-a \
      -v u6c_request_id=88100000-0000-4000-8000-000000000701 \
      -f /workspace/supabase/tests/platform_sales_admissions_handoff_concurrency_worker.sql \
      >"$u6c_concurrency_worker_a_log" 2>&1 &
    u6c_concurrency_worker_a_pid=$!

    u6c_concurrency_ready=0
    for _ in {1..50}; do
      if grep -Fq 'U6C_LOCK_HELD=1' "$u6c_concurrency_worker_a_log" 2>/dev/null; then
        u6c_concurrency_ready=1
        break
      fi
      sleep 0.1
    done

    if [[ "$u6c_concurrency_ready" != "1" ]]; then
      echo "U6 concurrency worker did not reach the overlap marker." >&2
      cat "$u6c_concurrency_worker_a_log" >&2
      exit 1
    fi

    if ! node "$deadline_runner" 12000 docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -v u6c_hold_lock=0 \
      -v u6c_hold_seconds=0 \
      -v u6c_worker_ref=worker-b \
      -v u6c_request_id=88100000-0000-4000-8000-000000000702 \
      -f /workspace/supabase/tests/platform_sales_admissions_handoff_concurrency_worker.sql \
      >"$u6c_concurrency_worker_b_log" 2>&1; then
      echo "U6 overlapping handoff worker failed." >&2
      cat "$u6c_concurrency_worker_b_log" >&2
      exit 1
    fi

    if ! wait "$u6c_concurrency_worker_a_pid"; then
      u6c_concurrency_worker_a_pid=""
      echo "U6 lock-owning handoff worker failed." >&2
      cat "$u6c_concurrency_worker_a_log" >&2
      exit 1
    fi
    u6c_concurrency_worker_a_pid=""

    u6c_worker_a_case="$({
      sed -n 's/^U6C_CASE_ID=//p' "$u6c_concurrency_worker_a_log"
    } | tail -1)"
    u6c_worker_b_case="$({
      sed -n 's/^U6C_CASE_ID=//p' "$u6c_concurrency_worker_b_log"
    } | tail -1)"
    if [[ -z "$u6c_worker_a_case" ]] \
      || [[ "$u6c_worker_a_case" != "$u6c_worker_b_case" ]]; then
      echo "U6 concurrent workers returned different case UUIDs." >&2
      cat "$u6c_concurrency_worker_a_log" >&2
      cat "$u6c_concurrency_worker_b_log" >&2
      exit 1
    fi

    if ! docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -v u6c_request_id_a=88100000-0000-4000-8000-000000000701 \
      -v u6c_request_id_b=88100000-0000-4000-8000-000000000702 \
      -f /workspace/supabase/tests/platform_sales_admissions_handoff_concurrency_assert.sql \
      >"$u6c_concurrency_assert_log" 2>&1; then
      echo "U6 concurrent handoff durable-state assertion failed." >&2
      cat "$u6c_concurrency_assert_log" >&2
      exit 1
    fi

    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -f /workspace/supabase/tests/platform_sales_admissions_handoff_rls.sql
  fi

  # Migration 089 completes the existing canonical Admissions case workspace
  # with bounded task and case-activity projections while reusing the audited
  # task, document, application and visa mutation boundaries.
  if [[ "$(basename "$migration")" == 089_* ]]; then
    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -f /workspace/supabase/tests/platform_admissions_case_workspace_rls.sql
  fi

  # Migration 090 adds the U8 canonical payment-control and finance stop-factor
  # read models while retaining the existing P2E audited mutation authority.
  if [[ "$(basename "$migration")" == 090_* ]]; then
    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -f /workspace/supabase/tests/platform_finance_stop_factor_rls.sql
  fi

  # Migration 091 upgrades only new Gemini proposals to the pinned U9 v2
  # contract and adds an append-only, human-reviewed decision boundary.
  if [[ "$(basename "$migration")" == 091_* ]]; then
    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -f /workspace/supabase/tests/platform_ai_human_review_rls.sql
  fi

  # Migration 092 adds the U10 net-new pilot cohort while keeping legacy cases
  # outside by default and preserving an explicit no-fallback write boundary.
  if [[ "$(basename "$migration")" == 092_* ]]; then
    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -f /workspace/supabase/tests/platform_pilot_cohort_rls.sql
  fi

  # Migration 096 binds Gemini starts to authenticated staff intent and adds
  # the service-only reconciliation contract. The executable reconciliation
  # proof runs at 097 after the exact-item claim replaces the generic claim.
  if [[ "$(basename "$migration")" == 096_* ]]; then
    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -f /workspace/supabase/tests/platform_provider_workflow_contract_rls.sql
  fi

  # Migration 098 replaces the remaining generic WAHA claims with one exact
  # item claim and rejects non-API evidence for matched reconciliation.
  if [[ "$(basename "$migration")" == 098_* ]]; then
    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -f /workspace/supabase/tests/platform_exact_waha_projection_claim.sql
  fi

  # Migration 099 is the current one-way WAHA transport cutover. Run every
  # current manual-send/provisioning/reconciliation contract here: migrations
  # 081 and 097 intentionally retain the frozen V1 alias as historical input,
  # while the schema tip must expose only the EVO Inbox transport.
  if [[ "$(basename "$migration")" == 099_* ]]; then
    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -f /workspace/supabase/tests/platform_waha_transport_alias.sql
    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -f /workspace/supabase/tests/platform_manual_send_waha_provisioning_current.sql
    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -f /workspace/supabase/tests/platform_manual_send_waha_runtime_current.sql
    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -f /workspace/supabase/tests/platform_provider_workflow_reconciliation.sql
  fi

  # Migration 100 makes the exact signed evo-inbox session.status projection
  # the WAHA readiness authority used by both staff UI and the send guard.
  if [[ "$(basename "$migration")" == 100_* ]]; then
    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -f /workspace/supabase/tests/platform_waha_session_readiness.sql
  fi

  # Migration 101 aligns the exact worker claim with the authenticated
  # four-field queue pointer and rejects the superseded three-field shape.
  if [[ "$(basename "$migration")" == 101_* ]]; then
    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -f /workspace/supabase/tests/platform_exact_manual_send_queue_shape.sql
  fi

  # Migration 102 makes the already-connected sales session the only active
  # WAHA identity and revokes the autonomous/frozen V1 sender surfaces.
  if [[ "$(basename "$migration")" == 102_* ]]; then
    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -f /workspace/supabase/tests/platform_crm_primary_waha_authority.sql
  fi

  # Migration 103 adds the Supabase-authoritative amoCRM command attempt,
  # replay and provider-binding contract.
  if [[ "$(basename "$migration")" == 103_* ]]; then
    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -f /workspace/supabase/tests/platform_amocrm_command_rls.sql
  fi

  # Migration 104 upgrades new amoCRM mapping evidence to schema v2 with the
  # exact lead-tag catalog while retaining immutable schema-v1 history.
  if [[ "$(basename "$migration")" == 104_* ]]; then
    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -f /workspace/supabase/tests/platform_amocrm_mapping_discovery_v2.sql
  fi

  # Migration 105 restores the authorized Student Case -> canonical Sales
  # lead navigation used by the Supabase-backed Student 360 queue.
  if [[ "$(basename "$migration")" == 105_* ]]; then
    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -f /workspace/supabase/tests/platform_student_case_sales_links_current.sql
  fi

  # Migration 106 exposes the exact canonical lead/client/Student Case
  # bindings for one staff-visible conversation without provider-id inference.
  if [[ "$(basename "$migration")" == 106_* ]]; then
    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -f /workspace/supabase/tests/platform_communication_command_context_current.sql
  fi

  # Migration 107 adds optimistic row versions to the canonical Admissions
  # task, application, visa and finance-stop command surfaces.
  if [[ "$(basename "$migration")" == 107_* ]]; then
    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -f /workspace/supabase/tests/platform_admissions_versioning_current.sql
  fi

  # Migration 108 extends the canonical document checklist with case-local
  # custom slots, optimistic metadata updates and soft removal.
  if [[ "$(basename "$migration")" == 108_* ]]; then
    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -f /workspace/supabase/tests/platform_dynamic_document_checklists.sql
  fi

  # Migration 109 owns one canonical private company-knowledge tree plus a
  # distinct 25 MiB Storage bucket. The plain PostgreSQL harness cannot apply
  # config.toml, so prove that lifecycle contract statically and exercise the
  # complete RPC/RLS/Storage-policy boundary in its rolled-back SQL suite.
  if [[ "$(basename "$migration")" == 109_* ]]; then
    p109_bucket_block="$(
      awk '
        /^\[storage\.buckets\.platform-company-files\]$/ { active = 1; next }
        active && /^\[/ { exit }
        active { print }
      ' "$repo_root/supabase/config.toml"
    )"

    if ! grep -Eq '^public[[:space:]]*=[[:space:]]*false$' \
      <<<"$p109_bucket_block" ||
      ! grep -Eq '^file_size_limit[[:space:]]*=[[:space:]]*"25MiB"$' \
        <<<"$p109_bucket_block" ||
      ! grep -Fq '"application/pdf"' <<<"$p109_bucket_block" ||
      ! grep -Fq '"application/vnd.openxmlformats-officedocument.wordprocessingml.document"' \
        <<<"$p109_bucket_block"; then
      echo "migration 109 private Storage bucket contract drifted" >&2
      exit 1
    fi

    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -f /workspace/supabase/tests/platform_company_files.sql
  fi

  # Migration 110 evolves the one canonical case-task table and command/read
  # surfaces with mutually exclusive timed, all-day and unscheduled deadlines.
  if [[ "$(basename "$migration")" == 110_* ]]; then
    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -f /workspace/supabase/tests/platform_case_task_all_day_deadlines.sql
  fi

  # Migration 111 exposes exact first stage-entry facts only when the existing
  # private workflow receipt and append-only audit event prove one transition.
  if [[ "$(basename "$migration")" == 111_* ]]; then
    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -f /workspace/supabase/tests/platform_sales_stage_entry_projection.sql
  fi
done < <(
  cd "$repo_root"
  find supabase/migrations -maxdepth 1 -type f -name '*.sql' | sort
)

docker exec "$container_name" \
  psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
  -f /workspace/supabase/tests/authorization_policies.sql

docker exec "$container_name" \
  psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
  -f /workspace/supabase/tests/authorization_inventory.sql

printf 'Verified disposable authorization database with %s (%s).\n' \
  "$postgres_image" \
  "${postgres_image_id:0:19}"
