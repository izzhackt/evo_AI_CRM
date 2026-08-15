import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFileSync, lstatSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import { readPortableMetadata, validatePortableMetadata, verifyPortableArchive } from "../scripts/p8b3-portable-image-identity.mjs";
import { P8D4_CANDIDATE, p8d4Specs } from "../scripts/p8d4-portable-image-identity.mjs";

const root = process.env.EVO_P8D4_EVIDENCE_ROOT;
if (!root) throw new Error("EVO_P8D4_EVIDENCE_ROOT must name the retained real P8D4 evidence root");
const schema = JSON.parse(readFileSync(join(process.cwd(), "docs/schemas/p8d4-portable-image-identity.schema.json"), "utf8"));
const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

test("real P8D4 archives, schema, modes and collection hashes are exact", () => {
  const identity = JSON.parse(readFileSync(join(root, "portable-image-identity.json"), "utf8"));
  assert.equal(validate(identity), true, JSON.stringify(validate.errors));
  const collection = JSON.parse(readFileSync(join(root, "collection-index.json"), "utf8"));
  assert.equal(collection.candidate_commit, P8D4_CANDIDATE);
  for (const entry of collection.files) {
    const path = join(root, entry.file);
    assert.equal(lstatSync(path).mode & 0o777, 0o600);
    assert.equal(digest(readFileSync(path)), entry.sha256);
  }
  for (const spec of p8d4Specs) {
    const tag = `${spec.prefix}:${P8D4_CANDIDATE}-linux-amd64`;
    const archive = join(root, spec.archive);
    verifyPortableArchive(archive, spec, tag, P8D4_CANDIDATE);
    const metadata = readPortableMetadata(archive);
    const changedTag = structuredClone(metadata);
    changedTag.descriptor.annotations["org.opencontainers.image.ref.name"] = "wrong-linux-amd64";
    assert.throws(() => validatePortableMetadata({ ...changedTag, spec, tag, candidate: P8D4_CANDIDATE }), /archive tag mismatch/);
    const changedRevision = structuredClone(metadata);
    changedRevision.config.config.Labels["org.opencontainers.image.revision"] = "0".repeat(40);
    assert.throws(() => validatePortableMetadata({ ...changedRevision, spec, tag, candidate: P8D4_CANDIDATE }), /archive source mismatch/);
  }

  const temporary = mkdtempSync(join(tmpdir(), "evo-p8d4-real-"));
  try {
    const spec = p8d4Specs[0];
    const tag = `${spec.prefix}:${P8D4_CANDIDATE}-linux-amd64`;
    const archive = join(temporary, spec.archive);
    copyFileSync(join(root, spec.archive), archive);
    writeFileSync(join(temporary, "unexpected.txt"), "unexpected\n", { mode: 0o600 });
    execFileSync("tar", ["-rf", archive, "-C", temporary, "unexpected.txt"]);
    assert.throws(() => verifyPortableArchive(archive, spec, tag, P8D4_CANDIDATE), /unexpected tar entries/);
    rmSync(archive);
    copyFileSync(join(root, spec.archive), archive);
    symlinkSync("unexpected.txt", join(temporary, "unsafe-link"));
    execFileSync("tar", ["-rf", archive, "-C", temporary, "unsafe-link"]);
    assert.throws(() => verifyPortableArchive(archive, spec, tag, P8D4_CANDIDATE), /unsafe tar entry type/);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
