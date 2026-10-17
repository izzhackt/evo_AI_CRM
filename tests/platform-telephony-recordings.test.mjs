// «Телефония Beeline KG», срез T6 (docs/EVO_TELEPHONY_PLAN_2026-10-16.md §7, §11, §12;
// миграция 297): потоковый прокси записей и плеер в «Ленте» лида. Проверки без сети и
// без базы: ссылка и адрес источника, диапазоны, ответ источника (заголовки, тип, предел,
// таймауты, отмена, поток без буферизации), обработчик маршрута с поддельной базой и
// поддельным источником (порядок отказов, коды базы в HTTP, ссылка не уходит наружу, журнал
// приложения без ссылки), строгий шаблон пути, контракт записей звонков, слова и настоящая
// страница лида статическим рендером (tests/e2e/numbers-static-render.cjs --json-telephony).
// Данные синтетические: ни настоящей ссылки, ни настоящего номера, ни настоящего хоста.
// Что решает база (флаг, право «все»/«свои», состояние, лимиты, срок 360 дней):
// supabase/tests/platform_telephony_recordings.sql.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { leadCallRow } from "../src/components/v3/profile/lead-work-view.ts";
import { isConnectedPlatformApi } from "../src/lib/platform-route-contract.ts";
import {
  RECORDING_MAX_BYTES,
  fetchRecording,
  isPublicAddress,
  parseRecordingLink,
  parseSingleRange,
  sliceFor,
} from "../src/lib/server/platform-telephony-recording-stream.ts";
import {
  createTelephonyRecordingHandler,
  recordingAuthorization,
  recordingConsumeReceipt,
  recordingGrantReceipt,
  recordingRefusal,
  recordingReportReceipt,
  telephonyRecordingMethodNotAllowed,
} from "../src/lib/server/telephony-recording-route-handlers.ts";
import {
  TelephonyShapeError,
  callRecordingItems,
  leadCallsState,
  leadRecordingsState,
  normalizeLeadRecordingsRead,
} from "../src/lib/v3/telephony-lead-calls.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const text = (html) => html.replace(/<[^>]+>/gu, " ").replace(/\s+/gu, " ").trim();
const solidRed = (html) => html.match(/(?<![\w:-])bg-accent(?![\w-])/gu)?.length ?? 0;
const ID = (n) => `29700000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const LEG = ID(8011);
const GRANT = ID(9001);
const HOST = "tenant.ats.beeline.kg";
const LINK = `https://${HOST}/records/2031/01/05/call-7f3a9c.mp3`;
const PUBLIC_ADDRESS = [{ address: "93.184.216.34", family: 4 }];
const BYTES = (n, fill = 7) => new Uint8Array(n).fill(fill);

/** Ответ источника: тело кусками, заголовки как у записи. */
function source(chunks, init = {}) {
  const body = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  return new Response(body, {
    status: init.status ?? 200,
    headers: { "content-type": "audio/mpeg", ...(init.headers ?? {}) },
  });
}
async function drain(response) {
  const reader = response.body.getReader();
  const parts = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
  }
  return Buffer.concat(parts);
}
const URL_OK = new URL(LINK);
const fetchWith = (handler, extra = {}) => ({ fetch: handler, resolveHost: async () => PUBLIC_ADDRESS, ...extra });

// ------------------------------------------------------------ the link

test("link: only the canonical https link of the tenant host with a safe .mp3 path is accepted", () => {
  assert.equal(parseRecordingLink(LINK, HOST)?.href, LINK);
  assert.ok(parseRecordingLink(`https://${HOST}/a.mp3`, HOST));
  assert.ok(parseRecordingLink(`https://${HOST}/a/b/c/d/e/f/g/h.MP3`, HOST), "up to eight segments, the extension without case");
  for (const bad of [
    `http://${HOST}/a.mp3`,
    `https://other.ats.beeline.kg/a.mp3`,
    `https://${HOST}.evil.example/a.mp3`,
    `https://evil.example/${HOST}/a.mp3`,
    `https://user:pass@${HOST}/a.mp3`,
    `https://${HOST}:8443/a.mp3`,
    `https://${HOST}:443/a.mp3`,
    `https://${HOST}/a.mp3?token=1`,
    `https://${HOST}/a.mp3?`,
    `https://${HOST}/a.mp3#t=1`,
    `https://${HOST.toUpperCase()}/a.mp3`,
    `https://${HOST}/a%2Fb.mp3`,
    `https://${HOST}/%2e%2e/a.mp3`,
    `https://${HOST}/../a.mp3`,
    `https://${HOST}/./a.mp3`,
    `https://${HOST}/a/../b.mp3`,
    `https://${HOST}//a.mp3`,
    `https://${HOST}/a//b.mp3`,
    `https://${HOST}/.hidden.mp3`,
    `https://${HOST}/a.mp3/`,
    `https://${HOST}/a.wav`,
    `https://${HOST}/a`,
    `https://${HOST}/`,
    `https://${HOST}`,
    `https://${HOST}/a b.mp3`,
    `https://${HOST}/a\\b.mp3`,
    `https://${HOST}/a\u0000.mp3`,
    `https://${HOST}/${"a/".repeat(9)}b.mp3`,
    `https://${HOST}/${"a".repeat(1100)}.mp3`,
    ` ${LINK}`,
    `${LINK} `,
    "not a link",
    "",
  ]) {
    assert.equal(parseRecordingLink(bad, HOST), null, JSON.stringify(bad));
  }
  for (const bad of [null, undefined, 7, {}, [], true]) assert.equal(parseRecordingLink(bad, HOST), null);
  // An address literal is never a tenant host, even when the configuration says so.
  assert.equal(parseRecordingLink("https://93.184.216.34/a.mp3", "93.184.216.34"), null);
  assert.equal(parseRecordingLink("https://[2606:4700::1111]/a.mp3", "[2606:4700::1111]"), null);
  assert.equal(parseRecordingLink("https://10.0.0.1/a.mp3", "10.0.0.1"), null);
  assert.equal(parseRecordingLink(`https://${HOST}/a.mp3`, "other.ats.beeline.kg"), null, "the host must equal the configured one exactly");
});

test("address: public addresses pass; private, loopback, link-local, shared, multicast and reserved ones do not", () => {
  for (const ok of ["93.184.216.34", "8.8.8.8", "1.1.1.1", "2606:4700:4700::1111", "2001:4860:4860::8888"]) {
    assert.equal(isPublicAddress(ok), true, ok);
  }
  for (const bad of [
    "0.0.0.0", "10.0.0.1", "10.255.255.255", "100.64.0.1", "127.0.0.1", "127.255.255.254", "169.254.169.254", "172.16.0.1",
    "172.31.255.255", "192.0.0.1", "192.0.2.1", "192.168.1.1", "198.18.0.1", "198.51.100.1", "203.0.113.1", "224.0.0.1",
    "239.255.255.255", "240.0.0.1", "255.255.255.255",
    "::", "::1", "fc00::1", "fd12:3456::1", "fe80::1", "febf::1", "ff02::1", "2001:db8::1", "2002:7f00:1::1", "64:ff9b::7f00:1",
    "::ffff:10.0.0.1", "::ffff:127.0.0.1", "::ffff:169.254.169.254", "::ffff:192.168.0.1",
    "", "localhost", "not-an-ip", "999.1.1.1", "1.2.3", "[::1]",
  ]) {
    assert.equal(isPublicAddress(bad), false, bad);
  }
  assert.equal(isPublicAddress("172.15.255.255"), true, "just below 172.16/12");
  assert.equal(isPublicAddress("172.32.0.1"), true, "just above 172.16/12");
});

// ------------------------------------------------------------ Range

