import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  RPC,
  TARGET_BASE_URL,
  buildPages,
  chatKeyOf,
  chatRef,
  SCAN_MAX_LIMIT,
  computeWindow,
  createChatIndex,
  createWahaClient,
  isAllowedWahaPath,
  parseChatList,
  runCli,
  scanWindow,
  slimMessage,
  withPhoneAlternative,
} from "../scripts/waha-history-import.mjs";
import {
  BODY,
  CHAT_A,
  CHAT_B,
  CHAT_C,
  CHAT_D,
  DAY,
  LID_1,
  LID_2,
  LID_3,
  ME,
  PHONE_OF_LID_1,
  WAHA_KEY,
  defaultSession,
  filteredRow,
  listen,
  makeAt,
  makeBaseRows,
  message,
  row,
  startMockWaha,
} from "./helpers/waha-history-mock.mjs";

// Everything below is synthetic. No Supabase project, WAHA instance or provider
// is contacted: WAHA and the database RPCs are loopback HTTP servers that model
// the documented contracts (WAHA 2026.9.2 GOWS REST history; migration 260 RPCs).
const SERVICE_CREDENTIAL = "sb_secret_abcdefghijklmnopqrstuvwxyz0123456789";
const ORG = "11111111-1111-4111-8111-111111111111";
const MEMBERSHIP = "33333333-3333-4333-8333-333333333333";
const NOW = new Date("2026-10-05T12:00:00.000Z");
const NOW_S = Math.floor(NOW.getTime() / 1000);
const WINDOW_TO = NOW.toISOString();
const at = makeAt(NOW_S);
const baseRows = () => makeBaseRows(NOW_S);
const SCRIPT_URL = new URL("../scripts/waha-history-import.mjs", import.meta.url);

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// Mock database RPCs: a JS model of migration 260's contract (windows, cursor,
// first-page rule, replay by request id, counts-only answers)
// ---------------------------------------------------------------------------

const OUTCOME_SKIPS = [
  "invalid",
  "direction_unverified",
  "out_of_window",
  "api_source",
  "crm_send",
  "empty",
  "own_chat",
  "unsupported_chat",
  "chat_mismatch",
  "foreign_conversation",
  "outbound_only",
];

function normalizeJid(value) {
  return typeof value === "string"
    ? value.trim().toLowerCase().replace(/:[0-9]+@/u, "@").replace(/@s\.whatsapp\.net$/u, "@c.us")
    : null;
}

function uuid(counter) {
  return `a0000000-0000-4000-8000-${String(counter).padStart(12, "0")}`;
}

async function startMockDb({ bindingMissing = false, bindingBaseUrl = TARGET_BASE_URL } = {}) {
  const state = {
    calls: [],
    runs: [],
    replays: new Map(),
    boundIds: new Set(),
    chatBindings: new Map(),
    imported: [],
    pageFaults: [],
    nextRun: 1,
    conversations: 0,
    errorBodyLeak: "row-secret-details",
  };

  const send = (response, status, body) => {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  };
  const sqlError = (response, status, code) =>
    send(response, status, { code, message: "synthetic error", details: state.errorBodyLeak });

  function planPage(run, chatKey, messages) {
    const skipped = Object.fromEntries(OUTCOME_SKIPS.map((name) => [name, 0]));
    const received = messages.length;
    if (!/^[0-9]{5,32}@(?:c\.us|lid)$/u.test(chatKey ?? "")) {
      skipped.unsupported_chat = received;
      return { outcome: "skip_unsupported_chat", skipped, alreadyBound: 0, eligible: [], received };
    }
    const from = Date.parse(run.window_from) / 1000;
    const to = Date.parse(run.window_to) / 1000;
    const own = new Set(Object.values(run.options.me ?? {}).map(normalizeJid));
    const prepared = [];
    for (const item of messages) {
      if (typeof item.fromMe !== "boolean") {
        skipped.direction_unverified += 1;
      } else if (item.timestamp < from || item.timestamp > to) {
        skipped.out_of_window += 1;
      } else if (item.fromMe && String(item.source).toLowerCase() === "api") {
        skipped.crm_send += 1;
      } else if (!item.fromMe && String(item.source).toLowerCase() === "api") {
        skipped.api_source += 1;
      } else if (own.has(chatKey)) {
        skipped.own_chat += 1;
      } else if (!(typeof item.body === "string" && item.body.trim() !== "") && item.hasMedia !== true) {
        skipped.empty += 1;
      } else {
        prepared.push(item);
      }
    }
    prepared.sort((left, right) => left.timestamp - right.timestamp || (left.id < right.id ? -1 : 1));
    let alreadyBound = 0;
    const eligible = [];
    for (const item of prepared) {
      if (state.boundIds.has(item.id.trim())) alreadyBound += 1;
      else eligible.push(item);
    }
    const creator = eligible.find((item) => !item.fromMe)
      ?? (run.options.include_outbound_only ? eligible[0] : undefined);
    const anchor = creator ?? eligible[0];
    if (!anchor) return { outcome: "skip_nothing_eligible", skipped, alreadyBound, eligible: [], received };
    const alt = normalizeJid(anchor._data?.Info?.[anchor.fromMe ? "RecipientAlt" : "SenderAlt"]);
    const bound = state.chatBindings.get(chatKey) ?? (alt ? state.chatBindings.get(alt) : undefined);
    if (!bound && !creator) {
      skipped.outbound_only = eligible.length;
      return { outcome: "skip_outbound_only", skipped, alreadyBound, eligible: [], received };
    }
    return {
      outcome: bound ? "import_existing" : "import_new",
      skipped,
      alreadyBound,
      eligible,
      received,
      alt,
      bound,
    };
  }

  const handlers = {
    [RPC.resolveRuntime]: (body, response) => {
      if (bindingMissing) return send(response, 200, []);
      return send(response, 200, [
        {
          waha_session_name: "crm_primary",
          waha_base_url: bindingBaseUrl,
          waha_api_key: WAHA_KEY,
          binding_version: 1,
        },
      ]);
    },
    [RPC.begin]: (body, response) => {
      const replayKey = body.p_request_id;
      const inputSha = sha256(JSON.stringify({ ...body, p_request_id: undefined }));
      const replay = state.replays.get(replayKey);
      if (replay) return send(response, 200, replay.response);
      const options = body.p_options;
      if (
        body.p_waha_session_name !== "crm_primary" ||
        !["NOWEB", "GOWS", "WEBJS"].includes(body.p_engine) ||
        typeof options?.me?.id !== "string" ||
        Object.keys(options).some((key) => !["include_outbound_only", "lead_mode", "me"].includes(key)) ||
        !(Date.parse(body.p_window_to) > Date.parse(body.p_window_from))
      ) {
        return sqlError(response, 400, "22023");
      }
      const last = state.runs.at(-1);
      let run;
      let resumed = false;
      if (!last || last.state === "completed") {
        run = {
          id: uuid(state.nextRun++),
          state: "running",
          window_from: body.p_window_from,
          window_to: body.p_window_to,
          options,
          engine: body.p_engine,
          membership: body.p_intake_sales_membership_id,
          cursor: { chat: 0, message: 0 },
          totals: {},
          skipped: {},
        };
        state.runs.push(run);
      } else {
        if (
          last.window_from !== body.p_window_from ||
          last.window_to !== body.p_window_to ||
          JSON.stringify(last.options) !== JSON.stringify(options) ||
          last.engine !== body.p_engine ||
          last.membership !== body.p_intake_sales_membership_id
        ) {
          return sqlError(response, 500, "55000");
        }
        run = last;
        run.state = "running";
        resumed = true;
      }
      const answer = {
        organization_id: ORG,
        run_id: run.id,
        state: "running",
        resumed,
        window_from: run.window_from,
        window_to: run.window_to,
        include_outbound_only: options.include_outbound_only === true,
        lead_mode: options.lead_mode ?? "promote",
        chat_offset: run.cursor.chat,
        message_offset: run.cursor.message,
      };
      state.replays.set(replayKey, { sha: inputSha, response: answer });
      return send(response, 200, answer);
    },
    [RPC.page]: (body, response, context) => {
      const inputSha = sha256(JSON.stringify({ ...body, p_request_id: undefined }));
      const replay = state.replays.get(body.p_request_id);
      if (replay) {
        if (replay.sha !== inputSha) return sqlError(response, 400, "22023");
        return send(response, 200, replay.response);
      }
      const run = state.runs.find((candidate) => candidate.id === body.p_run_id);
      if (!run) return sqlError(response, 403, "42501");
      if (run.state !== "running") return sqlError(response, 500, "55000");
      const messages = body.p_messages;
      if (
        !Array.isArray(messages) ||
        messages.length > 500 ||
        Buffer.byteLength(JSON.stringify(messages)) > 5 * 1024 * 1024
      ) {
        return sqlError(response, 400, "22023");
      }
      const ids = messages.map((item) => String(item.id).trim());
      if (new Set(ids).size !== ids.length) return sqlError(response, 400, "22023");
      const next = [body.p_next_chat_offset, body.p_next_message_offset];
      if (!(next[0] > run.cursor.chat || (next[0] === run.cursor.chat && next[1] > run.cursor.message))) {
        return sqlError(response, 400, "22023");
      }
      for (let index = 1; index < messages.length; index += 1) {
        if (messages[index].timestamp < messages[index - 1].timestamp) return sqlError(response, 400, "22023");
      }
      const plan = planPage(run, body.p_raw_chat_id, messages);
      let projected = { total: 0, inbound: 0, outbound: 0, media: 0 };
      let created = false;
      if (plan.outcome === "import_new" || plan.outcome === "import_existing") {
        if (plan.outcome === "import_new") {
          state.conversations += 1;
          state.chatBindings.set(body.p_raw_chat_id, `conversation-${state.conversations}`);
          if (plan.alt) state.chatBindings.set(plan.alt, `conversation-${state.conversations}`);
          created = true;
        }
        for (const item of plan.eligible) {
          state.boundIds.add(item.id.trim());
          state.imported.push({ chat: body.p_raw_chat_id, id: item.id.trim(), fromMe: item.fromMe, body: item.body });
          projected.total += 1;
          if (item.fromMe) projected.outbound += 1;
          else projected.inbound += 1;
          if (item.hasMedia === true) projected.media += 1;
        }
      }
      run.cursor = { chat: next[0], message: next[1] };
      run.pageLog = [
        ...(run.pageLog ?? []),
        { chat: body.p_raw_chat_id, count: messages.length, next, outcome: plan.outcome },
      ];
      const answer = {
        organization_id: ORG,
        run_id: run.id,
        state: "running",
        chat_outcome: plan.outcome,
        conversation_created: created,
        received: plan.received,
        projected: projected.total,
        projected_inbound: projected.inbound,
        projected_outbound: projected.outbound,
        projected_media: projected.media,
        already_bound: plan.alreadyBound,
        skipped: plan.skipped,
        chat_offset: next[0],
        message_offset: next[1],
      };
      for (const [key, value] of Object.entries({
        pages: 1,
        projected: projected.total,
        projected_inbound: projected.inbound,
        projected_outbound: projected.outbound,
        projected_media: projected.media,
        already_bound: plan.alreadyBound,
        conversations_created: created ? 1 : 0,
      })) {
        run.totals[key] = (run.totals[key] ?? 0) + value;
      }
      for (const [key, value] of Object.entries(plan.skipped)) {
        run.skipped[key] = (run.skipped[key] ?? 0) + value;
      }
      state.replays.set(body.p_request_id, { sha: inputSha, response: answer });
      context.processed = true;
      return send(response, 200, answer);
    },
    [RPC.finish]: (body, response) => {
      const run = state.runs.find((candidate) => candidate.id === body.p_run_id);
      if (!run) return sqlError(response, 403, "42501");
      if (run.state !== "running") return sqlError(response, 500, "55000");
      run.state = body.p_outcome;
      return send(response, 200, {
        organization_id: ORG,
        run_id: run.id,
        state: body.p_outcome,
        totals: { ...run.totals, skipped: run.skipped },
        chat_offset: run.cursor.chat,
        message_offset: run.cursor.message,
      });
    },
    [RPC.preview]: (body, response) => {
      const options = body.p_options;
      if (typeof options?.me?.id !== "string") return sqlError(response, 400, "22023");
      const run = {
        window_from: body.p_window_from,
        window_to: body.p_window_to,
        options,
      };
      const plan = planPage(run, body.p_raw_chat_id, body.p_messages);
      const eligible = plan.eligible;
      return send(response, 200, {
        chat_kind: /@lid$/u.test(body.p_raw_chat_id) ? "lid" : "c_us",
        chat_outcome: plan.outcome,
        lid_chat_has_phone: Boolean(plan.alt),
        conversation_exists: plan.outcome === "import_existing",
        would_create_conversation: plan.outcome === "import_new",
        matches_active_client_phone: body.p_raw_chat_id === CHAT_D,
        received: plan.received,
        would_import: eligible.length,
        would_import_inbound: eligible.filter((item) => !item.fromMe).length,
        would_import_outbound: eligible.filter((item) => item.fromMe).length,
        would_import_media: eligible.filter((item) => item.hasMedia === true).length,
        already_bound: plan.alreadyBound,
        skipped: plan.skipped,
      });
    },
  };

  const listener = await listen((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const url = new URL(request.url, "http://mock");
      const match = /^\/rest\/v1\/rpc\/([a-z_]+)$/u.exec(url.pathname);
      const name = match?.[1];
      const handler = name ? handlers[name] : undefined;
      if (request.method !== "POST" || !handler) {
        response.writeHead(404).end();
        return;
      }
      if (request.headers.apikey !== SERVICE_CREDENTIAL || request.headers.authorization !== undefined) {
        response.writeHead(401).end(JSON.stringify({ code: "PGRST301" }));
        return;
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      state.calls.push({ name, body });
      if (name === RPC.page && state.pageFaults.length > 0) {
        const fault = state.pageFaults.shift();
        if (fault === "unavailable") return send(response, 503, { message: "try again" });
        if (fault === "reject") return sqlError(response, 400, "22023");
        if (fault === "lose") {
          handler(body, { writeHead() {}, end() {} }, {});
          response.socket.destroy();
          return;
        }
      }
      handler(body, response, {});
    });
  });
  return { ...listener, state, calls: state.calls };
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

