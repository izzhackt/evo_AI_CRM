import { posix as path } from "node:path";
import { pathToFileURL } from "node:url";

const SAFE_IDENTITY_RE = /^[a-z0-9][a-z0-9_-]{5,127}$/u;
const SUPABASE_PROJECT_REF_RE = /^[a-z0-9]{20}$/u;
const CURRENT_PRODUCTION_SUPABASE_PROJECT_REF = "iosckaqtovbbnssqcpde";

const APPROVED_STAGING_PROFILE = Object.freeze({
  environment: "staging",
  githubEnvironment: "staging",
  serverRoot: "/opt/evo-crm-staging",
  immutableRoot: "/opt/evo-crm-staging/releases",
  transientRoot: "/opt/evo-crm-staging/.release-staging",
  evidenceRoot: "/opt/evo-crm-staging/evidence",
  composeProject: "evo-crm-staging",
  privateNetwork: "evo_crm_staging_private",
  publicNetwork: "evo_public_web",
  volumeNames: Object.freeze([
    "evo_crm_staging_output",
    "evo_crm_staging_waha_sessions",
  ]),
  fixedContainerNames: Object.freeze([]),
  publicHostname: "staging.crm.evoadmissions.com",
});

// This is the frozen V1 collision boundary, not the successor service list.
// Staging must not reuse any existing production identity before cutover.
const PRODUCTION_BOUNDARY = Object.freeze({
  protectedRoots: Object.freeze(["/opt/evo-crm", "/opt/evo-releases"]),
  composeProject: "evo-crm",
  privateNetwork: "evo_crm_private",
  volumeNames: Object.freeze([
    "evo_crm_data",
    "evo_crm_output",
    "evo_crm_backups",
    "evo_crm_waha_sessions",
    "evo_crm_lead_agent_data",
  ]),
  fixedContainerNames: Object.freeze(["evo-crm-manual-send-worker"]),
  publicHostname: "crm.evoadmissions.com",
});

export class ReleaseEnvironmentProfileError extends Error {
  constructor(code) {
    super(code);
    this.name = "ReleaseEnvironmentProfileError";
    this.code = code;
  }
}

function fail(code) {
  throw new ReleaseEnvironmentProfileError(code);
}

function normalizeAbsolutePath(value, code) {
  if (typeof value !== "string" || !value.startsWith("/") || value.includes("\0")) {
    fail(code);
  }
  const normalized = path.normalize(value);
  if (normalized === "/" || normalized !== value.replace(/\/$/u, "")) {
    fail(code);
  }
  return normalized;
}

function pathsOverlap(left, right) {
  const leftToRight = path.relative(left, right);
  const rightToLeft = path.relative(right, left);
  return leftToRight === ""
    || (!leftToRight.startsWith("../") && leftToRight !== "..")
    || (!rightToLeft.startsWith("../") && rightToLeft !== "..");
}

function requireExact(value, expected, code) {
  if (value !== expected) {
    fail(code);
  }
}

function requireStringArray(value, code, { allowEmpty = false } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0) || value.some((item) => (
    typeof item !== "string" || !SAFE_IDENTITY_RE.test(item)
  ))) {
    fail(code);
  }
  return value;
}

function requireExactSet(actual, expected, code) {
  if (actual.length !== expected.length) {
    fail(code);
  }
  const actualSet = new Set(actual);
  if (actualSet.size !== actual.length || expected.some((value) => !actualSet.has(value))) {
    fail(code);
  }
}

