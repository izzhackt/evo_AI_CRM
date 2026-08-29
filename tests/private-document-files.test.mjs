import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  PrivateDocumentFileError,
  readPrivateDocumentObject,
  removePrivateDocumentObject,
  requireStoredPrivateDocumentUpload,
  storePrivateDocumentObject,
} from "../src/lib/server/private-document-files.ts";

const PDF_BYTES = Buffer.from("%PDF-1.4\n%%EOF\n", "ascii");
const PDF_SHA256 = "14bcd090baf31edba64e9cbd8cdfc15f943344aa72cb3675ad8e91bfcbce03ad";

async function withPrivateDocumentRoot(run) {
  const root = await mkdtemp(join(tmpdir(), "evo-private-documents-"));
  const previous = process.env.EVO_PRIVATE_DOCUMENT_ROOT;
  process.env.EVO_PRIVATE_DOCUMENT_ROOT = root;
  try {
    await run(root);
  } finally {
    if (previous === undefined) delete process.env.EVO_PRIVATE_DOCUMENT_ROOT;
    else process.env.EVO_PRIVATE_DOCUMENT_ROOT = previous;
    await rm(root, { recursive: true, force: true });
  }
}

function chunks(...values) {
  return (async function* () {
    for (const value of values) yield value;
  })();
}

function storePdf(originalFilename = "offer.pdf", bytes = PDF_BYTES) {
  return storePrivateDocumentObject({
    originalFilename,
    declaredMimeType: "application/pdf",
    chunks: chunks(bytes),
  });
}

async function rejectsWithCode(operation, code, forbiddenText = []) {
  await assert.rejects(operation, (error) => {
    assert.ok(error instanceof PrivateDocumentFileError);
    assert.equal(error.code, code);
    for (const value of forbiddenText) {
      assert.equal(error.message.includes(value), false);
    }
    return true;
  });
}

test("a private document stream is persisted once with exact integrity metadata", async () => {
  await withPrivateDocumentRoot(async (root) => {
    let yielded = 0;
    const stored = await storePrivateDocumentObject({
      originalFilename: "offer.pdf",
      declaredMimeType: "application/pdf",
      chunks: (async function* () {
        for (const chunk of [PDF_BYTES.subarray(0, 3), PDF_BYTES.subarray(3)]) {
          yielded += 1;
          yield chunk;
        }
      })(),
    });

    assert.equal(yielded, 2);
    assert.match(stored.objectKey, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(stored.originalFilename, "offer.pdf");
    assert.equal(stored.declaredMimeType, "application/pdf");
    assert.equal(stored.byteLength, PDF_BYTES.length);
    assert.equal(stored.sha256, PDF_SHA256);
    assert.equal(requireStoredPrivateDocumentUpload(stored), stored);
    assert.deepEqual(
      await readPrivateDocumentObject({
        objectKey: stored.objectKey,
        expectedByteLength: stored.byteLength,
        expectedSha256: stored.sha256,
      }),
      PDF_BYTES,
    );
    assert.equal((await stat(join(root, "objects", stored.objectKey))).mode & 0o777, 0o600);
  });
});

test("stream failures and the 25 MiB ceiling leave no partial object", async () => {
  await withPrivateDocumentRoot(async (root) => {
    const oneMiB = Buffer.alloc(1024 * 1024, 0x41);
    oneMiB.set(Buffer.from("%PDF-", "ascii"), 0);
    await rejectsWithCode(
      storePrivateDocumentObject({
        originalFilename: "too-large.pdf",
        declaredMimeType: "application/pdf",
        chunks: (async function* () {
          for (let index = 0; index < 25; index += 1) yield oneMiB;
          yield Buffer.from([0]);
        })(),
      }),
      "private_document_bytes_too_large",
    );
    assert.deepEqual(await readdir(join(root, "objects")), []);

    await rejectsWithCode(
      storePrivateDocumentObject({
        originalFilename: "failed.pdf",
        declaredMimeType: "application/pdf",
        chunks: (async function* () {
          yield PDF_BYTES.subarray(0, 5);
          throw new Error("stream failed");
        })(),
      }),
      "private_document_storage_unavailable",
    );
    assert.deepEqual(await readdir(join(root, "objects")), []);
  });
});

test("private storage rejects missing, malformed, symlinked and public roots", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "evo-private-root-validation-"));
  const file = join(temporary, "not-a-directory");
  const missing = join(temporary, "missing");
  const realRoot = join(temporary, "real-root");
  const linkedRoot = join(temporary, "linked-root");
  await writeFile(file, "not a directory", { mode: 0o600 });
  await mkdir(realRoot);
  await symlink(realRoot, linkedRoot, "dir");
  const publicRoot = await mkdtemp(join(process.cwd(), "public", ".private-document-test-"));
  const previous = process.env.EVO_PRIVATE_DOCUMENT_ROOT;
  try {
    delete process.env.EVO_PRIVATE_DOCUMENT_ROOT;
    await rejectsWithCode(storePdf(), "private_document_root_missing");
    for (const value of [" ", "relative/private", "/", ` ${temporary}`, `${temporary} `, missing, file, linkedRoot, publicRoot]) {
      process.env.EVO_PRIVATE_DOCUMENT_ROOT = value;
      await rejectsWithCode(storePdf(), "private_document_root_invalid", [temporary, publicRoot]);
    }
  } finally {
    if (previous === undefined) delete process.env.EVO_PRIVATE_DOCUMENT_ROOT;
    else process.env.EVO_PRIVATE_DOCUMENT_ROOT = previous;
    await rm(temporary, { recursive: true, force: true });
    await rm(publicRoot, { recursive: true, force: true });
  }
});

