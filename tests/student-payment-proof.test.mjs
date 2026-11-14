// «Чек студента к уже принятой оплате» (решение владельца 14.11.2026, миграция 360). Сторону базы (права, один файл на оплату, гонка, повтор,
// деньги не двигаются, журнал, уведомление) доказывает supabase/tests/platform_student_payment_proof.sql; здесь - маршрут (настоящий обработчик с
// подставными клиентами и настоящим разбором multipart, антивирус - узкий тестовый сервер по протоколу clamd), правила строк, словарь (RU и KY) и
// устройство вёрстки.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:net";
import test, { after, before } from "node:test";

import { createStudentPaymentProofUploadHandler } from "../src/lib/server/student-payment-proof-route-handlers.ts";
import { isConnectedStudentPortalApi } from "../src/lib/platform-route-contract.ts";
import { parsePaymentCenter } from "../src/lib/portal/payment-center.ts";
import { parsePaymentProofResult, paymentProofFileHref, PAYMENT_PROOF_UPLOAD_PATH } from "../src/lib/portal/payment-proof.ts";
import { buildPaymentSchedule } from "../src/lib/portal/payment-rows.ts";
import { getPortalStrings } from "../src/lib/portal/i18n.ts";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

const ORG = "36000000-0000-4000-8000-000000000001";
const CASE = "36000000-0000-4000-8000-000000000701";
const STUDENT = "36000000-0000-4000-8000-000000000302";
const EVENT = "36000000-0000-4000-8000-000000009001";
const FILE = "36000000-0000-4000-8000-000000009002";
const KEY = "36000000-0000-4000-8000-000000009003";
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

// Узкий сервер по протоколу clamd (сессия: VERSION, INSTREAM, VERSION, END): отвечает «чисто» или «найдено» по первому байту файла.
let clamd;
const scanned = [];
before(async () => {
  clamd = createServer((socket) => {
    let buffer = Buffer.alloc(0);
    let streaming = false;
    let streamed = [];
    let replyId = 0;
    const version = () => socket.write(`${++replyId}: ClamAV 1.4.2/27800/Wed Nov 12 08:00:00 2026\0`);
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      for (;;) {
        if (!streaming) {
          const end = buffer.indexOf(0);
          if (end < 0) return;
          const command = buffer.subarray(0, end).toString("ascii");
          buffer = buffer.subarray(end + 1);
          if (command === "zIDSESSION") continue;
          if (command === "zVERSION") version();
          else if (command === "zINSTREAM") { streaming = true; streamed = []; }
          else if (command === "zEND") { socket.end(); return; }
        } else {
          if (buffer.length < 4) return;
          const size = buffer.readUInt32BE(0);
          if (buffer.length < 4 + size) return;
          if (size === 0) {
            const bytes = Buffer.concat(streamed);
            scanned.push(bytes);
            socket.write(`${++replyId}: ${bytes[8] === 0x66 ? "stream: Eicar-Test-Signature FOUND" : "stream: OK"}\0`);
            buffer = buffer.subarray(4);
            streaming = false;
          } else {
            streamed.push(buffer.subarray(4, 4 + size));
            buffer = buffer.subarray(4 + size);
          }
        }
      }
    });
  });
  await new Promise((resolve) => clamd.listen(0, "127.0.0.1", resolve));
  process.env.EVO_CLAMD_HOST = "127.0.0.1";
  process.env.EVO_CLAMD_PORT = String(clamd.address().port);
});
after(async () => {
  await new Promise((resolve) => clamd.close(resolve));
});

