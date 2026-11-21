import assert from "node:assert/strict";
import test from "node:test";

import { createStudentPortalCaseFileDownloadHandler } from "../src/lib/server/platform-case-agreement-storage-route-handlers.ts";
import { applyDownloadName, resolveDownloadName } from "../src/lib/server/download-file-name.ts";

const FILE_ID = "11111111-1111-4111-8111-111111111111";
const SIGNED = "https://db.example.test/storage/v1/object/sign/platform-documents/case-contracts/o/c/f?token=t&download=";

function harness({ nameResult, nameError = null } = {}) {
  const calls = [];
  const userClient = {
    schema() {
      return {
        async rpc(name, args) {
          calls.push(["rpc", name, args]);
          if (name === "student_portal_case_file_target_v1") {
            return { data: { file_kind: args.p_file_kind, file_id: args.p_file_id, storage_object_name: "case-contracts/o/c/f", original_filename: "scan.pdf" }, error: null };
          }
          return { data: nameError ? null : nameResult, error: nameError };
        },
      };
    },
  };
  const serviceClient = {
    storage: { from: () => ({ async createSignedUrl(path, ttl, options) { calls.push(["sign", path, ttl, options]); return { data: { signedUrl: SIGNED }, error: null }; } }) },
  };
  const handler = createStudentPortalCaseFileDownloadHandler({
    resolveBearerActor: async () => ({ status: "authenticated" }),
    createBearerClient: async () => userClient,
    createServiceClient: () => serviceClient,
  });
  const run = (kind) => handler(
    new Request("http://app.test/x", { headers: { authorization: "Bearer header.payload.signature" } }),
    { params: Promise.resolve({ fileKind: kind, fileId: FILE_ID }) },
  );
  return { calls, run };
}

test("Student contract and receipt downloads are named by type and surname", async () => {
  const contract = harness({ nameResult: { label: "Договор", student_surname: "Фамилия", mime_type: "application/pdf", original_filename: "scan.pdf" } });
  const response = await contract.run("contract");
  assert.equal(response.status, 307);
  assert.equal(new URL(response.headers.get("location")).searchParams.get("download"), "Договор — Фамилия.pdf");
  assert.deepEqual(contract.calls.map(([kind, name]) => (kind === "rpc" ? name : kind)), [
    "student_portal_case_file_target_v1", "student_portal_case_file_download_name_v1", "sign",
  ]);
  assert.deepEqual(contract.calls[1][2], { p_file_kind: "contract", p_file_id: FILE_ID });
  assert.deepEqual(contract.calls.at(-1)[3], { download: true });

  const receipt = harness({ nameResult: { label: "Чек", student_surname: "Фамилия", mime_type: "image/jpeg", original_filename: "IMG_1.HEIC" } });
  const receiptResponse = await receipt.run("student_receipt");
  assert.equal(new URL(receiptResponse.headers.get("location")).searchParams.get("download"), "Чек — Фамилия.jpg");
});

test("a failed name lookup still downloads, with the plain attachment link", async () => {
  const failing = harness({ nameError: { code: "PGRST202" } });
  const response = await failing.run("contract");
  assert.equal(response.status, 307);
  assert.equal(response.headers.get("location"), SIGNED);
});

test("name lookup helpers fall back to the plain download on bad answers and keep one-time encoding", async () => {
  const client = (data, error = null) => ({ schema: () => ({ rpc: async () => ({ data, error }) }) });
  assert.equal(await resolveDownloadName(client([]), "x", {}), true);
  assert.equal(await resolveDownloadName(client({}), "x", {}), true);
  assert.equal(await resolveDownloadName(client(null, { code: "42501" }), "x", {}), true);
  assert.equal(await resolveDownloadName({ schema: () => { throw new Error("boom"); } }, "x", {}), true);
  assert.equal(await resolveDownloadName(client({ original_filename: "Прайс.xlsx", mime_type: "" }), "x", {}, "stored"), "Прайс.xlsx");
  assert.equal(applyDownloadName(SIGNED, true), SIGNED);
  const named = new URL(applyDownloadName(SIGNED, "Паспорт — Фамилия.jpg"));
  assert.equal(named.searchParams.get("download"), "Паспорт — Фамилия.jpg");
  assert.doesNotMatch(named.search, /%25/u);
  assert.equal(applyDownloadName("not a url", "a.pdf"), "not a url");
});

test("a failed lookup writes one structured line without personal data", async () => {
  const lines = [];
  const original = console.warn;
  console.warn = (line) => lines.push(line);
  try {
    const client = (data, error = null) => ({ schema: () => ({ rpc: async () => ({ data, error }) }) });
    await resolveDownloadName(client(null, { code: "42501", message: "Фамилия секрет" }), "document_download_name_v1", { p_download_grant_id: "x" });
    await resolveDownloadName(client({}), "document_download_name_v1", {});
    await resolveDownloadName({ schema: () => { throw new Error("Фамилия секрет"); } }, "document_download_name_v1", {});
    await resolveDownloadName(client({ label: "Паспорт" }), "document_download_name_v1", {});
  } finally {
    console.warn = original;
  }
  assert.equal(lines.length, 3);
  assert.deepEqual(lines.map((line) => JSON.parse(line)), [
    { event: "download_name_fallback", kind: "document_download_name_v1", reason: "rpc_error_42501" },
    { event: "download_name_fallback", kind: "document_download_name_v1", reason: "no_usable_fields" },
    { event: "download_name_fallback", kind: "document_download_name_v1", reason: "exception" },
  ]);
  assert.ok(lines.every((line) => !line.includes("секрет")));
});
