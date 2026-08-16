import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import { P8D4G_PRODUCTION, createAtomicEvidenceInstallScript, createCandidateTagBoundaryCheck, createDockerImagePlatformCheck, createImporterIdentityCheck, createP8D4GOperations, validateP8D4GExecutionControl } from "../scripts/p8d4g-production-operations.mjs";

const expectedOciIndexDigests = {
  crm: "sha256:3174e8e35f27ca3983e971d6f4b94b6863a5b64a9ffd751042b3db5ed2f8c55a",
  inbox: "sha256:d7be064bdd690ac42f9e18fbcb32b8fb42eac32f588256a983393ede9f8b79ca",
  lead_agent: "sha256:9194b569df458a7a80792ca3f4aebfa417204961f229585178aa91c710d45c01",
};
const expectedRuntimeIds = {
  crm: "sha256:34c0f3806a934c7b09c92cea6c4420a0c8ab3d2acb586e45a9b872f01f85d281",
  inbox: "sha256:dfc1aae9743e2b6bf6d7e174933c36cd89e03e5d769b859f2aaaa557a7a68af3",
  lead_agent: "sha256:a50289ffadf3e73b121a56fd1a5621164ddc9e723a58e8280a0a8536f7484ac3",
};

function response(body, status = 200, headers = {}) {
  return new Response(body === null ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

const testEnvironment = {
  EVO_P8D4G_SUPABASE_ACCESS_TOKEN: "management-test-value",
  EVO_P8D4G_SUPABASE_URL: "https://example.supabase.co",
  EVO_P8D4G_SUPABASE_SERVICE_ROLE_KEY: "service-test-value",
  EVO_P8D4G_STAFF_COOKIE: "staff-test-value",
};
const testExecutionControl = { status: "verified", implementation_commit: "a".repeat(40), implementation_tree: "b".repeat(40), implementation_ci_run: 101, execution_commit: "c".repeat(40), execution_tree: "d".repeat(40), execution_ci_run: 102, files: [] };

test("production adapter pins the exact Hermes release and three-image matrix", () => {
  assert.equal(P8D4G_PRODUCTION.hermes, "hermes-vps");
  assert.equal(P8D4G_PRODUCTION.projectRef, "iosckaqtovbbnssqcpde");
  assert.equal(P8D4G_PRODUCTION.candidate, "aaa9f618131f604f79c694e4b332a0b13afd7a30");
  assert.equal(P8D4G_PRODUCTION.releaseId, "2026-08-16.p8d4p.1");
  assert.equal(P8D4G_PRODUCTION.releaseVersion, "p8d4p-20260816");
  assert.equal(P8D4G_PRODUCTION.importer, "evo-p8d4p-knowledge-import");
  assert.equal(P8D4G_PRODUCTION.releaseRoot, `/opt/evo-releases/${P8D4G_PRODUCTION.candidate}/2026-08-16.p8d4p.1`);
  assert.deepEqual(
    P8D4G_PRODUCTION.sourceFiles.map(({ name, path, mode }) => [name, path, mode]),
    [
      ["crm_env", "/opt/evo-crm/.env.production", "600"],
      ["lead_agent_env", "/opt/evo-crm/.env.lead-agent", "600"],
      ["inbox_env", "/opt/evo-inbox/agent-lead2-crmwhatsapp/.env.production", "600"],
      ["inbox_waha_env", "/opt/evo-inbox/agent-lead2-crmwhatsapp/.env.waha", "600"],
      ["crm_compose", "/opt/evo-releases/564332b420a1fb1bd6232dda945d044bb922d3f0/repo/docker-compose.prod.yml", "644"],
      ["inbox_compose", "/opt/evo-releases/a09a72fc55d869c861df520f76d62413a2315fc1/repo/agent-lead2-inbox/deploy/docker-compose.inbox.prod.yml", "644"],
      ["lead_agent_compose", "/opt/evo-releases/b2303eccb78b7c102ec702e9821f765f6dfaba88/repo/docker-compose.prod.yml", "600"],
    ],
  );
  assert.deepEqual(Object.fromEntries(Object.entries(P8D4G_PRODUCTION.images).map(([name, image]) => [name, image.ociIndexDigest])), expectedOciIndexDigests);
  assert.deepEqual(Object.fromEntries(Object.entries(P8D4G_PRODUCTION.images).map(([name, image]) => [name, image.runtimeId])), expectedRuntimeIds);
  assert.ok(Object.values(P8D4G_PRODUCTION.images).every((image) => image.ociIndexDigest !== image.runtimeId));
  assert.equal(P8D4G_PRODUCTION.pilotOrigin, "https://evo-inbox.72.62.119.112.sslip.io");
  for (const image of Object.values(P8D4G_PRODUCTION.images)) {
    assert.match(image.tag, new RegExp(`:${P8D4G_PRODUCTION.candidate}-linux-amd64$`));
    assert.match(image.composeTag, new RegExp(`:${P8D4G_PRODUCTION.candidate}$`));
    assert.match(image.archiveSha256, /^[0-9a-f]{64}$/);
  }
});

test("execution control binds merged bytes, clean current main and exact-main CI", () => {
  const root = mkdtempSync(join(tmpdir(), "p8d4g-execution-control-"));
  const paths = ["scripts/p8d4g-production-runner.mjs", "scripts/p8d4g-production-operations.mjs", "docs/schemas/p8d4g-result.schema.json", "docs/schemas/p8d4g-execution-control.schema.json", "package.json"];
  const implementation = "a".repeat(40);
  const implementationTree = "b".repeat(40);
  const execution = "c".repeat(40);
  const executionTree = "d".repeat(40);
  const contents = new Map();
  const state = { dirty: false, main: execution, redExecutionCi: false };
  try {
    const files = paths.map((path, index) => {
      const content = `controlled-${index}\n`;
      contents.set(path, content);
      const target = join(root, path);
      mkdirSync(join(target, ".."), { recursive: true });
      writeFileSync(target, content);
      return { path, sha256: createHash("sha256").update(content).digest("hex") };
    });
    const controlPath = join(root, "control.json");
    assert.throws(() => validateP8D4GExecutionControl(() => ({ stdout: "", stderr: "" }), { executionRoot: root, controlPath }), /not merged/);
    const control = { schema_version: 1, implementation_commit: implementation, implementation_tree: implementationTree, implementation_ci_run: 201, files };
    const controlSchema = JSON.parse(readFileSync(new URL("../docs/schemas/p8d4g-execution-control.schema.json", import.meta.url), "utf8"));
    const validateControl = new Ajv2020({ strict: false }).compile(controlSchema);
    assert.equal(validateControl(control), true, JSON.stringify(validateControl.errors));
    assert.equal(validateControl({ ...control, unexpected: true }), false);
    writeFileSync(controlPath, `${JSON.stringify(control)}\n`);
    const jobs = [{ name: "Main CRM", conclusion: "success" }, { name: "EVO Inbox", conclusion: "success" }, { name: "EVO Lead Agent", conclusion: "success" }, { name: "Changed range", conclusion: "skipped" }];
    const run = (command, args) => {
      if (command === "git" && args.includes("status")) return { stdout: state.dirty ? " M package.json\n" : "", stderr: "" };
      if (command === "git" && args.includes("rev-parse")) return { stdout: `${execution}\n`, stderr: "" };
      if (command === "git" && args.includes("ls-remote")) return { stdout: `${state.main}\trefs/heads/main\n`, stderr: "" };
      if (command === "git" && args.includes("merge-base")) return { stdout: "", stderr: "" };
      if (command === "git" && args.includes("show") && args.includes("-s")) return { stdout: `${args.at(-1) === implementation ? implementationTree : executionTree}\n`, stderr: "" };
      if (command === "git" && args.includes("show")) return { stdout: contents.get(args.at(-1).split(":").slice(1).join(":")), stderr: "" };
      if (command === "gh" && args[1] === "list") return { stdout: JSON.stringify([{ databaseId: 202, headSha: execution, conclusion: "success" }]), stderr: "" };
      if (command === "gh" && args[1] === "view") {
        const id = Number(args[2]);
        return { stdout: JSON.stringify({ databaseId: id, headSha: id === 201 ? implementation : execution, event: "push", conclusion: id === 202 && state.redExecutionCi ? "failure" : "success", jobs }), stderr: "" };
      }
      throw new Error(`unexpected command ${command} ${args.join(" ")}`);
    };
    const verified = validateP8D4GExecutionControl(run, { executionRoot: root, controlPath });
    assert.equal(verified.execution_commit, execution);
    assert.equal(verified.execution_ci_run, 202);
    state.dirty = true;
    assert.throws(() => validateP8D4GExecutionControl(run, { executionRoot: root, controlPath }), /dirty/);
    state.dirty = false;
    state.main = "e".repeat(40);
    assert.throws(() => validateP8D4GExecutionControl(run, { executionRoot: root, controlPath }), /current GitHub main/);
    state.main = execution;
    state.redExecutionCi = true;
    assert.throws(() => validateP8D4GExecutionControl(run, { executionRoot: root, controlPath }), /CI record drifted/);
    writeFileSync(join(root, paths[0]), "tampered\n");
    assert.throws(() => validateP8D4GExecutionControl(run, { executionRoot: root, controlPath }), /controlled runner bytes drifted/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("real preflight adapter uses only the fixed SSH target and read-only management endpoints", async () => {
  const calls = [];
  const rows = [
    ["evo-crm-app-1", P8D4G_PRODUCTION.current.crm.id],
    ["evo-inbox-app-1", P8D4G_PRODUCTION.current.inbox.id],
    ["evo-crm-lead-agent-1", P8D4G_PRODUCTION.current.lead_agent.id],
    ["evo-crm-waha-1", P8D4G_PRODUCTION.current.crm_waha.id],
    ["evo-inbox-waha", P8D4G_PRODUCTION.current.inbox_waha.id],
  ].map(([name, id]) => `${name}|${id}|healthy|0`).join("\n");
  const run = (command, args, options = {}) => {
    calls.push({ command, args, input: options.input ?? "", label: options.label });
    if (command === "ssh") return { stdout: `${rows}\n`, stderr: "" };
    throw new Error(`unexpected command ${command}`);
  };
  const fetchCalls = [];
  const fetchImpl = async (url, options) => {
    fetchCalls.push({ url: String(url), method: options?.method ?? "GET" });
    if (String(url).endsWith(`/v1/projects/${P8D4G_PRODUCTION.projectRef}`)) return response({ status: "ACTIVE_HEALTHY" });
    if (String(url).endsWith(`/v1/projects/${P8D4G_PRODUCTION.projectRef}/database/migrations`)) return response(Array.from({ length: 76 }, (_, index) => ({ version: String(index + 1).padStart(3, "0") })));
    if (String(url) === `${P8D4G_PRODUCTION.pilotOrigin}/`) return response(null, 307, { location: "/dashboard" });
    throw new Error("unexpected provider read");
  };
  const operations = await createP8D4GOperations({
    run,
    fetchImpl,
    validateCandidate: () => {},
    validateExecutionControl: () => testExecutionControl,
    credentialFile: "/definitely/absent",
    environment: testEnvironment,
  });
  const record = await operations.preflight();
  assert.equal(record.status, "verified");
  assert.equal(record.candidate_tag_boundary_verified, true);
  assert.equal(record.migration_range, "001-076");
  assert.equal(record.containers.length, 5);
  assert.deepEqual(fetchCalls.map((item) => item.method), ["GET", "GET", "GET"]);
  assert.equal(fetchCalls.at(-1).url, "https://evo-inbox.72.62.119.112.sslip.io/");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "ssh");
  assert.deepEqual(calls[0].args.slice(0, 4), ["-o", "BatchMode=yes", "hermes-vps", "bash"]);
  assert.match(calls[0].input, /\{\{\.Name\}\}\|\{\{\.Image\}\}\|/);
  assert.doesNotMatch(calls[0].input, /\{\{\.Name\}\}\\t\{\{\.Image\}\}/);
  assert.doesNotMatch(calls[0].input, /management-test-value|service-test-value|staff-test-value/);
  for (const source of P8D4G_PRODUCTION.sourceFiles) {
    assert.match(calls[0].input, new RegExp(`${source.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}.*root:root ${source.mode}`));
  }
  assert.doesNotMatch(calls[0].input, /for path in .*COMPOSE/);
  assert.match(calls[0].input, new RegExp(P8D4G_PRODUCTION.images.crm.tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(calls[0].input, new RegExp(P8D4G_PRODUCTION.images.crm.runtimeId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  const malformedOperations = await createP8D4GOperations({
    run: (command) => {
      if (command === "ssh") return { stdout: `${rows}|unexpected\n`, stderr: "" };
      throw new Error(`unexpected command ${command}`);
    },
    fetchImpl,
    validateCandidate: () => {},
    validateExecutionControl: () => testExecutionControl,
    credentialFile: "/definitely/absent",
    environment: testEnvironment,
  });
  await assert.rejects(() => malformedOperations.preflight(), /container preflight output is invalid/);
});

test("CLI is bound to the committed production adapter and closed mutation commands", () => {
  const runner = readFileSync(new URL("../scripts/p8d4g-production-runner.mjs", import.meta.url), "utf8");
  const operations = readFileSync(new URL("../scripts/p8d4g-production-operations.mjs", import.meta.url), "utf8");
  assert.match(runner, /import\("\.\/p8d4g-production-operations\.mjs"\)/);
  assert.doesNotMatch(operations, /!\s+docker (?:image )?inspect/);
  assert.match(operations, /docker image ls --no-trunc/);
  assert.match(operations, /docker container ls -a/);
  assert.doesNotMatch(runner, /operations-module|pathToFileURL/);
  assert.match(operations, /run -d --no-deps --name '\$\{IMPORTER\}'/);
  assert.match(operations, /up -d --no-deps '\$\{service\}'/);
  assert.match(operations, /\.NetworkSettings\.Networks/);
  assert.match(operations, /127\.0\.0\.1:3000\/api\/health/);
  assert.match(operations, /127\.0\.0\.1:8000\/health/);
  assert.match(operations, /docker rm -f '\$\{IMPORTER\}'/);
  assert.match(operations, /rm -rf '\$\{KNOWLEDGE_REMOTE\}'/);
  assert.match(operations, /bash", "-c", command/);
  assert.match(operations, /input: `\$\{state\.accountId\}\\n`/);
  assert.match(operations, /stable build report fields drifted/);
  assert.match(operations, /key !== "generated_at" && key !== "output_directory"/);
  assert.match(operations, /https:\/\/evo-inbox\.72\.62\.119\.112\.sslip\.io/);
  assert.doesNotMatch(operations, /https:\/\/inbox\.evoadmissions\.com/);
  assert.doesNotMatch(operations, /00000000-0000-4000-8000-000000000000/);
});

test("expired production operation deadline fails before a remote effect", async () => {
  const calls = [];
  const operations = await createP8D4GOperations({
    run: (...args) => { calls.push(args); throw new Error("must not run"); },
    fetchImpl: async () => response({}),
    validateCandidate: () => {},
    credentialFile: "/definitely/absent",
    environment: testEnvironment,
  });
  await assert.rejects(operations.configureDisabled({ deadlineAt: "2020-01-01T00:00:00.000Z" }), /deadline expired/);
  assert.equal(calls.length, 0);
});

test("staging verifies the transferred archive instead of treating git archive as a repository", async () => {
  const calls = [];
  const run = (command, args, options = {}) => {
    calls.push({ command, args, input: options.input ?? "", label: options.label });
    if (command === "git" && args.includes("archive")) {
      const output = args.find((arg) => arg.startsWith("--output=")).slice("--output=".length);
      writeFileSync(output, "closed-test-archive");
    }
    if (options.label === "Hermes rollback capture") {
      return { stdout: [
        ["image", "crm", "1".repeat(64), P8D4G_PRODUCTION.current.crm.id],
        ["image", "inbox", "2".repeat(64), P8D4G_PRODUCTION.current.inbox.id],
        ["image", "lead_agent", "3".repeat(64), P8D4G_PRODUCTION.current.lead_agent.id],
        ["env", "crm", "4".repeat(64), ""], ["env", "inbox", "5".repeat(64), ""], ["env", "lead_agent", "6".repeat(64), ""],
        ["compose", "crm", "7".repeat(64), ""], ["compose", "inbox", "8".repeat(64), ""], ["compose", "lead_agent", "9".repeat(64), ""],
      ].map((row) => row.join("\t")).join("\n"), stderr: "" };
    }
    return { stdout: "", stderr: "" };
  };
  const operations = await createP8D4GOperations({ run, fetchImpl: async () => response({}), validateCandidate: () => {}, credentialFile: "/definitely/absent", environment: testEnvironment });
  const record = await operations.stage({ deadlineAt: new Date(Date.now() + 60_000).toISOString() });
  assert.equal(record.status, "verified");
  const remoteScripts = calls.filter((call) => call.command === "ssh").map((call) => call.input).join("\n");
  assert.match(remoteScripts, /sha256sum .*repo\.tar/);
  assert.match(remoteScripts, /tar -xf .*repo\.tar/);
  assert.doesNotMatch(remoteScripts, /git -C .*\/repo/);
  const transfers = calls.filter((call) => call.command === "scp" && call.args.at(-1).includes(`${P8D4G_PRODUCTION.releaseRoot}/incoming/`));
  assert.equal(transfers.length, 4);
  assert.ok(transfers.some((call) => call.args[0].endsWith("/portable-image-identity.json")));
  const metadata = calls.find((call) => call.label === "portable artifact metadata");
  assert.ok(metadata);
  assert.match(metadata.input, /chown root:root/);
  assert.match(metadata.input, /chmod 0600/);
  for (const filename of [P8D4G_PRODUCTION.portableIdentity.filename, ...Object.values(P8D4G_PRODUCTION.images).map((image) => image.archive)]) {
    assert.equal(metadata.input.match(new RegExp(filename.replaceAll(".", "\\."), "g"))?.length, 2);
  }
  assert.doesNotMatch(metadata.input, /\*|\?/);
  assert.match(remoteScripts, /stat -c '%U:%G %a'.*\$1.*root:root 600/s);
  assert.match(remoteScripts, /portable-image-identity\.json/);
  for (const image of Object.values(P8D4G_PRODUCTION.images)) {
    assert.match(remoteScripts, new RegExp(image.ociIndexDigest));
    assert.match(remoteScripts, new RegExp(image.runtimeId));
  }
  assert.doesNotMatch(remoteScripts, /docker load|docker image tag/);
  assert.equal(record.artifacts.length, 4);
  assert.deepEqual(record.artifacts.slice(1).map((artifact) => artifact.image_id), Object.values(P8D4G_PRODUCTION.images).map((image) => image.ociIndexDigest));
  assert.equal(record.rollback_files.length, 9);
});

test("staging accepts omitted Docker Variant only for exact linux/amd64", () => {
  const root = mkdtempSync(join(tmpdir(), "p8d4g-docker-platform-"));
  const docker = join(root, "docker");
  try {
    writeFileSync(docker, "#!/bin/sh\nprintf '%s\\n' \"$FAKE_DOCKER_INSPECT_JSON\"\n");
    chmodSync(docker, 0o755);
    const script = `set -o pipefail\nset -- archive hash exact-tag compose-tag image-id\n${createDockerImagePlatformCheck()}`;
    const executeRaw = (value) => spawnSync("bash", ["-c", script], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${root}:${process.env.PATH}`, FAKE_DOCKER_INSPECT_JSON: JSON.stringify(value) },
    });
    const execute = (value) => executeRaw([value]);
    assert.equal(execute({ Os: "linux", Architecture: "amd64" }).status, 0);
    assert.equal(execute({ Os: "linux", Architecture: "amd64", Variant: "" }).status, 0);
    assert.notEqual(execute({ Os: "windows", Architecture: "amd64" }).status, 0);
    assert.notEqual(execute({ Os: "linux", Architecture: "arm64" }).status, 0);
    assert.notEqual(execute({ Os: "linux", Architecture: "amd64", Variant: "v8" }).status, 0);
    assert.notEqual(execute({ Architecture: "amd64" }).status, 0);
    assert.notEqual(executeRaw({ Os: "linux", Architecture: "amd64" }).status, 0);
    assert.doesNotMatch(script, /\{\{\.Variant\}\}/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("retry boundary requires all six exact P8D4O-staged tags", () => {
  const root = mkdtempSync(join(tmpdir(), "p8d4p-existing-candidate-tags-"));
  const docker = join(root, "docker");
  const images = Object.values(P8D4G_PRODUCTION.images);
  const inventory = images.flatMap((image) => [[image.tag, image.runtimeId], [image.composeTag, image.runtimeId]]);
  const exactInspects = Object.fromEntries(images.map((image) => [image.tag, [{ Id: image.runtimeId, Os: "linux", Architecture: "amd64", Config: { Labels: { "org.opencontainers.image.revision": P8D4G_PRODUCTION.candidate } } }]]));
  try {
    writeFileSync(docker, String.raw`#!/bin/sh
if [ "$1 $2" = "image ls" ]; then
  [ "$FAKE_LIST_ERROR" = "0" ] || exit 70
  printf '%s\n' "$FAKE_INVENTORY"
  exit 0
fi
tag=""
for argument in "$@"; do tag="$argument"; done
python3 -c 'import json,sys; rows=json.loads(sys.argv[1]); tag=sys.argv[2]; value=rows.get(tag); sys.exit(71) if value is None else print(json.dumps(value,separators=(",",":")))' "$FAKE_INSPECTS" "$tag"
`);
    chmodSync(docker, 0o755);
    const script = `set -euo pipefail\n${createCandidateTagBoundaryCheck()}`;
    const execute = ({ rows = inventory, inspects = exactInspects, listError = false } = {}) => spawnSync("bash", ["-c", script], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${root}:${process.env.PATH}`,
        FAKE_INVENTORY: rows.map((row) => row.join("|")).join("\n"),
        FAKE_INSPECTS: JSON.stringify(inspects),
        FAKE_LIST_ERROR: listError ? "1" : "0",
      },
    });

    assert.equal(execute().status, 0);
    assert.notEqual(execute({ rows: inventory.slice(1) }).status, 0);
    assert.notEqual(execute({ rows: [...inventory, inventory[0]] }).status, 0);
    assert.notEqual(execute({ listError: true }).status, 0);
    assert.notEqual(execute({ rows: inventory.map((row, index) => index === 0 ? [row[0], `sha256:${"0".repeat(64)}`] : row) }).status, 0);
    const crmTag = P8D4G_PRODUCTION.images.crm.tag;
    const mutate = (change) => ({ ...exactInspects, [crmTag]: [{ ...exactInspects[crmTag][0], ...change }] });
    assert.notEqual(execute({ inspects: mutate({ Id: P8D4G_PRODUCTION.images.crm.ociIndexDigest }) }).status, 0);
    assert.notEqual(execute({ inspects: mutate({ Architecture: "arm64" }) }).status, 0);
    assert.notEqual(execute({ inspects: mutate({ Variant: "v8" }) }).status, 0);
    assert.notEqual(execute({ inspects: mutate({ Config: { Labels: { "org.opencontainers.image.revision": "0".repeat(40) } } }) }).status, 0);
    const missingInspect = { ...exactInspects };
    delete missingInspect[crmTag];
    assert.notEqual(execute({ inspects: missingInspect }).status, 0);
    assert.doesNotMatch(script, /docker (load|image tag)/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("isolated importer verifies the named nextjs user and runtime UID/GID", () => {
  const root = mkdtempSync(join(tmpdir(), "p8d4p-importer-identity-"));
  const docker = join(root, "docker");
  try {
    writeFileSync(docker, String.raw`#!/bin/sh
if [ "$FAKE_FAILURE" = "$1" ]; then exit 70; fi
if [ "$1" = "inspect" ]; then printf '%s|%s\n' "$FAKE_IMAGE" "$FAKE_CONFIG_USER"; exit 0; fi
if [ "$1" = "exec" ]; then printf '%s|%s|%s\n' "$FAKE_USERNAME" "$FAKE_UID" "$FAKE_GID"; exit 0; fi
exit 71
`);
    chmodSync(docker, 0o755);
    const expectedImage = P8D4G_PRODUCTION.images.inbox.runtimeId;
    const script = `set -euo pipefail\n${createImporterIdentityCheck(P8D4G_PRODUCTION.importer, expectedImage)}`;
    const execute = (overrides = {}) => spawnSync("bash", ["-c", script], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${root}:${process.env.PATH}`,
        FAKE_IMAGE: expectedImage,
        FAKE_CONFIG_USER: "nextjs",
        FAKE_USERNAME: "nextjs",
        FAKE_UID: "1001",
        FAKE_GID: "1001",
        FAKE_FAILURE: "",
        ...overrides,
      },
    });

    assert.equal(execute().status, 0);
    for (const drift of [
      { FAKE_CONFIG_USER: "1001" }, { FAKE_CONFIG_USER: "root" }, { FAKE_CONFIG_USER: "" },
      { FAKE_USERNAME: "root" }, { FAKE_UID: "0" }, { FAKE_UID: "1002" }, { FAKE_GID: "0" },
      { FAKE_IMAGE: `sha256:${"0".repeat(64)}` }, { FAKE_FAILURE: "inspect" }, { FAKE_FAILURE: "exec" },
    ]) assert.notEqual(execute(drift).status, 0, JSON.stringify(drift));
    assert.throws(() => createImporterIdentityCheck("bad importer", expectedImage), /arguments are invalid/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("redacted result is hash-bound into the exact Hermes evidence root", async () => {
  const root = mkdtempSync(join(tmpdir(), "p8d4g-evidence-test-"));
  const resultPath = join(root, "result.json");
  writeFileSync(resultPath, '{"result_code":"operation_failed"}\n', { mode: 0o600 });
  chmodSync(resultPath, 0o600);
  const calls = [];
  try {
    const run = (command, args, options = {}) => {
      calls.push({ command, args, input: options.input ?? "" });
      return { stdout: "", stderr: "" };
    };
    const operations = await createP8D4GOperations({ run, fetchImpl: async () => response({}), validateCandidate: () => {}, credentialFile: "/definitely/absent", environment: testEnvironment });
    const record = await operations.publishEvidence(resultPath);
    assert.equal(record.status, "verified");
    const scp = calls.find((call) => call.command === "scp");
    assert.equal(scp.args[0], resultPath);
    assert.equal(scp.args[1], `hermes-vps:${P8D4G_PRODUCTION.evidenceRoot}/p8d4g-result.json.incoming`);
    const scripts = calls.filter((call) => call.command === "ssh").map((call) => call.input).join("\n");
    assert.match(scripts, /chown root:root/);
    assert.match(scripts, /chmod 0600/);
    assert.match(scripts, /trap cleanup_failed_publication ERR/);
    assert.match(scripts, /p8d4g-result\.json/);
    assert.doesNotMatch(scripts, /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("atomic evidence installation removes incoming and final files after a post-rename failure", () => {
  const root = mkdtempSync(join(tmpdir(), "p8d4g-atomic-evidence-"));
  const incoming = join(root, "result.json.incoming");
  const finalPath = join(root, "result.json");
  writeFileSync(incoming, "safe-result\n", { mode: 0o600 });
  const hash = createHash("sha256").update(readFileSync(incoming)).digest("hex");
  try {
    const source = createAtomicEvidenceInstallScript(incoming, finalPath, hash)
      .replace(`chown root:root '${incoming}'`, ":")
      .replace(/^\[\[ "\$\(stat .*$/gm, ":")
      .replace("trap - ERR", "false\ntrap - ERR");
    const result = spawnSync("bash", ["-seu"], { input: source, encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.equal(existsSync(incoming), false);
    assert.equal(existsSync(finalPath), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("failed evidence transfer requests removal of both remote paths", async () => {
  const root = mkdtempSync(join(tmpdir(), "p8d4g-transfer-failure-"));
  const resultPath = join(root, "result.json");
  writeFileSync(resultPath, "safe-result\n", { mode: 0o600 });
  const calls = [];
  try {
    const run = (command, args, options = {}) => {
      calls.push({ command, args, input: options.input ?? "", label: options.label });
      if (command === "scp") throw new Error("simulated transfer failure");
      return { stdout: "", stderr: "" };
    };
    const operations = await createP8D4GOperations({ run, fetchImpl: async () => response({}), validateCandidate: () => {}, credentialFile: "/definitely/absent", environment: testEnvironment });
    await assert.rejects(operations.publishEvidence(resultPath), /simulated transfer failure/);
    const cleanup = calls.find((call) => call.label === "failed evidence publication cleanup");
    assert.ok(cleanup);
    assert.match(cleanup.input, /rm -f .*p8d4g-result\.json\.incoming.*p8d4g-result\.json/);
    assert.match(cleanup.input, /! -e .*incoming.*! -e .*p8d4g-result\.json/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("pilot verifies exact status, audience-bound chunks, body-free audit and unchanged messages", async () => {
  const auditId = "22222222-2222-4222-8222-222222222222";
  const chunkId = "11111111-1111-4111-8111-111111111111";
  const documentId = "44444444-4444-4444-8444-444444444444";
  let countReads = 0;
  let pilotUrl = null;
  const fetchImpl = async (url, options = {}) => {
    const target = String(url);
    if (options.method === "HEAD" && target.includes("/messages?")) { countReads += 1; return response(null, 200, { "content-range": "0-0/17" }); }
    if (target.includes("/api/ai/playground")) {
      pilotUrl = target;
      return response({ reply: "Черновик", handoff: false, sources: [{ chunk_id: chunkId, source_path: P8D4G_PRODUCTION.pilots.client_china_documents.source }], audit_id: auditId });
    }
    if (target.includes("/ai_knowledge_chunks?")) return response([{ id: chunkId, audience: "client", document_id: documentId }]);
    if (target.includes("/ai_knowledge_documents?")) return response([{ id: documentId, source_path: P8D4G_PRODUCTION.pilots.client_china_documents.source }]);
    if (target.includes("/ai_assistant_audits?")) return response([{ id: auditId, audience: "client", evaluation_case_id: "client_china_documents", provider: "gemini", model: "gemini-3.5-flash", knowledge_sources: [{ chunk_id: chunkId, source_path: P8D4G_PRODUCTION.pilots.client_china_documents.source }], response_sha256: "a".repeat(64), handoff: false, success: true, actor_user_id: "33333333-3333-4333-8333-333333333333", created_at: "2026-08-16T00:00:00Z", expires_at: "2026-11-14T00:00:00Z" }]);
    throw new Error(`unexpected request ${target}`);
  };
  const operations = await createP8D4GOperations({ run: () => ({ stdout: "", stderr: "" }), fetchImpl, validateCandidate: () => {}, credentialFile: "/definitely/absent", environment: testEnvironment });
  const record = await operations.pilot("client_china_documents", { deadlineAt: new Date(Date.now() + 60_000).toISOString() });
  assert.equal(record.status, "verified");
  assert.equal(record.http_status, 200);
  assert.equal(record.audit_body_free, true);
  assert.equal(record.side_effect_free, true);
  assert.equal(countReads, 2);
  assert.equal(pilotUrl, "https://evo-inbox.72.62.119.112.sslip.io/api/ai/playground");
  assert.ok(!pilotUrl.includes("inbox.evoadmissions.com"));
});

test("pilot rejects provider drift and database source-path drift", async () => {
  const auditId = "22222222-2222-4222-8222-222222222222";
  const chunkId = "11111111-1111-4111-8111-111111111111";
  const documentId = "44444444-4444-4444-8444-444444444444";
  const expectedSource = P8D4G_PRODUCTION.pilots.client_china_documents.source;
  const createFetch = ({ provider = "gemini", databaseSource = expectedSource }) => async (url, options = {}) => {
    const target = String(url);
    if (options.method === "HEAD") return response(null, 200, { "content-range": "0-0/17" });
    if (target.includes("/api/ai/playground")) return response({ reply: "Черновик", handoff: false, sources: [{ chunk_id: chunkId, source_path: expectedSource }], audit_id: auditId });
    if (target.includes("/ai_knowledge_chunks?")) return response([{ id: chunkId, audience: "client", document_id: documentId }]);
    if (target.includes("/ai_knowledge_documents?")) return response([{ id: documentId, source_path: databaseSource }]);
    if (target.includes("/ai_assistant_audits?")) return response([{ id: auditId, audience: "client", evaluation_case_id: "client_china_documents", provider, model: "gemini-3.5-flash", knowledge_sources: [{ chunk_id: chunkId, source_path: expectedSource }], response_sha256: "a".repeat(64), handoff: false, success: true, actor_user_id: "33333333-3333-4333-8333-333333333333", created_at: "2026-08-16T00:00:00Z", expires_at: "2026-11-14T00:00:00Z" }]);
    throw new Error(`unexpected request ${target}`);
  };
  const providerDrift = await createP8D4GOperations({ run: () => ({ stdout: "", stderr: "" }), fetchImpl: createFetch({ provider: "other" }), validateCandidate: () => {}, credentialFile: "/definitely/absent", environment: testEnvironment });
  await assert.rejects(providerDrift.pilot("client_china_documents", { deadlineAt: new Date(Date.now() + 60_000).toISOString() }), /immutable audit drifted/);
  const sourceDrift = await createP8D4GOperations({ run: () => ({ stdout: "", stderr: "" }), fetchImpl: createFetch({ databaseSource: "wrong.md" }), validateCandidate: () => {}, credentialFile: "/definitely/absent", environment: testEnvironment });
  await assert.rejects(sourceDrift.pilot("client_china_documents", { deadlineAt: new Date(Date.now() + 60_000).toISOString() }), /database source-path proof failed/);
});

test("pilot rejects non-200 and does not fabricate verification", async () => {
  const fetchImpl = async (url, options = {}) => {
    if (options.method === "HEAD") return response(null, 200, { "content-range": "0-0/17" });
    return response({ error: "blocked" }, 201);
  };
  const operations = await createP8D4GOperations({ run: () => ({ stdout: "", stderr: "" }), fetchImpl, validateCandidate: () => {}, credentialFile: "/definitely/absent", environment: testEnvironment });
  await assert.rejects(operations.pilot("client_china_documents", { deadlineAt: new Date(Date.now() + 60_000).toISOString() }), /non-200/);
});
