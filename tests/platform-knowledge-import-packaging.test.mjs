import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import test from "node:test";

const cwd = new URL("..", import.meta.url);
const ACCOUNT_ID = "20000000-0000-4000-8000-000000000002";

test("root package builds a self-contained importer with a safe non-secret runtime probe", async () => {
  await rm(new URL("../.next/platform-knowledge-import.mjs", import.meta.url), { force: true });
  const build = spawnSync("npm", ["run", "build:platform-knowledge-import"], {
    cwd,
    encoding: "utf8",
  });
  assert.equal(build.status, 0, build.stderr || build.stdout);

  const probe = spawnSync("node", [".next/platform-knowledge-import.mjs", "--verify-runtime"], {
    cwd,
    encoding: "utf8",
    env: { PATH: process.env.PATH },
  });
  assert.equal(probe.status, 0, probe.stderr || probe.stdout);
  assert.deepEqual(JSON.parse(probe.stdout), {
    status: "knowledge_import_runtime_verified",
    version: 1,
  });
  assert.doesNotMatch(probe.stdout, /account|uuid|secret|key/iu);
});

test("root runner image installs only the bundled importer as non-root executable", async () => {
  const dockerfile = await readFile(new URL("../Dockerfile", import.meta.url), "utf8");
  assert.match(dockerfile, /COPY --from=builder --chown=nextjs:nodejs --chmod=0555 \/app\/\.next\/platform-knowledge-import\.mjs \.\/scripts\/import-platform-knowledge-bundle\.mjs/u);
  assert.match(dockerfile, /USER nextjs/u);
});

test("bundled importer emits one closed safe blocker without reading files on account mismatch", () => {
  const blocked = spawnSync("node", [
    ".next/platform-knowledge-import.mjs",
    "--audience", "client",
    "--account-id", "30000000-0000-4000-8000-000000000003",
    "--bundle", "/must/not/be/read/client.bundle.json",
    "--manifest", "/must/not/be/read/client.manifest.json",
  ], {
    cwd,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      EVO_PLATFORM_KNOWLEDGE_ACCOUNT_ID: ACCOUNT_ID,
    },
  });
  assert.equal(blocked.status, 0, blocked.stderr || blocked.stdout);
  assert.equal(blocked.stderr, "");
  assert.deepEqual(JSON.parse(blocked.stdout), {
    status: "knowledge_import_blocked",
    version: 1,
    audience: "client",
    reason_code: "account_binding_failed",
  });
  assert.doesNotMatch(blocked.stdout, /20000000|30000000|must\/not\/be\/read/u);
});
