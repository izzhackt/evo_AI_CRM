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

cleanup() {
  node "$deadline_runner" 30000 docker rm -f "$container_name" \
    >/dev/null 2>&1 || true
  rm -f -- \
    "$p2b_drift_log" \
    "$p2h_acl_mutation_log" \
    "$p2h_policy_mutation_log" \
    "$p2h_download_order_mutation_log" \
    "$p2h_review_order_mutation_log"
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
