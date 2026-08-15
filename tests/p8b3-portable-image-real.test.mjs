import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readPortableMetadata, specs, validatePortableMetadata, verifyPortableArchive } from "../scripts/p8b3-portable-image-identity.mjs";

const root = process.env.EVO_P8B3_EVIDENCE_ROOT;
if (!root) throw new Error("EVO_P8B3_EVIDENCE_ROOT must name the retained real P8B3 evidence root");
const candidate = "0505143657858e710acdd5029f1cc77c5524083e";

test("real P8B3 archives reject metadata drift and unexpected entries", () => {
  for (const spec of specs) {
    const tag = `${spec.prefix}:${candidate}-linux-amd64`;
    const archive = join(root, spec.archive);
    verifyPortableArchive(archive, spec, tag);
    const metadata = readPortableMetadata(archive);
    const changedTag = structuredClone(metadata);
    changedTag.descriptor.annotations["org.opencontainers.image.ref.name"] = "wrong-linux-amd64";
    assert.throws(() => validatePortableMetadata({ ...changedTag, spec, tag }), /archive tag mismatch/);
    const changedSource = structuredClone(metadata);
    changedSource.config.config.Labels["org.opencontainers.image.source"] = "https://example.invalid/not-evo";
    assert.throws(() => validatePortableMetadata({ ...changedSource, spec, tag }), /archive source mismatch/);
    const changedMedia = structuredClone(metadata);
    changedMedia.manifest.config.mediaType = "application/octet-stream";
    assert.throws(() => validatePortableMetadata({ ...changedMedia, spec, tag }), /config media type mismatch/);
  }

  const temporary = mkdtempSync(join(tmpdir(), "evo-p8b3-real-"));
  try {
    const spec = specs[0];
    const tag = `${spec.prefix}:${candidate}-linux-amd64`;
    const archive = join(temporary, spec.archive);
    copyFileSync(join(root, spec.archive), archive);
    writeFileSync(join(temporary, "unexpected.txt"), "unexpected\n", { mode: 0o600 });
    execFileSync("tar", ["-rf", archive, "-C", temporary, "unexpected.txt"]);
    assert.throws(() => verifyPortableArchive(archive, spec, tag), /unexpected tar entries/);
    rmSync(archive);
    copyFileSync(join(root, spec.archive), archive);
    symlinkSync("unexpected.txt", join(temporary, "unsafe-link"));
    execFileSync("tar", ["-rf", archive, "-C", temporary, "unsafe-link"]);
    assert.throws(() => verifyPortableArchive(archive, spec, tag), /unsafe tar entry type/);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
