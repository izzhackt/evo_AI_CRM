import assert from "node:assert/strict";
import test from "node:test";

import {
  validateControlledStagingProfile,
} from "../scripts/evo-release-environment-profile.mjs";

const PRODUCTION_SUPABASE_PROJECT_REF = "iosckaqtovbbnssqcpde";
const STAGING_SUPABASE_PROJECT_REF = "stageabcdefghijklmno";

function validStagingProfile() {
  return {
    environment: "staging",
    githubEnvironment: "staging",
    serverRoot: "/opt/evo-crm-staging",
    immutableRoot: "/opt/evo-crm-staging/releases",
    transientRoot: "/opt/evo-crm-staging/.release-staging",
    evidenceRoot: "/opt/evo-crm-staging/evidence",
    composeProject: "evo-crm-staging",
    privateNetwork: "evo_crm_staging_private",
    publicNetwork: "evo_public_web",
    volumeNames: [
      "evo_crm_staging_data",
      "evo_crm_staging_output",
      "evo_crm_staging_backups",
      "evo_crm_staging_waha_sessions",
      "evo_crm_staging_lead_agent_data",
    ],
    fixedContainerNames: ["evo-crm-staging-manual-send-worker"],
    publicHostname: "staging.crm.evoadmissions.com",
    supabaseProjectRef: STAGING_SUPABASE_PROJECT_REF,
    productionSupabaseProjectRef: PRODUCTION_SUPABASE_PROJECT_REF,
  };
}

test("controlled staging preflight accepts the closed isolated staging identity", () => {
  assert.deepEqual(validateControlledStagingProfile(validStagingProfile()), {
    ok: true,
    code: "controlled_staging_profile_valid",
    environment: "staging",
    profile: "evo-crm-staging-v1",
    effectsAllowed: false,
    releaseStatus: "blocked",
    blocker: "managed_staging_inputs_required",
  });
});

test("controlled staging preflight rejects every production identity collision", () => {
  const collisions = [
    ["serverRoot", "/opt/evo-crm", "staging_server_root_collision"],
    ["immutableRoot", "/opt/evo-releases", "staging_immutable_root_collision"],
    ["transientRoot", "/opt/evo-crm/release-staging", "staging_transient_root_collision"],
    ["evidenceRoot", "/opt/evo-crm/evidence", "staging_evidence_root_collision"],
    ["composeProject", "evo-crm", "staging_compose_project_collision"],
    ["privateNetwork", "evo_crm_private", "staging_private_network_collision"],
    ["publicHostname", "crm.evoadmissions.com", "staging_hostname_collision"],
    [
      "supabaseProjectRef",
      PRODUCTION_SUPABASE_PROJECT_REF,
      "staging_supabase_identity_collision",
    ],
  ];

  for (const [field, value, code] of collisions) {
    assert.throws(
      () => validateControlledStagingProfile({ ...validStagingProfile(), [field]: value }),
      (error) => error instanceof Error && error.code === code,
      field,
    );
  }

  assert.throws(
    () => validateControlledStagingProfile({
      ...validStagingProfile(),
      volumeNames: ["evo_crm_data", ...validStagingProfile().volumeNames.slice(1)],
    }),
    (error) => error instanceof Error && error.code === "staging_volume_collision",
  );
  assert.throws(
    () => validateControlledStagingProfile({
      ...validStagingProfile(),
      fixedContainerNames: ["evo-crm-manual-send-worker"],
    }),
    (error) => error instanceof Error && error.code === "staging_container_name_collision",
  );

  assert.throws(
    () => validateControlledStagingProfile({
      ...validStagingProfile(),
      supabaseProjectRef: "friendly_staging_alias",
    }),
    (error) => error instanceof Error && error.code === "staging_supabase_project_ref_invalid",
  );
  assert.throws(
    () => validateControlledStagingProfile({
      ...validStagingProfile(),
      productionSupabaseProjectRef: "otherproductionrefxx",
    }),
    (error) => error instanceof Error && error.code === "production_supabase_project_ref_invalid",
  );
});
