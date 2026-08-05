import assert from "node:assert/strict";

import {
  PlatformClamAvClient,
  PlatformClamAvError,
} from "../src/lib/server/platform-clamav-client.ts";

const [, , mode, host, portText] = process.argv;
const port = Number(portText);
if (
  !["scan", "unavailable"].includes(mode) ||
  host !== "127.0.0.1" ||
  !Number.isSafeInteger(port) ||
  port < 1 ||
  port > 65_535
) {
  throw new Error("clamav_integration_arguments_invalid");
}

const client = new PlatformClamAvClient({
  host,
  port,
  connectTimeoutMs: 1_000,
  responseTimeoutMs: 30_000,
});

if (mode === "unavailable") {
  await assert.rejects(
    client.scan(Buffer.from("synthetic-unavailable-proof", "utf8")),
    (error) =>
      error instanceof PlatformClamAvError &&
      error.retryable &&
      error.code !== "payload_empty",
  );
  process.stdout.write(
    `${JSON.stringify({ proof: "scanner-unavailable-fails-closed", passed: true })}\n`,
  );
} else {
  const readiness = await client.readiness();
  assert.match(readiness.version, /^ClamAV 1\.5\.3(?:[./\s-]|$)/u);

  const clean = await client.scan(
    Buffer.from("%PDF-1.7\nsynthetic integration fixture\n%%EOF", "utf8"),
  );
  assert.deepEqual(clean, { status: "clean" });

  // Built from two fragments so repository scanners do not mistake this test
  // harness for a stored malware sample. The runtime bytes are the standard
  // 68-byte EICAR anti-malware test file, not executable malware.
  const eicar = Buffer.from(
    ["X5O!P%@AP[4\\PZX54(P^)7CC)7}$", "EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"].join(""),
    "ascii",
  );
  assert.equal(eicar.byteLength, 68);
  const infected = await client.scan(eicar);
  assert.equal(infected.status, "infected");

  process.stdout.write(
    `${JSON.stringify({
      proof: "real-clamav-instream-clean-and-eicar",
      passed: true,
      version: readiness.version.split("/")[0],
    })}\n`,
  );
}