test("range: a single bytes range is passed on in canonical form; everything else is ignored", () => {
  assert.deepEqual({ ...parseSingleRange("bytes=0-") }, { header: "bytes=0-", start: 0, end: null, suffix: null });
  assert.deepEqual({ ...parseSingleRange("bytes=100-199") }, { header: "bytes=100-199", start: 100, end: 199, suffix: null });
  assert.deepEqual({ ...parseSingleRange("bytes=-500") }, { header: "bytes=-500", start: null, end: null, suffix: 500 });
  assert.deepEqual({ ...parseSingleRange("  bytes=007-0010 ") }, { header: "bytes=7-10", start: 7, end: 10, suffix: null }, "re-written from numbers, not echoed");
  assert.equal(parseSingleRange("bytes=5-5")?.header, "bytes=5-5");
  for (const bad of [
    null, "", "bytes=", "bytes=-", "bytes=-0", "bytes=5-2", "bytes=0-1,5-6", "bytes=0-1, 5-6", "items=0-1", "bytes 0-1", "bytes=a-b",
    "bytes=0-1\r\nX-Evil: 1", "bytes=1234567890123456-", "bytes=--5", "bytes=1--5", "BYTES=0-1x", "bytes=0-1 ",
  ]) {
    if (bad === "bytes=0-1 ") assert.equal(parseSingleRange(bad)?.header, "bytes=0-1", "trailing space is trimmed");
    else assert.equal(parseSingleRange(bad), null, JSON.stringify(bad));
  }
});

test("range: the slice of a whole recording, suffix, open end, overshoot and out of bounds", () => {
  const slice = (header, total) => sliceFor(parseSingleRange(header), total);
  assert.deepEqual(slice("bytes=0-", 10), { start: 0, end: 9 });
  assert.deepEqual(slice("bytes=2-4", 10), { start: 2, end: 4 });
  assert.deepEqual(slice("bytes=8-99", 10), { start: 8, end: 9 });
  assert.deepEqual(slice("bytes=-3", 10), { start: 7, end: 9 });
  assert.deepEqual(slice("bytes=-30", 10), { start: 0, end: 9 });
  assert.equal(slice("bytes=10-", 10), "unsatisfiable");
  assert.equal(slice("bytes=0-", 0), "unsatisfiable");
  assert.equal(slice("bytes=-1", 0), "unsatisfiable");
});

// ------------------------------------------------------------ the request to the source

test("source request: GET without cookie or employee headers, no redirects, no cache, only the range goes on", async () => {
  const seen = [];
  const outcome = await fetchRecording(URL_OK, parseSingleRange("bytes=10-"), new AbortController().signal, fetchWith(async (url, init) => {
    seen.push({ url, init });
    return source([BYTES(5)], { status: 206, headers: { "content-range": "bytes 10-14/100", "content-length": "5" } });
  }));
  assert.equal(outcome.kind, "stream");
  assert.equal(seen.length, 1, "exactly one request");
  const { url, init } = seen[0];
  assert.equal(url, LINK);
  assert.equal(init.method, "GET");
  assert.equal(init.redirect, "manual");
  assert.equal(init.cache, "no-store");
  assert.equal(init.credentials, "omit");
  assert.ok(init.signal instanceof AbortSignal);
  assert.deepEqual(Object.fromEntries(Object.entries(init.headers).map(([name, value]) => [name.toLowerCase(), value])),
    { accept: "audio/mpeg, */*;q=0.1", "accept-encoding": "identity", range: "bytes=10-" });
  assert.equal(init.body, undefined);
  await outcome.response.body.cancel();
  // No range asked: no Range header at all.
  let headers;
  await fetchRecording(URL_OK, null, new AbortController().signal, fetchWith(async (_url, init) => {
    headers = init.headers;
    return source([BYTES(1)]);
  })).then((result) => result.response?.body?.cancel());
  assert.equal("Range" in headers || "range" in headers, false);
});

test("source response: only the whitelisted headers reach the browser; the body is passed through", async () => {
  const outcome = await fetchRecording(URL_OK, null, new AbortController().signal, fetchWith(async () => source([BYTES(3, 1), BYTES(2, 2)], {
    headers: {
      "content-length": "5", "set-cookie": "sid=secret; Path=/", server: "tenant-pbx/1.0", etag: '"abc"', "last-modified": "Mon, 05 Jan 2031 08:00:00 GMT",
      "content-disposition": 'attachment; filename="call.mp3"', "x-powered-by": "pbx", "access-control-allow-origin": "*", location: "https://evil.example/",
      "cache-control": "public, max-age=31536000", "content-type": "audio/mpeg; charset=binary", "accept-ranges": "none", vary: "Origin",
    },
  })));
  assert.equal(outcome.kind, "stream");
  const { response } = outcome;
  assert.equal(response.status, 200);
  const names = [...response.headers.keys()].sort();
  assert.deepEqual(names, ["accept-ranges", "cache-control", "content-disposition", "content-length", "content-type",
    "referrer-policy", "x-content-type-options"]);
  assert.equal(response.headers.get("content-type"), "audio/mpeg");
  assert.equal(response.headers.get("accept-ranges"), "bytes");
  assert.equal(response.headers.get("cache-control"), "private, no-store, no-transform");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(response.headers.get("content-disposition"), "inline");
  assert.equal(response.headers.get("content-length"), "5");
  assert.deepEqual([...await drain(response)], [1, 1, 1, 2, 2]);
});

test("source response: a partial answer to a range request keeps its Content-Range and length; a dishonest one is refused", async () => {
  const run = (status, headers, range = "bytes=10-14") => fetchRecording(URL_OK, parseSingleRange(range), new AbortController().signal,
    fetchWith(async () => source([BYTES(5)], { status, headers })));
  const good = await run(206, { "content-range": "bytes 10-14/100", "content-length": "5" });
  assert.equal(good.kind, "stream");
  assert.equal(good.response.status, 206);
  assert.equal(good.response.headers.get("content-range"), "bytes 10-14/100");
  assert.equal(good.response.headers.get("content-length"), "5");
  assert.equal((await drain(good.response)).length, 5);
  const unknownTotal = await run(206, { "content-range": "bytes 10-14/*" });
  assert.equal(unknownTotal.kind, "stream");
  assert.equal(unknownTotal.response.headers.get("content-range"), "bytes 10-14/*");
  assert.equal(unknownTotal.response.headers.get("content-length"), "5", "length is derived from the range, not trusted blind");
  await unknownTotal.response.body.cancel();
  for (const [headers, why] of [
    [{ "content-length": "5" }, "no Content-Range"],
    [{ "content-range": "bytes 10-14/100", "content-length": "9" }, "length disagrees with the range"],
    [{ "content-range": "bytes 14-10/100" }, "inverted range"],
    [{ "content-range": "bytes 10-100/100" }, "range beyond the total"],
    [{ "content-range": "items 10-14/100" }, "wrong unit"],
    [{ "content-range": "bytes 10-14/99999999999" }, "total over the cap"],
    [{ "content-range": "bytes 0-99999999/*" }, "slice over the cap"],
  ]) {
    assert.deepEqual(await run(206, headers), { kind: "failed", reason: "bad_range" }, why);
  }
  // A partial answer nobody asked for.
  const unasked = await fetchRecording(URL_OK, null, new AbortController().signal,
    fetchWith(async () => source([BYTES(5)], { status: 206, headers: { "content-range": "bytes 0-4/100" } })));
  assert.deepEqual(unasked, { kind: "failed", reason: "bad_range" });
});

test("source response: an unsatisfiable range is passed on as 416 with the total", async () => {
  const outcome = await fetchRecording(URL_OK, parseSingleRange("bytes=500-"), new AbortController().signal,
    fetchWith(async () => new Response("", { status: 416, headers: { "content-range": "bytes */100", "content-type": "text/plain" } })));
  assert.equal(outcome.kind, "stream");
  assert.equal(outcome.response.status, 416);
  assert.equal(outcome.response.headers.get("content-range"), "bytes */100");
  assert.equal(outcome.response.headers.get("content-type"), "audio/mpeg");
  const noTotal = await fetchRecording(URL_OK, parseSingleRange("bytes=500-"), new AbortController().signal,
    fetchWith(async () => new Response("", { status: 416 })));
  assert.deepEqual(noTotal, { kind: "failed", reason: "bad_range" });
  // 416 to a request that sent no range is not a thing we pass on.
  const unasked = await fetchRecording(URL_OK, null, new AbortController().signal,
    fetchWith(async () => new Response("", { status: 416, headers: { "content-range": "bytes */100" } })));
  assert.deepEqual(unasked, { kind: "failed", reason: "status" });
});