function fakeClients({ target, record, uploadError = null } = {}) {
  const calls = { rpc: [], uploaded: [], removed: [] };
  const user = {
    schema: () => ({
      rpc: async (name, args) => {
        calls.rpc.push({ client: "user", name, args });
        return target ?? { data: { organization_id: ORG, student_case_id: CASE, student_membership_id: STUDENT, payment_event_id: EVENT, payment_obligation_id: ORG }, error: null };
      },
    }),
  };
  const service = {
    schema: () => ({
      rpc: async (name, args) => {
        calls.rpc.push({ client: "service", name, args });
        return record ?? { data: { organization_id: ORG, payment_event_id: EVENT, payment_receipt_file_id: FILE, original_filename: args.p_original_filename, replayed: false }, error: null };
      },
    }),
    storage: {
      from: (bucket) => ({
        upload: async (name, bytes, options) => {
          calls.uploaded.push({ bucket, name, size: bytes.byteLength, options });
          return { error: uploadError };
        },
        remove: async (names) => {
          calls.removed.push({ bucket, names });
          return { error: null };
        },
      }),
    },
  };
  return { calls, user, service };
}

function handlerWith(clients, actor = { status: "authenticated" }) {
  return createStudentPaymentProofUploadHandler({
    resolveCookieActor: async () => actor,
    createCookieClient: async () => clients.user,
    resolveBearerActor: async () => actor,
    createBearerClient: async () => clients.user,
    createServiceClient: () => clients.service,
  });
}

function upload({ bytes = PNG, type = "image/png", name = "slip.png", event = EVENT, key = KEY, origin = "https://app.test", headers = {}, extra = {} } = {}) {
  const form = new FormData();
  if (bytes) form.set("file", new File([bytes], name, { type }));
  if (event !== null) form.set("payment_event_id", event);
  for (const [field, value] of Object.entries(extra)) form.set(field, value);
  const all = { host: "app.test", ...(origin ? { origin } : {}), ...(key ? { "Idempotency-Key": key } : {}), ...headers };
  return new Request("https://app.test/api/portal/payment-proofs", { method: "POST", body: form, headers: all });
}
const code = async (response) => (await response.json()).error;

test("a Student attaches a file to an accepted payment: the database checks first, the scan before the write, the record last, the membership from the database", async () => {
  const clients = fakeClients();
  const response = await handlerWith(clients)(upload());
  assert.equal(response.status, 201);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { payment_receipt_file_id: FILE, original_filename: "slip.png" });
  assert.deepEqual(clients.calls.rpc.map((call) => `${call.client}:${call.name}`), ["user:student_payment_proof_target_v1", "service:record_student_payment_proof_v1"]);
  assert.deepEqual(clients.calls.rpc[0].args, { p_payment_event_id: EVENT, p_request_id: KEY, p_sha256_hex: clients.calls.rpc[1].args.p_sha256_hex },
    "the target gets the key and the hash so that a retry of the same request is recognised before any byte is stored");
  assert.equal(clients.calls.uploaded.length, 1);
  assert.equal(clients.calls.uploaded[0].bucket, "platform-documents");
  assert.match(clients.calls.uploaded[0].name, new RegExp(`^payment-receipts/${ORG}/${CASE}/[0-9a-f-]{36}$`));
  assert.deepEqual(clients.calls.uploaded[0].options, { contentType: "image/png", upsert: false });
  const record = clients.calls.rpc[1].args;
  assert.equal(record.p_organization_id, ORG);
  assert.equal(record.p_student_membership_id, STUDENT, "the Student comes from the database, never from the request");
  assert.equal(record.p_payment_event_id, EVENT);
  assert.equal(record.p_request_id, KEY, "the retry key is the request id");
  assert.equal(record.p_storage_object_name, clients.calls.uploaded[0].name);
  assert.equal(record.p_declared_mime_type, "image/png");
  assert.equal(record.p_byte_size, PNG.byteLength);
  assert.match(record.p_sha256_hex, /^[0-9a-f]{64}$/);
  assert.deepEqual(clients.calls.removed, []);
});

