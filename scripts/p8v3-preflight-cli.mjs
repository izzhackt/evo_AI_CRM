#!/usr/bin/env node

import { chmodSync, lstatSync, mkdirSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createP8V3ProductionOperations } from "./p8v3-production-operations.mjs";
import { runP8V3Preflight, writeP8V3Preflight } from "./p8v3-preflight.mjs";

function parseArguments(values) {
  const parsed = new Map();
  for (let index = 0; index < values.length; index += 2) {
    const name = values[index];
    const value = values[index + 1];
    if (!["--candidate-root", "--output-root"].includes(name) || !value || parsed.has(name)) return null;
    parsed.set(name, value);
  }
  return values.length === 4 ? parsed : null;
}

const arguments_ = parseArguments(process.argv.slice(2));
if (!arguments_) {
  process.stderr.write("Usage: npm run p8v3:preflight -- --candidate-root <reviewed-candidate-root> --output-root <new-local-preflight-root>\n");
  process.exit(2);
}

try {
  const toolRoot = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
  const outputRoot = resolve(arguments_.get("--output-root"));
  mkdirSync(outputRoot, { recursive: false, mode: 0o700 });
  chmodSync(outputRoot, 0o700);
  const metadata = lstatSync(outputRoot);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || (metadata.mode & 0o777) !== 0o700) throw new Error("unsafe preflight output root");
  const operations = await createP8V3ProductionOperations({
    mode: "preflight",
    sourceRoot: toolRoot,
    candidateRoot: arguments_.get("--candidate-root"),
    supabaseCliPath: join(toolRoot, "node_modules/.bin/supabase"),
    localResultPath: join(outputRoot, "unused-result.json"),
  });
  const result = await runP8V3Preflight({ operations });
  writeP8V3Preflight(join(outputRoot, "p8v3d-preflight.json"), result);
  process.stdout.write("p8v3d_preflight_verified\n");
} catch (error) {
  process.stderr.write(`p8v3d_preflight_failed:${error?.code ?? "operation_failed"}\n`);
  process.exitCode = 2;
}