test("source response: a source that ignores Range is read whole (within the cap) and cut to the slice asked", async () => {
  const whole = new Uint8Array(100).map((_, index) => index);
  const run = (range) => fetchRecording(URL_OK, parseSingleRange(range), new AbortController().signal,
    fetchWith(async () => source([whole.slice(0, 40), whole.slice(40)], { headers: { "content-length": "100" } })));
  const middle = await run("bytes=10-19");
  assert.equal(middle.kind, "stream");
  assert.equal(middle.response.status, 206);
  assert.equal(middle.response.headers.get("content-range"), "bytes 10-19/100");
  assert.equal(middle.response.headers.get("content-length"), "10");
  assert.deepEqual([...await drain(middle.response)], [10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
  const suffix = await run("bytes=-3");
  assert.equal(suffix.response.headers.get("content-range"), "bytes 97-99/100");
  assert.deepEqual([...await drain(suffix.response)], [97, 98, 99]);
  const open = await run("bytes=98-");
  assert.deepEqual([...await drain(open.response)], [98, 99]);
  const beyond = await run("bytes=100-");
  assert.equal(beyond.response.status, 416);
  assert.equal(beyond.response.headers.get("content-range"), "bytes */100");
  // Without a range the same source is streamed as 200.
  const plain = await fetchRecording(URL_OK, null, new AbortController().signal,
    fetchWith(async () => source([whole], { headers: { "content-length": "100" } })));
  assert.equal(plain.response.status, 200);
  assert.equal((await drain(plain.response)).length, 100);
  // A whole recording over the cap is refused, whether or not the source says its length.
  const big = await fetchRecording(URL_OK, parseSingleRange("bytes=0-9"), new AbortController().signal,
    fetchWith(async () => source([BYTES(40), BYTES(40)]), {}), );
  assert.equal(big.kind, "stream", "within the default cap");
  await big.response.body.cancel();
  const capped = await fetchRecording(URL_OK, parseSingleRange("bytes=0-9"), new AbortController().signal,
    fetchWith(async () => source([BYTES(60), BYTES(60)]), { maxBytes: 100 }));
  assert.deepEqual(capped, { kind: "failed", reason: "too_large" });
});

test("source response: 404 and 410 are reported as «not found»; redirects, other statuses and wrong types are refused", async () => {
  const run = (response, extra = {}) => fetchRecording(URL_OK, null, new AbortController().signal, fetchWith(async () => response, extra));
  assert.deepEqual(await run(new Response("gone", { status: 404 })), { kind: "not_found" });
  assert.deepEqual(await run(new Response("gone", { status: 410 })), { kind: "not_found" });
  // A redirect is never followed: the fetch is called once and the Location is not requested.
  let calls = 0;
  const redirect = await fetchRecording(URL_OK, null, new AbortController().signal, fetchWith(async () => {
    calls += 1;
    return new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data" } });
  }));
  assert.deepEqual(redirect, { kind: "failed", reason: "redirect" });
  assert.equal(calls, 1);
  for (const status of [301, 303, 307, 308]) assert.deepEqual(await run(new Response(null, { status })), { kind: "failed", reason: "redirect" }, String(status));
  assert.deepEqual(await run(new Response(null, { status: 204 })), { kind: "failed", reason: "status" }, "204");
  for (const status of [400, 401, 403, 405, 429, 500, 502, 503]) {
    assert.deepEqual(await run(new Response("x", { status })), { kind: "failed", reason: "status" }, String(status));
  }
  for (const type of ["text/html", "application/json", "audio/mp3", "audio/wav", "application/octet-stream", "audio/mpeg3", "video/mpeg"]) {
    assert.deepEqual(await run(new Response("x", { headers: { "content-type": type } })), { kind: "failed", reason: "content_type" }, type);
  }
  assert.deepEqual(await run(new Response("x")), { kind: "failed", reason: "content_type" }, "no type at all");
  for (const type of ["audio/mpeg", "AUDIO/MPEG", "audio/mpeg; charset=binary", " audio/mpeg ;x=1"]) {
    const ok = await run(new Response("abc", { headers: { "content-type": type } }));
    assert.equal(ok.kind, "stream", type);
    await ok.response.body.cancel();
  }
  assert.deepEqual(await run(source([BYTES(2)], { headers: { "content-encoding": "gzip" } })), { kind: "failed", reason: "encoding" });
  const identity = await run(source([BYTES(2)], { headers: { "content-encoding": "identity" } }));
  assert.equal(identity.kind, "stream");
  await identity.response.body.cancel();
  assert.deepEqual(await run(source([BYTES(2)], { headers: { "content-length": String(RECORDING_MAX_BYTES + 1) } })), { kind: "failed", reason: "too_large" });
});

test("source response: a body over the cap without a length stops the stream; the source request is aborted", async () => {
  let upstream;
  const outcome = await fetchRecording(URL_OK, null, new AbortController().signal, fetchWith(async (_url, init) => {
    upstream = init.signal;
    return source([BYTES(60), BYTES(60)]);
  }, { maxBytes: 100 }));
  assert.equal(outcome.kind, "stream");
  await assert.rejects(drain(outcome.response), (error) => error.reason === "too_large");
  assert.equal(upstream.aborted, true, "the request to the source is cancelled");
});

test("source response: the body is passed on as it arrives, not buffered", async () => {
  let upstream;
  let feed;
  const outcome = await fetchRecording(URL_OK, null, new AbortController().signal, fetchWith(async (_url, init) => {
    upstream = init.signal;
    return new Response(new ReadableStream({ start(controller) { feed = controller; controller.enqueue(BYTES(4, 9)); } }), {
      headers: { "content-type": "audio/mpeg" },
    });
  }));
  const reader = outcome.response.body.getReader();
  const first = await reader.read();
  assert.deepEqual([...first.value], [9, 9, 9, 9], "the first chunk arrives while the source is still open");
  feed.enqueue(BYTES(2, 8));
  assert.deepEqual([...(await reader.read()).value], [8, 8]);
  await reader.cancel();
  assert.equal(upstream.aborted, true, "cancelling the answer cancels the request to the source");
});

test("source: a private or unresolvable address stops the request before it is made", async () => {
  let called = 0;
  const never = async () => { called += 1; return source([BYTES(1)]); };
  for (const addresses of [[{ address: "10.0.0.5", family: 4 }], [{ address: "127.0.0.1", family: 4 }], [{ address: "::1", family: 6 }],
    [{ address: "93.184.216.34", family: 4 }, { address: "169.254.169.254", family: 4 }], [{ address: "::ffff:10.0.0.1", family: 6 }], []]) {
    const outcome = await fetchRecording(URL_OK, null, new AbortController().signal, { fetch: never, resolveHost: async () => addresses });
    assert.deepEqual(outcome, { kind: "failed", reason: "address" }, JSON.stringify(addresses));
  }
  const unresolved = await fetchRecording(URL_OK, null, new AbortController().signal,
    { fetch: never, resolveHost: async () => { throw new Error("ENOTFOUND"); } });
  assert.deepEqual(unresolved, { kind: "failed", reason: "network" });
  assert.equal(called, 0, "the source was never requested");
});

test("source: network errors, header timeout, idle timeout and the client's abort", async () => {
  const run = (handler, extra = {}, signal = new AbortController().signal) => fetchRecording(URL_OK, null, signal, fetchWith(handler, extra));
  assert.deepEqual(await run(async () => { throw new TypeError("fetch failed: secret-host"); }), { kind: "failed", reason: "network" });
  // Headers never come: the request is aborted after the header timeout.
  let aborted = false;
  const slow = await run((_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener("abort", () => { aborted = true; reject(new DOMException("aborted", "AbortError")); });
  }), { headersTimeoutMs: 20 });
  assert.deepEqual(slow, { kind: "failed", reason: "timeout" });
  assert.equal(aborted, true);
  // The body stalls after one chunk: the stream errors after the idle timeout and the source is cancelled.
  let upstream;
  const stall = await run(async (_url, init) => {
    upstream = init.signal;
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(BYTES(2)); } }), { headers: { "content-type": "audio/mpeg" } });
  }, { idleTimeoutMs: 20 });
  assert.equal(stall.kind, "stream");
  const reader = stall.response.body.getReader();
  assert.equal((await reader.read()).value.length, 2);
  await assert.rejects(reader.read(), (error) => error.reason === "timeout");
  assert.equal(upstream.aborted, true);
  // The client goes away before the request: nothing is requested.
  const gone = new AbortController();
  gone.abort();
  let requested = 0;
  assert.deepEqual(await run(async () => { requested += 1; return source([]); }, {}, gone.signal), { kind: "failed", reason: "aborted" });
  assert.equal(requested, 0);
  // The client goes away while waiting for the source's headers.
  const later = new AbortController();
  const waiting = run((_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
  }), {}, later.signal);
  later.abort();
  assert.deepEqual(await waiting, { kind: "failed", reason: "aborted" });
  // The client goes away while the body streams: the request to the source is cancelled.
  const streaming = new AbortController();
  let seen;
  const outcome = await run(async (_url, init) => {
    seen = init.signal;
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(BYTES(2)); } }), { headers: { "content-type": "audio/mpeg" } });
  }, {}, streaming.signal);
  streaming.abort();
  assert.equal(seen.aborted, true);
  await outcome.response.body.cancel().catch(() => undefined);
});

