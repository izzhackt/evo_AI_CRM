// Synthetic WAHA 2026.9.2 GOWS REST history and a loopback mock of the WAHA REST
// API, shared by tests/waha-history-import.test.mjs and the real-chain driver
// scripts/test-waha-history-import-chain.mjs. Everything is synthetic: numbers,
// names and texts are made up, and the server only answers GET.
import { createServer } from "node:http";

export const WAHA_KEY = "synthetic-waha-api-key-0123456789abcdef";
export const DAY = 86_400;
export const ME = Object.freeze({
  id: "15550000000@c.us",
  lid: "900000000000001@lid",
  jid: "15550000000:12@s.whatsapp.net",
});

// ---------------------------------------------------------------------------
// Synthetic WAHA data (GOWS shape: from = the chat in both directions, to = null)
// ---------------------------------------------------------------------------

let sequence = 0;
export function message({ chat, fromMe = false, ts, body = "hello", source = "app", id, name, extra = {} }) {
  sequence += 1;
  return {
    id: id ?? `${fromMe}_${chat}_ID${sequence}`,
    timestamp: ts,
    from: chat,
    fromMe,
    source,
    body,
    to: null,
    participant: null,
    hasMedia: false,
    media: null,
    ack: 3,
    ackName: "READ",
    replyTo: null,
    _data: {
      Info: {
        Chat: chat,
        Sender: fromMe ? ME.jid : chat,
        IsFromMe: fromMe,
        IsGroup: false,
        PushName: fromMe ? "Operator Name" : (name ?? "Customer Name"),
      },
      Message: {
        conversation: body,
        extendedTextMessage: { text: body, JPEGThumbnail: "T".repeat(400) },
      },
      Status: 3,
    },
    ...extra,
  };
}

export const row = (value) => ({ message: value, filtered: false });
export const filteredRow = (ts) => ({ message: { id: `reaction_${ts}`, timestamp: ts }, filtered: true });
export const makeAt = (nowSeconds) => (hours) => nowSeconds - 6 * DAY + hours * 3600;

export const CHAT_A = "15550000101@c.us";
export const CHAT_B = "15550000102@c.us";
export const CHAT_C = "15550000103@c.us";
export const CHAT_D = "15550000105@c.us";
export const LID_1 = "900000000000101@lid";
export const LID_2 = "900000000000102@lid";
export const LID_3 = "900000000000103@lid";
export const PHONE_OF_LID_1 = "15550000104@c.us";

export const BODY = Object.freeze({
  aOut1: "A-secret-body-out-one",
  aIn1: "A-secret-body-in-one",
  aOut2: "A-secret-body-out-two",
  aIn2: "A-secret-body-in-two",
});

export function makeBaseRows(nowSeconds) {
  const at = makeAt(nowSeconds);
  return [
    // A: outbound first, then the customer, with a CRM API send in between.
    row(message({ chat: CHAT_A, fromMe: true, ts: at(1), body: BODY.aOut1, id: "true_A_1" })),
    row(message({ chat: CHAT_A, ts: at(2), body: BODY.aIn1, name: "Aigul Test", id: "false_A_2" })),
    row(message({ chat: CHAT_A, fromMe: true, ts: at(3), body: "crm api text", source: "api", id: "true_A_api" })),
    row(message({ chat: CHAT_A, fromMe: true, ts: at(4), body: BODY.aOut2, id: "true_A_3" })),
    row(message({ chat: CHAT_A, ts: at(5), body: BODY.aIn2, name: "Aigul Test", id: "false_A_4" })),
    // B: customer messages and a media message (downloadMedia=false shape).
    row(message({ chat: CHAT_B, ts: at(10), body: "B-body-one", name: "Boris Test", id: "false_B_1" })),
    row(message({ chat: CHAT_B, ts: at(11), body: "B-body-two", name: "Boris Test", id: "false_B_2" })),
    row(message({
      chat: CHAT_B,
      ts: at(12),
      body: "",
      name: "Boris Test",
      id: "false_B_3",
      extra: {
        hasMedia: true,
        media: { url: null, mimetype: "image/jpeg", filename: null },
      },
    })),
    // C: outbound only.
    row(message({ chat: CHAT_C, fromMe: true, ts: at(20), body: "C-out-one", id: "true_C_1" })),
    row(message({ chat: CHAT_C, fromMe: true, ts: at(21), body: "C-out-two", id: "true_C_2" })),
    // D: one customer message.
    row(message({ chat: CHAT_D, ts: at(30), body: "D-body", name: "Dana Test", id: "false_D_1" })),
    // @lid chats.
    row(message({ chat: LID_1, ts: at(40), body: "LID1-in", name: "Lida Test", id: "false_L1_1" })),
    row(message({ chat: LID_1, fromMe: true, ts: at(41), body: "LID1-out", id: "true_L1_2" })),
    row(message({ chat: LID_2, ts: at(42), body: "LID2-in", name: "Lev Test", id: "false_L2_1" })),
    row(message({ chat: LID_3, ts: at(43), body: "LID3-in", name: "Lana Test", id: "false_L3_1" })),
    // Not direct chats, and the own chat.
    row(message({
      chat: "120363000000000001@g.us",
      ts: at(50),
      body: "group-body",
      id: "false_G_1",
      extra: { participant: "15550000199@c.us" },
    })),
    row(message({ chat: "status@broadcast", ts: at(51), body: "status-body", id: "false_S_1" })),
    row(message({ chat: "120363000000000002@newsletter", ts: at(52), body: "channel-body", id: "false_N_1" })),
    row(message({ chat: ME.id, fromMe: true, ts: at(53), body: "note-to-self", id: "true_SELF_1" })),
  ];
}

