import assert from "node:assert/strict";
import { mkdir, readFile, realpath, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  assertBuildLogSafe,
  createDockerExecutor,
  createP8V2Operations,
  parseProductionRows,
  P8V2_KNOWLEDGE_SOURCES,
  smokeImage,
  validateCandidateImage,
  validateConfigurationSnapshot,
} from "../scripts/p8v2-production-operations.mjs";
import { P8V2 } from "../scripts/p8v2-production-preparation.mjs";

const IMAGE_ID = `sha256:${"a".repeat(64)}`;

test("P8V2 binds the final frozen 11/291 vault sources", async () => {
  assert.deepEqual(P8V2_KNOWLEDGE_SOURCES, {
    client: {
      path: "/Users/iskhak.tazhibaev/Documents/01_Projects/EVO_Знания/Клиентская база знаний ЭВО",
      documentCount: 11,
    },
    internal: {
      path: "/Users/iskhak.tazhibaev/Documents/01_Projects/EVO_Знания/Внутренняя база знаний ЭВО/Утверждено для внутреннего ИИ",
      documentCount: 291,
    },
  });
  const source = await readFile(new URL("../scripts/p8v2-production-operations.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /EVO_Knowledge_Vault|40_Клиентская_база|30_Утверждено для ИИ/);
});

test("every Docker command is immediately preceded by the exact OrbStack checks", () => {
  const calls = [];
  const run = (command, args) => {
    calls.push([command, ...args]);
    if (command === "orb") return { status: 0, stdout: "Running\n", stderr: "" };
    if (command === "docker" && args[0] === "context") return { status: 0, stdout: "orbstack\n", stderr: "" };
    return { status: 0, stdout: "ok\n", stderr: "" };
  };
  const docker = createDockerExecutor(run);
  docker(["image", "ls"]);
  docker(["container", "ls"]);
  assert.deepEqual(calls, [
    ["orb", "status"], ["docker", "context", "show"], ["docker", "image", "ls"],
    ["orb", "status"], ["docker", "context", "show"], ["docker", "container", "ls"],
  ]);

  const drift = createDockerExecutor((command, args) => {
    if (command === "orb") return { status: 0, stdout: "Running\n", stderr: "" };
    if (command === "docker" && args[0] === "context") return { status: 0, stdout: "default\n", stderr: "" };
    throw new Error("effect must not run");
  });
  assert.throws(() => drift(["image", "ls"]), /orbstack/);
});

test("malformed docker run output still removes the exact newly-created smoke container", () => {
  const containerId = "d".repeat(64);
  const name = `evo-p8v2a-smoke-main-crm-${P8V2.applicationCommit.slice(0, 12)}`;
  const removed = [];
  let inventoryCall = 0;
  let ownerNonce = null;
  const docker = (args) => {
    if (args[0] === "container" && args[1] === "ls") {
      inventoryCall += 1;
      return { status: 0, stdout: inventoryCall === 1 ? "" : `${name}|${containerId}\n`, stderr: "" };
    }
    if (args[0] === "run") { ownerNonce = args[args.indexOf("--label") + 1].split("=")[1]; return { status: 0, stdout: "noisy-output\n", stderr: "" }; }
    if (args[0] === "container" && args[1] === "inspect") return { status: 0, stdout: JSON.stringify([{ Id: containerId, Image: IMAGE_ID, Config: { Labels: { "evo.p8v2a.owner": ownerNonce } } }]), stderr: "" };
    if (args[0] === "container" && args[1] === "rm") { removed.push(args.at(-1)); return { status: 0, stdout: "", stderr: "" }; }
    throw new Error(`unexpected docker call: ${args.join(" ")}`);
  };
  assert.throws(() => smokeImage(docker, P8V2.images[0], IMAGE_ID), /identity/);
  assert.deepEqual(removed, [containerId]);
});

test("failed smoke run never removes a foreign container that races onto the reserved name", () => {
  const foreignId = "e".repeat(64);
  const name = `evo-p8v2a-smoke-main-crm-${P8V2.applicationCommit.slice(0, 12)}`;
  let inventoryCall = 0;
  const removed = [];
  const docker = (args) => {
    if (args[0] === "container" && args[1] === "ls") { inventoryCall += 1; return { status: 0, stdout: inventoryCall === 1 ? "" : `${name}|${foreignId}\n`, stderr: "" }; }
    if (args[0] === "run") return { status: 1, stdout: "", stderr: "synthetic failure", signal: null };
    if (args[0] === "container" && args[1] === "inspect") return { status: 0, stdout: JSON.stringify([{ Id: foreignId, Image: IMAGE_ID, Config: { Labels: { "evo.p8v2a.owner": "foreign" } } }]), stderr: "" };
    if (args[0] === "container" && args[1] === "rm") { removed.push(args.at(-1)); return { status: 0, stdout: "", stderr: "" }; }
    throw new Error(`unexpected docker call: ${args.join(" ")}`);
  };
  assert.throws(() => smokeImage(docker, P8V2.images[0], IMAGE_ID), /foreign/);
  assert.deepEqual(removed, []);
});

test("Inbox build output rejects every exact process-only configured value before retention", () => {
  const values = ["https://project.supabase.co", "sb_publishable_sensitive", "https://inbox.example.test"];
  assert.equal(assertBuildLogSafe(Buffer.from("ordinary build output\n"), values).toString(), "ordinary build output\n");
  for (const value of values) assert.throws(() => assertBuildLogSafe(Buffer.from(`build error: ${value}`), values), /process-only/);
});

test("candidate identity requires immutable ID, exact labels and an empty variant", () => {
  const spec = P8V2.images[0];
  const inspect = {
    Id: IMAGE_ID,
    Descriptor: { digest: IMAGE_ID, mediaType: "application/vnd.oci.image.index.v1+json" },
    Os: "linux",
    Architecture: "amd64",
    Variant: "",
    Config: { Labels: {
      "org.opencontainers.image.revision": P8V2.applicationCommit,
      "org.opencontainers.image.source": P8V2.source,
      "org.opencontainers.image.version": "p8v2a-0f1454d0-20260818",
    } },
  };
  assert.equal(validateCandidateImage(inspect, spec), IMAGE_ID);
  for (const invalid of [
    { ...inspect, Id: `sha256:${"b".repeat(64)}` },
    { ...inspect, Architecture: "arm64" },
    { ...inspect, Variant: "v8" },
    { ...inspect, Config: { Labels: { ...inspect.Config.Labels, "org.opencontainers.image.revision": "bad" } } },
  ]) assert.throws(() => validateCandidateImage(invalid, spec, IMAGE_ID));
});

test("production rows require the five exact immutable containers in canonical order", () => {
  const text = P8V2.productionContainers.map((item) =>
    [item.name, item.containerId, item.imageId, "healthy", "0"].join("|")).join("\n");
  assert.equal(parseProductionRows(text).length, 5);
  assert.throws(() => parseProductionRows(text.split("\n").toReversed().join("\n")));
  assert.throws(() => parseProductionRows(text.replace("healthy|0", "healthy|1")));
  assert.throws(() => parseProductionRows(`${text}|extra`));
});

test("configuration comparison is process-only and reports fixed safe blocker codes", () => {
  const live = { accountId: "00000000-0000-4000-8000-000000000001", organizationId: "00000000-0000-4000-8000-000000000002", supabaseUrl: "https://iosckaqtovbbnssqcpde.supabase.co" };
  const complete = {
    root_crm: "verified", lead_agent: "verified", manual_worker: "verified",
    configured_account_id: live.accountId, configured_organization_id: live.organizationId,
    configured_supabase_url: live.supabaseUrl, blockers: [],
  };
  assert.deepEqual(validateConfigurationSnapshot(complete, live), {
    status: "verified", root_crm: "verified", lead_agent: "verified", manual_worker: "verified",
    configured_account_match: true, configured_organization_match: true, supabase_project_match: true, blockers: [],
  });
  const mismatch = { ...complete, configured_account_id: "00000000-0000-4000-8000-000000000003", root_crm: "blocked", blockers: ["root_crm_identity_mismatch"] };
  assert.throws(() => validateConfigurationSnapshot(mismatch, live), (error) => {
    assert.equal(error.code, "required_configuration_missing");
    assert.equal(JSON.stringify(error.safeDetails).includes("00000000"), false);
    return true;
  });
});

test("knowledge builds remove every UUID-bearing root even when the second build fails", async () => {
  const temporary = await import("node:fs/promises").then(({ mkdtemp }) => mkdtemp(join(tmpdir(), "evo-p8v2-ops-")));
  const roots = [];
  let buildCount = 0;
  const operations = await createP8V2Operations({
    toolRoot: process.cwd(),
    sourceRoot: process.cwd(),
    environment: {
      EVO_P8V2A_AUTHORIZATION: P8V2.authorization,
      EVO_P8V2_SUPABASE_URL: "https://iosckaqtovbbnssqcpde.supabase.co",
      EVO_P8V2_SUPABASE_ACCESS_TOKEN: "process-only-management-token",
      EVO_P8V2_SUPABASE_SERVICE_ROLE_KEY: "process-only-service-key",
    },
    makeKnowledgeRoot: async () => {
      const root = join(temporary, `build-${roots.length}`);
      await mkdir(root, { mode: 0o700 });
      roots.push(root);
      return root;
    },
    buildKnowledgeBundle: async ({ outputRoot }) => {
      buildCount += 1;
      await writeFile(join(outputRoot, "private.json"), "00000000-0000-4000-8000-000000000001", { mode: 0o600 });
      if (buildCount === 2) throw new Error("synthetic build failure");
    },
  });
  operations.__testState.accountId = "00000000-0000-4000-8000-000000000001";
  await assert.rejects(() => operations.buildKnowledge());
  for (const root of roots) await assert.rejects(() => stat(root));
});

test("an existing symlinked evidence parent is rejected before chmod or writes", async () => {
  const temporary = await import("node:fs/promises").then(({ mkdtemp }) => mkdtemp(join(tmpdir(), "evo-p8v2-symlink-")));
  const sourceRoot = await realpath(temporary);
  const target = join(sourceRoot, "outside");
  await mkdir(target, { mode: 0o755 });
  await symlink(target, join(sourceRoot, ".evo-release-evidence"));
  const operations = await createP8V2Operations({
    toolRoot: process.cwd(), sourceRoot,
    environment: { EVO_P8V2A_AUTHORIZATION: P8V2.authorization },
    buildKnowledgeBundle: async () => { throw new Error("must not build"); },
  });
  operations.__testState.accountId = "00000000-0000-4000-8000-000000000001";
  await assert.rejects(() => operations.buildKnowledge(), /unsafe directory/);
  assert.equal((await stat(target)).mode & 0o777, 0o755);
});

test("real adapter source freezes the exact rollback matrix and never globs secret inputs", async () => {
  const source = await readFile(new URL("../scripts/p8v2-production-operations.mjs", import.meta.url), "utf8");
  for (const file of P8V2.rollbackFiles) assert.match(source, new RegExp(file.name.replaceAll(".", "\\.")));
  assert.doesNotMatch(source, /\/opt\/evo-(?:crm|inbox)\/\.env\*/);
  assert.doesNotMatch(source, /NEXT_PUBLIC_SUPABASE_ANON_KEY=\$\{environment/);
  assert.match(source, /docker compose .*config -q/);
  assert.match(source, /root:root/);
  assert.match(source, /0600/);
});