test("a replay of the same request answers 200 and drops the object that was just written", async () => {
  const clients = fakeClients({ record: { data: { organization_id: ORG, payment_event_id: EVENT, payment_receipt_file_id: FILE, original_filename: "slip.png", replayed: true }, error: null } });
  const response = await handlerWith(clients)(upload());
  assert.equal(response.status, 200);
  assert.equal((await response.json()).payment_receipt_file_id, FILE);
  assert.equal(clients.calls.removed.length, 1);
  assert.deepEqual(clients.calls.removed[0].names, [clients.calls.uploaded[0].name]);
});

test("a retry of a request that already succeeded gets its earlier result (200) without a scan, a write or a second record", async () => {
  const replay = { data: { organization_id: ORG, student_case_id: CASE, student_membership_id: STUDENT, payment_event_id: EVENT, payment_obligation_id: ORG,
    replay: { payment_receipt_file_id: FILE, original_filename: "slip.png" } }, error: null };
  const clients = fakeClients({ target: replay });
  const scannedBefore = scanned.length;
  const response = await handlerWith(clients)(upload());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { payment_receipt_file_id: FILE, original_filename: "slip.png" });
  assert.deepEqual(clients.calls.rpc.map((call) => call.name), ["student_payment_proof_target_v1"]);
  assert.deepEqual(clients.calls.uploaded, []);
  assert.equal(scanned.length, scannedBefore, "no byte went to the scanner");
  // Ответ не той формы вместо результата - отказ, а не успех.
  for (const strange of [{ replay: null }, { replay: {} }, { replay: { payment_receipt_file_id: "x", original_filename: "a" } }, { replay: { payment_receipt_file_id: FILE, original_filename: 1 } }]) {
    const odd = fakeClients({ target: { data: { ...replay.data, ...strange }, error: null } });
    assert.equal((await handlerWith(odd)(upload())).status, 503);
    assert.deepEqual(odd.calls.uploaded, []);
  }
  // Тот же ключ с другим файлом: конфликт (база), байты не нужны.
  const conflict = fakeClients({ target: { data: null, error: { code: "23505", message: "request_conflict" } } });
  const refused = await handlerWith(conflict)(upload());
  assert.equal(refused.status, 409);
  assert.deepEqual(await refused.json(), { error: "request_conflict" });
  assert.deepEqual(conflict.calls.uploaded, []);
});

test("the database refusals map to codes and nothing is stored when the target check refuses", async () => {
  for (const [error, status, expected] of [
    [{ code: "42501", message: "proof_forbidden" }, 403, "receipt_forbidden"],
    [{ code: "23505", message: "proof_exists" }, 409, "proof_exists"],
    [{ code: "22023", message: "whatever the database says" }, 400, "receipt_invalid"],
    [{ code: "XX000", message: "boom: details of the server" }, 503, "receipt_unavailable"],
  ]) {
    const clients = fakeClients({ target: { data: null, error } });
    const response = await handlerWith(clients)(upload());
    assert.equal(response.status, status);
    const body = await response.json();
    assert.deepEqual(body, { error: expected }, "only a code leaves the server, never the database text");
    assert.deepEqual(clients.calls.uploaded, [], "nothing is stored when the target check refuses");
    assert.deepEqual(clients.calls.rpc.map((call) => call.name), ["student_payment_proof_target_v1"]);
  }
});

test("a failed or lost race at the record removes the object and answers with a code", async () => {
  for (const [error, status, expected] of [
    [{ code: "23505", message: "proof_exists" }, 409, "proof_exists"],
    [{ code: "23505", message: "request_conflict" }, 409, "request_conflict"],
    [{ code: "42501", message: "proof_forbidden" }, 403, "receipt_forbidden"],
    [{ code: "22023", message: "proof_invalid" }, 400, "receipt_invalid"],
    [{ code: "08006", message: "connection lost" }, 503, "receipt_unavailable"],
  ]) {
    const clients = fakeClients({ record: { data: null, error } });
    const response = await handlerWith(clients)(upload());
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { error: expected });
    assert.equal(clients.calls.removed.length, 1, "an orphaned object is removed");
    assert.deepEqual(clients.calls.removed[0].names, [clients.calls.uploaded[0].name]);
  }
  const strange = fakeClients({ record: { data: { replayed: false }, error: null } });
  assert.equal((await handlerWith(strange)(upload())).status, 503);
  assert.equal(strange.calls.removed.length, 1);
  const storage = fakeClients({ uploadError: { message: "disk" } });
  const stored = await handlerWith(storage)(upload());
  assert.equal(stored.status, 503);
  assert.deepEqual(storage.calls.rpc.map((call) => call.name), ["student_payment_proof_target_v1"], "no record without the object");
});