test("display filenames cannot control a private document path", async () => {
  await withPrivateDocumentRoot(async () => {
    for (const originalFilename of [
      "", ".", "..", "...", "../offer.pdf", "folder/offer.pdf",
      "folder\\offer.pdf", "offer\u0000.pdf", "offer\n.pdf", " offer.pdf",
      "offer.pdf ", "x".repeat(256),
    ]) {
      await rejectsWithCode(
        storePrivateDocumentObject({
          originalFilename,
          declaredMimeType: "application/pdf",
          chunks: chunks(PDF_BYTES),
        }),
        "private_document_filename_invalid",
      );
    }
  });
});

test("only nonempty PDF, JPEG and PNG streams with matching magic bytes are stored", async () => {
  await withPrivateDocumentRoot(async () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x04, 0xff, 0xd9]);
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    const storedJpeg = await storePrivateDocumentObject({
      originalFilename: "photo.jpg",
      declaredMimeType: "image/jpeg",
      chunks: chunks(jpeg),
    });
    const storedPng = await storePrivateDocumentObject({
      originalFilename: "scan.png",
      declaredMimeType: "image/png",
      chunks: chunks(png),
    });
    assert.equal(storedJpeg.declaredMimeType, "image/jpeg");
    assert.equal(storedPng.declaredMimeType, "image/png");

    await rejectsWithCode(
      storePrivateDocumentObject({
        originalFilename: "offer.txt",
        declaredMimeType: "text/plain",
        chunks: chunks(PDF_BYTES),
      }),
      "private_document_mime_invalid",
    );
    await rejectsWithCode(
      storePrivateDocumentObject({
        originalFilename: "empty.pdf",
        declaredMimeType: "application/pdf",
        chunks: chunks(),
      }),
      "private_document_bytes_empty",
    );
    await rejectsWithCode(
      storePrivateDocumentObject({
        originalFilename: "offer.pdf",
        declaredMimeType: "application/pdf",
        chunks: chunks(png),
      }),
      "private_document_content_mismatch",
    );
  });
});

test("separate streams create separate immutable objects", async () => {
  await withPrivateDocumentRoot(async () => {
    const first = await storePdf();
    const second = await storePdf();
    assert.notEqual(first.objectKey, second.objectKey);
    assert.deepEqual(
      await readPrivateDocumentObject({
        objectKey: first.objectKey,
        expectedByteLength: first.byteLength,
        expectedSha256: first.sha256,
      }),
      PDF_BYTES,
    );
  });
});

