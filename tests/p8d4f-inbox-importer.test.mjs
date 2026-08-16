import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import {
  P8D4F_BUILD_EVIDENCE_BASENAME,
  P8D4F_CANDIDATE,
  P8D4F_IMPORTER_EVIDENCE_FILE,
  P8D4F_INBOX_IMAGE_ID,
  P8D4F_INBOX_TAG,
  verifyP8D4FInboxImporter,
} from "../scripts/p8d4f-verify-inbox-importer.mjs";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function fixture() {
  const temporary = realpathSync(mkdtempSync(join(tmpdir(), "evo-p8d4f-importer-")));
  const evidenceParent = join(temporary, ".evo-release-evidence");
  const root = join(evidenceParent, P8D4F_BUILD_EVIDENCE_BASENAME);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  chmodSync(root, 0o700);
  const baseline = Buffer.from("safe build evidence\n");
  writeFileSync(join(root, "build-inbox.log"), baseline, { mode: 0o600 });
  writeFileSync(join(root, "collection-index.json"), `${JSON.stringify({
    schema_version: 1,
    candidate_commit: P8D4F_CANDIDATE,
    files: [{ file: "build-inbox.log", mode: 600, sha256: sha256(baseline) }],
  }, null, 2)}\n`, { mode: 0o600 });
  return { temporary, root };
}

function response(status, stdout = "", stderr = "") {
  return { status, signal: null, stdout, stderr };
}

function runner({ incompleteStatus = 1, incompleteSignal = null, imageId = P8D4F_INBOX_IMAGE_ID } = {}) {
  const calls = [];
  const run = (command, args) => {
    calls.push([command, args]);
    if (command === "orb") return response(0, "Running\n");
    if (command === "gitleaks") return response(0);
    if (args[0] === "context") return response(0, "orbstack\n");
    if (args[0] === "image") return response(0, `${JSON.stringify([{
      Id: imageId,
      Os: "linux",
      Architecture: "amd64",
      Variant: "",
      Config: {
        User: "nextjs",
        Labels: {
          "org.opencontainers.image.revision": P8D4F_CANDIDATE,
          "org.opencontainers.image.source": "https://github.com/izzhackt/evo_AI_CRM",
        },
      },
    }])}\n`);
    if (args.includes("process.stdout.write(String(process.getuid?.() ?? -1))")) return response(0, "1001");
    if (args.includes("--verify-runtime")) return response(0, '{"status":"knowledge_import_runtime_verified","version":1}\n');
    return { ...response(incompleteStatus, "", "missing required arguments"), signal: incompleteSignal };
  };
  return { run, calls };
}

test("P8D4F verifies the real importer boundary and writes only UUID-free hash-bound evidence", () => {
  const { temporary, root } = fixture();
  try {
    const fake = runner();
    const result = verifyP8D4FInboxImporter(root, fake.run);
    assert.equal(result.runtime.incomplete_invocation, "rejected");
    const retained = JSON.parse(readFileSync(join(root, P8D4F_IMPORTER_EVIDENCE_FILE), "utf8"));
    assert.deepEqual(retained, result);
    assert.equal(JSON.stringify(retained).includes("account_id"), false);
    assert.equal(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i.test(JSON.stringify(retained)), false);
    assert.equal(statSync(join(root, P8D4F_IMPORTER_EVIDENCE_FILE)).mode & 0o777, 0o600);

    const index = JSON.parse(readFileSync(join(root, "collection-index.json"), "utf8"));
    const entry = index.files.find(({ file }) => file === P8D4F_IMPORTER_EVIDENCE_FILE);
    assert.deepEqual(entry, {
      file: P8D4F_IMPORTER_EVIDENCE_FILE,
      mode: 600,
      sha256: sha256(readFileSync(join(root, P8D4F_IMPORTER_EVIDENCE_FILE))),
    });

    const dockerRuns = fake.calls.filter(([command, args]) => command === "docker" && args[0] === "run");
    assert.equal(dockerRuns.length, 3);
    for (const [, args] of dockerRuns) {
      assert.equal(args.includes("--network"), true);
      assert.equal(args[args.indexOf("--network") + 1], "none");
      assert.equal(args.includes("--user"), true);
      assert.equal(args[args.indexOf("--user") + 1], "1001:1001");
      assert.equal(args.includes("--env"), false);
      assert.equal(args.includes("--env-file"), false);
      assert.equal(args.includes("--mount"), false);
      assert.equal(args.includes("-v"), false);
      assert.equal(args.includes(P8D4F_INBOX_TAG), true);
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("P8D4F refuses an incomplete importer that unexpectedly succeeds", () => {
  const { temporary, root } = fixture();
  try {
    const fake = runner({ incompleteStatus: 0 });
    assert.throws(() => verifyP8D4FInboxImporter(root, fake.run), /did not fail closed/);
    assert.throws(() => statSync(join(root, P8D4F_IMPORTER_EVIDENCE_FILE)), /ENOENT/);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("P8D4F does not misclassify a missing or interrupted Docker result as fail-closed behavior", () => {
  for (const fake of [runner({ incompleteStatus: null }), runner({ incompleteStatus: null, incompleteSignal: "SIGTERM" })]) {
    const { temporary, root } = fixture();
    try {
      assert.throws(() => verifyP8D4FInboxImporter(root, fake.run), /did not fail closed/);
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  }
});

test("P8D4F refuses image or existing evidence drift before retaining a result", () => {
  const first = fixture();
  try {
    assert.throws(
      () => verifyP8D4FInboxImporter(first.root, runner({ imageId: `sha256:${"0".repeat(64)}` }).run),
      /identity mismatch/,
    );
  } finally {
    rmSync(first.temporary, { recursive: true, force: true });
  }

  const second = fixture();
  try {
    writeFileSync(join(second.root, "build-inbox.log"), "tampered\n", { mode: 0o600 });
    assert.throws(() => verifyP8D4FInboxImporter(second.root, runner().run), /does not match retained evidence/);
  } finally {
    rmSync(second.temporary, { recursive: true, force: true });
  }
});