test("a file that the scanner flags is never stored; an unreachable scanner fails closed", async () => {
  const infected = fakeClients();
  const bad = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x66, 2, 3, 4]);
  const flagged = await handlerWith(infected)(upload({ bytes: bad }));
  assert.equal(flagged.status, 422);
  assert.equal(await code(flagged), "malware_detected");
  assert.deepEqual(infected.calls.uploaded, []);
  assert.deepEqual(infected.calls.rpc.map((call) => call.name), ["student_payment_proof_target_v1"], "the record is never reached");

  const port = process.env.EVO_CLAMD_PORT;
  process.env.EVO_CLAMD_PORT = "1";
  try {
    const down = fakeClients();
    const refused = await handlerWith(down)(upload());
    assert.equal(refused.status, 503);
    assert.equal(await code(refused), "malware_scanner_unavailable");
    assert.deepEqual(down.calls.uploaded, []);
  } finally {
    process.env.EVO_CLAMD_PORT = port;
  }
});

test("the file is checked before the database is asked: size, type and signature", async () => {
  for (const [options, status, expected] of [
    [{ type: "text/html", name: "x.html" }, 415, "unsupported_mime_type"],
    [{ bytes: Uint8Array.from([1, 2, 3, 4, 5, 6]), type: "image/png" }, 400, "file_signature_mismatch"],
    [{ bytes: new Uint8Array(0) }, 413, "file_too_large"],
    [{ bytes: null }, 400, "invalid_upload"],
  ]) {
    const clients = fakeClients();
    const response = await handlerWith(clients)(upload(options));
    assert.equal(response.status, status);
    assert.equal(await code(response), expected);
    assert.deepEqual(clients.calls.rpc, []);
    assert.deepEqual(clients.calls.uploaded, []);
  }
  const big = fakeClients();
  const tooBig = await handlerWith(big)(upload({ headers: { "content-length": String(27 * 1024 * 1024) } }));
  assert.equal(tooBig.status, 413);
  assert.deepEqual(big.calls.rpc, []);
});

test("the payment and the key must be real ids; a missing payment is refused before the database", async () => {
  for (const options of [{ event: null }, { event: "not-an-id" }, { event: "00000000-0000-0000-0000-000000000000" }, { key: "not-a-key" }]) {
    const clients = fakeClients();
    const response = await handlerWith(clients)(upload(options));
    assert.equal(response.status, 400);
    assert.equal(await code(response), "invalid_fields");
    assert.deepEqual(clients.calls.rpc, []);
  }
  const noKey = fakeClients();
  const response = await handlerWith(noKey)(upload({ key: null }));
  assert.equal(response.status, 201);
  assert.match(noKey.calls.rpc[1].args.p_request_id, /^[0-9a-f-]{36}$/, "without a header the server makes a key");
});

