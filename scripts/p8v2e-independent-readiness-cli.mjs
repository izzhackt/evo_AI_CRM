#!/usr/bin/env node

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { runP8V2EReadiness } from "./p8v2e-independent-readiness.mjs";

const arguments_ = process.argv.slice(2);
const index = arguments_.indexOf("--application-root");
if (index < 0 || !arguments_[index + 1] || arguments_.length !== 2) {
  process.stderr.write("Usage: npm run p8v2e:prepare -- --application-root <exact-clean-application-checkout>\n");
  process.exit(2);
}

try {
  const output = await runP8V2EReadiness({
    toolRoot: resolve(dirname(fileURLToPath(import.meta.url)), ".."),
    sourceRoot: resolve(arguments_[index + 1]),
  });
  process.stdout.write(`p8v2e_${output.result.result_code}\n`);
  process.exitCode = output.result.result_code === "readiness_verified" ? 0 : 2;
} catch (error) {
  process.stderr.write(`p8v2e_failed:${error?.code ?? "operation_failed"}\n`);
  process.exitCode = 2;
}