export function defaultSession(overrides = {}) {
  return {
    name: "crm_primary",
    status: "WORKING",
    engine: { engine: "GOWS" },
    me: { id: ME.id, lid: ME.lid, jid: ME.jid, pushName: "Operator Name" },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock WAHA (GET only; applies the window, the sort and LIMIT/OFFSET before the
// engine-side filter that drops reactions, exactly as GOWS does)
// ---------------------------------------------------------------------------

export async function listen(handler) {
  const server = createServer(handler);
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  return {
    server,
    origin: `http://127.0.0.1:${server.address().port}`,
    close: () =>
      new Promise((done) => {
        server.closeAllConnections?.();
        server.close(() => done());
      }),
  };
}

// A small seeded generator (mulberry32) so a tie-shuffling server is reproducible.
function makeRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Options: `shuffleTies` (a seed) puts rows with EQUAL timestamps in a new random
 * order on EVERY request, exactly the instability of a store that sorts by the
 * whole-second timestamp only; rows marked `filtered` are dropped AFTER the
 * LIMIT/OFFSET, as the GOWS engine drops reactions/protocol rows; `ignoreFilter`
 * answers without applying the window; `duplicateInResponse` repeats the first
 * row of a response (always, or the given number of times).
 */
export async function startMockWaha({
  rows = [],
  lids = {},
  session = defaultSession(),
  ignoreFilter = false,
  shuffleTies = null,
  duplicateInResponse = 0,
} = {}) {
  const state = {
    rows,
    lids,
    session,
    requests: [],
    ignoreFilter,
    rejectKey: false,
    duplicateInResponse,
    random: shuffleTies === null ? null : makeRandom(shuffleTies),
  };
  const listener = await listen((request, response) => {
    const url = new URL(request.url, "http://mock");
    const record = {
      method: request.method,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      key: request.headers["x-api-key"],
    };
    state.requests.push(record);
    const json = (status, body) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(body));
    };
    if (request.method !== "GET") return json(405, { error: "read only" });
    if (state.rejectKey || request.headers["x-api-key"] !== WAHA_KEY) return json(401, { error: "key" });
    if (url.pathname === "/api/sessions/crm_primary") return json(200, state.session);
    const lidMatch = /^\/api\/crm_primary\/lids\/([0-9]+@lid)$/.exec(url.pathname);
    if (lidMatch) {
      const entry = state.lids[lidMatch[1]];
      if (entry === undefined) return json(404, { error: "unknown lid" });
      return json(200, { lid: lidMatch[1], pn: entry });
    }
    if (url.pathname === "/api/crm_primary/chats/all/messages") {
      const query = record.query;
      if (query.downloadMedia !== "false") return json(400, { error: "downloadMedia must be false" });
      const limit = query.limit === undefined ? 10 : Number(query.limit);
      const offset = Number(query.offset ?? 0);
      // WAHA's DTO has no upper bound for limit (src/structures/chats.dto.ts:102-123).
      if (!(limit >= 1 && limit <= 100_000) || !(offset >= 0)) return json(400, { error: "paging" });
      const gte = Number(query["filter.timestamp.gte"]);
      const lte = Number(query["filter.timestamp.lte"]);
      let list = state.rows.filter(
        (entry) =>
          state.ignoreFilter ||
          (entry.message.timestamp >= gte && entry.message.timestamp <= lte),
      );
      const direction = query.sortOrder === "desc" ? -1 : 1;
      list = list
        .map((entry, position) => ({ entry, position }))
        .sort((left, right) =>
          direction * (left.entry.message.timestamp - right.entry.message.timestamp) || left.position - right.position)
        .map(({ entry }) => entry);
      if (state.random) {
        // Equal timestamps change places between requests.
        for (let start = 0; start < list.length; ) {
          let end = start + 1;
          while (end < list.length && list[end].message.timestamp === list[start].message.timestamp) end += 1;
          for (let k = end - 1; k > start; k -= 1) {
            const swap = start + Math.floor(state.random() * (k - start + 1));
            [list[k], list[swap]] = [list[swap], list[k]];
          }
          start = end;
        }
      }
      const page = list.slice(offset, offset + limit).filter((entry) => !entry.filtered);
      const body = page.map((entry) => entry.message);
      if (state.duplicateInResponse && body.length > 0) {
        if (state.duplicateInResponse !== true) state.duplicateInResponse -= 1;
        body.push(body[0]);
      }
      return json(200, body);
    }
    return json(404, { error: "not found" });
  });
  return { ...listener, state, requests: state.requests };
}