test("source failures carry only a fixed word: no link, address or text of the source in an error or a message", async () => {
  const canary = "CANARY-secret-token-9f2c";
  const outcomes = await Promise.all([
    fetchRecording(URL_OK, null, new AbortController().signal, fetchWith(async () => { throw new Error(`boom ${canary} ${LINK}`); })),
    fetchRecording(URL_OK, null, new AbortController().signal, fetchWith(async () => new Response(canary, { status: 500, statusText: canary }))),
    fetchRecording(URL_OK, null, new AbortController().signal, fetchWith(async () => new Response(canary, { headers: { "content-type": `text/html; x=${canary}` } }))),
    fetchRecording(URL_OK, null, new AbortController().signal, { fetch: async () => source([]), resolveHost: async () => { throw new Error(canary); } }),
  ]);
  for (const outcome of outcomes) {
    assert.equal(outcome.kind, "failed");
    const dump = JSON.stringify(outcome);
    assert.doesNotMatch(dump, new RegExp(`${canary}|${HOST}|mp3`, "u"));
    assert.match(outcome.reason, /^[a-z_]+$/u);
  }
});

// ------------------------------------------------------------ the route

const ACTOR = Object.freeze({ organizationId: ID(1), membershipId: ID(302), systemRole: "staff", permissionKeys: ["telephony.recording.listen.own"] });
const PBX_READY = Object.freeze({
  status: "ready",
  config: Object.freeze({ baseUrl: `https://${HOST}/crmapi/v1`, apiHost: HOST, recordingHost: HOST, apiKey: "k".repeat(24) }),
});
const requestFor = (legId = LEG, headers = {}, search = "", signal) =>
  new Request(`https://crm.example.test/api/v3/telephony/recordings/${legId}${search}`, { headers, signal });
const context = (legId = LEG) => ({ params: Promise.resolve({ legId }) });

/** Поддельная база и источник; `calls` записывает, что вызывалось и с чем. */
function harness(overrides = {}) {
  const calls = { grant: [], consume: [], report: [], fetch: [], log: [] };
  const dependencies = {
    authorize: async () => ({ status: "authorized", actor: ACTOR }),
    pbxConfig: () => PBX_READY,
    grant: async (actor, legId) => { calls.grant.push({ actor, legId }); return { status: "granted", grantId: GRANT }; },
    consume: async (actor, grantId, legId) => {
      calls.consume.push({ actor, grantId, legId });
      return { status: "consumed", link: LINK, notFoundCount: 0 };
    },
    report: async (actor, legId, result) => { calls.report.push({ actor, legId, result }); return { status: "reported", state: "available" }; },
    fetchOptions: {
      fetch: async (url, init) => { calls.fetch.push({ url, init }); return source([BYTES(4)], { headers: { "content-length": "4" } }); },
      resolveHost: async () => PUBLIC_ADDRESS,
    },
    log: (entry) => calls.log.push(entry),
    ...overrides,
  };
  return { calls, handler: createTelephonyRecordingHandler(dependencies) };
}
async function leakFree(response) {
  const body = response.body ? Buffer.from(await response.arrayBuffer()).toString("latin1") : "";
  const headers = JSON.stringify([...response.headers.entries()]);
  assert.doesNotMatch(body + headers, new RegExp(`mp3|${HOST.replace(/\./gu, "\\.")}|https?:|${GRANT}|CANARY`, "iu"));
  return body;
}

test("route: a granted listener gets the stream with the documented headers; the database is asked once each", async () => {
  const { handler, calls } = harness();
  const response = await handler(requestFor(), context());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "audio/mpeg");
  assert.equal(response.headers.get("cache-control"), "private, no-store, no-transform");
  assert.deepEqual([...(await drain(response))], [7, 7, 7, 7]);
  assert.equal(calls.grant.length, 1);
  assert.equal(calls.grant[0].legId, LEG);
  assert.equal(calls.consume.length, 1);
  assert.deepEqual({ grantId: calls.consume[0].grantId, legId: calls.consume[0].legId }, { grantId: GRANT, legId: LEG });
  assert.equal(calls.fetch.length, 1);
  assert.equal(calls.fetch[0].url, LINK);
  assert.equal(calls.report.length, 0, "a clean answer of the source writes nothing");
  assert.deepEqual(calls.log, [{ event: "telephony_recording", status: 200, reason: "streamed", range: false }]);
});

test("route: the id is normalised to lower case; a Range header goes to the source as one clean range", async () => {
  const { handler, calls } = harness({
    fetchOptions: {
      fetch: async (url, init) => { calls.fetch.push({ url, init }); return source([BYTES(5)], { status: 206, headers: { "content-range": "bytes 10-14/100", "content-length": "5" } }); },
      resolveHost: async () => PUBLIC_ADDRESS,
    },
  });
  const response = await handler(requestFor(LEG.replace(/8011$/u, "801A").toUpperCase(), { range: "bytes=010-14" }), context(LEG.replace(/8011$/u, "801A").toUpperCase()));
  assert.equal(response.status, 206);
  assert.equal(response.headers.get("content-range"), "bytes 10-14/100");
  await response.body.cancel();
  assert.equal(calls.grant[0].legId, LEG.replace(/8011$/u, "801a"));
  assert.equal(calls.fetch[0].init.headers.Range, "bytes=10-14");
  assert.deepEqual(calls.log, [{ event: "telephony_recording", status: 206, reason: "streamed", range: true }]);
  // Several ranges, an odd unit, a broken header: ignored, the whole recording is asked for.
  for (const range of ["bytes=0-1,5-6", "items=0-1", "bytes=9-2", "garbage"]) {
    const other = harness();
    const answer = await other.handler(requestFor(LEG, { range }), context());
    assert.equal(answer.status, 200, range);
    await answer.body.cancel();
    assert.equal("Range" in other.calls.fetch[0].init.headers, false, range);
  }
});

test("route: no session, a broken session, a role preview and no right never reach the database or the source", async () => {
  for (const [status, expected, code] of [["anonymous", 401, "authentication_required"], ["unavailable", 503, "unavailable"],
    ["preview", 403, "preview"], ["forbidden", 403, "forbidden"]]) {
    const { handler, calls } = harness({ authorize: async () => ({ status, actor: null }) });
    const response = await handler(requestFor(), context());
    assert.equal(response.status, expected, status);
    assert.equal((await response.json()).error.code, code);
    assert.deepEqual([calls.grant.length, calls.consume.length, calls.report.length, calls.fetch.length], [0, 0, 0, 0], status);
  }
  const thrown = harness({ authorize: async () => { throw new Error("session store down"); } });
  assert.equal((await thrown.handler(requestFor(), context())).status, 503);
});

test("access: the session decides only who has nothing to listen to — no login, a broken session, a role preview, no listening right", () => {
  const actor = (fields) => ({ systemRole: "staff", presentationRole: null, permissionKeys: [], organizationId: ID(1), membershipId: ID(302), ...fields });
  const decide = (fields) => recordingAuthorization({ status: "authenticated", actor: actor(fields) }).status;
  assert.equal(recordingAuthorization({ status: "anonymous", actor: null }).status, "anonymous");
  assert.equal(recordingAuthorization({ status: "invalid", actor: null, reason: "supabase_session_invalid" }).status, "unavailable");
  assert.equal(decide({ permissionKeys: ["telephony.recording.listen.own"] }), "authorized");
  assert.equal(decide({ permissionKeys: ["telephony.recording.listen.all"] }), "authorized");
  assert.equal(decide({ permissionKeys: ["telephony.recording.listen.own", "telephony.recording.listen.all"] }), "authorized");
  assert.equal(decide({ systemRole: "admin" }), "authorized", "the Admin holds every telephony right");
  assert.equal(decide({}), "forbidden");
  assert.equal(decide({ permissionKeys: ["telephony.call.dial", "telephony.manage", "telephony.report.read.all", "lead.read"] }), "forbidden",
    "the dial, report and settings rights do not let anyone listen");
  assert.equal(decide({ systemRole: "student" }), "forbidden");
  assert.equal(decide({ systemRole: "admin", presentationRole: "sales" }), "preview", "a role preview plays nothing: a grant would write to the journal");
  assert.equal(decide({ systemRole: "staff", presentationRole: "sales", permissionKeys: ["telephony.recording.listen.own"] }), "authorized",
    "presentationRole is an Admin-only choice; for anyone else it is not a preview");
  const refused = recordingAuthorization({ status: "authenticated", actor: actor({ systemRole: "admin", presentationRole: "sales" }) });
  assert.equal(refused.actor, null, "a refused session carries no actor");
});

