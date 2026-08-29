import { createHash, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";

import { expect, test, type Page } from "@playwright/test";

const documentMode = process.env.EVO_EXPECT_DOCUMENT_MODE ?? "configured";
const acceptanceResultFile =
  process.env.EVO_PRIVATE_DOCUMENT_ACCEPTANCE_RESULT_FILE ?? "";
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requireUuid(value: string | null, label: string): string {
  if (!value || !uuidPattern.test(value)) {
    throw new Error(`${label} must be a valid non-nil UUID`);
  }
  return value;
}

function requirePrivateDocumentCaseId(): string {
  const value = process.env.EVO_PRIVATE_DOCUMENT_CASE_ID;
  return requireUuid(value ?? null, "EVO_PRIVATE_DOCUMENT_CASE_ID");
}
const caseId = requirePrivateDocumentCaseId();
const guessedDocumentId = "00000000-0000-4000-8000-000000000498";
const guessedVersionId = "00000000-0000-4000-8000-000000000499";
const initialBytes = Buffer.from(
  "%PDF-1.4\n% EVO V2 private persistence acceptance\n1 0 obj\n<<>>\nendobj\n%%EOF\n",
);
const replacementBytes = Buffer.from(
  "%PDF-1.4\n% EVO V2 immutable replacement version\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n",
);

function credentials(role: "admin" | "sales" | "admissions") {
  const prefix = `EVO_DEV_GATE_${role.toUpperCase()}`;
  const identifier = process.env[`${prefix}_IDENTIFIER`];
  const secret = process.env[`${prefix}_SECRET`];
  if (!identifier || !secret) {
    throw new Error(`missing browser credential for ${role}`);
  }
  return { identifier, secret };
}

async function login(page: Page, role: "admin" | "sales" | "admissions") {
  const { identifier, secret } = credentials(role);
  await page.goto("/login");
  await page.locator("#gate-identifier").fill(identifier);
  await page.locator("#gate-secret").fill(secret);
  await page.getByRole("button", { name: "Открыть CRM" }).click();
  await expect(page.getByTestId("development-workspace")).toBeVisible();
}

function uploadMultipart(bytes: Buffer, filename = "acceptance.pdf") {
  return {
    caseId,
    file: {
      name: filename,
      mimeType: "application/pdf",
      buffer: bytes,
    },
  };
}

async function downloadBytes(
  download: import("@playwright/test").Download,
): Promise<Buffer> {
  const stream = await download.createReadStream();
  if (!stream) throw new Error("private document download stream unavailable");
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function expectError(
  response: import("@playwright/test").APIResponse,
  status: number,
  error: string,
  options: Readonly<{ routeHandled?: boolean }> = {},
) {
  expect(response.status()).toBe(status);
  expect(await response.json()).toEqual({ error });
  expect(response.headers()["cache-control"]).toContain("no-store");
  if (options.routeHandled !== false) {
    expect(response.headers()["x-content-type-options"]).toBe("nosniff");
  }
}

test("private documents use one authorized PostgreSQL and filesystem path", async ({
  page,
}) => {
  test.skip(documentMode !== "configured");
  const api = page.context().request;

  await expectError(
    await api.post("/api/v2/documents", {
      multipart: uploadMultipart(initialBytes),
    }),
    401,
    "authentication_required",
    { routeHandled: false },
  );

  await login(page, "sales");
  await expectError(
    await api.post("/api/v2/documents", {
      multipart: uploadMultipart(initialBytes),
    }),
    403,
    "forbidden",
  );

  await page.context().clearCookies();
  await login(page, "admin");
  await expectError(
    await api.get(
      `/api/v2/document-versions/${guessedVersionId}/download`,
    ),
    404,
    "document_not_found",
  );

  await page.getByTestId("preview-role-sales").click();
  await expect(page.getByTestId("active-role")).toHaveAttribute(
    "data-authority-role",
    "admin",
  );
  await expect(page.getByTestId("active-role")).toHaveAttribute(
    "data-role",
    "sales",
  );
  await expectError(
    await api.get(
      `/api/v2/document-versions/${guessedVersionId}/download`,
    ),
    403,
    "forbidden",
  );

  await page.getByTestId("preview-role-admissions").click();
  await expect(page.getByTestId("active-role")).toHaveAttribute(
    "data-role",
    "admissions",
  );
  await expectError(
    await api.get(
      `/api/v2/document-versions/${guessedVersionId}/download`,
    ),
    404,
    "document_not_found",
  );

  await page.getByTestId("preview-role-admin").click();
  await expect(page.getByTestId("active-role")).toHaveAttribute(
    "data-role",
    "admin",
  );
  await expectError(
    await api.get(
      `/api/v2/document-versions/${guessedVersionId}/download`,
    ),
    404,
    "document_not_found",
  );

  await page.context().clearCookies();
  await login(page, "admissions");

  await expectError(
    await api.post("/api/v2/documents", {
      multipart: {
        ...uploadMultipart(initialBytes),
        objectKey: randomUUID(),
      },
    }),
    400,
    "invalid_request",
  );
  await expectError(
    await api.post("/api/v2/documents", {
      multipart: uploadMultipart(initialBytes, "../../outside.pdf"),
    }),
    400,
    "invalid_request",
  );

  await expectError(
    await api.post(
      `/api/v2/documents/${guessedDocumentId}/resubmissions`,
      { multipart: { file: uploadMultipart(replacementBytes).file } },
    ),
    404,
    "document_not_found",
  );
  await expectError(
    await api.get(
      `/api/v2/document-versions/${guessedVersionId}/download`,
    ),
    404,
    "document_not_found",
  );

  await page.goto(`/clients/${caseId}#documents`);
  const documentPanel = page.getByTestId("canonical-private-documents");
  await expect(documentPanel).toBeVisible();
  await expect(
    documentPanel.getByTestId("canonical-private-document"),
  ).toHaveCount(0);

  const uploadForm = documentPanel.getByTestId(
    "canonical-private-document-upload-form",
  );
  await uploadForm.locator('input[type="file"]').setInputFiles({
    name: "acceptance.pdf",
    mimeType: "application/pdf",
    buffer: initialBytes,
  });
  await uploadForm.locator('button[type="submit"]').click();

  const documentRow = documentPanel
    .getByTestId("canonical-private-document")
    .filter({ hasText: "acceptance.pdf" });
  await expect(documentRow).toBeVisible();
  const documentId = requireUuid(
    await documentRow.getAttribute("data-document-id"),
    "Student 360 document id",
  );
  const initialLink = documentRow.locator(
    '[data-testid="canonical-private-document-download"][data-version-number="1"]',
  );
  await expect(initialLink).toBeVisible();
  const initialVersionId = requireUuid(
    await initialLink.getAttribute("data-version-id"),
    "initial document version id",
  );
  await expect(initialLink).toHaveAttribute(
    "href",
    `/api/v2/document-versions/${initialVersionId}/download`,
  );

  const [initialDownload] = await Promise.all([
    page.waitForEvent("download"),
    initialLink.click(),
  ]);
  expect(initialDownload.suggestedFilename()).toBe("acceptance.pdf");
  expect(await downloadBytes(initialDownload)).toEqual(initialBytes);

  const resubmissionForm = documentRow.getByTestId(
    "canonical-private-document-resubmit-form",
  );
  await resubmissionForm.locator('input[type="file"]').setInputFiles({
    name: "acceptance-replacement.pdf",
    mimeType: "application/pdf",
    buffer: replacementBytes,
  });
  await resubmissionForm.locator('button[type="submit"]').click();

  const replacementLink = documentRow.locator(
    '[data-testid="canonical-private-document-download"][data-version-number="2"]',
  );
  await expect(replacementLink).toBeVisible();
  await expect(documentRow).toContainText("acceptance-replacement.pdf");
  const replacementVersionId = requireUuid(
    await replacementLink.getAttribute("data-version-id"),
    "replacement document version id",
  );
  expect(replacementVersionId).not.toBe(initialVersionId);

  const [replacementDownload] = await Promise.all([
    page.waitForEvent("download"),
    replacementLink.click(),
  ]);
  expect(replacementDownload.suggestedFilename()).toBe(
    "acceptance-replacement.pdf",
  );
  expect(await downloadBytes(replacementDownload)).toEqual(replacementBytes);

  const [historicalDownload] = await Promise.all([
    page.waitForEvent("download"),
    initialLink.click(),
  ]);
  expect(await downloadBytes(historicalDownload)).toEqual(initialBytes);

  await page.goto("/documents");
  const queue = page.getByTestId("canonical-private-document-queue");
  await expect(queue).toBeVisible();
  const queueRow = queue
    .getByTestId("canonical-private-document-queue-row")
    .filter({ hasText: "acceptance-replacement.pdf" });
  await expect(queueRow).toHaveCount(1);
  await expect(queueRow).toHaveAttribute("data-document-id", documentId);
  await expect(queueRow).toContainText("acceptance-replacement.pdf");
  await expect(queueRow).toContainText("Версия 2");
  await expect(queueRow).toContainText("active");
  const student360Link = queueRow.getByRole("link", {
    name: "Открыть в Student 360",
  });
  await expect(student360Link).toHaveAttribute(
    "href",
    `/clients/${caseId}#documents`,
  );
  await student360Link.click();
  await expect(page).toHaveURL(`/clients/${caseId}#documents`);
  await expect(
    page
      .getByTestId("canonical-private-documents")
      .getByTestId("canonical-private-document")
      .filter({ hasText: "acceptance-replacement.pdf" }),
  ).toBeVisible();

  if (!acceptanceResultFile) {
    throw new Error("EVO_PRIVATE_DOCUMENT_ACCEPTANCE_RESULT_FILE is required");
  }
  await writeFile(
    acceptanceResultFile,
    `${JSON.stringify({
      caseId,
      documentId,
      versions: [
        {
          versionId: initialVersionId,
          versionNumber: 1,
          originalFilename: "acceptance.pdf",
          byteLength: initialBytes.byteLength,
          sha256: createHash("sha256").update(initialBytes).digest("hex"),
        },
        {
          versionId: replacementVersionId,
          versionNumber: 2,
          originalFilename: "acceptance-replacement.pdf",
          byteLength: replacementBytes.byteLength,
          sha256: createHash("sha256").update(replacementBytes).digest("hex"),
        },
      ],
    })}\n`,
    { encoding: "utf8", mode: 0o600 },
  );

  for (const publicCandidate of [
    `/private-documents/${replacementVersionId}`,
    `/uploads/${replacementVersionId}`,
  ]) {
    const response = await api.get(publicCandidate, { maxRedirects: 0 });
    expect(response.status()).toBe(307);
    expect(response.headers()["location"]).toContain("/platform-pending");
    expect(response.headers()["content-type"] ?? "").not.toContain(
      "application/pdf",
    );
  }
});

test("an unavailable private root fails closed without a fallback", async ({
  page,
}) => {
  test.skip(documentMode !== "unavailable");
  await login(page, "admissions");
  await expectError(
    await page.context().request.post("/api/v2/documents", {
      multipart: uploadMultipart(initialBytes),
    }),
    503,
    "document_storage_unavailable",
  );
});
