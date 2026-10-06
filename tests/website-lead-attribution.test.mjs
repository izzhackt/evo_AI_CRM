import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { parseWebsiteEnquiryAttribution } from "../src/lib/website-enquiry-contract.ts";
import { receiveWebsiteLead } from "../src/lib/server/website-lead-intake.ts";

/**
 * Метки перехода сайта (План «Маркетинг» §8 С4, миграция 263). Приёмник проверяется настоящим
 * `receiveWebsiteLead`; вместо PostgREST стоит локальный HTTP-приёмник, который только записывает
 * вызов RPC и отвечает `accepted`. Поведение самой базы (очистка меток, касания, повтор) — в
 * `supabase/tests/platform_marketing_m1.sql`, здесь оно не проверяется и не подменяется.
 */
const KEY = "k".repeat(43);
const REQUEST_ID = "11111111-2222-4333-8444-555555555555";
const calls = [];
const server = createServer((request, response) => {
  const chunks = [];
  request.on("data", (chunk) => chunks.push(chunk));
  request.on("end", () => {
    calls.push({ path: request.url, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ status: "accepted", request_id: REQUEST_ID }));
  });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
Object.assign(process.env, {
  EVO_WEBSITE_INTAKE_EDGE_KEY: KEY,
  EVO_PLATFORM_ORGANIZATION_ID: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  EVO_WEBSITE_INTAKE_OWNER_MEMBERSHIP_ID: "ffffffff-0000-4111-8222-333333333333",
  NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${port}`,
  EVO_PLATFORM_SUPABASE_SECRET_KEY: "sb_secret_synthetic_test_key_000",
});
test.after(() => server.close());

const LEGACY = {
  requestId: REQUEST_ID, name: "Тест Синтетический", phone: "+996 555 000 000", age: 18, city: "Бишкек",
  country: "Malaysia", consent: true, website: "",
};
function post(body, headers = {}) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return receiveWebsiteLead(new Request("https://crm.test/api/public/website-leads", {
    method: "POST",
    headers: {
      "content-type": "application/json", origin: "https://evoadmissions.com", "x-evo-website-key": KEY,
      "x-evo-website-ip": "203.0.113.7", ...headers,
    },
    body: text,
  }));
}
async function accepted(extra) {
  const before = calls.length;
  const response = await post({ ...LEGACY, ...extra });
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  assert.equal(calls.length, before + 1);
  return calls.at(-1).body;
}

test("a legacy payload without attribution is accepted and the RPC call carries no p_attribution", async () => {
  const rpc = await accepted({});
  assert.equal(Object.hasOwn(rpc, "p_attribution"), false);
  assert.deepEqual(Object.keys(rpc).sort(), [
    "p_age", "p_city", "p_consent", "p_country", "p_ip_hash", "p_name", "p_organization_id", "p_owner_membership_id",
    "p_phone", "p_request_id", "p_university",
  ]);
  assert.equal(calls.at(-1).path, "/rest/v1/rpc/receive_website_lead");
});

test("attribution survives sanitised, unknown sub-keys are dropped and fbclid becomes has_fbclid only", async () => {
  const seen = new Date(Date.now() - 3_600_000).toISOString();
  const rpc = await accepted({ attribution: {
    v: 1, utm_source: "instagram", utm_medium: "paid_social", utm_campaign: "Лето 2026", utm_content: "reel-1", utm_term: "malaysia",
    utm_id: "120210000000", fbclid: "IwAR0synthetic-click-id", referrer_host: "L.Instagram.com", landing_path: "/guides/apu/",
    seen_at: seen, session_cookie: "must-not-pass", extra: { nested: true },
  } });
  assert.deepEqual(rpc.p_attribution, {
    utm_source: "instagram", utm_medium: "paid_social", utm_campaign: "Лето 2026", utm_content: "reel-1", utm_term: "malaysia",
    utm_id: "120210000000", has_fbclid: true, referrer_host: "l.instagram.com", landing_path: "/guides/apu/", seen_at: seen,
  });
  assert.equal(JSON.stringify(rpc).includes("IwAR0synthetic-click-id"), false, "the click id is never forwarded");
});

test("bad sub-fields are dropped and the lead is still accepted; nothing left means no p_attribution", async () => {
  const mixed = await accepted({ attribution: {
    v: 1, utm_source: "a@b.example", utm_medium: "paid_social", utm_campaign: "x".repeat(101), utm_content: "tel 9965550001234",
    utm_term: "100%40x", utm_id: "abc", referrer_host: "-bad_host", landing_path: "/p?x=1", seen_at: "yesterday", has_fbclid: "yes",
  } });
  assert.deepEqual(mixed.p_attribution, { utm_medium: "paid_social" });
  const none = await accepted({ attribution: {
    v: 1, utm_source: "a b", utm_medium: 7, utm_campaign: ["x"], utm_id: "12a", referrer_host: "http://x.example/", landing_path: "no-slash",
    seen_at: new Date(Date.now() + 86_400_000).toISOString(),
  } });
  assert.equal(Object.hasOwn(none, "p_attribution"), false);
  // seen_at alone is not attribution.
  const lone = await accepted({ attribution: { v: 1, seen_at: new Date().toISOString() } });
  assert.equal(Object.hasOwn(lone, "p_attribution"), false);
});

test("a non-object attribution is ignored, never a 400", async () => {
  for (const attribution of ["utm_source=instagram", ["utm_source"], 5, true, null]) {
    const rpc = await accepted({ attribution });
    assert.equal(Object.hasOwn(rpc, "p_attribution"), false, JSON.stringify(attribution));
  }
  // An unknown version is not guessed at.
  const rpc = await accepted({ attribution: { v: 2, utm_source: "instagram" } });
  assert.equal(Object.hasOwn(rpc, "p_attribution"), false);
});

test("every other validation is unchanged: unknown top-level keys still answer 400 and nothing reaches the database", async () => {
  const before = calls.length;
  for (const extra of [{ utm_source: "instagram" }, { fbclid: "x" }, { tracking: {} }, { attributions: {} }]) {
    const response = await post({ ...LEGACY, ...extra });
    assert.equal(response.status, 400, JSON.stringify(extra));
    assert.deepEqual(await response.json(), { error: "invalid_request" });
  }
  const { website: _website, ...missing } = LEGACY;
  assert.equal((await post({ ...missing, attribution: { v: 1, utm_source: "instagram" } })).status, 400);
  assert.equal((await post({ ...LEGACY, consent: false, attribution: { v: 1, utm_source: "instagram" } })).status, 400);
  assert.equal((await post({ ...LEGACY, website: "bot", attribution: { v: 1, utm_source: "instagram" } })).status, 400);
  assert.equal(calls.length, before);
});

test("the body cap is unchanged: an oversized body is 413 before any parsing", async () => {
  const before = calls.length;
  const big = { ...LEGACY, attribution: { v: 1, utm_campaign: "a".repeat(9000) } };
  const response = await post(big);
  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), { error: "request_too_large" });
  assert.equal(calls.length, before);
});

test("sanitising follows the SQL rules field by field", () => {
  const now = Date.parse("2026-10-06T12:00:00Z");
  const parse = (value) => parseWebsiteEnquiryAttribution(value, now);
  assert.equal(parse(undefined), null);
  assert.equal(parse({}), null);
  assert.equal(parse({ v: 1 }), null);
  assert.deepEqual(parse({ utm_source: "  instagram  " }), { utm_source: "instagram" });
  // token: no spaces, no Cyrillic; label: letters of both alphabets, digits, space.
  assert.equal(parse({ utm_source: "ins tagram" }), null);
  assert.equal(parse({ utm_source: "инстаграм" }), null);
  assert.deepEqual(parse({ utm_campaign: "Лето 2026 Malaysia" }), { utm_campaign: "Лето 2026 Malaysia" });
  assert.equal(parse({ utm_campaign: "Лето/2026" }), null);
  // @, %40, 7+ digits in a row are personal-data-shaped and dropped everywhere except utm_id.
  for (const value of ["me@x", "me%40x", "id1234567x", "1234567"]) assert.equal(parse({ utm_term: value }), null, value);
  assert.deepEqual(parse({ utm_term: "123456" }), { utm_term: "123456" });
  assert.deepEqual(parse({ utm_id: "12345678901234567890" }), { utm_id: "12345678901234567890" });
  assert.equal(parse({ utm_id: "123456789012345678901" }), null);
  assert.equal(parse({ utm_id: "12 34" }), null);
  // host and path.
  assert.deepEqual(parse({ referrer_host: "WWW.Google.COM" }), { referrer_host: "www.google.com" });
  for (const host of ["localhost", "a..b", "http://x.com", "x.com/path", "x.com:80", "x_y.com", "x".repeat(250) + ".com"]) {
    assert.equal(parse({ referrer_host: host }), null, host);
  }
  assert.deepEqual(parse({ landing_path: "/" }), { landing_path: "/" });
  for (const path of ["guides", "/a?b", "/a#b", "/a b", "/a@b", "/" + "x".repeat(200)]) assert.equal(parse({ landing_path: path }), null, path);
  // has_fbclid: only `true`; a click id string is converted, an empty one is not.
  assert.deepEqual(parse({ has_fbclid: true }), { has_fbclid: true });
  assert.equal(parse({ has_fbclid: false }), null);
  assert.equal(parse({ has_fbclid: "true" }), null);
  assert.deepEqual(parse({ fbclid: "IwAR-synthetic" }), { has_fbclid: true });
  assert.equal(parse({ fbclid: "   " }), null);
  assert.equal(parse({ fbclid: 7 }), null);
  // seen_at: ISO with zone, not in the future, not older than 30 days; normalised to UTC.
  const base = { utm_source: "instagram" };
  assert.deepEqual(parse({ ...base, seen_at: "2026-10-06T10:00:00+05:00" }), { ...base, seen_at: "2026-10-06T05:00:00.000Z" });
  assert.deepEqual(parse({ ...base, seen_at: "2026-10-06T10:00:00+05" }), { ...base, seen_at: "2026-10-06T05:00:00.000Z" }, "an offset without minutes, as SQL accepts it");
  for (const at of ["2026-10-06T12:00:01Z", "2026-09-06T11:59:59Z", "2026-10-06", "2026-10-06T10:00:00", "garbage", 5]) {
    assert.deepEqual(parse({ ...base, seen_at: at }), base, String(at));
  }
  assert.deepEqual(parse({ ...base, seen_at: "2026-09-06T12:00:00Z" }), { ...base, seen_at: "2026-09-06T12:00:00.000Z" });
});
