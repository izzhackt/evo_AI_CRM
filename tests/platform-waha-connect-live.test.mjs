import assert from "node:assert/strict";
import test from "node:test";

import { createWahaConnectClient } from "../src/lib/server/platform-waha-connect.ts";
import {
  performWhatsAppConnect,
  resetWhatsAppConnectLimitsForTests,
} from "../src/lib/server/platform-waha-connect-service.ts";

/**
 * «Подключение WhatsApp» против НАСТОЯЩЕГО WAHA (решение владельца 20.10.2026).
 *
 * Тот же образ и версия, что на сервере (`devlikeapro/waha:gows-2026.9.2`, GOWS),
 * запущенный локально с одноразовым ключом и НЕпривязанной сессией `crm_primary`:
 *
 *   docker run -d --name evo-waha-local-test --platform linux/amd64 \
 *     -p 127.0.0.1:13000:3000 -e WAHA_API_KEY=<одноразовый ключ, 16+ знаков> \
 *     -e WHATSAPP_DEFAULT_ENGINE=GOWS devlikeapro/waha@sha256:1ae3c6a994ee…
 *   EVO_LOCAL_WAHA_URL=http://127.0.0.1:13000 EVO_LOCAL_WAHA_KEY=<тот же ключ> \
 *     node --conditions=react-server --experimental-strip-types --test \
 *     tests/platform-waha-connect-live.test.mjs
 *
 * Без этих переменных тест пропускается. Приложение работает как на сервере —
 * клиент и сервис те же; подменяется только адрес (`http://evo-crm-waha:3000`
 * → локальный). Рабочая сессия сервера здесь не участвует. Сессию на локальном
 * WAHA создаёт и удаляет сам тест, прямыми вызовами (приложение этого не умеет и
 * не должно). `EVO_LOCAL_WAHA_QR_REFRESH_SECONDS=70` дополнительно ждёт смены QR.
 * Номер для кода — вымышленный из закрытого диапазона 555-01xx: WhatsApp его не
 * принимает, и тест проверяет именно этот отказ; настоящий номер не используется.
 */

const URL_BASE = process.env.EVO_LOCAL_WAHA_URL ?? "";
const KEY = process.env.EVO_LOCAL_WAHA_KEY ?? "";
const enabled = /^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/u.test(URL_BASE) && KEY.length >= 16;
const skip = enabled ? false : "set EVO_LOCAL_WAHA_URL (loopback) and EVO_LOCAL_WAHA_KEY to run against a local WAHA container";

const ORG = "11111111-1111-4111-8111-111111111111";
const ADMIN = { systemRole: "admin", presentationRole: null, organizationId: ORG, profileId: "22222222-2222-4222-8222-222222222222", membershipId: "33333333-3333-4333-8333-333333333333", permissionKeys: [], platformAccessVersion: 1 };
const RUNTIME = { wahaSessionName: "crm_primary", wahaBaseUrl: "http://evo-crm-waha:3000", wahaApiKey: KEY, bindingVersion: "1" };
const FICTIONAL_PHONE = "14155550100";

const realFetch = fetch;
const toLocal = async (url, init) => realFetch(String(url).replace("http://evo-crm-waha:3000", URL_BASE), init);
const direct = (path, method = "GET", body) => realFetch(`${URL_BASE}${path}`, {
  method,
  headers: { "X-Api-Key": KEY, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
  ...(body ? { body: JSON.stringify(body) } : {}),
});
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(read, done, { timeoutMs = 60_000, stepMs = 1_000 } = {}) {
  const seen = [];
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (seen.at(-1) !== value) seen.push(value);
    if (done(value)) return seen;
    assert.ok(Date.now() < deadline, `timed out; saw ${seen.join(" → ")}`);
    await sleep(stepMs);
  }
}

