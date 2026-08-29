import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import postgres from "postgres";

import { closeDatabaseConnections } from "../src/lib/server/database.ts";
import { storePrivateDocumentObject } from "../src/lib/server/private-document-files.ts";
import {
  createPrivateDocument,
  downloadPrivateDocumentVersion,
  listPrivateDocuments,
  listPrivateDocumentsForCase,
  PrivateDocumentRepositoryError,
  resubmitPrivateDocument,
} from "../src/lib/server/private-document-repository.ts";

const INITIAL_BYTES = Buffer.from("%PDF-1.4\ninitial\n%%EOF\n", "ascii");
const REPLACEMENT_BYTES = Buffer.from("%PDF-1.4\nreplacement\n%%EOF\n", "ascii");

function requiredDatabaseUrl() {
  const value = process.env.DATABASE_URL;
  assert.ok(value, "DATABASE_URL is required for private-document PostgreSQL acceptance");
  const parsed = new URL(value);
  assert.ok(
    parsed.protocol === "postgres:" || parsed.protocol === "postgresql:",
    "private-document acceptance requires PostgreSQL",
  );
  return value;
}

function repositoryError(code) {
  return (error) => {
    assert.ok(error instanceof PrivateDocumentRepositoryError);
    assert.equal(error.code, code);
    return true;
  };
}

function storedPdf(originalFilename, bytes) {
  return storePrivateDocumentObject({
    originalFilename,
    declaredMimeType: "application/pdf",
    chunks: (async function* () {
      yield bytes;
    })(),
  });
}

test("private document repository binds metadata and bytes to handed-off canonical cases", async () => {
  const databaseUrl = requiredDatabaseUrl();
  const sql = postgres(databaseUrl, {
    idle_timeout: 5,
    max: 1,
    onnotice: () => undefined,
  });
  const privateRoot = await mkdtemp(join(tmpdir(), "evo-private-document-repository-"));
  const previousRoot = process.env.EVO_PRIVATE_DOCUMENT_ROOT;
  process.env.EVO_PRIVATE_DOCUMENT_ROOT = privateRoot;

  const personId = randomUUID();
  const leadId = randomUUID();
  const caseId = randomUUID();

  try {
    await sql`
      insert into evo_people (id, full_name, email)
      values (${personId}, ${`technical-document-${personId}`}, ${`${personId}@acceptance.invalid`})
    `;
    await sql`
      insert into evo_leads (id, person_id, source, stage)
      values (${leadId}, ${personId}, 'private-document-acceptance', 'handed_off')
    `;
    await sql`
      insert into evo_student_cases (id, person_id, lead_id, status)
      values (${caseId}, ${personId}, ${leadId}, 'active')
    `;

    await assert.rejects(
      createPrivateDocument({
        actorRole: "sales",
        caseId,
        upload: await storedPdf("initial.pdf", INITIAL_BYTES),
      }),
      repositoryError("not_found"),
    );

    const initial = await createPrivateDocument({
      actorRole: "admissions",
      caseId,
      upload: await storedPdf("initial.pdf", INITIAL_BYTES),
    });
    const initialCaseDocuments = await listPrivateDocumentsForCase({
      actorRole: "admissions",
      caseId,
    });
    assert.equal(initialCaseDocuments.length, 1);
    assert.deepEqual(initialCaseDocuments[0].versions, [initial]);
    assert.equal(initialCaseDocuments[0].displayName, `technical-document-${personId}`);
    assert.equal(JSON.stringify(initialCaseDocuments).includes("objectKey"), false);

    const replacement = await resubmitPrivateDocument({
      actorRole: "admin",
      documentId: initial.documentId,
      upload: await storedPdf("replacement.pdf", REPLACEMENT_BYTES),
    });
    const caseDocuments = await listPrivateDocumentsForCase({
      actorRole: "admin",
      caseId,
    });
    assert.deepEqual(
      caseDocuments[0].versions.map((version) => version.versionNumber),
      [2, 1],
    );
    assert.deepEqual(caseDocuments[0].versions[0], replacement);

    const queue = await listPrivateDocuments({ actorRole: "admissions" });
    const queueRow = queue.find((row) => row.documentId === initial.documentId);
    assert.ok(queueRow);
    assert.equal(queueRow.caseId, caseId);
    assert.equal(queueRow.leadId, leadId);
    assert.equal(queueRow.personId, personId);
    assert.deepEqual(queueRow.latestVersion, replacement);
    assert.equal(JSON.stringify(queueRow).includes("objectKey"), false);

    await sql`update evo_student_cases set status = 'paused' where id = ${caseId}`;
    assert.equal(
      (await listPrivateDocumentsForCase({ actorRole: "admissions", caseId }))[0]
        .caseStatus,
      "paused",
    );
    assert.deepEqual(
      (await downloadPrivateDocumentVersion({
        actorRole: "admissions",
        versionId: initial.versionId,
      })).bytes,
      INITIAL_BYTES,
    );
    await assert.rejects(
      createPrivateDocument({
        actorRole: "admissions",
        caseId,
        upload: await storedPdf("blocked-new.pdf", INITIAL_BYTES),
      }),
      repositoryError("not_found"),
    );
    await assert.rejects(
      resubmitPrivateDocument({
        actorRole: "admissions",
        documentId: initial.documentId,
        upload: await storedPdf("blocked.pdf", REPLACEMENT_BYTES),
      }),
      repositoryError("not_found"),
    );
    assert.equal(
      Number(
        (
          await sql`
            select count(*)::int as count
            from evo_private_documents
            where case_id = ${caseId}
          `
        )[0].count,
      ),
      1,
    );
    assert.equal(
      Number(
        (
          await sql`
            select count(*)::int as count
            from evo_private_document_versions
            where document_id = ${initial.documentId}
          `
        )[0].count,
      ),
      2,
    );
    assert.equal((await readdir(join(privateRoot, "objects"))).length, 2);

    await sql`update evo_student_cases set status = 'closed' where id = ${caseId}`;
    assert.equal(
      (await listPrivateDocumentsForCase({ actorRole: "admin", caseId }))[0]
        .caseStatus,
      "closed",
    );

    await sql`update evo_leads set stage = 'handoff_ready' where id = ${leadId}`;
    await assert.rejects(
      listPrivateDocumentsForCase({ actorRole: "admissions", caseId }),
      repositoryError("not_found"),
    );
    await assert.rejects(
      downloadPrivateDocumentVersion({
        actorRole: "admissions",
        versionId: replacement.versionId,
      }),
      repositoryError("not_found"),
    );
    assert.equal(
      (await listPrivateDocuments({ actorRole: "admin" })).some(
        (row) => row.documentId === initial.documentId,
      ),
      false,
    );
  } finally {
    await closeDatabaseConnections();
    await sql`delete from evo_private_document_versions where document_id in (
      select id from evo_private_documents where case_id = ${caseId}
    )`;
    await sql`delete from evo_private_documents where case_id = ${caseId}`;
    await sql`delete from evo_student_cases where id = ${caseId}`;
    await sql`delete from evo_leads where id = ${leadId}`;
    await sql`delete from evo_people where id = ${personId}`;
    await sql.end({ timeout: 5 });
    if (previousRoot === undefined) delete process.env.EVO_PRIVATE_DOCUMENT_ROOT;
    else process.env.EVO_PRIVATE_DOCUMENT_ROOT = previousRoot;
    await rm(privateRoot, { recursive: true, force: true });
  }
});