async function setup({
  rows = baseRows(),
  lids,
  session,
  dbOptions,
  ignoreFilter = false,
  shuffleTies = null,
  duplicateInResponse = 0,
} = {}) {
  const waha = await startMockWaha({
    rows,
    lids: lids ?? { [LID_1]: PHONE_OF_LID_1, [LID_2]: ME.id, [LID_3]: null },
    session,
    ignoreFilter,
    shuffleTies,
    duplicateInResponse,
  });
  const db = await startMockDb(dbOptions);
  const environment = {
    NEXT_PUBLIC_SUPABASE_URL: db.origin,
    EVO_WAHA_HISTORY_ALLOW_LOCAL_SUPABASE: "1",
    EVO_PLATFORM_SUPABASE_SECRET_KEY: SERVICE_CREDENTIAL,
    EVO_PLATFORM_ORGANIZATION_ID: ORG,
    EVO_PLATFORM_WAHA_INTAKE_SALES_MEMBERSHIP_ID: MEMBERSHIP,
  };
  const wahaFetchImpl = (url, init) => fetch(String(url).replace(TARGET_BASE_URL, waha.origin), init);
  const outputs = [];
  const directory = mkdtempSync(join(tmpdir(), "waha-history-test-"));

  async function run(args, extra = {}) {
    const command = args[0];
    const fast = ["--waha-pause-ms", "0"];
    // One-day slices keep the loopback scans short; the slice tests choose their own.
    if (!args.includes("--waha-slice-seconds")) fast.push("--waha-slice-seconds", "86400");
    if (command === "preview" || command === "apply") fast.push("--rpc-pause-ms", "0");
    const out = [];
    const err = [];
    const code = await runCli({
      argv: [...args, ...fast],
      environment: extra.environment ?? environment,
      stdout: { write: (text) => out.push(text) },
      stderr: { write: (text) => err.push(text) },
      fetchImpl: extra.fetchImpl ?? fetch,
      wahaFetchImpl,
      sleep: extra.sleep ?? (async () => {}),
      now: extra.now ?? (() => NOW),
      signal: extra.signal,
    });
    const stdout = out.join("");
    const stderr = err.join("");
    outputs.push(stdout, stderr);
    const parseLine = (text) => {
      const lines = text.trim().split("\n").filter((line) => line.startsWith("{"));
      return lines.length === 0 ? null : JSON.parse(lines.at(-1));
    };
    return { code, stdout, stderr, json: parseLine(stdout), error: parseLine(stderr) };
  }

  // A client for the mock WAHA, for tests that drive scanWindow directly.
  const client = () =>
    createWahaClient({
      baseUrl: TARGET_BASE_URL,
      apiKey: WAHA_KEY,
      fetchImpl: wahaFetchImpl,
      sleep: async () => {},
      pauseMs: 0,
    });

  return {
    waha,
    db,
    environment,
    client,
    run,
    outputs,
    directory,
    file(name, content) {
      const path = join(directory, name);
      writeFileSync(path, content);
      return path;
    },
    path: (name) => join(directory, name),
    async close() {
      await waha.close();
      await db.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

async function withHarness(options, body) {
  const harness = await setup(options);
  try {
    await body(harness);
  } finally {
    await harness.close();
  }
}

const windowArgs = ["--window-to", WINDOW_TO];
const pageCalls = (db) => db.calls.filter((call) => call.name === RPC.page);
const messagesRequests = (waha) =>
  waha.requests.filter((request) => request.path === "/api/crm_primary/chats/all/messages");

// ---------------------------------------------------------------------------
// WAHA reading: parameters, paging, window
// ---------------------------------------------------------------------------

test("reads the window in disjoint slices at offset 0 with the verified WAHA parameters, each settled by two equal consecutive limits", async () => {
  const rows = [];
  let ts = at(1);
  for (let index = 0; index < 450; index += 1) {
    rows.push(row(message({ chat: CHAT_A, fromMe: index % 2 === 1, ts, body: `m${index}`, id: `${index % 2 === 1}_A_${index}` })));
    ts += 10;
    if (index % 7 === 0) rows.push(filteredRow(ts));
  }
  await withHarness({ rows }, async (harness) => {
    const result = await harness.run(["sync-status", ...windowArgs, "--waha-page-size", "100", "--waha-slice-seconds", "3600"]);
    assert.equal(result.code, 3, "a single snapshot is not stable");
    assert.equal(result.json.counts.kept_messages, 450);
    assert.equal(result.json.counts.direct_chats, 1);
    const requests = messagesRequests(harness.waha);
    const from = NOW_S - 7 * DAY;
    for (const request of requests) {
      assert.equal(request.method, "GET");
      assert.equal(request.query.offset, "0", "never offset paging: ties may change places between requests");
      assert.ok(["100", "500", "2500"].includes(request.query.limit), `limit ${request.query.limit} is always sent (WAHA's default is 10)`);
      assert.equal(request.query.sortBy, "timestamp");
      assert.equal(request.query.sortOrder, "asc");
      assert.equal(request.query.downloadMedia, "false");
      assert.equal(request.key, WAHA_KEY);
    }
    // The slices are disjoint, abut and cover [from, to] exactly; each is read with limit 100 then 500.
    const slices = new Map();
    for (const request of requests) {
      const key = `${request.query["filter.timestamp.gte"]}:${request.query["filter.timestamp.lte"]}`;
      slices.set(key, [...(slices.get(key) ?? []), request.query.limit]);
    }
    const ordered = [...slices.keys()].map((key) => key.split(":").map(Number)).sort((left, right) => left[0] - right[0]);
    assert.equal(ordered[0][0], from);
    assert.equal(ordered.at(-1)[1], NOW_S + 1, "the last slice asks up to to + 1 (a fractional timestamp in the last second)");
    ordered.forEach(([start, end], position) => {
      assert.equal(end - 1 - start + 1 <= 3600, true);
      // lte is the slice end + 1, which is exactly where the next slice starts: no gap, no second read.
      if (position > 0) assert.equal(start, ordered[position - 1][1], "no gap and no overlap between slices");
    });
    for (const limits of slices.values()) assert.deepEqual(limits.slice(0, 2), ["100", "500"]);
    // The busy hours (more than 100 rows) needed a third, larger limit to settle; the quiet ones did not.
    assert.ok([...slices.values()].some((limits) => limits.length === 3));
    assert.ok([...slices.values()].some((limits) => limits.length === 2));
    assert.equal(result.json.counts.scan_requests, requests.length);
    assert.equal(result.json.counts.scan_splits, 0);
  });
});

test("the window is a closed interval of Unix seconds computed from --days and --window-to", async () => {
  await withHarness({}, async (harness) => {
    const to = "2026-10-04T08:30:15.000Z";
    const result = await harness.run(["sync-status", "--days", "3", "--window-to", to]);
    const requests = messagesRequests(harness.waha);
    const toSeconds = Date.parse(to) / 1000;
    const bounds = requests.map((request) => [Number(request.query["filter.timestamp.gte"]), Number(request.query["filter.timestamp.lte"])]);
    assert.equal(Math.min(...bounds.map((pair) => pair[0])), toSeconds - 3 * DAY);
    assert.equal(Math.max(...bounds.map((pair) => pair[1])), toSeconds + 1);
    assert.equal(result.json.window_to, "2026-10-04T08:30:15.000Z");
    assert.equal(result.json.window_from, "2026-10-01T08:30:15.000Z");
  });
  assert.throws(() => computeWindow({ days: 32, windowTo: null, now: () => NOW }), { code: "window_invalid" });
  assert.throws(() => computeWindow({ days: 7, windowTo: "2026-10-05T12:30:00Z", now: () => NOW }), { code: "window_invalid" });
  assert.throws(() => computeWindow({ days: 7, windowTo: "2026-10-05 12:00:00", now: () => NOW }), { code: "window_invalid" });
  const defaulted = computeWindow({ days: undefined, windowTo: undefined, now: () => NOW });
  assert.equal(defaulted.toDefaulted, true);
  assert.equal(defaulted.toSeconds - defaulted.fromSeconds, 7 * DAY);
});

test("a server that ignores the window filter fails the scan instead of importing a partial window", async () => {
  const rows = [
    row(message({ chat: CHAT_A, ts: NOW_S - 9 * DAY, body: "too old", id: "false_old" })),
    ...[1, 2, 3, 4].map((hour) => row(message({ chat: CHAT_A, ts: at(hour), body: `in${hour}`, id: `false_in${hour}` }))),
  ];
  await withHarness({ rows, ignoreFilter: true }, async (harness) => {
    const result = await harness.run(["sync-status", ...windowArgs]);
    assert.equal(result.code, 1);
    assert.equal(result.error.error_code, "waha_response_invalid");
  });
});

// A scan helper for the tie and filter tests: the ids kept per chat, read with a tie-shuffling server.
async function scanIds(harness, options) {
  const index = createChatIndex({ fromSeconds: NOW_S - 7 * DAY, toSeconds: NOW_S, retain: true });
  const scan = await scanWindow({
    waha: harness.client(),
    index,
    fromSeconds: NOW_S - 7 * DAY,
    toSeconds: NOW_S,
    baseLimit: 20,
    sliceSeconds: 3600,
    maxMessages: 1_000_000,
    ...options,
  });
  const ids = index.finalize().flatMap((chat) => chat.messages.map((item) => item.id));
  return { ids, scan, stats: index.stats };
}

test("tie-safe scan: equal timestamps that change places between requests, and rows dropped after the LIMIT, lose and repeat nothing", async () => {
  // 600 messages on 25 distinct seconds (24 per second, ties everywhere), reactions interleaved, and a run of 450
  // consecutive dropped rows in the middle of the window that hides the real messages behind it from a small limit.
  const rows = [];
  const expected = [];
  for (let second = 0; second < 25; second += 1) {
    for (let k = 0; k < 24; k += 1) {
      const id = `false_${CHAT_A}_T${second}_${k}`;
      expected.push(id);
      rows.push(row(message({ chat: k % 2 === 0 ? CHAT_A : CHAT_B, ts: at(2) + second, body: `t${second}-${k}`, id })));
      if (k % 5 === 0) rows.push(filteredRow(at(2) + second));
    }
    if (second === 11) for (let k = 0; k < 450; k += 1) rows.push(filteredRow(at(2) + second));
  }
  for (let seed = 1; seed <= 12; seed += 1) {
    await withHarness({ rows, shuffleTies: seed }, async (harness) => {
      const { ids, scan, stats } = await scanIds(harness, {});
      assert.equal(ids.length, 600, `seed ${seed}: ${ids.length} messages`);
      assert.deepEqual([...new Set(ids)].sort(), [...expected].sort(), `seed ${seed}: the exact id set`);
      assert.equal(stats.duplicate, 0);
      assert.ok(scan.requests >= 2 * 168, "every slice of the window is asked for, none is skipped");
    });
  }
  // The CLI reaches the same answer end to end.
  await withHarness({ rows, shuffleTies: 99 }, async (harness) => {
    const result = await harness.run(["sync-status", ...windowArgs, "--waha-page-size", "20", "--waha-slice-seconds", "3600"]);
    assert.equal(result.json.counts.kept_messages, 600);
  });
});

test("sub-second timestamps are read as floor(timestamp) like the database: none lost at a slice boundary or in the last second, none read twice", async () => {
  const from = NOW_S - 7 * DAY;
  const boundary = from + 3600 * 10;
  const mk = (id, ts) => row(message({ chat: CHAT_A, ts, body: id, id }));
  const rows = [
    mk("false_frac_before_boundary", boundary - 0.5),
    mk("false_frac_on_boundary", boundary),
    mk("false_frac_after_boundary", boundary + 0.5),
    mk("false_frac_end_of_slice", boundary + 3599.5),
    mk("false_frac_end_of_window", NOW_S + 0.5),
    mk("false_frac_outside_before", from - 0.5),
    mk("false_frac_outside_after", NOW_S + 1),
  ];
  await withHarness({ rows, shuffleTies: 5 }, async (harness) => {
    const { ids } = await scanIds(harness, {});
    assert.deepEqual(
      [...ids].sort(),
      [
        "false_frac_after_boundary",
        "false_frac_before_boundary",
        "false_frac_end_of_slice",
        "false_frac_end_of_window",
        "false_frac_on_boundary",
      ],
      "floor(timestamp) inside the window, each exactly once",
    );
  });
});

test("a slice that is too big for the largest limit is split; a second that cannot settle fails closed", async () => {
  const rows = [];
  for (let second = 0; second < 200; second += 1) {
    rows.push(row(message({ chat: CHAT_A, ts: at(5) + second, body: `s${second}`, id: `false_split_${second}` })));
  }
  await withHarness({ rows, shuffleTies: 3 }, async (harness) => {
    const { ids, scan } = await scanIds(harness, { baseLimit: 10, maxLimit: 50 });
    assert.equal(new Set(ids).size, 200);
    assert.ok(scan.splits > 0, "the hour was split until each part settled");
  });
  const same = Array.from({ length: 80 }, (_, k) => row(message({ chat: CHAT_B, ts: at(6), body: `x${k}`, id: `false_same_${k}` })));
  await withHarness({ rows: same, shuffleTies: 4 }, async (harness) => {
    await assert.rejects(scanIds(harness, { baseLimit: 10, maxLimit: 50 }), { code: "scan_unstable" });
    // With the real limits the same second settles.
    const { ids } = await scanIds(harness, { baseLimit: 20 });
    assert.equal(new Set(ids).size, 80);
  });
  assert.ok(SCAN_MAX_LIMIT >= 5000);
});

test("sub-second timestamps are read as floor(timestamp) like the database: none lost at a slice boundary or in the last second, none read twice", async () => {
  const from = NOW_S - 7 * DAY;
  const boundary = from + 3600 * 10;
  const mk = (id, ts) => row(message({ chat: CHAT_A, ts, body: id, id }));
  const rows = [
    mk("false_frac_before_boundary", boundary - 0.5),
    mk("false_frac_on_boundary", boundary),
    mk("false_frac_after_boundary", boundary + 0.5),
    mk("false_frac_end_of_slice", boundary + 3599.5),
    mk("false_frac_end_of_window", NOW_S + 0.5),
    mk("false_frac_outside_before", from - 0.5),
    mk("false_frac_outside_after", NOW_S + 1),
  ];
  await withHarness({ rows, shuffleTies: 5 }, async (harness) => {
    const { ids } = await scanIds(harness, {});
    assert.deepEqual(
      [...ids].sort(),
      [
        "false_frac_after_boundary",
        "false_frac_before_boundary",
        "false_frac_end_of_slice",
        "false_frac_end_of_window",
        "false_frac_on_boundary",
      ],
      "floor(timestamp) inside the window, each exactly once",
    );
  });
});

test("a slice that is too big for the largest limit is split; a second that cannot settle fails closed", async () => {
  const rows = [];
  for (let second = 0; second < 200; second += 1) {
    rows.push(row(message({ chat: CHAT_A, ts: at(5) + second, body: `s${second}`, id: `false_split_${second}` })));
  }
  await withHarness({ rows, shuffleTies: 3 }, async (harness) => {
    const { ids, scan } = await scanIds(harness, { baseLimit: 10, maxLimit: 50 });
    assert.equal(new Set(ids).size, 200);
    assert.ok(scan.splits > 0, "the hour was split until each part settled");
  });
  const same = Array.from({ length: 80 }, (_, k) => row(message({ chat: CHAT_B, ts: at(6), body: `x${k}`, id: `false_same_${k}` })));
  await withHarness({ rows: same, shuffleTies: 4 }, async (harness) => {
    await assert.rejects(scanIds(harness, { baseLimit: 10, maxLimit: 50 }), { code: "scan_unstable" });
    // With the real limits the same second settles.
    const { ids } = await scanIds(harness, { baseLimit: 20 });
    assert.equal(new Set(ids).size, 80);
  });
  assert.ok(SCAN_MAX_LIMIT >= 5000);
});

test("a row repeated inside one response is retried and then fails; one id in two slices fails", async () => {
  const rows = [
    row(message({ chat: CHAT_A, ts: at(5) + 10, body: "one", id: "false_dup_1" })),
    row(message({ chat: CHAT_A, ts: at(6) + 10, body: "two", id: "false_dup_2" })),
  ];
  await withHarness({ rows, duplicateInResponse: 1 }, async (harness) => {
    const { ids, scan } = await scanIds(harness, {});
    assert.equal(ids.length, 2);
    assert.equal(scan.retries, 1, "a transient repeat is re-requested");
  });
  await withHarness({ rows, duplicateInResponse: true }, async (harness) => {
    await assert.rejects(scanIds(harness, {}), { code: "scan_unstable" });
    const result = await harness.run(["preview", ...windowArgs, "--out", harness.path("never.jsonl")]);
    assert.equal(result.error.error_code, "scan_unstable");
    assert.equal(harness.db.calls.some((call) => call.name === RPC.preview), false, "nothing is previewed from an unsettled scan");
  });
  const twice = [
    row(message({ chat: CHAT_A, ts: at(5) + 10, body: "same id, hour one", id: "false_twice" })),
    row(message({ chat: CHAT_A, ts: at(8) + 10, body: "same id, hour two", id: "false_twice" })),
  ];
  await withHarness({ rows: twice }, async (harness) => {
    await assert.rejects(scanIds(harness, {}), { code: "scan_unstable" });
  });
});

// ---------------------------------------------------------------------------
// Chat filter, @lid, own number
// ---------------------------------------------------------------------------

test("only direct chats are read: groups, Status, channels, the own chat and CRM API sends never leave the process", async () => {
  await withHarness({}, async (harness) => {
    const result = await harness.run(["apply", ...windowArgs, "--dry-run"]);
    assert.equal(result.code, 0);
    assert.deepEqual(result.json.skipped_local, {
      api_source: 0,
      crm_send: 1,
      direction_unverified: 0,
      duplicate: 0,
      invalid: 0,
      non_direct: 3,
      outside_window: 0,
      own_chat: 1,
    });
    assert.equal(result.json.direct_chats, 7);
    assert.equal(result.json.kept_messages, 14);
    assert.equal(result.json.candidate_chats, 6, "the outbound-only chat is not a candidate");
    // Nothing of a group or the own chat was previewed either.
    const previewed = harness.db.calls.filter((call) => call.name === RPC.preview).map((call) => call.body.p_raw_chat_id);
    assert.deepEqual(previewed.sort(), [CHAT_A, CHAT_B, CHAT_D, LID_1, LID_2, LID_3].sort());
  });
  assert.equal(chatKeyOf({ from: "15550000101@c.us", fromMe: false }), "15550000101@c.us");
  assert.equal(chatKeyOf({ from: "15550000000@c.us", to: "15550000101@s.whatsapp.net", fromMe: true }), "15550000101@c.us");
  assert.equal(chatKeyOf({ from: "120363000000000001@g.us", fromMe: false }), null);
  assert.equal(chatKeyOf({ from: "15550000101@c.us", participant: "15550000102@c.us", fromMe: false }), null);
  assert.equal(chatKeyOf({ from: "status@broadcast", fromMe: false }), null);
  assert.equal(chatKeyOf({ from: "12345@newsletter", fromMe: false }), null);
});

test("an @lid chat gets its phone from WAHA's lid map as the alternative field; the own number and unknown lids get none", async () => {
  await withHarness({}, async (harness) => {
    const result = await harness.run(["apply", ...windowArgs, "--all-chats"]);
    assert.equal(result.code, 0, result.stderr);
    const lookups = harness.waha.requests.filter((request) => request.path.includes("/lids/"));
    assert.deepEqual(
      lookups.map((request) => request.path).sort(),
      [LID_1, LID_2, LID_3].map((lid) => `/api/crm_primary/lids/${lid}`).sort(),
    );
    const byChat = (chat) => pageCalls(harness.db).filter((call) => call.body.p_raw_chat_id === chat).flatMap((call) => call.body.p_messages);
    const lid1 = byChat(LID_1);
    assert.equal(lid1.length, 2);
    for (const item of lid1) {
      assert.equal(item._data.Info[item.fromMe ? "RecipientAlt" : "SenderAlt"], PHONE_OF_LID_1);
    }
    for (const chat of [LID_2, LID_3]) {
      for (const item of byChat(chat)) {
        assert.equal(item._data?.Info?.SenderAlt, undefined, "the own number or an unknown mapping is never passed");
        assert.equal(item._data?.Info?.RecipientAlt, undefined);
      }
    }
    // Plain c.us chats are untouched.
    for (const item of byChat(CHAT_A)) assert.equal(item._data.Info.SenderAlt, undefined);
  });
  const slim = slimMessage(message({ chat: LID_1, ts: at(1), id: "x" }));
  assert.equal(withPhoneAlternative(slim, PHONE_OF_LID_1)._data.Info.SenderAlt, PHONE_OF_LID_1);
  assert.equal(slim._data.Info.SenderAlt, undefined, "the stored copy is not mutated");
});

test("the own account from the session is passed to the database and the own chat is never imported", async () => {
  await withHarness({}, async (harness) => {
    await harness.run(["apply", ...windowArgs, "--all-chats"]);
    const begin = harness.db.calls.find((call) => call.name === RPC.begin).body;
    assert.deepEqual(begin.p_options, {
      include_outbound_only: false,
      lead_mode: "promote",
      me: { id: ME.id, lid: ME.lid, jid: ME.jid },
    });
    assert.equal(begin.p_engine, "GOWS");
    assert.equal(begin.p_waha_session_name, "crm_primary");
    assert.equal(begin.p_intake_sales_membership_id, MEMBERSHIP);
    assert.equal(begin.p_window_to, WINDOW_TO);
    assert.equal(begin.p_window_from, new Date((NOW_S - 7 * DAY) * 1000).toISOString());
    assert.equal(harness.db.state.imported.some((item) => item.chat === ME.id), false);
  });
  const noMe = defaultSession({ me: {} });
  await withHarness({ session: noMe }, async (harness) => {
    const result = await harness.run(["apply", ...windowArgs, "--all-chats"]);
    assert.equal(result.error.error_code, "session_me_missing");
    assert.equal(harness.db.calls.some((call) => call.name === RPC.begin), false);
  });
});

// ---------------------------------------------------------------------------
// preview
// ---------------------------------------------------------------------------

test("preview writes a 0600 file with opaque refs, names and last four digits; stdout has only totals", async () => {
  await withHarness({}, async (harness) => {
    const out = harness.path("preview.jsonl");
    const result = await harness.run(["preview", ...windowArgs, "--out", out]);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.json.out_file_mode, "0600");
    assert.equal(statSync(out).mode & 0o777, 0o600);
    const lines = readFileSync(out, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(lines[0].meta.window_to, WINDOW_TO);
    const chats = lines.slice(1);
    assert.equal(chats.length, 6);
    for (const line of chats) {
      assert.match(line.ref, /^c-[0-9a-f]{16}$/u);
      assert.ok(Number.isInteger(line.inbound) && Number.isInteger(line.outbound));
      assert.ok(line.first_at <= line.last_at);
    }
    const a = chats.find((line) => line.last4 === "0101");
    assert.equal(a.name, "Aigul Test");
    assert.equal(a.inbound, 2);
    assert.equal(a.outbound, 2, "the CRM API send is not counted");
    assert.equal(a.kind, "c_us");
    assert.equal(a.outcome, "import_new");
    assert.equal(chats.find((line) => line.name === "Dana Test").existing_client_match, true);
    // The @lid chat with a phone shows the phone's last four digits; one without shows none.
    assert.equal(chats.find((line) => line.name === "Lida Test").last4, "0104");
    assert.equal(chats.find((line) => line.name === "Lana Test").last4, null);
    // The file never holds a full number or a message text.
    const text = readFileSync(out, "utf8");
    for (const secret of ["15550000101", "15550000104", BODY.aIn1, BODY.aOut1, "B-body-one", WAHA_KEY, SERVICE_CREDENTIAL]) {
      assert.equal(text.includes(secret), false, `the preview file leaks ${secret}`);
    }
    // stdout: totals only, no ref, name or file path.
    const stdout = result.stdout;
    for (const line of chats) assert.equal(stdout.includes(line.ref), false);
    assert.equal(stdout.includes("Aigul"), false);
    assert.equal(stdout.includes(out), false);
    assert.equal(result.json.totals.chats_candidates, 6);
    assert.equal(result.json.totals.chats_outbound_only, 1);
    assert.equal(result.json.totals.by_outcome.import_new, 6);
    // Refs are stable across runs and do not depend on the window.
    const again = harness.path("preview-2.jsonl");
    await harness.run(["preview", "--days", "6", "--window-to", WINDOW_TO, "--out", again]);
    const second = readFileSync(again, "utf8").trim().split("\n").slice(1).map((line) => JSON.parse(line));
    assert.equal(second.find((line) => line.last4 === "0101").ref, a.ref);
    assert.equal(chatRef(SERVICE_CREDENTIAL, CHAT_A), a.ref);
    assert.notEqual(chatRef("sb_secret_another_key_value_0123456789", CHAT_A), a.ref);
    // Never overwrites an existing file.
    const rerun = await harness.run(["preview", ...windowArgs, "--out", out]);
    assert.equal(rerun.error.error_code, "out_file_exists");
    // Preview writes nothing in the database.
    assert.deepEqual(
      [...new Set(harness.db.calls.map((call) => call.name))].sort(),
      [RPC.preview, RPC.resolveRuntime].sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// apply: selection, lists, pilot, paging, idempotence
// ---------------------------------------------------------------------------

async function refsByName(harness, extraArgs = []) {
  const out = harness.path(`refs-${Math.random().toString(16).slice(2)}.jsonl`);
  await harness.run(["preview", ...windowArgs, ...extraArgs, "--out", out]);
  const lines = readFileSync(out, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  const map = new Map();
  for (const line of lines.slice(1)) map.set(line.name ?? `last4:${line.last4}`, line.ref);
  return { map, out };
}

test("apply needs an explicit selection; a dry run does not", async () => {
  await withHarness({}, async (harness) => {
    const refused = await harness.run(["apply", ...windowArgs]);
    assert.equal(refused.code, 1);
    assert.equal(refused.error.error_code, "selection_required");
    assert.equal(harness.waha.requests.length, 0, "refused before any network call");
    // --max-chats only limits a selection: alone it would pick "the freshest chats", personal ones included.
    const limitOnly = await harness.run(["apply", ...windowArgs, "--max-chats", "3"]);
    assert.equal(limitOnly.error.error_code, "selection_required");
    // A real import pins its window: no default of "now".
    const noWindow = await harness.run(["apply", "--all-chats"]);
    assert.equal(noWindow.error.error_code, "window_to_required");
    assert.equal(harness.waha.requests.length, 0);
    // A list file that names no chat selects (or excludes) nothing silently: refused; --all-chats is the explicit form.
    for (const [name, content] of [["empty.txt", ""], ["comments.txt", "# nobody\n\n   \n# still nobody\n"]]) {
      const emptyFile = harness.file(name, content);
      for (const flag of ["--exclude-chats-file", "--only-chats-file"]) {
        const result = await harness.run(["apply", ...windowArgs, flag, emptyFile]);
        assert.equal(result.error.error_code, "list_file_empty", `${flag} ${name}`);
      }
    }
    assert.equal(harness.waha.requests.length, 0);
    assert.equal(harness.db.calls.some((call) => call.name === RPC.begin), false);
    const dryWithoutWindow = await harness.run(["apply", "--dry-run"]);
    assert.equal(dryWithoutWindow.code, 0, "a dry run may default the window");
    assert.equal(dryWithoutWindow.json.window_to_defaulted, true);
    harness.waha.requests.length = 0;
    const dry = await harness.run(["apply", ...windowArgs, "--dry-run"]);
    assert.equal(dry.code, 0);
    assert.equal(dry.json.mode, "apply-dry-run");
    assert.deepEqual(
      [...new Set(harness.db.calls.map((call) => call.name))].sort(),
      [RPC.preview, RPC.resolveRuntime].sort(),
      "a dry run never begins, projects or finishes a run",
    );
    assert.equal(harness.db.state.imported.length, 0);
    assert.equal(dry.json.totals.by_outcome.import_new, 6);
  });
});

test("pilot with --only-chats-file, then the rest with --exclude-chats-file: nothing is imported twice", async () => {
  await withHarness({}, async (harness) => {
    const { map, out: previewFile } = await refsByName(harness);
    const pilot = harness.file("pilot.txt", `# pilot\n${map.get("Aigul Test")}  first chat\n${map.get("Boris Test")}\n`);
    const personal = harness.file("personal.txt", `${map.get("Dana Test")}\n`);

    const pilotRun = await harness.run(["apply", ...windowArgs, "--only-chats-file", pilot]);
    assert.equal(pilotRun.code, 0, pilotRun.stderr);
    assert.equal(pilotRun.json.state, "completed");
    assert.equal(pilotRun.json.totals.chats_imported, 2);
    assert.deepEqual(new Set(harness.db.state.imported.map((item) => item.chat)), new Set([CHAT_A, CHAT_B]));
    assert.equal(harness.db.state.imported.filter((item) => item.chat === CHAT_A).length, 4);
    assert.equal(harness.db.state.imported.filter((item) => item.chat === CHAT_B).length, 3);

    const rest = await harness.run([
      "apply",
      ...windowArgs,
      "--exclude-chats-file",
      personal,
      "--preview-file",
      previewFile,
    ]);
    assert.equal(rest.code, 0, rest.stderr);
    assert.equal(rest.json.selection.excluded_by_list, 1);
    assert.equal(rest.json.selection.preview_file_checked, true);
    const chats = new Set(harness.db.state.imported.map((item) => item.chat));
    assert.equal(chats.has(CHAT_D), false, "an excluded chat is never imported");
    assert.deepEqual(chats, new Set([CHAT_A, CHAT_B, LID_1, LID_2, LID_3]));
    // A and B were already imported by the pilot: counted, not duplicated.
    assert.equal(rest.json.totals.already_bound, 7);
    const allIds = harness.db.state.imported.map((item) => item.id);
    assert.equal(new Set(allIds).size, allIds.length);

    // Verification: a dry run over the same window and lists reports nothing left to import.
    const verify = await harness.run(["apply", ...windowArgs, "--exclude-chats-file", personal, "--dry-run"]);
    assert.equal(verify.json.totals.first_page_would_import, 0);
    assert.equal(verify.json.totals.by_outcome.skip_nothing_eligible, 5);
  });
});

test("list files are validated: unmatched refs, another window, unreviewed chats", async () => {
  await withHarness({}, async (harness) => {
    const { map, out: previewFile } = await refsByName(harness);
    const unmatched = harness.file("unmatched.txt", `${map.get("Aigul Test")}\nc-0000000000000000\n`);
    const result = await harness.run(["apply", ...windowArgs, "--only-chats-file", unmatched]);
    assert.equal(result.error.error_code, "list_ref_unmatched");
    assert.equal(harness.db.calls.some((call) => call.name === RPC.begin), false);

    const garbage = harness.file("garbage.txt", "not a ref\n");
    assert.equal((await harness.run(["apply", ...windowArgs, "--exclude-chats-file", garbage])).error.error_code, "list_file_invalid");

    // The preview file is only valid for the window it was made for.
    const other = await harness.run([
      "apply",
      "--window-to",
      "2026-10-05T11:00:00.000Z",
      "--days",
      "5",
      "--exclude-chats-file",
      previewFile,
    ]);
    assert.equal(other.error.error_code, "list_window_mismatch");

    // A chat that is not in the reviewed preview file stops the run.
    const lines = readFileSync(previewFile, "utf8").trim().split("\n");
    const trimmed = harness.file("trimmed.jsonl", `${lines.slice(0, -1).join("\n")}\n`);
    const unreviewed = await harness.run(["apply", ...windowArgs, "--all-chats", "--preview-file", trimmed]);
    assert.equal(unreviewed.error.error_code, "chat_not_reviewed");
    assert.equal(harness.db.calls.some((call) => call.name === RPC.begin), false);
  });
  assert.deepEqual([...parseChatList("c-0123456789abcdef  note\n# x\n{\"ref\":\"c-1111111111111111\",\"name\":\"n\"}\n").refs].sort(), [
    "c-0123456789abcdef",
    "c-1111111111111111",
  ]);
  assert.throws(() => parseChatList("15550000101@c.us\n"), { code: "list_file_invalid" });
});

test("--max-chats limits a list selection; it cannot be combined with --all-chats", async () => {
  await withHarness({}, async (harness) => {
    const { map } = await refsByName(harness);
    const personal = harness.file("personal.txt", `${map.get("Dana Test")}\n`);
    harness.waha.requests.length = 0;
    const capped = await harness.run(["apply", ...windowArgs, "--all-chats", "--max-chats", "2"]);
    assert.equal(capped.error.error_code, "all_chats_with_max_chats");
    assert.equal(harness.waha.requests.length, 0, "refused before any network call");
    assert.equal(harness.db.calls.some((call) => call.name === RPC.begin), false);
    const result = await harness.run(["apply", ...windowArgs, "--exclude-chats-file", personal, "--max-chats", "2"]);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.json.totals.chats_imported, 2);
    assert.equal(new Set(harness.db.state.imported.map((item) => item.chat)).size, 2);
    assert.equal(harness.db.state.imported.some((item) => item.chat === CHAT_D), false, "the excluded chat is never taken");
    assert.equal(harness.db.state.runs[0].state, "completed");
  });
});

test("pages respect the database limits, stay chronological and move the cursor strictly forward", async () => {
  const rows = [];
  for (let index = 0; index < 235; index += 1) {
    rows.push(row(message({ chat: CHAT_A, fromMe: index % 3 === 0, ts: at(1) + index * 60, body: `body ${index}`, id: `${index % 3 === 0}_A_${index}` })));
  }
  rows.push(...baseRows().filter((entry) => entry.message.from === CHAT_B));
  await withHarness({ rows }, async (harness) => {
    const result = await harness.run(["apply", ...windowArgs, "--all-chats", "--page-size", "100"]);
    assert.equal(result.code, 0, result.stderr);
    const calls = pageCalls(harness.db);
    const chatA = calls.filter((call) => call.body.p_raw_chat_id === CHAT_A);
    assert.deepEqual(chatA.map((call) => call.body.p_messages.length), [100, 100, 35]);
    let previous = [-1, -1];
    for (const call of calls) {
      assert.ok(call.body.p_messages.length <= 500);
      assert.ok(Buffer.byteLength(JSON.stringify(call.body.p_messages)) <= 3 * 1024 * 1024);
      const next = [call.body.p_next_chat_offset, call.body.p_next_message_offset];
      assert.ok(next[0] > previous[0] || (next[0] === previous[0] && next[1] > previous[1]), "cursor strictly increases");
      previous = next;
      const stamps = call.body.p_messages.map((item) => item.timestamp);
      assert.deepEqual(stamps, [...stamps].sort((left, right) => left - right));
    }
    assert.equal(harness.db.state.imported.filter((item) => item.chat === CHAT_A).length, 235);
    assert.equal(harness.db.state.runs[0].totals.conversations_created, 2);
    // The request id of a page is derived from run, chat, offsets and content: stable for a retry.
    assert.equal(new Set(calls.map((call) => call.body.p_request_id)).size, calls.length);
    // The messages carry only what the database keeps: no protobuf body, thumbnail or ack.
    for (const call of calls) {
      for (const item of call.body.p_messages) {
        assert.equal(item.ack, undefined);
        assert.equal(item._data?.Message?.extendedTextMessage, undefined);
        assert.equal(item._data?.Status, undefined);
        assert.equal(JSON.stringify(item).includes("TTTT"), false);
      }
    }
  });
});

test("the first page of a chat reaches its first customer message, or the chat is left out", async () => {
  const lead = [];
  for (let index = 0; index < 120; index += 1) {
    lead.push(row(message({ chat: CHAT_A, fromMe: true, ts: at(1) + index, body: `out ${index}`, id: `true_A_${index}` })));
  }
  lead.push(row(message({ chat: CHAT_A, ts: at(2), body: "finally the customer", id: "false_A_first" })));
  lead.push(row(message({ chat: CHAT_A, ts: at(3), body: "and more", id: "false_A_second" })));
  const tooDeep = [];
  for (let index = 0; index < 520; index += 1) {
    tooDeep.push(row(message({ chat: CHAT_B, fromMe: true, ts: at(4) + index, body: `out ${index}`, id: `true_B_${index}` })));
  }
  tooDeep.push(row(message({ chat: CHAT_B, ts: at(8), body: "late customer", id: "false_B_first" })));
  await withHarness({ rows: [...lead, ...tooDeep] }, async (harness) => {
    const result = await harness.run(["apply", ...windowArgs, "--all-chats", "--page-size", "50"]);
    assert.equal(result.code, 0, result.stderr);
    const firstA = pageCalls(harness.db).find((call) => call.body.p_raw_chat_id === CHAT_A);
    assert.equal(firstA.body.p_messages.length, 121, "extended to include the first customer message");
    assert.equal(firstA.body.p_messages.at(-1).fromMe, false);
    assert.equal(harness.db.state.imported.filter((item) => item.chat === CHAT_A).length, 122);
    assert.equal(pageCalls(harness.db).some((call) => call.body.p_raw_chat_id === CHAT_B), false);
    assert.equal(result.json.totals.chats_first_inbound_unreachable, 1);
  });
});

test("after a first page the database skipped as outbound-only, the rest of the chat is not sent and the cursor moves past it", async () => {
  // The first customer message is empty (no text, no media): the database does not count it, so page 1 is outbound-only.
  const rows = [
    row(message({ chat: CHAT_A, fromMe: true, ts: at(1), body: "out one", id: "true_A_1" })),
    row(message({ chat: CHAT_A, fromMe: true, ts: at(2), body: "out two", id: "true_A_2" })),
    row(message({ chat: CHAT_A, ts: at(3), body: "", id: "false_A_empty" })),
    row(message({ chat: CHAT_A, ts: at(4), body: "real customer text", id: "false_A_real" })),
    row(message({ chat: CHAT_B, ts: at(10), body: "other chat", id: "false_B_1" })),
  ];
  await withHarness({ rows }, async (harness) => {
    const result = await harness.run(["apply", ...windowArgs, "--all-chats", "--page-size", "2"]);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.json.totals.chats_stopped_early, 1);
    assert.equal(harness.db.state.imported.some((item) => item.chat === CHAT_A), false, "no half-imported chat");
    const forA = pageCalls(harness.db).filter((call) => call.body.p_raw_chat_id === CHAT_A);
    assert.equal(forA.length, 2);
    assert.equal(forA[1].body.p_messages.length, 0, "an empty page only advances the durable cursor");
    assert.equal(harness.db.state.imported.some((item) => item.chat === CHAT_B), true);
  });
});

test("--include-outbound-only and --lead-mode are run options; an outbound-only chat is imported when asked", async () => {
  await withHarness({}, async (harness) => {
    const result = await harness.run(["apply", ...windowArgs, "--all-chats", "--include-outbound-only", "--lead-mode", "none"]);
    assert.equal(result.code, 0, result.stderr);
    const begin = harness.db.calls.find((call) => call.name === RPC.begin).body;
    assert.equal(begin.p_options.include_outbound_only, true);
    assert.equal(begin.p_options.lead_mode, "none");
    assert.equal(harness.db.state.imported.filter((item) => item.chat === CHAT_C).length, 2);
  });
});

test("a second apply over the same window adds nothing (idempotent) and finishes cleanly", async () => {
  await withHarness({}, async (harness) => {
    const first = await harness.run(["apply", ...windowArgs, "--all-chats"]);
    assert.equal(first.code, 0, first.stderr);
    assert.equal(first.json.totals.projected, 12, "A 4, B 3, D 1 and the three @lid chats 2 + 1 + 1");
    assert.equal(harness.db.state.imported.length, 12);
    const second = await harness.run(["apply", ...windowArgs, "--all-chats"]);
    assert.equal(second.code, 0, second.stderr);
    assert.equal(second.json.totals.projected, 0);
    assert.equal(second.json.totals.already_bound, 12);
    assert.equal(second.json.totals.conversations_created, 0);
    assert.equal(harness.db.state.imported.length, 12);
    assert.deepEqual(harness.db.state.runs.map((run) => run.state), ["completed", "completed"]);
  });
});

// ---------------------------------------------------------------------------
// resume, retries
// ---------------------------------------------------------------------------

test("an interrupted run is paused and resumes from its durable cursor; an unfinished run needs --resume", async () => {
  await withHarness({}, async (harness) => {
    const controller = new AbortController();
    let pages = 0;
    const interrupting = async (url, init) => {
      const response = await fetch(url, init);
      if (String(url).endsWith(RPC.page) && ++pages === 2) controller.abort();
      return response;
    };
    const interrupted = await harness.run(["apply", ...windowArgs, "--all-chats"], {
      fetchImpl: interrupting,
      signal: controller.signal,
    });
    assert.equal(interrupted.code, 1);
    assert.equal(interrupted.error.error_code, "interrupted");
    const runId = interrupted.error.run_id;
    assert.match(runId, /^[0-9a-f-]{36}$/u);
    assert.equal(harness.db.state.runs[0].state, "paused");
    const imported = harness.db.state.imported.length;
    assert.ok(imported > 0 && imported < 13);

    // Without --resume the unfinished run is not silently continued.
    const refused = await harness.run(["apply", ...windowArgs, "--all-chats"]);
    assert.equal(refused.error.error_code, "unfinished_run_exists");
    assert.equal(refused.error.run_id, runId);
    assert.equal(harness.db.state.runs[0].state, "paused", "left as it was");

    const wrong = await harness.run(["apply", ...windowArgs, "--all-chats", "--resume", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"]);
    assert.equal(wrong.error.error_code, "resume_mismatch");
    const needsWindow = await harness.run(["apply", "--all-chats", "--resume", runId]);
    assert.equal(needsWindow.error.error_code, "window_to_required", "--resume requires an explicit --window-to");

    const before = pageCalls(harness.db).length;
    const resumed = await harness.run(["apply", ...windowArgs, "--all-chats", "--resume", runId]);
    assert.equal(resumed.code, 0, resumed.stderr);
    assert.equal(resumed.json.resumed, true);
    assert.equal(resumed.json.run_id, runId);
    assert.equal(resumed.json.state, "completed");
    const resumedCalls = pageCalls(harness.db).slice(before);
    assert.ok(resumedCalls.length > 0);
    // Chats before the durable cursor are not sent again.
    const first = harness.db.state.runs[0].pageLog;
    assert.ok(first.length >= before);
    const ids = harness.db.state.imported.map((item) => item.id);
    assert.equal(new Set(ids).size, ids.length);
  });
});

test("a transient database failure is retried with the same request id; a lost answer is replayed, never applied twice", async () => {
  await withHarness({}, async (harness) => {
    const { map } = await refsByName(harness);
    const only = harness.file("only.txt", `${map.get("Boris Test")}\n`);
    harness.db.state.pageFaults.push("unavailable", "lose");
    const sleeps = [];
    const result = await harness.run(["apply", ...windowArgs, "--only-chats-file", only], {
      sleep: async (ms) => sleeps.push(ms),
    });
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(sleeps.slice(0, 2), [500, 1500], "backed off before each retry");
    const calls = pageCalls(harness.db);
    assert.equal(calls.length, 3, "one 503, one lost answer, one replay");
    assert.equal(new Set(calls.map((call) => call.body.p_request_id)).size, 1, "every attempt used the same request id");
    assert.equal(harness.db.state.imported.filter((item) => item.chat === CHAT_B).length, 3, "applied exactly once");
    assert.equal(result.json.totals.projected, 3);
  });
  // A deterministic database refusal is not retried: the run is paused and reported with its SQLSTATE only.
  await withHarness({}, async (harness) => {
    harness.db.state.pageFaults.push("reject");
    const result = await harness.run(["apply", ...windowArgs, "--all-chats"]);
    assert.equal(result.code, 1);
    assert.equal(result.error.error_code, "rpc_rejected");
    assert.equal(result.error.sqlstate, "22023");
    assert.match(result.error.run_id, /^[0-9a-f-]{36}$/u);
    // The failing chat is named by its opaque reference (an HMAC, found in the preview file), never by its id.
    const failed = pageCalls(harness.db)[0].body.p_raw_chat_id;
    assert.equal(result.error.chat_ref, chatRef(SERVICE_CREDENTIAL, failed));
    assert.equal(result.stderr.includes(failed), false);
    assert.equal(pageCalls(harness.db).length, 1, "not retried");
    assert.equal(harness.db.state.runs[0].state, "paused", "the run is paused so it can be resumed");
    assert.equal(result.stderr.includes(harness.db.state.errorBodyLeak), false);
  });
});

// ---------------------------------------------------------------------------
// preflight refusals
// ---------------------------------------------------------------------------

test("refuses an unsupported engine, a session that is not WORKING, a missing or wrong binding and a rejected key", async () => {
  await withHarness({ session: defaultSession({ engine: { engine: "WEBJS" } }) }, async (harness) => {
    assert.equal((await harness.run(["apply", ...windowArgs, "--dry-run"])).error.error_code, "engine_unsupported");
    assert.equal(messagesRequests(harness.waha).length, 0);
  });
  await withHarness({ session: defaultSession({ status: "SCAN_QR_CODE" }) }, async (harness) => {
    assert.equal((await harness.run(["preview", ...windowArgs, "--out", harness.path("p.jsonl")])).error.error_code, "session_not_working");
  });
  await withHarness({ dbOptions: { bindingMissing: true } }, async (harness) => {
    const result = await harness.run(["apply", ...windowArgs, "--dry-run"]);
    assert.equal(result.error.error_code, "waha_binding_missing");
    assert.equal(harness.waha.requests.length, 0, "WAHA is not called without a key");
  });
  await withHarness({ dbOptions: { bindingBaseUrl: "http://evil.example:3000" } }, async (harness) => {
    const result = await harness.run(["apply", ...windowArgs, "--dry-run"]);
    assert.equal(result.error.error_code, "waha_binding_invalid");
    assert.equal(harness.waha.requests.length, 0);
  });
  await withHarness({}, async (harness) => {
    harness.waha.state.rejectKey = true;
    const result = await harness.run(["apply", ...windowArgs, "--dry-run"]);
    assert.equal(result.error.error_code, "waha_key_rejected");
    assert.equal(harness.db.calls.some((call) => call.name === RPC.preview), false);
  });
  // NOWEB's in-memory store cannot list every chat (chatId=all): refused, like WEBJS and WPP.
  await withHarness({ session: defaultSession({ engine: { engine: "NOWEB" } }) }, async (harness) => {
    assert.equal((await harness.run(["apply", ...windowArgs, "--dry-run"])).error.error_code, "engine_unsupported");
    assert.equal(messagesRequests(harness.waha).length, 0);
  });
});

// ---------------------------------------------------------------------------
// sync-status heuristic
// ---------------------------------------------------------------------------

function clockHarness(start = NOW.getTime()) {
  const clock = { t: start };
  return { clock, now: () => new Date(clock.t), sleep: async (ms) => { clock.t += ms; } };
}

test("sync-status is stable only after 10 minutes of WORKING and two identical counts at least 3 minutes apart", async () => {
  await withHarness({}, async (harness) => {
    const clocked = clockHarness();
    const workingSince = new Date(NOW.getTime() - 30 * 60_000).toISOString();
    const stable = await harness.run(
      ["sync-status", "--window-to", WINDOW_TO, "--working-since", workingSince, "--watch", "--interval-seconds", "180"],
      { now: clocked.now, sleep: clocked.sleep },
    );
    assert.equal(stable.code, 0, stable.stderr);
    assert.equal(stable.json.heuristic.stable, true);
    assert.equal(stable.json.heuristic.snapshots, 2);
    assert.equal(stable.json.heuristic.counts_identical, true);
    assert.equal(stable.json.heuristic.seconds_between_snapshots, 180);
    assert.deepEqual(stable.json.heuristic.reasons, []);
    assert.equal(stable.json.counts.direct_chats, 7);
  });
  await withHarness({}, async (harness) => {
    const clocked = clockHarness();
    const workingSince = new Date(NOW.getTime() - 5 * 60_000).toISOString();
    const young = await harness.run(
      ["sync-status", "--window-to", WINDOW_TO, "--working-since", workingSince, "--watch", "--interval-seconds", "180"],
      { now: clocked.now, sleep: clocked.sleep },
    );
    assert.equal(young.code, 3);
    assert.deepEqual(young.json.heuristic.reasons, ["working_under_10_minutes"]);
    const unknown = await harness.run(["sync-status", "--window-to", WINDOW_TO, "--watch", "--interval-seconds", "180"], {
      now: clockHarness().now,
      sleep: clockHarness().sleep,
    });
    assert.ok(unknown.json.heuristic.reasons.includes("working_since_unknown"));
    const single = await harness.run(["sync-status", "--window-to", WINDOW_TO]);
    assert.ok(single.json.heuristic.reasons.includes("no_second_snapshot"));
    const quick = clockHarness();
    const tooQuick = await harness.run(
      ["sync-status", "--window-to", WINDOW_TO, "--working-since", new Date(NOW.getTime() - 3_600_000).toISOString(), "--watch", "--interval-seconds", "30"],
      { now: quick.now, sleep: quick.sleep },
    );
    assert.deepEqual(tooQuick.json.heuristic.reasons, ["interval_under_3_minutes"]);
  });
  await withHarness({}, async (harness) => {
    const clocked = clockHarness();
    const growing = async (ms) => {
      clocked.clock.t += ms;
      harness.waha.state.rows.push(row(message({ chat: CHAT_A, ts: at(60), body: "late history", id: "false_A_late" })));
    };
    const result = await harness.run(
      ["sync-status", "--window-to", WINDOW_TO, "--working-since", new Date(NOW.getTime() - 3_600_000).toISOString(), "--watch", "--interval-seconds", "180"],
      { now: clocked.now, sleep: growing },
    );
    assert.equal(result.code, 3);
    assert.deepEqual(result.json.heuristic.reasons, ["counts_changed"]);
    assert.equal(result.json.heuristic.counts_identical, false);
  });
});

// ---------------------------------------------------------------------------
// Safety: no forbidden WAHA call, no secrets or personal data in any output
// ---------------------------------------------------------------------------

test("WAHA is only read: GET on three allow-listed paths, never downloadMedia=true, read, seen or send", async () => {
  await withHarness({}, async (harness) => {
    const { map } = await refsByName(harness);
    await harness.run(["apply", ...windowArgs, "--exclude-chats-file", harness.file("none.txt", `${map.get("Dana Test")}\n`), "--max-chats", "2"]);
    await harness.run(["apply", ...windowArgs, "--exclude-chats-file", harness.file("none.txt", `${map.get("Dana Test")}\n`)]);
    await harness.run(["sync-status", ...windowArgs]);
    assert.ok(harness.waha.requests.length > 10);
    for (const request of harness.waha.requests) {
      assert.equal(request.method, "GET");
      assert.ok(isAllowedWahaPath(request.path), `unexpected WAHA path ${request.path}`);
      assert.notEqual(request.query.downloadMedia, "true");
      assert.doesNotMatch(request.path, /read|seen|send|logout|restart|stop|start|media|pin|delete|typing|presence/iu);
      assert.equal(request.key, WAHA_KEY, "the key travels as the X-Api-Key header, never in the URL");
      assert.equal(JSON.stringify(request.query).includes(WAHA_KEY), false);
    }
    for (const request of harness.waha.requests.filter((candidate) => candidate.path.endsWith("/messages"))) {
      assert.equal(request.query.downloadMedia, "false");
    }
  });
  for (const forbidden of [
    "/api/crm_primary/chats/15550000101@c.us/messages/read",
    "/api/crm_primary/chats/15550000101@c.us/messages",
    "/api/sendText",
    "/api/crm_primary/sessions/logout",
    "/api/sessions/crm_primary/logout",
    "/api/sessions/crm_primary/restart",
    "/api/crm_primary/lids",
    "/api/crm_primary/lids/15550000101@c.us",
    "/api/crm_primary/chats/all/messages/x",
    "/api/other/chats/all/messages",
    "/api/sessions/other",
  ]) {
    assert.equal(isAllowedWahaPath(forbidden), false, forbidden);
  }
  for (const allowed of [
    "/api/sessions/crm_primary",
    "/api/crm_primary/chats/all/messages",
    "/api/crm_primary/lids/900000000000101@lid",
  ]) {
    assert.equal(isAllowedWahaPath(allowed), true, allowed);
  }
});

test("no output carries a key, a chat id, a number, a push name, a message text or a database error detail", async () => {
  await withHarness({}, async (harness) => {
    const { map, out } = await refsByName(harness);
    const pilot = harness.file("pilot.txt", `${map.get("Aigul Test")}\n`);
    await harness.run(["apply", ...windowArgs, "--only-chats-file", pilot]);
    await harness.run(["apply", ...windowArgs, "--all-chats"]);
    await harness.run(["apply", ...windowArgs, "--dry-run"]);
    await harness.run(["sync-status", ...windowArgs]);
    await harness.run(["apply", ...windowArgs, "--all-chats"], { environment: { ...harness.environment, NEXT_PUBLIC_SUPABASE_URL: "https://example.com" } });
    await harness.run(["--bogus-flag", WAHA_KEY]);
    await harness.run(["apply", ...windowArgs, "--all-chats", WAHA_KEY]);
    harness.db.state.pageFaults.length = 0;
    const text = harness.outputs.join("\n");
    assert.ok(text.length > 100);
    const forbidden = [
      WAHA_KEY,
      SERVICE_CREDENTIAL,
      "15550000101",
      "15550000102",
      "15550000104",
      "900000000000101",
      "15550000000",
      "Aigul",
      "Boris",
      "Dana",
      "Lida",
      "Operator Name",
      ...Object.values(BODY),
      "B-body-one",
      "LID1-in",
      harness.db.state.errorBodyLeak,
      harness.directory,
      out,
    ];
    for (const secret of forbidden) {
      assert.equal(text.includes(secret), false, `an output leaks ${JSON.stringify(secret)}`);
    }
    // Chat refs appear only in the 0600 preview file.
    for (const ref of map.values()) assert.equal(text.includes(ref), false);
  });
});

test("database failures surface as closed codes with at most a SQLSTATE", async () => {
  await withHarness({}, async (harness) => {
    const unauthorized = await harness.run(["apply", ...windowArgs, "--dry-run"], {
      environment: { ...harness.environment, EVO_PLATFORM_SUPABASE_SECRET_KEY: "sb_secret_wrongwrongwrongwrongwrongwrong0123" },
    });
    assert.equal(unauthorized.error.error_code, "rpc_unauthorized");
    // Options without the own account are refused by the database (22023): the CLI always sends it.
    harness.waha.state.session = defaultSession({ me: { id: "not-a-jid", lid: "x" } });
    const noValidMe = await harness.run(["apply", ...windowArgs, "--dry-run"]);
    assert.equal(noValidMe.error.error_code, "session_me_missing");
  });
});

test("argument errors are usage errors and never echo the argument", async () => {
  const result = await runCli({
    argv: ["apply", "--all-chats", "synthetic-waha-api-key-0123456789abcdef"],
    environment: {},
    stdout: { write() {} },
    stderr: { write() {} },
  });
  assert.equal(result, 2);
  const help = [];
  assert.equal(await runCli({ argv: ["--help"], environment: {}, stdout: { write: (text) => help.push(text) }, stderr: { write() {} } }), 0);
  assert.match(help.join(""), /Read-only against WAHA/u);
  for (const argv of [
    ["bogus"],
    [],
    ["preview"],
    ["apply", "--days", "0", "--all-chats"],
    ["apply", "--days", "7x", "--all-chats"],
    ["apply", "--page-size", "501", "--all-chats"],
    ["apply", "--lead-mode", "all", "--all-chats"],
    ["sync-status", "--all-chats"],
    ["preview", "--out"],
  ]) {
    const errors = [];
    const code = await runCli({ argv, environment: {}, stdout: { write() {} }, stderr: { write: (text) => errors.push(text) } });
    assert.equal(code, 2, JSON.stringify(argv));
    assert.deepEqual(JSON.parse(errors.join("")), { ok: false, error_code: "usage" });
  }
  const noEnvironment = [];
  const code = await runCli({ argv: ["apply", "--dry-run"], environment: {}, stdout: { write() {} }, stderr: { write: (text) => noEnvironment.push(text) } });
  assert.equal(code, 1);
  assert.deepEqual(JSON.parse(noEnvironment.join("")), { ok: false, error_code: "invalid_environment" });
});

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

test("slimMessage keeps exactly the fields the database keeps", () => {
  const raw = message({
    chat: CHAT_A,
    ts: at(1),
    body: "caption",
    id: "false_A_x",
    extra: {
      hasMedia: true,
      media: { url: "http://x/y", mimetype: "audio/ogg", filename: "n.ogg" },
      replyTo: { id: "q", body: "quoted secret" },
      location: { lat: 1 },
      vCards: ["card"],
    },
  });
  raw._data.Message = {
    audioMessage: { PTT: true, URL: "https://x", mediaKey: "k" },
    videoMessage: { gifPlayback: true },
    imageMessage: { JPEGThumbnail: "A".repeat(5000), caption: "c" },
    documentMessage: { fileName: "d.pdf" },
    stickerMessage: {},
    ptvMessage: {},
    conversation: "protobuf copy",
  };
  const slim = slimMessage(raw);
  assert.equal(slim.ack, undefined);
  assert.equal(slim.replyTo, undefined);
  assert.equal(slim.location, undefined);
  assert.equal(slim.body, "caption");
  assert.deepEqual(slim.media, { mimetype: "audio/ogg", filename: "n.ogg" });
  assert.deepEqual(slim._data.Message, {
    stickerMessage: {},
    documentMessage: {},
    audioMessage: { PTT: true },
    imageMessage: {},
    videoMessage: { gifPlayback: true },
    ptvMessage: {},
  });
  assert.equal(slim._data.Info.PushName, "Customer Name");
  assert.equal(slim.to, undefined, "a null `to` is dropped");
  assert.ok(Buffer.byteLength(JSON.stringify(slim)) < Buffer.byteLength(JSON.stringify(raw)) / 2);
  // Media with downloadMedia=false: null (2026.7.x) or an object with null url.
  const none = slimMessage(message({ chat: CHAT_A, ts: at(1), extra: { hasMedia: true, media: null } }));
  assert.equal(none.hasMedia, true);
  assert.equal(none.media, undefined);
});

test("buildPages splits by count and bytes, extends the first page to the first customer message and drops an oversized message", () => {
  const messages = Array.from({ length: 25 }, (_, index) => ({ id: `m${index}`, timestamp: index, fromMe: index !== 12, body: "x" }));
  const plain = buildPages(messages, 0, { pageSize: 10, maxMessages: 500, maxBytes: 1_000_000, firstPageMinimum: 0 });
  assert.deepEqual(plain.pages.map((page) => [page.startOffset, page.endOffset, page.messages.length]), [[0, 10, 10], [10, 20, 10], [20, 25, 5]]);
  const extended = buildPages(messages, 0, { pageSize: 10, maxMessages: 500, maxBytes: 1_000_000, firstPageMinimum: 13 });
  assert.deepEqual(extended.pages.map((page) => page.messages.length), [13, 10, 2]);
  const capped = buildPages(messages, 0, { pageSize: 10, maxMessages: 12, maxBytes: 1_000_000, firstPageMinimum: 20 });
  assert.equal(capped.pages[0].messages.length, 12);
  const resumed = buildPages(messages, 20, { pageSize: 10, maxMessages: 500, maxBytes: 1_000_000, firstPageMinimum: 99 });
  assert.deepEqual(resumed.pages.map((page) => [page.startOffset, page.endOffset]), [[20, 25]], "a resumed chat is never re-extended");
  const big = [...messages.slice(0, 3), { id: "big", timestamp: 3, fromMe: true, body: "y".repeat(5000) }, ...messages.slice(4, 6)];
  const bytes = buildPages(big, 0, { pageSize: 10, maxMessages: 500, maxBytes: 1_000, firstPageMinimum: 0 });
  assert.equal(bytes.dropped, 1);
  assert.equal(bytes.pages.flatMap((page) => page.messages).some((item) => item.id === "big"), false);
  assert.equal(bytes.pages.at(-1).endOffset, big.length);
});

test("the CLI ships in the runner image next to the other operator scripts", () => {
  const dockerfile = readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");
  assert.match(
    dockerfile,
    /COPY --from=builder --chown=nextjs:nodejs --chmod=0555 \/app\/scripts\/waha-history-import\.mjs \.\/scripts\/waha-history-import\.mjs/u,
  );
  const source = readFileSync(SCRIPT_URL, "utf8");
  const imports = [...source.matchAll(/^import .* from "([^"]+)";$/gmu)].map((match) => match[1]);
  assert.ok(imports.length > 0);
  for (const specifier of imports) assert.match(specifier, /^node:/u, "only node: built-ins");
});
