#!/usr/bin/env node

import { createHash } from "node:crypto";
import { chmodSync, lstatSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createP8V3ProductionOperations } from "./p8v3-production-operations.mjs";
import { validateP8V3Preflight } from "./p8v3-preflight.mjs";
import { runP8V3Rollout, writeP8V3Result } from "./p8v3-rollout.mjs";

function parseArguments(values) {
  const parsed = new Map();
  for (let index = 0; index < values.length; index += 2) {
    const name = values[index];
    const value = values[index + 1];
    if (!["--candidate-root", "--output-root", "--preflight"].includes(name) || !value || parsed.has(name)) return null;
    parsed.set(name, value);
  }
  return values.length === 6 ? parsed : null;
}

const arguments_ = parseArguments(process.argv.slice(2));
if (!arguments_) {
  process.stderr.write("Usage: npm run p8v3:rollout -- --candidate-root <reviewed-candidate-root> --preflight <fresh-preflight.json> --output-root <new-local-evidence-root>\n");
  process.exit(2);
}

try {
  const toolRoot = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
  const outputRoot = resolve(arguments_.get("--output-root"));
  const preflightPath = realpathSync(resolve(arguments_.get("--preflight")));
  const preflightMetadata = lstatSync(preflightPath);
  if (!preflightMetadata.isFile() || preflightMetadata.isSymbolicLink() || (preflightMetadata.mode & 0o777) !== 0o600) throw new Error("unsafe preflight artifact");
  const preflightBytes = readFileSync(preflightPath);
  const preflight = validateP8V3Preflight(JSON.parse(preflightBytes.toString("utf8")));
  const preflightSha256 = createHash("sha256").update(preflightBytes).digest("hex");
  const output = join(outputRoot, "p8v3i-rollout-result.json");
  const operations = await createP8V3ProductionOperations({
    sourceRoot: toolRoot,
    candidateRoot: arguments_.get("--candidate-root"),
    supabaseCliPath: join(toolRoot, "node_modules/.bin/supabase"),
    localResultPath: output,
  });
  mkdirSync(outputRoot, { recursive: false, mode: 0o700 });
  chmodSync(outputRoot, 0o700);
  const metadata = lstatSync(outputRoot);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || (metadata.mode & 0o777) !== 0o700) throw new Error("unsafe output root");
  const result = await runP8V3Rollout({
    operations,
    authorization: process.env.EVO_P8V3_AUTHORIZATION,
    preflight,
    preflightSha256,
  });
  writeP8V3Result(output, result);
  process.stdout.write(`p8v3i_${result.result_code}\n`);
  process.exitCode = result.result_code === "rollout_verified" ? 0 : 2;
} catch (error) {
  process.stderr.write(`p8v3i_failed:${error?.code ?? "operation_failed"}\n`);
  process.exitCode = 2;
}
