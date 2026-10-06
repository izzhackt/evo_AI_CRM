#!/usr/bin/env node
// Driver for scripts/test-waha-history-import-postgres.sh: runs the REAL
// operator CLI (scripts/waha-history-import.mjs) over HTTP against a real
// PostgREST in front of a disposable Supabase Postgres that has migrations
// 001-260 applied, with a loopback MOCK of WAHA (synthetic history, GET only).
// Nothing real is contacted. The bash script asserts the database after each
// phase; this driver only runs one phase and passes the CLI's stdout/stderr and
// exit code through.
//
//   node scripts/test-waha-history-import-chain.mjs <phase>
//
// phases: preview | pilot | interrupted | resume | rerun | dryrun
// The flags are the owner's go-live choice (docs/runbooks/whatsapp-history-import.md):
// every command passes --include-outbound-only, the pilot picks a chat from the
// preview with --only-chats-file, the rest runs with --all-chats (no personal
// chats on the sales phone) behind the reviewed preview file.
// environment: NEXT_PUBLIC_SUPABASE_URL, EVO_PLATFORM_SUPABASE_SECRET_KEY,
// EVO_PLATFORM_ORGANIZATION_ID, EVO_PLATFORM_WAHA_INTAKE_SALES_MEMBERSHIP_ID,
// EVO_WAHA_HISTORY_ALLOW_LOCAL_SUPABASE=1, EVO_CHAIN_NOW (window end, ISO),
// EVO_CHAIN_DIR (work directory), EVO_CHAIN_RUN_ID (resume only).

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { TARGET_BASE_URL, runCli } from "./waha-history-import.mjs";
import {
  DAY,
  PHONE_OF_LID_1,
  LID_1,
  LID_2,
  LID_3,
  ME,
  defaultSession,
  filteredRow,
  makeBaseRows,
  message,
  row,
  startMockWaha,
} from "../tests/helpers/waha-history-mock.mjs";

const phase = process.argv[2];
const now = process.env.EVO_CHAIN_NOW;
const directory = process.env.EVO_CHAIN_DIR;
if (!["preview", "pilot", "interrupted", "resume", "rerun", "dryrun"].includes(phase) || !now || !directory) {
  process.stderr.write("usage: test-waha-history-import-chain.mjs <phase> (see the header)\n");
  process.exit(2);
}
const nowSeconds = Math.floor(Date.parse(now) / 1000);

// The base dataset plus one chat with 260 messages (several pages at --page-size 100),
// in groups of 20 with the SAME timestamp (ties), with reactions interleaved that WAHA drops
// after the LIMIT; the mock WAHA also puts equal timestamps in a new random order on every request.
const CHAT_E = "15550000106@c.us";
const rows = makeBaseRows(nowSeconds);
for (let index = 0; index < 260; index += 1) {
  rows.push(
    row(
      message({
        chat: CHAT_E,
        fromMe: index % 2 === 0,
        ts: nowSeconds - 5 * DAY + Math.floor(index / 20) * 30,
        body: `E-body-${index}`,
        name: "Emil Test",
        id: `${index % 2 === 0}_${CHAT_E}_E${index}`,
      }),
    ),
  );
  if (index % 10 === 9) rows.push(filteredRow(nowSeconds - 5 * DAY + Math.floor(index / 20) * 30));
}

const waha = await startMockWaha({
  shuffleTies: 7,
  rows,
  lids: { [LID_1]: PHONE_OF_LID_1, [LID_2]: ME.id, [LID_3]: null },
  session: defaultSession(),
});
const wahaFetchImpl = (url, init) => fetch(String(url).replace(TARGET_BASE_URL, waha.origin), init);

function refOf(name) {
  const lines = readFileSync(join(directory, "preview.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
  const found = lines.slice(1).find((line) => line.name === name);
  if (!found) throw new Error(`no preview line named ${name}`);
  return found.ref;
}

const preview = join(directory, "preview.jsonl");
const window = ["--window-to", now];
const common = ["--page-size", "100", "--waha-page-size", "50", "--waha-pause-ms", "0", "--rpc-pause-ms", "0", "--include-outbound-only"];
let argv;
let signal;
let fetchImpl = fetch;

if (phase === "preview") {
  argv = ["preview", ...window, "--include-outbound-only", "--out", preview, "--waha-page-size", "50", "--waha-pause-ms", "0", "--rpc-pause-ms", "0", "--page-size", "100"];
} else if (phase === "pilot") {
  writeFileSync(join(directory, "pilot.txt"), `# pilot\n${refOf("Aigul Test")}\n`);
  argv = ["apply", ...window, "--only-chats-file", join(directory, "pilot.txt"), ...common];
} else {
  argv = ["apply", ...window, "--all-chats", "--preview-file", preview, ...common];
  if (phase === "interrupted") {
    const controller = new AbortController();
    signal = controller.signal;
    let pages = 0;
    fetchImpl = async (url, init) => {
      const response = await fetch(url, init);
      if (String(url).endsWith("/project_waha_history_window_page") && ++pages === 3) controller.abort();
      return response;
    };
  }
  if (phase === "dryrun") argv.push("--dry-run");
  if (phase === "resume") {
    const runId = process.env.EVO_CHAIN_RUN_ID;
    if (!runId) throw new Error("EVO_CHAIN_RUN_ID is required");
    argv.push("--resume", runId);
  }
}

const code = await runCli({
  argv,
  environment: process.env,
  stdout: process.stdout,
  stderr: process.stderr,
  fetchImpl,
  wahaFetchImpl,
  signal,
});

// What WAHA was asked: only GET, only the three allow-listed read paths.
const bad = waha.requests.filter(
  (request) =>
    request.method !== "GET" ||
    !/^\/api\/(sessions\/crm_primary|crm_primary\/(chats\/all\/messages|lids\/[0-9]+@lid))$/u.test(request.path) ||
    (request.path.endsWith("/messages") && request.query.downloadMedia !== "false"),
);
if (bad.length > 0) {
  process.stderr.write(`{"ok":false,"driver_error":"forbidden WAHA request","count":${bad.length}}\n`);
  await waha.close();
  process.exit(9);
}
process.stderr.write(`{"driver":"waha_requests","count":${waha.requests.length},"all_get":true}\n`);
await waha.close();
process.exit(code);
