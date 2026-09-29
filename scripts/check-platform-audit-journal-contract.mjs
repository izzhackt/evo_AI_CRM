#!/usr/bin/env node
// Checks the TS P7A allowlists (src/lib/platform-audit.ts) against the LIVE
// server contract captured by supabase/tests/platform_audit_journal_contract.sql
// on the latest migration chain (scripts/test-postgres-authorization.sh).
//
// Usage:
//   node --experimental-strip-types check-platform-audit-journal-contract.mjs \
//     <captured-output-file> [path-to-platform-audit.ts]
//
// <captured-output-file> is the raw stdout of the psql run of that suite: it
// contains, among other (ignored) lines, exactly one line starting with
// "P7A_JOURNAL_CONTRACT " (the server's actions/resourceTypes/
// changedFieldCodesByAction as JSON) and one or more lines starting with
// "P7A_JOURNAL_PAGE " (each search_audit_events() page as JSON, verbatim).
//
// This script only needs node built-ins plus a type-stripped import of
// platform-audit.ts (which itself imports only a *type* from
// platform-audit-csv.ts), so it runs in the fast PR "Migration boundary" job
// without `npm ci`.
//
// Exit 0 and a one-line summary on success. Exit 1 with a labeled diff
// (missing/extra per allowlist, and any page that failed to normalize or
// whose rows came back unrecognized) on failure.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

const capturedFilePath = process.argv[2];
const moduleArg = process.argv[3] ?? "../src/lib/platform-audit.ts";

if (!capturedFilePath) {
  console.error(
    "usage: check-platform-audit-journal-contract.mjs <captured-output-file> [path-to-platform-audit.ts]",
  );
  process.exit(1);
}

function die(message) {
  console.error(`P7A journal contract check FAILED: ${message}`);
  process.exit(1);
}

const CONTRACT_PREFIX = "P7A_JOURNAL_CONTRACT ";
const PAGE_PREFIX = "P7A_JOURNAL_PAGE ";

let raw;
try {
  raw = readFileSync(capturedFilePath, "utf8");
} catch (error) {
  die(`cannot read captured output file ${capturedFilePath}: ${error.message}`);
}

const lines = raw.split(/\r?\n/);
const contractLines = lines.filter((line) => line.startsWith(CONTRACT_PREFIX));
const pageLines = lines.filter((line) => line.startsWith(PAGE_PREFIX));

if (contractLines.length !== 1) {
  die(
    `expected exactly one ${JSON.stringify(CONTRACT_PREFIX.trim())} line, found ${contractLines.length}`,
  );
}
if (pageLines.length < 1) {
  die(`expected at least one ${JSON.stringify(PAGE_PREFIX.trim())} line, found none`);
}

let contract;
try {
  contract = JSON.parse(contractLines[0].slice(CONTRACT_PREFIX.length));
} catch (error) {
  die(`the P7A_JOURNAL_CONTRACT line is not valid JSON: ${error.message}`);
}
for (const key of ["actions", "resourceTypes", "changedFieldCodesByAction"]) {
  if (!(key in contract)) die(`P7A_JOURNAL_CONTRACT JSON is missing "${key}"`);
}

const pages = pageLines.map((line, index) => {
  try {
    return JSON.parse(line.slice(PAGE_PREFIX.length));
  } catch (error) {
    die(`P7A_JOURNAL_PAGE line ${index + 1} is not valid JSON: ${error.message}`);
  }
});

const modulePath = path.isAbsolute(moduleArg) ? moduleArg : path.resolve(scriptDir, moduleArg);
const moduleUrl = pathToFileURL(modulePath).href;

let platformAudit;
try {
  platformAudit = await import(moduleUrl);
} catch (error) {
  die(`failed to import ${modulePath}: ${error.stack ?? error.message}`);
}

