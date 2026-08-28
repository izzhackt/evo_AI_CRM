import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { cleanNextDevTypes } from "../scripts/clean-next-dev-types.mjs";

test("cleanNextDevTypes removes only interrupted development route types", async () => {
  const repositoryRoot = await mkdtemp(join(tmpdir(), "evo-next-dev-types-"));
  const interruptedTypes = join(repositoryRoot, ".next", "dev", "types");
  const authoritativeTypes = join(repositoryRoot, ".next", "types");

  try {
    await mkdir(interruptedTypes, { recursive: true });
    await mkdir(authoritativeTypes, { recursive: true });
    await writeFile(join(interruptedTypes, "validator.ts"), "partial output");
    await writeFile(join(authoritativeTypes, "validator.ts"), "route types");

    await cleanNextDevTypes(repositoryRoot);

    assert.equal(existsSync(interruptedTypes), false);
    assert.equal(existsSync(join(authoritativeTypes, "validator.ts")), true);

    await cleanNextDevTypes(repositoryRoot);
    assert.equal(existsSync(repositoryRoot), true);
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});