test("route: a bad id, a query string and an unconfigured PBX stop before anything is granted", async () => {
  for (const [legId, search, status, code] of [["not-a-uuid", "", 404, "not_found"], ["00000000-0000-0000-0000-000000000000", "", 404, "not_found"],
    [LEG, "?download=1", 400, "invalid_request"], [LEG, "?x", 400, "invalid_request"]]) {
    const { handler, calls } = harness();
    const response = await handler(requestFor(legId, {}, search), context(legId));
    assert.equal(response.status, status, `${legId}${search}`);
    assert.equal((await response.json()).error.code, code);
    assert.equal(calls.grant.length, 0);
  }
  for (const pbx of [{ status: "not_configured" }, { status: "invalid", reason: "incomplete_group" }]) {
    const { handler, calls } = harness({ pbxConfig: () => pbx });
    const response = await handler(requestFor(), context());
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, "not_configured");
    assert.deepEqual([calls.grant.length, calls.consume.length, calls.fetch.length], [0, 0, 0], "no grant, no journal row, no use counted without a PBX");
  }
});

test("route: the database's refusals become the documented statuses, without telling who may know a recording", async () => {
  for (const [code, status, error, extra] of [
    ["forbidden", 403, "forbidden"], ["not_found", 404, "not_found"], ["recording_unavailable", 404, "recording_unavailable"],
    ["expired", 410, "recording_expired"], ["rate_limited", 429, "rate_limited", { "retry-after": "300" }],
    ["invalid", 400, "invalid_request"], ["unavailable", 503, "unavailable"],
  ]) {
    const { handler, calls } = harness({ grant: async () => ({ status: "refused", code }) });
    const response = await handler(requestFor(), context());
    assert.equal(response.status, status, code);
    assert.equal(response.headers.get("cache-control"), "private, no-store, no-transform");
    for (const [name, value] of Object.entries(extra ?? {})) assert.equal(response.headers.get(name), value);
    assert.equal((await response.json()).error.code, error);
    assert.equal(calls.consume.length, 0, "nothing is consumed after a refused grant");
    assert.equal(calls.fetch.length, 0);
  }
  // Consume refusals: same words; a spent grant is retried once with a fresh one.
  for (const [code, status] of [["forbidden", 403], ["expired", 410], ["recording_unavailable", 404], ["not_found", 404], ["unavailable", 503]]) {
    const { handler, calls } = harness({ consume: async () => ({ status: "refused", code }) });
    assert.equal((await handler(requestFor(), context())).status, status, code);
    assert.equal(calls.grant.length, 1);
    assert.equal(calls.fetch.length, 0);
  }
  let attempt = 0;
  const retry = harness({
    consume: async () => {
      attempt += 1;
      return attempt === 1 ? { status: "refused", code: "grant_invalid" } : { status: "consumed", link: LINK, notFoundCount: 0 };
    },
  });
  const ok = await retry.handler(requestFor(), context());
  assert.equal(ok.status, 200);
  await ok.body.cancel();
  assert.equal(retry.calls.grant.length, 2, "a grant spent between grant and consume is replaced once");
  const stuck = harness({ consume: async () => ({ status: "refused", code: "grant_invalid" }) });
  assert.equal((await stuck.handler(requestFor(), context())).status, 503);
  assert.equal(stuck.calls.grant.length, 2, "and only once");
});

test("route: the link database gave must still be the tenant's strict link, else nothing is requested", async () => {
  for (const link of [`http://${HOST}/a.mp3`, `https://elsewhere.example/a.mp3`, `https://${HOST}/a.mp3?token=1`, `https://${HOST}/a`, "", `https://${HOST}:8443/a.mp3`,
    "https://10.0.0.1/a.mp3"]) {
    const { handler, calls } = harness({ consume: async () => ({ status: "consumed", link, notFoundCount: 0 }) });
    const response = await handler(requestFor(), context());
    assert.equal(response.status, 502, link);
    assert.equal((await response.json()).error.code, "recording_temporarily_unavailable");
    assert.equal(calls.fetch.length, 0);
    assert.equal(calls.report.length, 0, "a link of the wrong shape changes no state");
  }
});

test("route: a 404 from the source is decided by the database by the call's age; the link is never cleared here", async () => {
  const notFound = { fetch: async (url, init) => { calls.fetch.push({ url, init }); return new Response("gone", { status: 404 }); }, resolveHost: async () => PUBLIC_ADDRESS };
  let calls;
  for (const [state, status, code] of [["available", 404, "recording_not_ready"], ["unavailable", 404, "recording_not_ready"], ["expired", 410, "recording_expired"]]) {
    const built = harness({ fetchOptions: notFound, report: async (actor, legId, result) => { built.calls.report.push({ actor, legId, result }); return { status: "reported", state }; } });
    calls = built.calls;
    const response = await built.handler(requestFor(), context());
    assert.equal(response.status, status, state);
    assert.equal((await response.json()).error.code, code);
    assert.deepEqual(built.calls.report, [{ actor: ACTOR, legId: LEG, result: "not_found" }]);
  }
  const broken = harness({ fetchOptions: notFound, report: async () => ({ status: "failed" }) });
  calls = broken.calls;
  const response = await broken.handler(requestFor(), context());
  assert.equal(response.status, 502);
  assert.equal((await response.json()).error.code, "recording_temporarily_unavailable");
});

test("route: a failing source is 502 and changes nothing; a wrong type is 502 without a body", async () => {
  for (const make of [
    () => new Response("x", { status: 500 }),
    () => new Response("x", { status: 403 }),
    () => new Response(null, { status: 302, headers: { location: "https://elsewhere.example/" } }),
  ]) {
    const { handler, calls } = harness({ fetchOptions: { fetch: async () => make(), resolveHost: async () => PUBLIC_ADDRESS } });
    const response = await handler(requestFor(), context());
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error.code, "recording_temporarily_unavailable");
    assert.equal(calls.report.length, 0, "the state of the recording is not changed by a source failure");
  }
  const network = harness({ fetchOptions: { fetch: async () => { throw new Error("ECONNRESET"); }, resolveHost: async () => PUBLIC_ADDRESS } });
  assert.equal((await network.handler(requestFor(), context())).status, 502);
  const html = harness({ fetchOptions: { fetch: async () => new Response("<html>", { headers: { "content-type": "text/html" } }), resolveHost: async () => PUBLIC_ADDRESS } });
  const wrongType = await html.handler(requestFor(), context());
  assert.equal(wrongType.status, 502);
  assert.equal(await wrongType.text(), "", "no body at all");
  assert.equal(wrongType.headers.get("content-type"), null);
  const priv = harness({ fetchOptions: { fetch: async () => source([]), resolveHost: async () => [{ address: "10.1.2.3", family: 4 }] } });
  assert.equal((await priv.handler(requestFor(), context())).status, 502);
});

test("route: after earlier 404s a good answer from the source resets the counter; a failing report does not stop the sound", async () => {
  const built = harness({ consume: async () => ({ status: "consumed", link: LINK, notFoundCount: 2 }) });
  const response = await built.handler(requestFor(), context());
  assert.equal(response.status, 200);
  await response.body.cancel();
  assert.deepEqual(built.calls.report, [{ actor: ACTOR, legId: LEG, result: "ok" }]);
  const throwing = harness({ consume: async () => ({ status: "consumed", link: LINK, notFoundCount: 1 }), report: async () => { throw new Error("db down"); } });
  const still = await throwing.handler(requestFor(), context());
  assert.equal(still.status, 200);
  assert.deepEqual([...await drain(still)], [7, 7, 7, 7]);
});

