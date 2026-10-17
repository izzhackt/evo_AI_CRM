import assert from "node:assert/strict";
import test from "node:test";

import {
  parseTelephonyBody,
  readBoundedTelephonyBody,
  telephonyBodyBucket,
  telephonyBodyKind,
  telephonyLogMediaType,
  telephonyMediaType,
  TELEPHONY_MAX_BODY_BYTES,
} from "../src/lib/server/platform-telephony-ingress-body.ts";

// Synthetic values only.
const bytes = (text) => new TextEncoder().encode(text);
const parse = (kind, text, contentType = "application/x-www-form-urlencoded") =>
  parseTelephonyBody(kind, bytes(text), contentType);
const entries = (map) => (map === null ? null : Object.fromEntries(map));

test("media type: parameters and case are ignored; only the four documented kinds are accepted", () => {
  assert.equal(telephonyMediaType("Application/JSON; charset=utf-8"), "application/json");
  assert.equal(telephonyMediaType(null), "");
  assert.equal(telephonyBodyKind("application/x-www-form-urlencoded; charset=UTF-8"), "form");
  assert.equal(telephonyBodyKind("application/json"), "json");
  assert.equal(telephonyBodyKind("multipart/form-data; boundary=x"), "multipart");
  assert.equal(telephonyBodyKind("text/plain;charset=utf-8"), "text");
  for (const other of [null, "", "text/html", "application/xml", "application/jsonx", "multipart/mixed", "form"]) {
    assert.equal(telephonyBodyKind(other), null, String(other));
  }
});

test("the logged media type is short, parameter-free and shaped like a media type, or «other»/«none»", () => {
  assert.equal(telephonyLogMediaType("application/json; charset=utf-8; secret=996555000111"), "application/json");
  assert.equal(telephonyLogMediaType(null), "none");
  assert.equal(telephonyLogMediaType(""), "none");
  assert.equal(telephonyLogMediaType("996555000111"), "other");
  assert.equal(telephonyLogMediaType("a/b c"), "other");
  assert.equal(telephonyLogMediaType(`application/${"x".repeat(80)}`), "other");
  assert.equal(telephonyLogMediaType("text/plain\nx"), "other");
});

test("size buckets", () => {
  assert.equal(telephonyBodyBucket(0), "le_1k");
  assert.equal(telephonyBodyBucket(1024), "le_1k");
  assert.equal(telephonyBodyBucket(1025), "le_4k");
  assert.equal(telephonyBodyBucket(4096), "le_4k");
  assert.equal(telephonyBodyBucket(4097), "le_32k");
  assert.equal(telephonyBodyBucket(TELEPHONY_MAX_BODY_BYTES), "le_32k");
  assert.equal(telephonyBodyBucket(TELEPHONY_MAX_BODY_BYTES + 1), "gt_32k");
  assert.equal(telephonyBodyBucket(null), "gt_32k");
});

test("form: the portal's documented transport decodes percent escapes, plus signs and UTF-8", async () => {
  const fields = entries(
    await parse(
      "form",
      "cmd=history&type=out&status=Success&phone=996312000111&user=admin&start=20170703T121110Z" +
        "&duration=124&link=https%3A%2F%2Fexample.test%2Fa.mp3&crm_token=synthetic-key&callid=33274237" +
        "&groupRealName=%D0%9E%D1%82%D0%B4%D0%B5%D0%BB+%D0%BF%D1%80%D0%BE%D0%B4%D0%B0%D0%B6&note=a%2Bb",
    ),
  );
  assert.equal(fields.cmd, "history");
  assert.equal(fields.link, "https://example.test/a.mp3");
  assert.equal(fields.groupRealName, "Отдел продаж");
  assert.equal(fields.note, "a+b");
  assert.equal(fields.duration, "124");
});

test("form: empty values are kept as empty strings; a key without a value is allowed", async () => {
  assert.deepEqual(entries(await parse("form", "cmd=contact&diversion=&flag")), {
    cmd: "contact",
    diversion: "",
    flag: "",
  });
});

