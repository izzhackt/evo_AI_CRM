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
  PRIVATE_DOCUMENT_MAX_BYTES,
  preparePrivateDocumentFile,
  PrivateDocumentFileError,
  readPrivateDocumentObject,
  removePrivateDocumentObject,
  writePrivateDocumentObject,
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

function preparedPdf() {
  return preparePrivateDocumentFile({
    originalFilename: "offer.pdf",
    declaredMimeType: "application/pdf",
    bytes: PDF_BYTES,
  });
}

async function rejectsWithCode(operation, code, forbiddenText = []) {
  await assert.rejects(operation, (error) => {
    assert.ok(error instanceof PrivateDocumentFileError);
    assert.equal(error.code, code);
    for (const value of forbiddenText) assert.equal(error.message.includes(value), false);
    return true;
  });
}

function throwsWithCode(operation, code) {
  assert.throws(operation, (error) => {
    assert.ok(error instanceof PrivateDocumentFileError);
    assert.equal(error.code, code);
    return true;
  });
}

test("a prepared private PDF is persisted and read back with verified integrity", async () => {
  await withPrivateDocumentRoot(async (root) => {
    const prepared = preparePrivateDocumentFile({
      originalFilename: "offer.pdf",
      declaredMimeType: "application/pdf",
      bytes: PDF_BYTES,
    });

    const stored = await writePrivateDocumentObject(prepared);

    assert.match(stored.objectKey, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(stored.byteLength, PDF_BYTES.length);
    assert.equal(stored.sha256, PDF_SHA256);
    assert.deepEqual(
      await readPrivateDocumentObject({
        objectKey: stored.objectKey,
        expectedByteLength: stored.byteLength,
        expectedSha256: stored.sha256,
      }),
      PDF_BYTES,
    );
    assert.equal((await stat(join(root, "objects"))).mode & 0o777, 0o700);
    assert.equal((await stat(join(root, "objects", stored.objectKey))).mode & 0o777, 0o600);
    assert.deepEqual(await readdir(join(root, "objects")), [stored.objectKey]);

    await removePrivateDocumentObject(stored.objectKey);
  });
});

test("private document storage rejects missing, malformed and non-directory roots without path disclosure", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "evo-private-root-validation-"));
  const file = join(temporary, "not-a-directory");
  const missing = join(temporary, "missing");
  await writeFile(file, "not a directory", { mode: 0o600 });
  const previous = process.env.EVO_PRIVATE_DOCUMENT_ROOT;
  try {
    delete process.env.EVO_PRIVATE_DOCUMENT_ROOT;
    await rejectsWithCode(
      writePrivateDocumentObject(preparedPdf()),
      "private_document_root_missing",
    );

    for (const value of [" ", "relative/private", ` ${temporary}`, `${temporary} `, missing, file]) {
      process.env.EVO_PRIVATE_DOCUMENT_ROOT = value;
      await rejectsWithCode(
        writePrivateDocumentObject(preparedPdf()),
        "private_document_root_invalid",
        [temporary],
      );
    }
  } finally {
    if (previous === undefined) delete process.env.EVO_PRIVATE_DOCUMENT_ROOT;
    else process.env.EVO_PRIVATE_DOCUMENT_ROOT = previous;
    await rm(temporary, { recursive: true, force: true });
  }
});

test("private document storage rejects a symlink root and a root under public", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "evo-private-symlink-validation-"));
  const realRoot = join(temporary, "real-root");
  const linkedRoot = join(temporary, "linked-root");
  await mkdir(realRoot);
  await symlink(realRoot, linkedRoot, "dir");
  const publicRoot = await mkdtemp(join(process.cwd(), "public", ".private-document-test-"));
  const previous = process.env.EVO_PRIVATE_DOCUMENT_ROOT;
  try {
    for (const root of [linkedRoot, publicRoot]) {
      process.env.EVO_PRIVATE_DOCUMENT_ROOT = root;
      await rejectsWithCode(
        writePrivateDocumentObject(preparedPdf()),
        "private_document_root_invalid",
        [root],
      );
    }
  } finally {
    if (previous === undefined) delete process.env.EVO_PRIVATE_DOCUMENT_ROOT;
    else process.env.EVO_PRIVATE_DOCUMENT_ROOT = previous;
    await rm(temporary, { recursive: true, force: true });
    await rm(publicRoot, { recursive: true, force: true });
  }
});

test("display filenames cannot control or traverse a private document path", () => {
  for (const originalFilename of [
    "",
    ".",
    "..",
    "...",
    "../offer.pdf",
    "folder/offer.pdf",
    "folder\\offer.pdf",
    "offer\u0000.pdf",
    "offer\n.pdf",
    " offer.pdf",
    "offer.pdf ",
    "x".repeat(256),
  ]) {
    throwsWithCode(
      () =>
        preparePrivateDocumentFile({
          originalFilename,
          declaredMimeType: "application/pdf",
          bytes: PDF_BYTES,
        }),
      "private_document_filename_invalid",
    );
  }
});