test("route: the link, the host and the grant never leave in a body or a header, and the application log holds words and counters only", async () => {
  const canary = "CANARY-link-9f2c";
  const scenarios = [
    harness(),
    harness({ grant: async () => ({ status: "refused", code: "forbidden" }) }),
    harness({ consume: async () => ({ status: "refused", code: "expired" }) }),
    harness({ consume: async () => ({ status: "consumed", link: `https://${HOST}/${canary}`, notFoundCount: 0 }) }),
    harness({ fetchOptions: { fetch: async () => new Response(canary, { status: 404 }), resolveHost: async () => PUBLIC_ADDRESS } }),
    harness({ fetchOptions: { fetch: async () => { throw new Error(`${canary} ${LINK}`); }, resolveHost: async () => PUBLIC_ADDRESS } }),
    harness({ fetchOptions: { fetch: async () => new Response(canary, { status: 500, headers: { "content-type": "text/html" } }), resolveHost: async () => PUBLIC_ADDRESS } }),
    harness({ report: async () => ({ status: "reported", state: "expired" }), fetchOptions: { fetch: async () => new Response("x", { status: 410 }), resolveHost: async () => PUBLIC_ADDRESS } }),
    harness({ authorize: async () => { throw new Error(`${canary} ${LINK}`); } }),
  ];
  for (const { handler, calls } of scenarios) {
    const response = await handler(requestFor(), context());
    const body = await leakFree(response);
    assert.doesNotMatch(body, new RegExp(canary, "u"));
    for (const entry of calls.log) {
      assert.deepEqual(Object.keys(entry).sort(), ["event", "range", "reason", "status"]);
      assert.equal(entry.event, "telephony_recording");
      assert.match(entry.reason, /^[a-z_]+$/u);
      assert.doesNotMatch(JSON.stringify(entry), new RegExp(`${canary}|${HOST}|${LEG}|${GRANT}|mp3`, "u"));
    }
  }
  const failing = harness({ log: () => { throw new Error("log sink down"); } });
  const response = await failing.handler(requestFor(), context());
  assert.equal(response.status, 200, "a logging failure never changes the answer");
  await response.body.cancel();
});

test("route: only GET does anything; HEAD and OPTIONS are 405 and ask nobody", async () => {
  const response = telephonyRecordingMethodNotAllowed();
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "GET");
  assert.equal(response.headers.get("cache-control"), "private, no-store, no-transform");
  assert.equal((await response.json()).error.code, "method_not_allowed");
  const route = read("src/app/api/v3/telephony/recordings/[legId]/route.ts");
  assert.match(route, /export const GET = createTelephonyRecordingHandler\(\);/u);
  assert.match(route, /export const HEAD = telephonyRecordingMethodNotAllowed;/u);
  assert.match(route, /export const OPTIONS = telephonyRecordingMethodNotAllowed;/u);
  assert.match(route, /export const runtime = "nodejs";/u);
  assert.match(route, /export const dynamic = "force-dynamic";/u);
  assert.doesNotMatch(route, /export (?:const|async function) (?:POST|PUT|PATCH|DELETE)\b/u);
});

test("receipts: the database's answers are read strictly; any other shape is a failure, not a success", () => {
  const grant = { status: "issued", grantId: GRANT.toUpperCase(), expiresAt: "2031-01-05T09:00:00+00:00", scope: "own" };
  assert.deepEqual(recordingGrantReceipt(grant), { status: "granted", grantId: GRANT });
  assert.deepEqual(recordingGrantReceipt({ ...grant, status: "reused", scope: "all" }), { status: "granted", grantId: GRANT });
  for (const bad of [null, [], "x", {}, { ...grant, status: "queued" }, { ...grant, scope: "any" }, { ...grant, grantId: "nope" }, { ...grant, expiresAt: "soon" },
    { ...grant, extra: 1 }, { status: "issued", grantId: GRANT, scope: "own" }, { ...grant, link: LINK }]) {
    assert.deepEqual(recordingGrantReceipt(bad), { status: "refused", code: "unavailable" }, JSON.stringify(bad));
  }
  const consume = { legId: LEG, callId: ID(7001), link: LINK, notFoundCount: 0 };
  assert.deepEqual(recordingConsumeReceipt(consume, LEG), { status: "consumed", link: LINK, notFoundCount: 0 });
  assert.deepEqual(recordingConsumeReceipt({ ...consume, legId: LEG.toUpperCase(), notFoundCount: 2 }, LEG), { status: "consumed", link: LINK, notFoundCount: 2 });
  for (const bad of [null, [], {}, { ...consume, legId: ID(1) }, { ...consume, link: "" }, { ...consume, link: 5 }, { ...consume, notFoundCount: -1 },
    { ...consume, notFoundCount: 1.5 }, { ...consume, callId: "x" }, { ...consume, extra: 1 }, { legId: LEG, link: LINK }]) {
    assert.deepEqual(recordingConsumeReceipt(bad, LEG), { status: "refused", code: "unavailable" }, JSON.stringify(bad));
  }
  assert.deepEqual(recordingReportReceipt({ state: "expired", changed: true, notFoundCount: 0 }), { status: "reported", state: "expired" });
  for (const state of ["none", "available", "unavailable"]) assert.deepEqual(recordingReportReceipt({ state }), { status: "reported", state });
  for (const bad of [null, [], {}, { state: "gone" }, { state: 1 }]) assert.deepEqual(recordingReportReceipt(bad), { status: "failed" });
});

test("refusals: SQLSTATEs of migration 297 map to words; the text of the exception tells apart what one code cannot", () => {
  assert.equal(recordingRefusal({ code: "42501", message: "telephony_recording_forbidden" }), "forbidden");
  assert.equal(recordingRefusal({ code: "42501", message: "telephony_recording_grant_invalid" }), "grant_invalid");
  assert.equal(recordingRefusal({ code: "42501" }), "forbidden");
  assert.equal(recordingRefusal({ code: "P0002", message: "telephony_recording_unavailable" }), "recording_unavailable");
  assert.equal(recordingRefusal({ code: "P0002", message: "telephony_recording_not_found" }), "not_found");
  assert.equal(recordingRefusal({ code: "PT410", message: "telephony_recording_expired" }), "expired");
  assert.equal(recordingRefusal({ code: "PT429", message: "telephony_recording_rate_limited" }), "rate_limited");
  assert.equal(recordingRefusal({ code: "22023" }), "invalid");
  for (const other of [{}, { code: "XX000" }, { code: "57014" }, { code: "PGRST301" }]) assert.equal(recordingRefusal(other), "unavailable");
  // The words really are in the migration, so the mapping cannot drift from the database.
  const migration = read("supabase/migrations/297_platform_telephony_recordings.sql");
  for (const message of ["telephony_recording_forbidden", "telephony_recording_grant_invalid", "telephony_recording_unavailable",
    "telephony_recording_not_found", "telephony_recording_expired", "telephony_recording_rate_limited"]) {
    assert.ok(migration.includes(`'${message}'`), message);
  }
  assert.match(migration, /'telephony_recording_expired' USING ERRCODE = 'PT410'/u);
  assert.match(migration, /'telephony_recording_rate_limited' USING ERRCODE = 'PT429'/u);
});

test("route contract: exactly the strict GET path is connected; its near misses are not", () => {
  const path = `/api/v3/telephony/recordings/${ID(8011)}`;
  assert.equal(isConnectedPlatformApi(path), true);
  assert.equal(isConnectedPlatformApi(`/api/v3/telephony/recordings/${ID(8011).replace(/8011$/u, "801a")}`), true);
  for (const wrong of [
    `${path}/`, `${path}/x`, `${path}.mp3`, `${path}?x=1`, `/api/v3/telephony/recordings/${ID(8011).replace(/8011$/u, "801A")}`, "/api/v3/telephony/recordings/",
    "/api/v3/telephony/recordings", "/api/v3/telephony/recordings/not-a-uuid", `/api/v3/telephony/recording/${ID(8011)}`,
    `/api/v3/telephony/recordings/${ID(8011)}%2Fx`, `/api/v2/telephony/recordings/${ID(8011)}`, `/api/v3/telephony/recordings//${ID(8011)}`,
    `/api/v3/telephony/calls/${ID(8011)}/recording`, `/api/v3/telephony/recordings/${ID(8011).replace("-4000-", "-9000-")}`,
  ]) {
    assert.equal(isConnectedPlatformApi(wrong), false, wrong);
  }
});