test("a browser needs the same Origin and a session; the app needs a valid token; the Student comes only from the session", async () => {
  const clients = fakeClients();
  assert.equal((await handlerWith(clients)(upload({ origin: null }))).status, 403);
  assert.equal((await handlerWith(clients)(upload({ origin: "https://evil.test" }))).status, 403);
  assert.equal((await handlerWith(clients, { status: "anonymous" })(upload())).status, 401);
  assert.equal((await handlerWith(clients, { status: "denied", reason: "student_authority_invalid" })(upload())).status, 403);
  assert.equal((await handlerWith(clients, { status: "unavailable", reason: "student_authority_unavailable" })(upload())).status, 503);
  assert.equal((await handlerWith(clients)(upload({ headers: { authorization: "Basic abc" } }))).status, 401);
  assert.equal((await handlerWith(clients)(upload({ headers: { authorization: "Bearer not a token" } }))).status, 401);
  assert.deepEqual(clients.calls.rpc, [], "nothing reached the database");
  // Приложение (Bearer) Origin не шлёт и ходит с токеном.
  const jwt = "aaaa.bbbb.cccc";
  const app = fakeClients();
  assert.equal((await handlerWith(app)(upload({ origin: null, headers: { authorization: `Bearer ${jwt}` } }))).status, 201);
  assert.equal((await handlerWith(app, { status: "denied", reason: "student_authority_invalid" })(upload({ origin: null, headers: { authorization: `Bearer ${jwt}` } }))).status, 403);
  assert.equal((await handlerWith(app, { status: "denied", reason: "no_session" })(upload({ origin: null, headers: { authorization: `Bearer ${jwt}` } }))).status, 401);
  // Чужие поля формы (участник, дело, организация, сумма) никуда не идут.
  const forged = fakeClients();
  await handlerWith(forged)(upload({ extra: { student_membership_id: "x", organization_id: "x", student_case_id: "x", amount: "1", p_membership_id: "x" } }));
  const sent = JSON.stringify(forged.calls.rpc);
  assert.doesNotMatch(sent, /"x"/);
});