test("form: limits are exact — 32 fields, a 64-character key, a 2048-character value, a 1024-character link", async () => {
  const thirtyTwo = Array.from({ length: 32 }, (_, i) => `f${i}=1`).join("&");
  assert.equal((await parse("form", thirtyTwo)).size, 32);
  assert.equal(await parse("form", `${thirtyTwo}&one_more=1`), null);
  assert.ok(await parse("form", `${"k".repeat(64)}=1`));
  assert.equal(await parse("form", `${"k".repeat(65)}=1`), null);
  assert.ok(await parse("form", `v=${"x".repeat(2048)}`));
  assert.equal(await parse("form", `v=${"x".repeat(2049)}`), null);
  assert.ok(await parse("form", `link=${"x".repeat(1024)}`));
  assert.equal(await parse("form", `link=${"x".repeat(1025)}`), null);
});

test("form: a repeated key, __proto__ and an empty key are refused; constructor-like names are plain keys", async () => {
  assert.equal(await parse("form", "a=1&a=2"), null);
  assert.equal(await parse("form", "a=1&a=1"), null);
  assert.equal(await parse("form", "__proto__=x"), null);
  assert.equal(await parse("form", "=x"), null);
  assert.equal(await parse("form", ""), null);
  const plain = await parse("form", "constructor=x&prototype=y&toString=z");
  assert.deepEqual(entries(plain), { constructor: "x", prototype: "y", toString: "z" });
  assert.equal(Object.getPrototypeOf(Object.fromEntries(plain)), Object.prototype);
});

test("json: a flat object of strings, numbers, booleans and null", async () => {
  const fields = entries(
    await parse(
      "json",
      ' \n{ "cmd" : "event", "duration": 124, "rating": -4.5e1, "ok": true, "off": false, "gone": null,\n' +
        ' "text": "line\\nbreak \\u0041 \\"quoted\\" \\\\ slash \\/ end" }  ',
      "application/json",
    ),
  );
  assert.deepEqual(fields, {
    cmd: "event",
    duration: "124",
    rating: "-4.5e1",
    ok: "true",
    off: "false",
    text: 'line\nbreak A "quoted" \\ slash / end',
  });
  // A number is kept as written, not re-formatted.
  assert.equal(entries(await parse("json", '{"a":0.10,"b":1E3}', "application/json")).a, "0.10");
});

test("json: nesting, arrays, a repeated key (even after null), __proto__, trailing text, bad escapes and bad literals are refused", async () => {
  for (const body of [
    "",
    "{}",
    "[]",
    "[1]",
    "1",
    '"x"',
    "null",
    '{"a":{"b":1}}',
    '{"a":[1]}',
    '{"a":1,"a":2}',
    '{"a":null,"a":"x"}',
    '{"__proto__":"x"}',
    '{"a":1} {"b":2}',
    '{"a":1}x',
    '{"a":1,}',
    '{"a":1',
    '{"a" 1}',
    '{a:1}',
    "{'a':1}",
    '{"a":"\\x"}',
    '{"a":"\\u12"}',
    '{"a":"tab\tinside"}',
    '{"a":01}',
    '{"a":1.}',
    '{"a":+1}',
    '{"a":tru}',
    '{"a":nullx}',
    '{"a":NaN}',
    '{"a":Infinity}',
    '{"cmd":"event"\n"type":"INCOMING"}',
    `{"${"k".repeat(65)}":1}`,
    `{"v":"${"x".repeat(2049)}"}`,
    `{${Array.from({ length: 33 }, (_, i) => `"f${i}":1`).join(",")}}`,
  ]) {
    assert.equal(await parse("json", body, "application/json"), null, body.slice(0, 60));
  }
  assert.equal(
    (await parse("json", `{${Array.from({ length: 32 }, (_, i) => `"f${i}":1`).join(",")}}`, "application/json")).size,
    32,
  );
});

