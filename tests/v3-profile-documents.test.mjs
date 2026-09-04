import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("V3 profile documents use the canonical private Storage routes", () => {
  const wrapper = source("src/components/v3/profile/Documents.tsx");
  const client = source("src/components/v3/profile/ProfileDocumentsClient.tsx");
  const types = source("src/components/v3/profile/document-types.ts");

  assert.match(wrapper, /<ProfileDocumentsClient groups=\{groups\} uploadAccess=\{uploadAccess\}/u);
  assert.match(wrapper, /item\.presence === "present"/u);
  assert.match(client, /\/api\/v2\/document-slots\/\$\{item\.id\}\/versions/u);
  assert.match(client, /\/api\/v2\/document-versions\/\$\{item\.currentVersionId\}\/download/u);
  assert.match(client, /name="request_id" value=\{item\.uploadRequestId\}/u);
  assert.match(client, /name="file"/u);
  assert.match(client, /response\.status !== 201/u);
  assert.match(client, /uploadWasConfirmed\(payload, item\)/u);
  assert.match(client, /router\.refresh\(\)/u);
  assert.doesNotMatch(client, /URL\.createObjectURL|localStorage|sessionStorage/u);

  assert.match(types, /presence: Extract<DocumentPresence, "absent">/u);
  assert.match(types, /currentVersionId: null/u);
  assert.match(types, /downloadReady: false/u);
  assert.match(types, /presence: Extract<DocumentPresence, "present">/u);
  assert.match(types, /currentVersionId: string/u);
  assert.match(types, /currentVersionNumber: number/u);
  assert.match(types, /currentFilename: string/u);
  assert.match(client, /item\.currentFilename/u);
  assert.match(client, /item\.currentVersionNumber/u);
});

test("V3 profile exposes only the two approved document presence labels", () => {
  const client = source("src/components/v3/profile/ProfileDocumentsClient.tsx");
  const wording = source("src/lib/v3/wording.ts");

  assert.match(wording, /export type DocumentPresence = "absent" \| "present"/u);
  assert.match(wording, /absent: "нет"/u);
  assert.match(wording, /present: "есть"/u);
  assert.match(client, /documentPresence\(item\.presence\)/u);
  assert.doesNotMatch(client, /submittedBy|uploadedBy|createdAt|updatedAt|reviewedAt/u);
  assert.doesNotMatch(client, /correction_required|rejected|approved/u);
});

test("V3 profile document upload fails closed and explains every failure class", () => {
  const client = source("src/components/v3/profile/ProfileDocumentsClient.tsx");

  assert.match(client, /status === 401 \|\| status === 403/u);
  assert.match(client, /"invalid" \| "forbidden" \| "unavailable"/u);
  assert.match(client, /!item\.uploadRequestId/u);
  assert.match(client, /сервер не выдал безопасный идентификатор команды/u);
  assert.match(client, /Файл не отмечен как сохранённый/u);
});
