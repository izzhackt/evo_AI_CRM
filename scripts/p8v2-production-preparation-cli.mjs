#!/usr/bin/env node

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createP8V2Operations } from "./p8v2-production-operations.mjs";
import { runP8V2Preparation } from "./p8v2-production-preparation.mjs";

const args = process.argv.slice(2);

if (args.length !== 2 || args[0] !== "--application-root" || !args[1]) {
  process.stderr.write("Usage: npm run p8v2c:prepare -- --application-root <exact-clean-application-checkout>\n");
  process.exitCode = 2;
} else {
  try {
    const operations = await createP8V2Operations({
      toolRoot: resolve(dirname(fileURLToPath(import.meta.url)), ".."),
      sourceRoot: resolve(args[1]),
    });
    const result = await runP8V2Preparation({ operations });
    process.stdout.write(`p8v2c_${result.result_code}\n`);
    process.exitCode = result.result_code === "preparation_verified" ? 0 : 2;
  } catch (error) {
    process.stderr.write(`p8v2c_failed:${error?.code ?? "operation_failed"}\n`);
    process.exitCode = 2;
  }
}
