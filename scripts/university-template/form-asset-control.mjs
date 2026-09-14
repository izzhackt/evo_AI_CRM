// TEST IMAGE ONLY. Uses the prior real synthetic request, never a private source.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
const input = await readFile("/proof-output/saved-small.eufq");
assert.ok(input.length > 12 && input.length < 2 * 1024 * 1024);
assert.equal(input.subarray(0, 4).toString(), "EUFQ");
const child = spawn("/opt/evo-university-template-runtime/launcher", ["--render-form-v1"], { env: {}, stdio: ["pipe", "pipe", "pipe"] });
const chunks = []; let length = 0, stderr = "";
child.stdin.on("error", () => {}); child.stdout.on("data", bytes => { length += bytes.length; assert.ok(length <= 4108); chunks.push(bytes); });
child.stderr.on("data", bytes => { stderr += bytes; }); child.stdin.end(input);
const code = await new Promise((resolve, reject) => { child.on("error", reject); child.on("close", resolve); });
assert.equal(code, 0); assert.equal(stderr, "");
const wire = Buffer.concat(chunks); assert.equal(wire.subarray(0, 4).toString(), "EUF1");
assert.equal(wire.length, 12 + wire.readUInt32BE(4)); assert.equal(wire.readUInt32BE(8), 0);
assert.deepEqual(JSON.parse(wire.subarray(12).toString()), { status: "rejected", code: "source_unavailable" });
process.stdout.write("form_fixed_asset_rejection_verified\n");
