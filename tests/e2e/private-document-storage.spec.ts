import { createHash, randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

const documentMode = process.env.EVO_EXPECT_DOCUMENT_MODE ?? "configured";
function requirePrivateDocumentCaseId(): string {
  const value = process.env.EVO_PRIVATE_DOCUMENT_CASE_ID;
  if (
    !value ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  ) {
    throw new Error("EVO_PRIVATE_DOCUMENT_CASE_ID must be a valid non-nil UUID");
  }
  return value;
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

type DocumentMetadata = Readonly<{
  documentId: string;
  caseId: string;
  versionId: string;
  versionNumber: number;
  originalFilename: string;
  declaredMimeType: string;
  byteLength: number;
  sha256: string;
  createdAt: string;
}>;

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

function expectPrivateResponseHeaders(
  headers: Record<string, string>,
): void {
  expect(headers["cache-control"]).toContain("no-store");
  expect(headers["x-content-type-options"]).toBe("nosniff");
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

  const createResponse = await api.post("/api/v2/documents", {
    multipart: uploadMultipart(initialBytes),
  });
  expect(createResponse.status()).toBe(201);
  expectPrivateResponseHeaders(createResponse.headers());
  const createBody = (await createResponse.json()) as {
    document: DocumentMetadata;
  };
  const initial = createBody.document;
  expect(initial).toMatchObject({
    caseId,
    versionNumber: 1,
    originalFilename: "acceptance.pdf",
    declaredMimeType: "application/pdf",
    byteLength: initialBytes.byteLength,
    sha256: createHash("sha256").update(initialBytes).digest("hex"),
  });
  expect(initial.documentId).toMatch(/^[0-9a-f-]{36}$/);
  expect(initial.versionId).toMatch(/^[0-9a-f-]{36}$/);
  expect(JSON.stringify(createBody)).not.toMatch(
    /objectKey|object_key|private.document.root|\/objects\//i,
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

  const initialDownload = await api.get(
    `/api/v2/document-versions/${initial.versionId}/download`,
  );
  expect(initialDownload.status()).toBe(200);
  expectPrivateResponseHeaders(initialDownload.headers());
  expect(initialDownload.headers()["content-type"]).toContain("application/pdf");
  expect(initialDownload.headers()["content-disposition"]).toContain(
    "attachment",
  );
  expect(Number(initialDownload.headers()["content-length"])).toBe(
    initialBytes.byteLength,
  );
  expect(await initialDownload.body()).toEqual(initialBytes);

  const resubmitResponse = await api.post(
    `/api/v2/documents/${initial.documentId}/resubmissions`,
    {
      multipart: {
        file: {
          name: "acceptance-replacement.pdf",
          mimeType: "application/pdf",
          buffer: replacementBytes,
        },
      },
    },
  );
  expect(resubmitResponse.status()).toBe(201);
  expectPrivateResponseHeaders(resubmitResponse.headers());
  const resubmitBody = (await resubmitResponse.json()) as {
    document: DocumentMetadata;
  };
  const replacement = resubmitBody.document;
  expect(replacement).toMatchObject({
    documentId: initial.documentId,
    caseId,
    versionNumber: 2,
    originalFilename: "acceptance-replacement.pdf",
    byteLength: replacementBytes.byteLength,
    sha256: createHash("sha256").update(replacementBytes).digest("hex"),
  });
  expect(replacement.versionId).not.toBe(initial.versionId);
  expect(JSON.stringify(resubmitBody)).not.toMatch(
    /objectKey|object_key|private.document.root|\/objects\//i,
  );

  const replacementDownload = await api.get(
    `/api/v2/document-versions/${replacement.versionId}/download`,
  );
  expect(replacementDownload.status()).toBe(200);
  expect(await replacementDownload.body()).toEqual(replacementBytes);
  expect(
    await (
      await api.get(
        `/api/v2/document-versions/${initial.versionId}/download`,
      )
    ).body(),
  ).toEqual(initialBytes);

  for (const publicCandidate of [
    `/private-documents/${replacement.versionId}`,
    `/uploads/${replacement.versionId}`,
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