// ------------------------------------------------------------ files and wiring

test("wiring: the route, the handler, the source and the migration agree; the link is read in one place", () => {
  const migration = read("supabase/migrations/297_platform_telephony_recordings.sql");
  const handlers = read("src/lib/server/telephony-recording-route-handlers.ts");
  const stream = read("src/lib/server/platform-telephony-recording-stream.ts");
  const source = read("src/lib/v3/telephony-lead-calls-source.ts");
  const parts = read("src/components/v3/profile/LeadWorkParts.tsx");
  const player = read("src/components/v3/profile/LeadCallRecording.tsx");
  const contract = read("src/lib/v3/telephony-lead-calls.ts");
  const view = read("src/components/v3/profile/lead-work-view.ts");
  const script = read("scripts/test-postgres-authorization.sh");
  // The RPC parameter names in TypeScript are the SQL parameter names, in both directions.
  const params = (name) => [...migration.match(new RegExp(`FUNCTION platform\\.${name}\\(([^)]*)\\)`, "u"))[1].matchAll(/\bp_[a-z_]+/gu)].map((match) => match[0]).sort();
  const used = (file, name) => [...file.match(new RegExp(`rpc\\(\\s*"${name}",\\s*\\{([^}]*)\\}`, "u"))[1].matchAll(/\bp_[a-z_]+/gu)].map((match) => match[0]).sort();
  assert.deepEqual(used(handlers, "telephony_recording_grant_v1"), params("telephony_recording_grant_v1"));
  assert.deepEqual(used(handlers, "telephony_recording_consume_v1"), params("telephony_recording_consume_v1"));
  assert.deepEqual(used(handlers, "telephony_recording_report_v1"), params("telephony_recording_report_v1"));
  assert.deepEqual(used(source, "telephony_lead_recordings_v1"), params("telephony_lead_recordings_v1"));
  // Who calls what: the employee's session for the grant, the service key for consume and report, never the other way.
  assert.match(handlers, /createSupabaseServerClient\(\)\)\.schema\("platform"\)\.rpc\(\s*"telephony_recording_grant_v1"/u);
  assert.match(handlers, /createPlatformSupabaseServiceClient\(getPlatformSupabaseBackendConfig\(\)\);\s*const \{ data, error \} = await client\.schema\("platform"\)\.rpc\("telephony_recording_consume_v1"/u);
  assert.match(handlers, /rpc\("telephony_recording_report_v1"/u);
  assert.doesNotMatch(source, /service/iu, "the page reads recordings with the employee's session only");
  // The recording link is named nowhere in the browser-facing code and nowhere in the logs.
  for (const [name, file] of Object.entries({ source, parts, player, contract, view })) {
    assert.doesNotMatch(file, /recording_link|recordingLink|\.mp3|clientPhone|client_phone/u, name);
  }
  assert.doesNotMatch(player, /server-only|platform-telephony|supabase|getPlatform/u, "the client component imports nothing of the server");
  assert.doesNotMatch(handlers, /console\.(?:log|warn|error|debug)|recording_link|\.link\b.*log/u);
  assert.match(handlers, /console\.info\(JSON\.stringify\(entry\)\)/u);
  assert.doesNotMatch(stream, /console\.|writeFile|createWriteStream|caches|localStorage|Buffer\.from\(/u, "the stream module stores and logs nothing");
  // The link is only handed over as a request URL and never put into a response or an error.
  assert.doesNotMatch(stream, /new Error\([^)]*(?:url|link|href)/iu);
  // The hook in the real-Postgres script is matched by name, not by number.
  assert.match(script, /\*_platform_telephony_recordings\.sql \]\]/u);
  assert.match(script, /-f \/workspace\/supabase\/tests\/platform_telephony_recordings\.sql/u);
  // The page hands the reader the recordings the database read, nothing else.
  assert.match(parts, /const callRecordings = input\.calls\?\.status === "ready" \? input\.calls\.recordings \?\? null : null;/u);
  assert.match(parts, /const recordings = preview \? null : callRecordings\?\.\[item\.call\.callId\] \?\? null;/u, "a role preview plays nothing");
  assert.match(source, /call\.recording !== "none"/u, "recordings are read only for calls that have one");
  // The player talks to our route only: a path with the leg id, no source URL.
  assert.match(player, /return `\/api\/v3\/telephony\/recordings\/\$\{legId\}`;/u);
  assert.match(player, /controlsList="nodownload noplaybackrate"/u);
  assert.match(player, /preload="none"/u);
  // The recording route is a streaming proxy: no cache, no redirect, no Range echo.
  assert.match(stream, /redirect: "manual"/u);
  assert.match(stream, /cache: "no-store"/u);
  assert.match(stream, /"Accept-Encoding": "identity"/u);
  assert.match(stream, /"Cache-Control": "private, no-store, no-transform"/u);
});

// ------------------------------------------------------------ the contract of the list and the words

const REC_LEG = (n, state = "available") => ({ legId: ID(8000 + n), state });
const REC_CALL = (n, canListen, legs) => ({ callId: ID(n), canListen, legs });
const recPayload = (calls, enabled = true) => ({ enabled, calls });

test("recordings contract: a well-formed answer is normalised, frozen and keyed by the call", () => {
  const requested = [ID(1), ID(2), ID(3)];
  const map = normalizeLeadRecordingsRead(recPayload([
    REC_CALL(1, true, [REC_LEG(1)]),
    REC_CALL(2, false, [REC_LEG(2), REC_LEG(3, "expired")]),
    { callId: ID(3).toUpperCase(), canListen: true, legs: [{ legId: ID(8004).toUpperCase(), state: "unavailable" }] },
  ]), requested);
  assert.deepEqual(Object.keys(map), [ID(1), ID(2), ID(3)]);
  assert.equal(map[ID(1)].canListen, true);
  assert.deepEqual(map[ID(2)].legs.map((leg) => leg.state), ["available", "expired"]);
  assert.equal(map[ID(3)].legs[0].legId, ID(8004), "ids are lower-cased");
  assert.ok(Object.isFrozen(map) && Object.isFrozen(map[ID(1)]) && Object.isFrozen(map[ID(1)].legs) && Object.isFrozen(map[ID(1)].legs[0]));
  // An empty answer is an empty map; a switch turned off between two reads is «not read».
  assert.deepEqual({ ...normalizeLeadRecordingsRead(recPayload([]), requested) }, {});
  assert.equal(normalizeLeadRecordingsRead(recPayload([], false), requested), null);
});

test("recordings contract: a foreign shape is an error, never a player", () => {
  const requested = [ID(1), ID(2)];
  const bad = (value, why) => assert.throws(() => normalizeLeadRecordingsRead(value, requested), TelephonyShapeError, why);
  bad(null, "null"); bad([], "array"); bad("x", "text"); bad({}, "empty object");
  bad({ ...recPayload([]), extra: 1 }, "extra key");
  bad({ enabled: "yes", calls: [] }, "enabled type");
  bad({ enabled: true, calls: "none" }, "calls type");
  bad(recPayload([REC_CALL(1, true, [REC_LEG(1)])], false), "a call while off");
  bad(recPayload([REC_CALL(9, true, [REC_LEG(1)])]), "a call nobody asked for");
  bad(recPayload([REC_CALL(1, true, [REC_LEG(1)]), REC_CALL(1, true, [REC_LEG(2)])]), "the same call twice");
  bad(recPayload([REC_CALL(1, true, [])]), "a call with no legs");
  bad(recPayload([REC_CALL(1, true, Array.from({ length: 7 }, (_, index) => REC_LEG(index + 1)))]), "more than six legs");
  bad(recPayload([REC_CALL(1, true, [REC_LEG(1), REC_LEG(1)])]), "the same leg twice");
  bad(recPayload([REC_CALL(1, true, [REC_LEG(1, "none")])]), "state none");
  bad(recPayload([REC_CALL(1, true, [REC_LEG(1, "playable")])]), "unknown state");
  bad(recPayload([REC_CALL(1, "yes", [REC_LEG(1)])]), "canListen type");
  bad(recPayload([{ ...REC_CALL(1, true, [REC_LEG(1)]), link: LINK }]), "a link key on the call");
  bad(recPayload([REC_CALL(1, true, [{ ...REC_LEG(1), link: LINK }])]), "a link key on the leg");
  bad(recPayload([REC_CALL(1, true, [{ legId: "not-a-uuid", state: "available" }])]), "leg id");
  bad(recPayload([{ callId: "x", canListen: true, legs: [REC_LEG(1)] }]), "call id");
  bad(recPayload(Array.from({ length: 101 }, () => REC_CALL(1, true, [REC_LEG(1)]))), "over 100 calls");
  // The state helper turns any of it into «not read» (the feed then shows the T5 words and no player).
  assert.equal(leadRecordingsState({ enabled: true, calls: "none" }, requested), null);
  assert.equal(leadRecordingsState(recPayload([REC_CALL(1, true, [REC_LEG(1)])]), requested)[ID(1)].canListen, true);
});

test("recordings words: «Слушать» only where the database allowed; otherwise the state in plain Russian", () => {
  const items = (canListen, ...states) => callRecordingItems({ canListen, legs: states.map((state, index) => ({ legId: ID(8000 + index + 1), state })) });
  assert.deepEqual(items(true, "available"), [{ kind: "player", legId: ID(8001), label: "Слушать" }]);
  assert.deepEqual(items(true, "available", "available"), [
    { kind: "player", legId: ID(8001), label: "Слушать запись 1" },
    { kind: "player", legId: ID(8002), label: "Слушать запись 2" },
  ]);
  assert.deepEqual(items(false, "available"), [{ kind: "text", text: "Запись доступна руководителю" }]);
  assert.deepEqual(items(false, "available", "available"), [
    { kind: "text", text: "Запись 1 доступна руководителю" }, { kind: "text", text: "Запись 2 доступна руководителю" }]);
  assert.deepEqual(items(true, "unavailable"), [{ kind: "text", text: "Запись временно недоступна" }]);
  assert.deepEqual(items(true, "expired"), [{ kind: "text", text: "Запись удалена по сроку хранения" }]);
  assert.deepEqual(items(false, "expired"), [{ kind: "text", text: "Запись удалена по сроку хранения" }], "the state is told to everyone");
  assert.deepEqual(items(true, "available", "expired"), [
    { kind: "player", legId: ID(8001), label: "Слушать запись 1" }, { kind: "text", text: "Запись 2 удалена по сроку хранения" }]);
  assert.deepEqual(items(true, "unavailable", "available"), [
    { kind: "text", text: "Запись 1 временно недоступна" }, { kind: "player", legId: ID(8002), label: "Слушать запись 2" }]);
  assert.deepEqual(callRecordingItems({ canListen: true, legs: [] }), []);
});

test("row: with the recordings read the small line drops the recording words; without them it is the old line", () => {
  const call = leadCallsState({
    enabled: true, canSetResult: false, hasMore: false,
    calls: [{
      callId: ID(1), direction: "out", state: "ended", outcome: "answered", outcomeSource: "webhook",
      startedAt: "2031-01-05T08:00:00+00:00", answeredAt: "2031-01-05T08:00:05+00:00", endedAt: "2031-01-05T08:03:00+00:00",
      talkSeconds: 125, phone: "+996 ••• 00 00 01", managerName: "Менеджер Первый", participants: [{ name: "Менеджер Первый", state: "completed" }],
      recording: "available", resultCode: null, resultAt: null, resultByName: null, callbackOn: null, resultEditable: false,
    }],
  }).calls[0];
  const now = new Date("2031-01-05T12:00:00Z");
  assert.equal(leadCallRow(call, now).details, "+996 ••• 00 00 01 · Менеджер Первый · Есть запись");
  assert.equal(leadCallRow(call, now, null).details, "+996 ••• 00 00 01 · Менеджер Первый · Есть запись");
  assert.equal(leadCallRow(call, now, { canListen: true, legs: [{ legId: LEG, state: "available" }] }).details, "+996 ••• 00 00 01 · Менеджер Первый");
});

// ------------------------------------------------------------ the rendered page

const pages = new Map(JSON.parse(execFileSync(process.execPath,
  [fileURLToPath(new URL("./e2e/numbers-static-render.cjs", import.meta.url)), "--json-telephony"],
  { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })).map((page) => [page.name, page.html]));
const callRows = (html) => html.match(/<li [^>]*data-feed="call"[^>]*>[\s\S]*?<\/li>/gu) ?? [];
const feedOf = (html) => html.slice(html.indexOf('data-testid="v3-lead-feed-items"'), html.indexOf("</ol>", html.indexOf('data-testid="v3-lead-feed-items"')));

test("rendered lead: recordings read by the database show «Слушать» and the words of each state under the call", () => {
  const html = pages.get("lead-recordings");
  const rows = callRows(html).map(text);
  assert.equal(rows.length, 7);
  assert.match(rows[0], /^Исходящий звонок · разговор 2 мин 05 с 26\.09 14:00 \+996 ••• 00 00 01 · Санжар Эскизов Слушать$/u, "one recording: «Слушать», and no «Есть запись»");
  assert.match(rows[1], /^Входящий звонок · разговор 2 мин 05 с 26\.09 13:30 \+996 ••• 00 00 01 · Санжар Эскизов Слушать запись 1 Слушать запись 2$/u);
  assert.match(rows[2], /Санжар Эскизов Запись временно недоступна$/u);
  assert.match(rows[3], /Санжар Эскизов Запись удалена по сроку хранения$/u);
  assert.match(rows[4], /Санжар Эскизов Запись доступна руководителю$/u, "a recording the reader may not play is told, not offered");
  assert.match(rows[5], /Санжар Эскизов · Есть запись$/u, "a call the recordings read did not answer for keeps the old words");
  assert.match(rows[6], /^Исходящий звонок · занято 26\.09 11:00 \+996 ••• 00 00 01$/u, "no recording, nothing said");
  const blocks = html.match(/<div class="mt-1" data-testid="v3-call-recording">[\s\S]*?<p role="status"[^>]*><\/p><\/div>/gu) ?? [];
  assert.equal(blocks.length, 5, "a block for each call the database spoke about");
  const buttons = [...html.matchAll(/<button type="button" class="([^"]*)" aria-expanded="(true|false)">([\s\S]*?)<\/button>/gu)]
    .filter((match) => /Слушать/u.test(match[3]));
  assert.equal(buttons.length, 3);
  for (const [, classes, expanded, content] of buttons) {
    assert.match(classes, /min-h-11/u, "targets are 44 px");
    assert.equal(expanded, "false", "nothing plays until pressed");
    assert.match(content, /^<svg [^>]*aria-hidden="true"[^>]*><polygon points="6 3 20 12 6 21 6 3"\/><\/svg>Слушать( запись [12])?$/u);
  }
  assert.equal((html.match(/role="group" aria-label="Запись разговора"/gu) ?? []).length, 2);
});

test("rendered lead: nothing loads before a press — no audio element, no source address, no link, no file name", () => {
  for (const name of ["lead-recordings", "lead-recordings-null", "lead-recordings-unread"]) {
    const html = pages.get(name);
    assert.doesNotMatch(feedOf(html), /<audio|<source|src=|https?:|\.mp3|recording_link|\/api\/v3\/telephony\/recordings|700000001|autoplay/iu, name);
    assert.doesNotMatch(html, /\.mp3|recording_link|recordingLink/u, name);
  }
  assert.equal(solidRed(pages.get("lead-recordings")), solidRed(pages.get("lead-none")), "the player adds no solid red");
  assert.doesNotMatch(pages.get("lead-recordings"), /data-testid="v3-call-result"/u, "no result strip where the database allowed none");
});

test("rendered lead: recordings not read (null) or not asked for look exactly like the T5 feed — no player at all", () => {
  const unread = pages.get("lead-recordings-unread");
  assert.equal(pages.get("lead-recordings-null"), unread, "«not read» and «not asked» are the same page");
  assert.equal((unread.match(/data-testid="v3-call-recording"/gu) ?? []).length, 0);
  const rows = callRows(unread).map(text);
  assert.equal(rows.length, 7);
  assert.match(rows[0], /Санжар Эскизов · Есть запись$/u);
  assert.match(rows[2], /Санжар Эскизов · Запись временно недоступна$/u);
  assert.match(rows[3], /Санжар Эскизов · Запись удалена по сроку хранения$/u);
  assert.doesNotMatch(text(unread), /Слушать|доступна руководителю/u);
});