export function validateControlledStagingProfile(profile) {
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
    fail("staging_profile_invalid");
  }

  requireExact(profile.environment, "staging", "staging_environment_invalid");
  requireExact(profile.githubEnvironment, "staging", "staging_github_environment_invalid");

  const pathFields = [
    ["serverRoot", "staging_server_root_collision"],
    ["immutableRoot", "staging_immutable_root_collision"],
    ["transientRoot", "staging_transient_root_collision"],
    ["evidenceRoot", "staging_evidence_root_collision"],
  ];
  for (const [field, collisionCode] of pathFields) {
    const candidate = normalizeAbsolutePath(profile[field], "staging_path_invalid");
    if (PRODUCTION_BOUNDARY.protectedRoots.some((root) => pathsOverlap(candidate, root))) {
      fail(collisionCode);
    }
    requireExact(candidate, APPROVED_STAGING_PROFILE[field], "staging_profile_not_approved");
  }

  if (profile.composeProject === PRODUCTION_BOUNDARY.composeProject) {
    fail("staging_compose_project_collision");
  }
  requireExact(
    profile.composeProject,
    APPROVED_STAGING_PROFILE.composeProject,
    "staging_profile_not_approved",
  );

  if (profile.privateNetwork === PRODUCTION_BOUNDARY.privateNetwork) {
    fail("staging_private_network_collision");
  }
  requireExact(
    profile.privateNetwork,
    APPROVED_STAGING_PROFILE.privateNetwork,
    "staging_profile_not_approved",
  );
  requireExact(profile.publicNetwork, "evo_public_web", "staging_public_network_invalid");

  const volumeNames = requireStringArray(profile.volumeNames, "staging_volume_names_invalid");
  if (volumeNames.some((name) => PRODUCTION_BOUNDARY.volumeNames.includes(name))) {
    fail("staging_volume_collision");
  }
  requireExactSet(
    volumeNames,
    APPROVED_STAGING_PROFILE.volumeNames,
    "staging_profile_not_approved",
  );

  const fixedContainerNames = requireStringArray(
    profile.fixedContainerNames,
    "staging_container_names_invalid",
    { allowEmpty: true },
  );
  if (fixedContainerNames.some((name) => PRODUCTION_BOUNDARY.fixedContainerNames.includes(name))) {
    fail("staging_container_name_collision");
  }
  requireExactSet(
    fixedContainerNames,
    APPROVED_STAGING_PROFILE.fixedContainerNames,
    "staging_profile_not_approved",
  );

  const publicHostname = typeof profile.publicHostname === "string"
    ? profile.publicHostname.toLowerCase()
    : "";
  if (publicHostname === PRODUCTION_BOUNDARY.publicHostname) {
    fail("staging_hostname_collision");
  }
  requireExact(
    publicHostname,
    APPROVED_STAGING_PROFILE.publicHostname,
    "staging_profile_not_approved",
  );

  if (!SUPABASE_PROJECT_REF_RE.test(profile.supabaseProjectRef ?? "")) {
    fail("staging_supabase_project_ref_invalid");
  }
  if (
    !SUPABASE_PROJECT_REF_RE.test(profile.productionSupabaseProjectRef ?? "") ||
    profile.productionSupabaseProjectRef !== CURRENT_PRODUCTION_SUPABASE_PROJECT_REF
  ) {
    fail("production_supabase_project_ref_invalid");
  }
  if (profile.supabaseProjectRef === profile.productionSupabaseProjectRef) {
    fail("staging_supabase_identity_collision");
  }

  return {
    ok: true,
    code: "controlled_staging_profile_valid",
    environment: "staging",
    profile: "evo-crm-staging-successor-v1",
    effectsAllowed: false,
    releaseStatus: "blocked",
    blocker: "managed_staging_inputs_required",
  };
}

function splitClosedList(value) {
  return typeof value === "string" && value !== ""
    ? value.split(",")
    : [];
}

export function controlledStagingProfileFromEnvironment(environment) {
  return {
    environment: environment.EVO_RELEASE_ENVIRONMENT,
    githubEnvironment: environment.EVO_RELEASE_GITHUB_ENVIRONMENT,
    serverRoot: environment.EVO_RELEASE_ROOT,
    immutableRoot: environment.EVO_RELEASE_IMMUTABLE_ROOT,
    transientRoot: environment.EVO_RELEASE_STAGING_ROOT,
    evidenceRoot: environment.EVO_RELEASE_EVIDENCE_ROOT,
    composeProject: environment.EVO_RELEASE_PROJECT_NAME,
    privateNetwork: environment.EVO_RELEASE_PRIVATE_NETWORK,
    publicNetwork: environment.EVO_RELEASE_PUBLIC_NETWORK,
    volumeNames: splitClosedList(environment.EVO_RELEASE_VOLUME_NAMES),
    fixedContainerNames: splitClosedList(environment.EVO_RELEASE_FIXED_CONTAINER_NAMES),
    publicHostname: environment.EVO_RELEASE_PUBLIC_HOSTNAME,
    supabaseProjectRef: environment.EVO_RELEASE_SUPABASE_PROJECT_REF,
    productionSupabaseProjectRef: environment.EVO_PRODUCTION_SUPABASE_PROJECT_REF,
  };
}

function runCli() {
  if (process.argv.length !== 3 || process.argv[2] !== "--from-env") {
    fail("invalid_arguments");
  }
  const result = validateControlledStagingProfile(
    controlledStagingProfileFromEnvironment(process.env),
  );
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    runCli();
  } catch (error) {
    const code = error instanceof ReleaseEnvironmentProfileError
      ? error.code
      : "staging_profile_validation_failed";
    process.stderr.write(`${JSON.stringify({ ok: false, code })}\n`);
    process.exitCode = 2;
  }
}
