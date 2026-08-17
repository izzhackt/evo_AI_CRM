import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import test from "node:test";

const cwd = new URL("..", import.meta.url);

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
