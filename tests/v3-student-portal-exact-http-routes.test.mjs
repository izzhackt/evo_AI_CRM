import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const nextBin = resolve(repositoryRoot, "node_modules/next/dist/bin/next");
const slotId = "10000000-0000-4000-8000-000000000001";
const versionId = "20000000-0000-4000-8000-000000000002";

test("Next preserves trailing-slash Student document paths for fail-closed proxy handling", {
  timeout: 60_000,
}, async (context) => {
  const port = await reserveLoopbackPort();
  const output = [];
  const server = spawn(
    process.execPath,
    [nextBin, "dev", "-H", "127.0.0.1", "-p", String(port)],
    {
      cwd: repositoryRoot,
      env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  server.stdout.on("data", (chunk) => output.push(chunk.toString()));
  server.stderr.on("data", (chunk) => output.push(chunk.toString()));
  context.after(async () => stopServer(server));

  const cases = [
    {
      method: "POST",
      path: `/api/portal/document-slots/${slotId}/versions/`,
    },
    {
      method: "GET",
      path: `/api/portal/document-versions/${versionId}/download/`,
    },
  ];

  await waitForServer(port, server, output);
  for (const routeCase of cases) {
    const response = await fetch(`http://127.0.0.1:${port}${routeCase.path}`, {
      method: routeCase.method,
      body: routeCase.method === "POST" ? "not-a-valid-upload" : undefined,
      headers: routeCase.method === "POST"
        ? { "content-type": "application/octet-stream" }
        : undefined,
      redirect: "manual",
    });
    assert.equal(response.status, 403, routeCase.path);
    assert.equal(response.headers.get("location"), null, routeCase.path);
    assert.deepEqual(await response.json(), {
      error: "platform_route_not_connected",
      request_id: response.headers.get("x-request-id"),
    });
  }
});

async function reserveLoopbackPort() {
  const server = createServer();
  server.unref();
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  await new Promise((resolveClose, reject) => {
    server.close((error) => error ? reject(error) : resolveClose());
  });
  return address.port;
}

async function waitForServer(port, server, output) {
  const deadline = Date.now() + 30_000;
  const probe = `/api/portal/document-versions/${versionId}/download/`;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      assert.fail(`Next exited before readiness: ${output.join("").slice(-4_000)}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}${probe}`, {
        redirect: "manual",
      });
      await response.body?.cancel();
      return;
    } catch {
      await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    }
  }
  assert.fail(`Next did not become ready: ${output.join("").slice(-4_000)}`);
}

async function stopServer(server) {
  if (server.exitCode !== null) return;
  server.kill("SIGTERM");
  await Promise.race([
    once(server, "exit"),
    new Promise((resolveWait) => setTimeout(resolveWait, 5_000)),
  ]);
  if (server.exitCode === null) server.kill("SIGKILL");
}
