import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const controls = await readFile(
  new URL("../src/components/v3/portal/PortalDocumentControls.tsx", import.meta.url),
  "utf8",
);
const documents = await readFile(
  new URL("../src/components/v3/portal/DocumentsView.tsx", import.meta.url),
  "utf8",
);

const { selectCurrentPortalDocuments } = await loadDocumentSelection();

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

test("Documents view renders one slot and binds controls to its current version", () => {
  const empty = Object.freeze({
    documentSlotId: "slot-a",
    documentVersionId: null,
    versionNo: null,
    originalFilename: null,
  });
  const oldVersion = Object.freeze({
    documentSlotId: "slot-a",
    documentVersionId: "version-old",
    versionNo: "9007199254740993",
    originalFilename: "passport-old.pdf",
  });
  const currentVersion = Object.freeze({
    documentSlotId: "slot-a",
    documentVersionId: "version-current",
    versionNo: "9007199254740994",
    originalFilename: "passport-current.pdf",
  });
  const otherSlot = Object.freeze({
    documentSlotId: "slot-b",
    documentVersionId: null,
    versionNo: null,
    originalFilename: null,
  });

  const selected = selectCurrentPortalDocuments([
    oldVersion,
    otherSlot,
    currentVersion,
    empty,
  ]);

  assert.equal(selected.length, 2);
  assert.strictEqual(selected[0], currentVersion);
  assert.strictEqual(selected[1], otherSlot);
  assert.deepEqual(
    selected.map((document) => [
      document.documentSlotId,
      document.documentVersionId,
      document.originalFilename,
    ]),
    [
      ["slot-a", "version-current", "passport-current.pdf"],
      ["slot-b", null, null],
    ],
  );

  assert.match(documents, /const currentDocuments = selectCurrentPortalDocuments\(documents\)/u);
  assert.match(documents, /\{currentDocuments\.map\(\(document\) =>/u);
  assert.doesNotMatch(documents, /\{documents\.map\(\(document\) =>/u);
  assert.match(documents, /<PortalDocumentControls/u);
  assert.match(documents, /documentSlotId=\{document\.documentSlotId\}/u);
  assert.match(documents, /documentVersionId=\{document\.documentVersionId\}/u);
  assert.match(documents, /allowUpload=\{document\.status !== "approved"\}/u);
});

async function loadDocumentSelection() {
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const result = await build({
    stdin: {
      contents: [
        "import { selectCurrentPortalDocuments as selection }",
        'from "./src/components/v3/portal/DocumentsView.tsx";',
        "export const selectCurrentPortalDocuments = selection;",
      ].join(" "),
      resolveDir: repositoryRoot,
      sourcefile: "student-portal-document-selection.ts",
    },
    bundle: true,
    format: "esm",
    logLevel: "silent",
    platform: "node",
    treeShaking: true,
    write: false,
    plugins: [
      {
        name: "stub-unrelated-document-view-imports",
        setup(buildContext) {
          buildContext.onResolve(
            {
              filter:
                /^(\.\/(PortalDocumentControls|PortalPage|PortalStatus|presentation)|react\/jsx-(dev-)?runtime)$/,
            },
            (args) => ({
              namespace: "document-view-test-stub",
              path: args.path,
              sideEffects: false,
            }),
          );
          buildContext.onLoad(
            { filter: /.*/, namespace: "document-view-test-stub" },
            () => ({
              contents: [
                "export const PortalDocumentControls = () => null;",
                "export const PortalEmptyState = () => null;",
                "export const PortalSection = () => null;",
                "export const PortalStatus = () => null;",
                "export const documentReviewLabel = () => null;",
                "export const documentStatus = () => ({});",
                "export const formatPortalTimestamp = () => null;",
                "export const jsx = () => null;",
                "export const jsxs = () => null;",
              ].join("\n"),
              loader: "js",
            }),
          );
        },
      },
    ],
  });

  const bundled = result.outputFiles.at(0)?.text;
  assert.ok(bundled, "document selection bundle must be emitted");
  return import(`data:text/javascript;base64,${Buffer.from(bundled).toString("base64")}`);
}