test("the proof route is wired, connected for one exact method, and the source keeps its order", () => {
  assert.match(read("../src/app/api/portal/payment-proofs/route.ts"), /createStudentPaymentProofUploadHandler\(\)/);
  assert.equal(isConnectedStudentPortalApi("/api/portal/payment-proofs", "POST"), true);
  assert.equal(isConnectedStudentPortalApi("/api/portal/payment-proofs", "GET"), false);
  assert.equal(isConnectedStudentPortalApi("/api/portal/payment-proofs/x", "POST"), false);
  const whole = read("../src/lib/server/student-payment-proof-route-handlers.ts");
  const source = whole.slice(whole.indexOf("export function createStudentPaymentProofUploadHandler"));
  assert.ok(source.indexOf('"student_payment_proof_target_v1"') < source.indexOf("scanOrRespond(upload"), "target check before the scan");
  assert.ok(source.indexOf("scanOrRespond(upload") < source.indexOf(".upload(objectName"), "the scan before the storage write");
  assert.ok(source.indexOf(".upload(objectName") < source.indexOf('"record_student_payment_proof_v1"'), "the record after the storage write");
  assert.match(source, /sameOrigin\(request\)/);
  assert.match(source, /resolveStudentPortalActor/);
  assert.match(source, /resolveStudentPortalBearerActor/);
  assert.doesNotMatch(source, /console\.|\.message\b[^;]*Response\.json|error\.message[^;]*errorResponse/u, "no server text in the answer or in logs");
  assert.doesNotMatch(source, /p_membership_id|membership_id:\s*request|form\.get\("(?:student|organization|membership|case)/u, "no identity from the client");
});

// ---------------------------------------------------------------------------------------------------------------------------------------
// Строки страницы «Оплата».
// ---------------------------------------------------------------------------------------------------------------------------------------
const payment = (over = {}) => ({
  kind: "payment", entryId: EVENT, status: "accepted", amountMinor: 60000, currency: "USD", onDate: "2026-10-02",
  rejectReason: null, fileKind: null, fileId: null, filename: null, ...over,
});
const due = (over = {}) => ({
  obligationId: ORG, label: "Получено в USD", category: "evo_service_fee", amountMinor: 60000, paidMinor: 60000, refundedMinor: 0, outstandingMinor: 0,
  currency: "USD", dueAt: null, status: "paid", overdue: false, nextAction: null, entries: [payment()], ...over,
});
const linesOf = (center) => buildPaymentSchedule({ details: null, unassigned: [], canUpload: true, dues: [], ...center }).groups.flatMap((group) => group.lines);

test("an accepted payment without a file offers the proof, and only that", () => {
  // Платёж, который куратор записал и принял без файла: «02.10.2026 · 600 $ · Чек — · Принято». Остатка нет, обычного «Приложить чек» нет.
  const [line] = linesOf({ dues: [due()] });
  assert.equal(line.status, "accepted");
  assert.equal(line.proofEventId, EVENT, "the id of the payment itself is the one the route takes");
  assert.equal(line.attach, false, "the request for a new payment is not offered on a paid-up payment");
  assert.equal(line.replace, false);
  assert.equal(line.fileId, null);
  // Настоящий ответ базы разбирается прежним строгим разборщиком, и id оплаты в нём уже есть: ключи не добавлялись.
  const parsed = parsePaymentCenter({
    details: null, can_upload: true, unassigned: [],
    dues: [{
      obligation_id: ORG, label: "Получено в USD", category: "evo_service_fee", amount_minor: 60000, paid_minor: 60000, refunded_minor: 0, outstanding_minor: 0,
      currency: "USD", due_at: null, derived_status: "paid", overdue: false, next_action: null,
      entries: [{ kind: "payment", entry_id: EVENT, status: "accepted", amount_minor: 60000, currency: "USD", on_date: "2026-10-02", reject_reason: null, file_kind: null, file_id: null, filename: null }],
    }],
  });
  assert.ok(parsed, "the unchanged strict parser still accepts the database answer");
  assert.equal(linesOf({ dues: parsed.dues, canUpload: parsed.canUpload })[0].proofEventId, EVENT);
});

test("no proof for a payment that has a file, for a refund, for a receipt under review or rejected, for an open balance, or when uploads are off", () => {
  const withFile = linesOf({ dues: [due({ entries: [payment({ fileKind: "receipt", fileId: FILE, filename: "slip.pdf" })] })] });
  assert.equal(withFile[0].proofEventId, null, "one file per payment: a payment that has a file offers nothing");
  const refund = linesOf({ dues: [due({ paidMinor: 60000, refundedMinor: 10000, outstandingMinor: 10000, entries: [payment(), payment({ kind: "refund", entryId: FILE, amountMinor: 10000 })] })] });
  // Возврат открыл остаток, поэтому у платежа три строки: оплата с доказательством, возврат и открытый остаток (прежний запрос на оплату).
  assert.deepEqual(refund.map((line) => [line.status, line.proofEventId]).sort(), [["accepted", EVENT], ["missing", null], ["refund", null]]);
  const receipts = linesOf({ dues: [due({ paidMinor: 0, outstandingMinor: 60000, entries: [
    { kind: "receipt", entryId: FILE, status: "review", amountMinor: 100, currency: "USD", onDate: "2026-11-01", rejectReason: null, fileKind: "student_receipt", fileId: FILE, filename: "a.jpg" },
    { kind: "receipt", entryId: KEY, status: "rejected", amountMinor: 100, currency: "USD", onDate: "2026-11-02", rejectReason: "Не видно", fileKind: "student_receipt", fileId: KEY, filename: "b.jpg" },
  ] })] });
  assert.ok(receipts.length >= 2 && receipts.every((line) => line.proofEventId === null), "a pending or rejected receipt is not a payment: no proof");
  const open = linesOf({ dues: [due({ paidMinor: 0, outstandingMinor: 60000, entries: [] })] });
  assert.equal(open[0].status, "missing");
  assert.equal(open[0].proofEventId, null);
  assert.equal(open[0].attach, true, "an open balance keeps the old request for a payment");
  const off = linesOf({ canUpload: false, dues: [due()] });
  assert.equal(off[0].proofEventId, null);
  const loose = buildPaymentSchedule({ details: null, canUpload: true, dues: [], unassigned: [{ kind: "receipt", entryId: FILE, status: "review", amountMinor: 100, currency: "USD", onDate: "2026-11-01", rejectReason: null, fileKind: "student_receipt", fileId: FILE, filename: "c.jpg" }] });
  assert.equal(loose.added[0].proofEventId, null);
});

test("the proof answer and the link are parsed strictly", () => {
  assert.equal(PAYMENT_PROOF_UPLOAD_PATH, "/api/portal/payment-proofs");
  assert.deepEqual(parsePaymentProofResult({ payment_receipt_file_id: FILE, original_filename: "slip.png" }), { fileId: FILE, filename: "slip.png" });
  assert.equal(parsePaymentProofResult({ payment_receipt_file_id: FILE, original_filename: "\u0007\u0007" }).filename, "file");
  assert.equal(Array.from(parsePaymentProofResult({ payment_receipt_file_id: FILE, original_filename: "я".repeat(400) }).filename).length, 255);
  for (const bad of [null, [], "x", {}, { payment_receipt_file_id: FILE }, { payment_receipt_file_id: "nope", original_filename: "a" }, { payment_receipt_file_id: FILE, original_filename: 1 },
    { payment_receipt_file_id: FILE, original_filename: "a", extra: 1 }]) {
    assert.equal(parsePaymentProofResult(bad), null);
  }
  assert.equal(paymentProofFileHref(FILE), `/api/portal/case-files/receipt/${FILE}/download`);
});

test("the Student strings exist in RU and KY, say only that the receipt is attached, and carry no data-reminder wording", () => {
  const ru = getPortalStrings("admission", "ru");
  const ky = getPortalStrings("admission", "ky");
  assert.equal(ru.proofAttached, "Чек приложен");
  assert.equal(ky.proofAttached, "Чек тиркелди");
  assert.match(read("../src/lib/portal/i18n.ts"), /proofAttached: "Чек тиркелди", \/\/ KY: needs native proofreading/);
  for (const text of [ru.proofAttached, ky.proofAttached]) {
    assert.doesNotMatch(text, /антивирус|политик|согласи|хранен|шифр|только вы|видите|ИИ|коммерч|конфиденц|купуя/iu);
  }
  assert.equal(ru.receiptAttach, "Приложить чек", "the button keeps the existing words");
});

test("the slot follows the page rules: a real button of 44px, the focus is set by hand, no effect hooks, one POST", () => {
  const form = read("../src/components/portal/admission/PaymentReceiptForm.tsx");
  const slot = form.slice(form.indexOf("export function ProofSlot"), form.indexOf("/** «Добавить платёж»"));
  assert.match(slot, /payment_event_id/);
  assert.match(slot, /flushSync\(\(\) => setFile\(next\)\);\s*focusNow\(saveRef\)/, "the focus moves to «Сохранить» as for a receipt");
  assert.match(slot, /focusNow\(sentRef\)/, "the focus moves to the confirmation");
  assert.match(slot, /role="status"/);
  assert.match(slot, /aria-label=\{`\$\{strings\.receiptAttach\}: \$\{context\}`\}/, "each button names its payment");
  assert.match(slot, /pt-pay-slot/);
  assert.doesNotMatch(form, /useEffect/u);
  assert.doesNotMatch(slot, /amount|currency|paid_on|payment_obligation_id/u, "the proof sends only the file and the payment: nothing money-shaped");
  assert.match(form, /fetch\(PAYMENT_PROOF_UPLOAD_PATH/);
  assert.match(form, /"Idempotency-Key": attemptKey\.current/);
  const view = read("../src/components/portal/admission/PaymentsView.tsx");
  assert.match(view, /line\.proofEventId \? <ProofSlot/);
  assert.match(view, /!href && !mode && !line\.proofEventId \? <span className="pt-pay-nofile">/);
  const css = read("../src/app/(portal)/portal.css");
  assert.match(css, /\.pt-pay-slot \{[^}]*min-height: 44px/, "the button is at least 44px high");
  assert.match(css, /\.pt-pay-save \{[^}]*min-height: 44px/);
  assert.match(css, /\.pt-pay-clear \{[^}]*width: 44px;[^}]*height: 44px/);
  assert.match(css, /a\.pt-pay-file \{[^}]*overflow-wrap: anywhere/, "a long file name wraps");
  assert.match(css, /\.pt-pay-filename \{[^}]*overflow-wrap: anywhere/);
});

/** Тело `{ … }`, которое открывается после первого вхождения `marker` (вложенные скобки считаются). */
function blockAfter(source, marker) {
  const at = source.indexOf(marker);
  assert.notEqual(at, -1, `${marker} is in the source`);
  const open = source.indexOf("{", at);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}" && (depth -= 1) === 0) return source.slice(open + 1, index);
  }
  throw new Error(`${marker}: unbalanced block`);
}