test("downloads reject changed length or bytes instead of returning corruption", async () => {
  await withPrivateDocumentRoot(async (root) => {
    const stored = await storePdf();
    await rejectsWithCode(
      readPrivateDocumentObject({
        objectKey: stored.objectKey,
        expectedByteLength: stored.byteLength + 1,
        expectedSha256: stored.sha256,
      }),
      "private_document_integrity_invalid",
      [root],
    );
    await writeFile(
      join(root, "objects", stored.objectKey),
      Buffer.from("%PDF-1.5\n%%EOF\n", "ascii"),
      { mode: 0o600 },
    );
    await rejectsWithCode(
      readPrivateDocumentObject({
        objectKey: stored.objectKey,
        expectedByteLength: stored.byteLength,
        expectedSha256: stored.sha256,
      }),
      "private_document_integrity_invalid",
      [root],
    );
  });
});

test("downloads reject missing, symlinked and non-regular objects", async () => {
  await withPrivateDocumentRoot(async (root) => {
    await storePdf();
    await rejectsWithCode(
      readPrivateDocumentObject({
        objectKey: randomUUID(),
        expectedByteLength: PDF_BYTES.length,
        expectedSha256: PDF_SHA256,
      }),
      "private_document_object_missing",
      [root],
    );
    const outsideFile = join(root, "outside.pdf");
    const linkedKey = randomUUID();
    await writeFile(outsideFile, PDF_BYTES, { mode: 0o600 });
    await symlink(outsideFile, join(root, "objects", linkedKey));
    await rejectsWithCode(
      readPrivateDocumentObject({
        objectKey: linkedKey,
        expectedByteLength: PDF_BYTES.length,
        expectedSha256: PDF_SHA256,
      }),
      "private_document_object_unsafe",
      [root],
    );
    await rejectsWithCode(removePrivateDocumentObject(linkedKey), "private_document_object_unsafe", [root]);
    assert.deepEqual(await readFile(outsideFile), PDF_BYTES);
    const directoryKey = randomUUID();
    await mkdir(join(root, "objects", directoryKey));
    await rejectsWithCode(
      readPrivateDocumentObject({
        objectKey: directoryKey,
        expectedByteLength: PDF_BYTES.length,
        expectedSha256: PDF_SHA256,
      }),
      "private_document_object_unsafe",
      [root],
    );
  });
});

test("uncommitted object cleanup is path-safe and idempotent", async () => {
  await withPrivateDocumentRoot(async (root) => {
    const stored = await storePdf();
    const objectPath = join(root, "objects", stored.objectKey);
    await removePrivateDocumentObject(stored.objectKey);
    await assert.rejects(stat(objectPath), { code: "ENOENT" });
    await removePrivateDocumentObject(stored.objectKey);
    await rejectsWithCode(removePrivateDocumentObject("../outside.pdf"), "private_document_object_key_invalid", [root]);
  });
});

test("a symlinked objects directory is rejected before a stream is consumed", async () => {
  const root = await mkdtemp(join(tmpdir(), "evo-private-objects-link-"));
  const target = await mkdtemp(join(tmpdir(), "evo-private-objects-target-"));
  await symlink(target, join(root, "objects"), "dir");
  const previous = process.env.EVO_PRIVATE_DOCUMENT_ROOT;
  process.env.EVO_PRIVATE_DOCUMENT_ROOT = root;
  let consumed = false;
  try {
    await rejectsWithCode(
      storePrivateDocumentObject({
        originalFilename: "offer.pdf",
        declaredMimeType: "application/pdf",
        chunks: (async function* () {
          consumed = true;
          yield PDF_BYTES;
        })(),
      }),
      "private_document_root_invalid",
      [root, target],
    );
    assert.equal(consumed, false);
  } finally {
    if (previous === undefined) delete process.env.EVO_PRIVATE_DOCUMENT_ROOT;
    else process.env.EVO_PRIVATE_DOCUMENT_ROOT = previous;
    await rm(root, { recursive: true, force: true });
    await rm(target, { recursive: true, force: true });
  }
});

test("stored upload metadata cannot be forged at the repository boundary", () => {
  assert.throws(
    () => requireStoredPrivateDocumentUpload({
      originalFilename: "offer.pdf",
      declaredMimeType: "application/pdf",
      objectKey: randomUUID(),
      byteLength: PDF_BYTES.length,
      sha256: PDF_SHA256,
    }),
    (error) => {
      assert.ok(error instanceof PrivateDocumentFileError);
      assert.equal(error.code, "private_document_prepared_file_invalid");
      return true;
    },
  );
});