test("only nonempty PDF, JPEG and PNG payloads up to 25 MiB are prepared", () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x04, 0xff, 0xd9]);
  const png = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
  ]);
  assert.equal(
    preparePrivateDocumentFile({
      originalFilename: "photo.jpg",
      declaredMimeType: "image/jpeg",
      bytes: jpeg,
    }).declaredMimeType,
    "image/jpeg",
  );
  assert.equal(
    preparePrivateDocumentFile({
      originalFilename: "scan.png",
      declaredMimeType: "image/png",
      bytes: png,
    }).declaredMimeType,
    "image/png",
  );

  throwsWithCode(
    () =>
      preparePrivateDocumentFile({
        originalFilename: "offer.txt",
        declaredMimeType: "text/plain",
        bytes: PDF_BYTES,
      }),
    "private_document_mime_invalid",
  );
  throwsWithCode(
    () =>
      preparePrivateDocumentFile({
        originalFilename: "offer.pdf",
        declaredMimeType: "application/pdf",
        bytes: Buffer.alloc(0),
      }),
    "private_document_bytes_empty",
  );
  throwsWithCode(
    () =>
      preparePrivateDocumentFile({
        originalFilename: "offer.pdf",
        declaredMimeType: "application/pdf",
        bytes: Buffer.alloc(PRIVATE_DOCUMENT_MAX_BYTES + 1),
      }),
    "private_document_bytes_too_large",
  );
  throwsWithCode(
    () =>
      preparePrivateDocumentFile({
        originalFilename: "offer.pdf",
        declaredMimeType: "application/pdf",
        bytes: png,
      }),
    "private_document_content_mismatch",
  );
});

test("exclusive object creation never overwrites a completed object", async () => {
  await withPrivateDocumentRoot(async () => {
    const prepared = preparedPdf();
    const stored = await writePrivateDocumentObject(prepared);

    await rejectsWithCode(
      writePrivateDocumentObject(prepared),
      "private_document_object_exists",
    );
    assert.deepEqual(
      await readPrivateDocumentObject({
        objectKey: stored.objectKey,
        expectedByteLength: stored.byteLength,
        expectedSha256: stored.sha256,
      }),
      PDF_BYTES,
    );
  });
});

test("download rejects changed length or bytes instead of returning corrupted content", async () => {
  await withPrivateDocumentRoot(async (root) => {
    const stored = await writePrivateDocumentObject(preparedPdf());
    await rejectsWithCode(
      readPrivateDocumentObject({
        objectKey: stored.objectKey,
        expectedByteLength: stored.byteLength + 1,
        expectedSha256: stored.sha256,
      }),
      "private_document_integrity_invalid",
      [root],
    );
    const changedBytes = Buffer.from("%PDF-1.5\n%%EOF\n", "ascii");
    assert.equal(changedBytes.length, PDF_BYTES.length);
    await writeFile(join(root, "objects", stored.objectKey), changedBytes, { mode: 0o600 });
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

test("download rejects missing, symlinked and non-regular objects", async () => {
  await withPrivateDocumentRoot(async (root) => {
    const seed = await writePrivateDocumentObject(preparedPdf());
    await removePrivateDocumentObject(seed.objectKey);

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
    await rejectsWithCode(
      removePrivateDocumentObject(linkedKey),
      "private_document_object_unsafe",
      [root],
    );
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
    const stored = await writePrivateDocumentObject(preparedPdf());
    const objectPath = join(root, "objects", stored.objectKey);

    await removePrivateDocumentObject(stored.objectKey);
    await assert.rejects(stat(objectPath), { code: "ENOENT" });
    await removePrivateDocumentObject(stored.objectKey);

    await rejectsWithCode(
      removePrivateDocumentObject("../outside.pdf"),
      "private_document_object_key_invalid",
      [root],
    );
  });
});

test("a symlinked objects directory is rejected before any object write", async () => {
  const root = await mkdtemp(join(tmpdir(), "evo-private-objects-link-"));
  const target = await mkdtemp(join(tmpdir(), "evo-private-objects-target-"));
  await symlink(target, join(root, "objects"), "dir");
  const previous = process.env.EVO_PRIVATE_DOCUMENT_ROOT;
  process.env.EVO_PRIVATE_DOCUMENT_ROOT = root;
  try {
    await rejectsWithCode(
      writePrivateDocumentObject(preparedPdf()),
      "private_document_root_invalid",
      [root, target],
    );
  } finally {
    if (previous === undefined) delete process.env.EVO_PRIVATE_DOCUMENT_ROOT;
    else process.env.EVO_PRIVATE_DOCUMENT_ROOT = previous;
    await rm(root, { recursive: true, force: true });
    await rm(target, { recursive: true, force: true });
  }
});
