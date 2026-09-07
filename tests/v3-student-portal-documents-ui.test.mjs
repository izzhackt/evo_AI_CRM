import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const controls = await readFile(
  new URL("../src/components/v3/portal/PortalDocumentControls.tsx", import.meta.url),
  "utf8",
);
const documents = await readFile(
  new URL("../src/components/v3/portal/DocumentsView.tsx", import.meta.url),
  "utf8",
);

test("Student document controls use the single private Portal API surface", () => {
  assert.match(controls, /^"use client";/u);
  assert.match(
    controls,
    /`\/api\/portal\/document-slots\/\$\{encodeURIComponent\(documentSlotId\)\}\/versions`/u,
  );
  assert.match(
    controls,
    /`\/api\/portal\/document-versions\/\$\{encodeURIComponent\(documentVersionId\)\}\/download`/u,
  );
  assert.match(controls, /method: "POST"/u);
  assert.match(controls, /response\.status !== 201/u);
  assert.match(controls, /exactUploadReceipt\(payload, documentSlotId\)/u);
  assert.match(controls, /formRef\.current\?\.reset\(\)/u);
  assert.match(controls, /router\.refresh\(\)/u);
  assert.doesNotMatch(controls, /request_id|requestId/u);
  assert.doesNotMatch(controls, /service_role|SUPABASE|createClient/u);
});

test("Student upload is file-only, bounded and exposes accessible outcome state", () => {
  assert.match(controls, /name="file"/u);
  assert.match(controls, /accept="application\/pdf,image\/jpeg,image\/png"/u);
  assert.match(controls, /до 25 МБ/u);
  assert.match(controls, /Array\.from\(formData\.keys\(\)\)/u);
  assert.match(controls, /key !== "file"/u);
  assert.match(controls, /disabled=\{pending\}/u);
  assert.match(controls, /aria-disabled=\{pending\}/u);
  assert.match(controls, /aria-live="polite"/u);
  assert.match(controls, /role=\{state\.status === "error" \? "alert" : "status"\}/u);
});

test("Documents view wires current-version download and hides upload after approval", () => {
  assert.match(documents, /<PortalDocumentControls/u);
  assert.match(documents, /documentSlotId=\{document\.documentSlotId\}/u);
  assert.match(documents, /documentVersionId=\{document\.documentVersionId\}/u);
  assert.match(documents, /allowUpload=\{document\.status !== "approved"\}/u);
});
