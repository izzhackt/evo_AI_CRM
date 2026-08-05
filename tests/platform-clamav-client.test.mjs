import assert from "node:assert/strict";
import { createServer } from "node:net";
import test from "node:test";

import {
  PlatformClamAvClient,
  PlatformClamAvError,
  buildClamAvInstreamFrames,
  parseClamAvScanResponse,
} from "../src/lib/server/platform-clamav-client.ts";

async function startServer(connectionHandler) {
  const sockets = new Set();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    connectionHandler(socket);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return {
    port: address.port,
    close: () => {
      for (const socket of sockets) socket.destroy();
      return new Promise((resolve) => server.close(resolve));
    },
  };
}

function collectInstream(socket, onComplete) {
  let received = Buffer.alloc(0);
  let completed = false;
  socket.on("data", (chunk) => {
    received = Buffer.concat([received, chunk]);
    if (received.length < 10 || !received.subarray(0, 10).equals(Buffer.from("zINSTREAM\0"))) {
      return;
    }
    let offset = 10;
    const chunks = [];
    while (offset + 4 <= received.length) {
      const length = received.readUInt32BE(offset);
      if (length === 0) {
        if (!completed) {
          completed = true;
          onComplete(Buffer.concat(chunks));
        }
        return;
      }
      if (offset + 4 + length > received.length) return;
      chunks.push(received.subarray(offset + 4, offset + 4 + length));
      offset += 4 + length;
    }
  });
}

test("INSTREAM framing is bounded, big-endian, and zero-terminated", () => {
  const bytes = Buffer.from("synthetic-pdf-bytes", "utf8");
  const frames = buildClamAvInstreamFrames(bytes, 1024);
  assert.equal(frames[0].toString("ascii"), "zINSTREAM\0");
  assert.equal(frames[1].readUInt32BE(0), bytes.length);
  assert.deepEqual(frames[2], bytes);
  assert.deepEqual(frames.at(-1), Buffer.alloc(4));
});

test("readiness uses exact PING and VERSION metadata", async (context) => {
  const commands = [];
  const fixture = await startServer((socket) => {
    socket.once("data", (command) => {
      commands.push(command.toString("ascii"));
      if (command.equals(Buffer.from("zPING\0"))) socket.end("PONG\0");
      else socket.end("ClamAV 1.5.3/28000/Wed Aug 5 00:00:00 2026\0");
    });
  });
  context.after(fixture.close);

  const client = new PlatformClamAvClient({ host: "127.0.0.1", port: fixture.port });
  assert.deepEqual(await client.readiness(), {
    ready: true,
    version: "ClamAV 1.5.3/28000/Wed Aug 5 00:00:00 2026",
  });
  assert.deepEqual(commands, ["zPING\0", "zVERSION\0"]);
});

test("clean scan streams only bytes and parses exact OK", async (context) => {
  const bytes = Buffer.from("synthetic-clean-content", "utf8");
  let streamed;
  const fixture = await startServer((socket) => {
    collectInstream(socket, (content) => {
      streamed = content;
      socket.end("stream: OK\0");
    });
  });
  context.after(fixture.close);

  const client = new PlatformClamAvClient({
    host: "127.0.0.1",
    port: fixture.port,
    chunkBytes: 1024,
  });
  assert.deepEqual(await client.scan(bytes), { status: "clean" });
  assert.deepEqual(streamed, bytes);
});

test("EICAR-like daemon response is infected without needing real malware bytes", async (context) => {
  const fixture = await startServer((socket) => {
    collectInstream(socket, () => {
      socket.end("stream: Eicar-Test-Signature FOUND\0");
    });
  });
  context.after(fixture.close);

  const client = new PlatformClamAvClient({ host: "127.0.0.1", port: fixture.port });
  assert.deepEqual(await client.scan(Buffer.from("benign-synthetic-fixture")), {
    status: "infected",
    signature: "Eicar-Test-Signature",
  });
});

test("limit, daemon error, and malformed replies stay fail-closed", () => {
  assert.throws(
    () => parseClamAvScanResponse("stream: INSTREAM size limit exceeded. ERROR"),
    (error) => error instanceof PlatformClamAvError && error.code === "stream_limit_exceeded" && !error.retryable,
  );
  assert.throws(
    () => parseClamAvScanResponse("stream: Scanner temporarily unavailable ERROR"),
    (error) => error instanceof PlatformClamAvError && error.code === "daemon_error" && error.retryable,
  );
  assert.throws(
    () => parseClamAvScanResponse("stream: probably fine"),
    (error) => error instanceof PlatformClamAvError && error.code === "response_malformed",
  );
});

test("timeout and abort are retryable and never become clean", async (context) => {
  const fixture = await startServer(() => undefined);
  context.after(fixture.close);
  const client = new PlatformClamAvClient({
    host: "127.0.0.1",
    port: fixture.port,
    responseTimeoutMs: 25,
  });
  await assert.rejects(
    client.scan(Buffer.from("synthetic-timeout")),
    (error) => error instanceof PlatformClamAvError && error.code === "timeout" && error.retryable,
  );

  const controller = new AbortController();
  const pending = client.scan(Buffer.from("synthetic-abort"), controller.signal);
  controller.abort();
  await assert.rejects(
    pending,
    (error) => error instanceof PlatformClamAvError && error.code === "aborted" && error.retryable,
  );
});