test("json: a 200 000-character nest does not recurse or stall", async () => {
  const deep = `{"a":${"[".repeat(200_000)}${"]".repeat(200_000)}}`;
  const started = performance.now();
  assert.equal(await parse("json", deep, "application/json"), null);
  assert.ok(performance.now() - started < 1000);
});

test("text/plain: a JSON object when it starts with a brace, otherwise a form", async () => {
  assert.deepEqual(entries(await parse("text", '  {"cmd":"event"}', "text/plain")), { cmd: "event" });
  assert.deepEqual(entries(await parse("text", "cmd=event&type=x", "text/plain; charset=utf-8")), {
    cmd: "event",
    type: "x",
  });
  assert.equal(await parse("text", '{"cmd":"event"', "text/plain"), null);
});

test("multipart: text parts only", async () => {
  const form = new FormData();
  form.append("cmd", "event");
  form.append("callid", "c1");
  const request = new Request("http://localhost/x", { method: "POST", body: form });
  const body = new Uint8Array(await request.arrayBuffer());
  const contentType = request.headers.get("content-type");
  assert.deepEqual(entries(await parseTelephonyBody("multipart", body, contentType)), {
    cmd: "event",
    callid: "c1",
  });
  // The same bytes under a different boundary are not a multipart body.
  assert.equal(await parseTelephonyBody("multipart", body, "multipart/form-data; boundary=other"), null);
  assert.equal(await parseTelephonyBody("multipart", new Uint8Array(0), contentType), null);
  // A repeated part is a repeated key.
  const twice = new FormData();
  twice.append("cmd", "event");
  twice.append("cmd", "history");
  const repeated = new Request("http://localhost/x", { method: "POST", body: twice });
  assert.equal(
    await parseTelephonyBody(
      "multipart",
      new Uint8Array(await repeated.arrayBuffer()),
      repeated.headers.get("content-type"),
    ),
    null,
  );
});

test("an empty body is never parsed", async () => {
  for (const kind of ["form", "json", "multipart", "text"]) {
    assert.equal(await parseTelephonyBody(kind, new Uint8Array(0), "x/y"), null, kind);
  }
});

test("invalid UTF-8 does not throw; it is replaced and the form still parses", async () => {
  const body = new Uint8Array([...bytes("cmd=event&name="), 0xff, 0xfe, ...bytes("&callid=1")]);
  const fields = entries(await parseTelephonyBody("form", body, "application/x-www-form-urlencoded"));
  assert.equal(fields.callid, "1");
  assert.ok(fields.name.includes("�"));
});

test("the bounded reader stops an endless body and returns the bytes of a small one", async () => {
  const small = new Request("http://localhost/x", { method: "POST", body: "cmd=contact" });
  assert.equal(new TextDecoder().decode(await readBoundedTelephonyBody(small)), "cmd=contact");
  const none = new Request("http://localhost/x", { method: "POST" });
  assert.equal((await readBoundedTelephonyBody(none)).byteLength, 0);

  let cancelled = false;
  let pulls = 0;
  const endless = new Request("http://localhost/x", {
    method: "POST",
    body: new ReadableStream(
      {
        pull(controller) {
          pulls += 1;
          controller.enqueue(new Uint8Array(8 * 1024));
        },
        cancel() {
          cancelled = true;
        },
      },
      { highWaterMark: 0 },
    ),
    duplex: "half",
  });
  assert.equal(await readBoundedTelephonyBody(endless), null);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(cancelled, true);
  assert.ok(pulls <= 6, `pulled ${pulls}`);

  // Exactly the cap is fine; a byte more is not.
  const exact = new Request("http://localhost/x", { method: "POST", body: new Uint8Array(TELEPHONY_MAX_BODY_BYTES) });
  assert.equal((await readBoundedTelephonyBody(exact)).byteLength, TELEPHONY_MAX_BODY_BYTES);
  const over = new Request("http://localhost/x", { method: "POST", body: new Uint8Array(TELEPHONY_MAX_BODY_BYTES + 1) });
  assert.equal(await readBoundedTelephonyBody(over), null);
});