test("the proof slot does not refresh the page after a saved file, so the focus stays on «Чек приложен»; it refreshes when the server says the file already exists", () => {
  const form = read("../src/components/portal/admission/PaymentReceiptForm.tsx");
  const slot = form.slice(form.indexOf("export function ProofSlot"), form.indexOf("/** «Добавить платёж»"));
  const submit = blockAfter(slot, "async function submit");
  const saved = blockAfter(submit, "if (result.ok)");
  const exists = blockAfter(submit, "if (result.exists)");
  const count = (text, needle) => text.split(needle).length - 1;
  // Saved: the screen changes and the confirmation takes the focus, both by hand (no effect hooks, no waiting for a refresh).
  assert.match(saved, /flushSync\(\(\) => \{[^}]*setState\("sent"\)[^}]*\}\);\s*focusNow\(sentRef\);/);
  // The one refresh the saved branch may have is the line for an answer of an unexpected shape (there is no file id to link to, so the
  // page data brings the link): it stays behind its guard and after the focus. Any other refresh here would unmount the slot, drop the
  // confirmation and lose the focus.
  const guarded = "if (!result.result) router.refresh();";
  assert.equal(count(saved, "router.refresh()"), count(saved, guarded), "every refresh of the saved branch is the guarded one");
  assert.ok(count(saved, guarded) <= 1, "and there is at most one of it");
  if (count(saved, guarded) === 1) assert.ok(saved.indexOf("focusNow(sentRef)") < saved.indexOf(guarded), "the focus is set before the guarded refresh");
  // «Файл уже есть» (the payment was opened twice, or staff attached a file): the row must come back from the server with the link.
  assert.match(exists, /router\.refresh\(\);/);
  // Nowhere else in the slot: not on picking a file, not on the other error paths, not on the confirmation screen.
  assert.equal(count(slot, "router.refresh()"), 2, "two refreshes in the whole slot: the guarded one and proof_exists");
});

test("the migration keeps its promises in the text: the old payment center answer is untouched and the new door is closed to the wrong roles", () => {
  const sql = read("../supabase/migrations/360_platform_student_payment_proof.sql");
  assert.doesNotMatch(sql, /CREATE (?:OR REPLACE )?FUNCTION platform\.student_portal_payment_center_v1/u, "the center is not redefined");
  assert.match(sql, /a360_already_applied/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION platform\.record_student_payment_proof_v1\([^)]*\) TO service_role;/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION platform\.student_payment_proof_target_v1\(uuid, uuid, text\) TO authenticated;/);
  assert.doesNotMatch(sql, /\bDROP\s+(?:TABLE|FUNCTION|COLUMN)|\bTRUNCATE\b|\bDELETE\s+FROM/iu, "no destructive statements");
  assert.doesNotMatch(sql, /INSERT INTO platform\.payment_events|UPDATE platform\.payment_obligations|record_case_payment_v1\(/u, "no money is written");
  assert.match(sql, /FOR UPDATE OF c/, "the case is locked like the staff upload locks it");
});