test("the connect block works against a real WAHA gows-2026.9.2: states, QR, refresh and the pairing code", { skip, timeout: 240_000 }, async (t) => {
  // Чистая одноразовая сессия на ЛОКАЛЬНОМ WAHA.
  await direct("/api/sessions/crm_primary", "DELETE");
  const created = await direct("/api/sessions", "POST", { name: "crm_primary", start: false });
  assert.ok(created.ok, `local session create ${created.status}`);
  t.after(async () => { await direct("/api/sessions/crm_primary", "DELETE"); });

  const version = await (await direct("/api/version")).json();
  assert.equal(version.engine, "GOWS");
  assert.equal(version.version, "2026.9.2");

  const dependencies = {
    resolveRuntime: async () => RUNTIME,
    clientDependencies: { fetch: toLocal },
    recordAudit: (entry) => audits.push(entry),
    sleep,
  };
  const audits = [];
  resetWhatsAppConnectLimitsForTests();
  const client = createWahaConnectClient(RUNTIME, { fetch: toLocal });

  // 1. Остановленная сессия: «Ожидает подключения».
  assert.equal(await client.getStatus(), "STOPPED");

  // 2. «Подключить»: сессия запускается, окно QR открыто, след один.
  const connect = await performWhatsAppConnect(ADMIN, { action: "connect" }, dependencies);
  assert.equal(connect.status, "ok");
  assert.ok(["STARTING", "SCAN_QR_CODE"].includes(connect.session), connect.session);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].kind, "qr");

  // 3. Состояния сменяются сами: до «ждёт сканирования».
  const transitions = await until(() => client.getStatus(), (status) => status === "SCAN_QR_CODE");
  t.diagnostic(`status transitions seen: STOPPED → ${transitions.join(" → ")}`);

  // 4. QR — настоящая картинка PNG, выдаётся только в открытом окне.
  await sleep(1_600);
  const first = await performWhatsAppConnect(ADMIN, { action: "status", withQr: true }, dependencies);
  assert.equal(first.status, "ok");
  assert.equal(first.session, "SCAN_QR_CODE");
  assert.match(first.qr, /^data:image\/png;base64,/u);
  const png = Buffer.from(first.qr.split(",")[1], "base64");
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.ok(png.byteLength > 1_000, `qr size ${png.byteLength}`);
  t.diagnostic(`qr png: ${png.byteLength} bytes`);

  // 5. QR обновляется: WhatsApp меняет его сам; ждём, если попросили.
  const refreshSeconds = Number(process.env.EVO_LOCAL_WAHA_QR_REFRESH_SECONDS ?? 0);
  if (refreshSeconds > 0) {
    await sleep(refreshSeconds * 1_000);
    const second = await performWhatsAppConnect(ADMIN, { action: "status", withQr: true }, dependencies);
    assert.match(second.qr, /^data:image\/png;base64,/u);
    assert.notEqual(second.qr, first.qr, "the QR changed after the provider rotated it");
    t.diagnostic(`qr refreshed after ${refreshSeconds}s`);
  }

  // 6. Перезапуск живой сессии отвечает состоянием (тот же вызов, что для FAILED).
  const restarted = await client.restart();
  assert.ok(["STARTING", "SCAN_QR_CODE"].includes(restarted), restarted);
  await until(() => client.getStatus(), (status) => status === "SCAN_QR_CODE");

  // 7. Код по номеру: эндпоинт GOWS есть; вымышленный номер WhatsApp отклоняет, и мы говорим об этом словом.
  const code = await performWhatsAppConnect(ADMIN, { action: "code", phone: FICTIONAL_PHONE }, dependencies);
  t.diagnostic(`request-code with a fictional number → ${code.status === "refused" ? `${code.http} ${code.code}` : "code issued"}`);
  assert.equal(code.status, "refused");
  assert.equal(code.code, "phone_rejected");
  assert.equal(JSON.stringify(audits).includes(FICTIONAL_PHONE), false);
  assert.equal(audits.at(-1).kind, "code");
});