const {
  PLATFORM_AUDIT_ACTIONS,
  PLATFORM_AUDIT_RESOURCE_TYPES,
  PLATFORM_AUDIT_CHANGED_FIELD_CODES,
  normalizePlatformAuditSearchResult,
} = platformAudit;
for (const [name, value] of [
  ["PLATFORM_AUDIT_ACTIONS", PLATFORM_AUDIT_ACTIONS],
  ["PLATFORM_AUDIT_RESOURCE_TYPES", PLATFORM_AUDIT_RESOURCE_TYPES],
  ["PLATFORM_AUDIT_CHANGED_FIELD_CODES", PLATFORM_AUDIT_CHANGED_FIELD_CODES],
  ["normalizePlatformAuditSearchResult", normalizePlatformAuditSearchResult],
]) {
  if (value === undefined) die(`${modulePath} does not export ${name}`);
}

function setDiff(server, ts) {
  const serverSet = new Set(server);
  const tsSet = new Set(ts);
  return {
    missingFromTs: [...serverSet].filter((item) => !tsSet.has(item)).sort(),
    extraInTs: [...tsSet].filter((item) => !serverSet.has(item)).sort(),
  };
}

let failed = false;

function reportSetDiff(label, diff) {
  if (diff.missingFromTs.length === 0 && diff.extraInTs.length === 0) return;
  failed = true;
  console.error(`${label} mismatch:`);
  if (diff.missingFromTs.length) {
    console.error(`  on the server but missing from TS: ${JSON.stringify(diff.missingFromTs)}`);
  }
  if (diff.extraInTs.length) {
    console.error(`  in TS but not on the server: ${JSON.stringify(diff.extraInTs)}`);
  }
}

reportSetDiff("Action allowlist", setDiff(contract.actions, PLATFORM_AUDIT_ACTIONS));
reportSetDiff(
  "Resource-type allowlist",
  setDiff(contract.resourceTypes, PLATFORM_AUDIT_RESOURCE_TYPES),
);
const serverFieldCodes = [
  ...new Set(Object.values(contract.changedFieldCodesByAction).flat()),
];
reportSetDiff(
  "Changed-field-code allowlist",
  setDiff(serverFieldCodes, PLATFORM_AUDIT_CHANGED_FIELD_CODES),
);

let totalRows = 0;
let recognizedRows = 0;
const unrecognizedSamples = [];
const seenActions = new Set();

pages.forEach((page, index) => {
  let result;
  try {
    result = normalizePlatformAuditSearchResult(page);
  } catch (error) {
    failed = true;
    console.error(
      `Page ${index + 1}/${pages.length}: normalizePlatformAuditSearchResult threw: ${error.message}`,
    );
    return;
  }
  for (const row of result.rows) {
    totalRows += 1;
    seenActions.add(row.action);
    if (row.recognized) {
      recognizedRows += 1;
    } else if (unrecognizedSamples.length < 20) {
      unrecognizedSamples.push({
        action: row.action,
        resourceType: row.resourceType,
        changedFieldCodes: row.changedFieldCodes,
      });
    }
  }
});

if (totalRows !== recognizedRows) {
  failed = true;
  console.error(
    `${totalRows - recognizedRows} of ${totalRows} rows across ${pages.length} page(s) were NOT recognized by the TS contract:`,
  );
  console.error(JSON.stringify(unrecognizedSamples, null, 2));
}

const actionSetDiff = setDiff(contract.actions, [...seenActions]);
if (actionSetDiff.missingFromTs.length > 0) {
  failed = true;
  console.error(
    `Server actions never appeared in any captured page (fixture gap, not a TS drift): ${JSON.stringify(actionSetDiff.missingFromTs)}`,
  );
}

if (failed) {
  console.error("P7A journal contract check FAILED.");
  process.exit(1);
}

console.log(
  `P7A journal contract check passed: ${contract.actions.length} actions, ` +
    `${contract.resourceTypes.length} resource types, ${pages.length} page(s), ` +
    `${totalRows} rows, all recognized.`,
);
