import { expect, test, type Page } from "@playwright/test";

async function login(page: Page, email: string, password: string, target = /\/dashboard$/) {
  await page.goto("/login");
  await page.getByLabel("Эл. почта").fill(email);
  await page.getByLabel("Пароль").fill(password);
  await Promise.all([
    page.waitForURL(target),
    page.getByRole("button", { name: "Войти" }).click(),
  ]);
}

async function browserFetch(page: Page, url: string, init?: RequestInit) {
  return page.evaluate(
    async ({ requestUrl, requestInit }) => {
      const response = await fetch(requestUrl, requestInit);
      return {
        status: response.status,
        contentType: response.headers.get("content-type"),
        body: await response.text(),
      };
    },
    { requestUrl: url, requestInit: init },
  );
}

test("anonymous requests cannot reach any transcription endpoint", async ({ page, request }) => {
  await page.goto("/transcription-lab");
  await expect(page).toHaveURL(/\/login$/);

  const cases: Array<[string, "get" | "post" | "delete"]> = [
    ["/api/transcription/jobs", "post"],
    ["/api/transcription/jobs/20260101000000-aaaaaaaa", "get"],
    ["/api/transcription/jobs/20260101000000-aaaaaaaa", "delete"],
    ["/api/transcription/jobs/20260101000000-aaaaaaaa/events", "get"],
    ["/api/transcription/jobs/20260101000000-aaaaaaaa/improve", "post"],
  ];
  for (const [url, method] of cases) {
    const response =
      method === "get"
        ? await request.get(url)
        : method === "post"
          ? await request.post(url)
          : await request.delete(url);
    expect(response.status(), `${method.toUpperCase()} ${url}`).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "authentication_required" });
  }
});

test("finance role is denied documents, portal data, AI, and transcription", async ({ page }) => {
  await login(page, "finance@demo.kg", "finance123", /\/finance$/);

  await page.goto("/documents");
  await expect(page).toHaveURL(/\/access-denied\?from=%2Fdocuments$/);
  await expect(page.locator("#staff-main").getByRole("heading", { name: "Нет доступа к разделу" })).toBeVisible();
  await page.goto("/portal");
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto("/transcription-lab");
  await expect(page).toHaveURL(/\/access-denied\?from=%2Ftranscription-lab$/);

  const summary = await browserFetch(page, "/api/ai/summary", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId: 1 }),
  });
  expect(summary.status).toBe(400);
  expect(JSON.parse(summary.body)).toEqual({ error: "not_configured" });

  const draft = await browserFetch(page, "/api/ai/draft", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ conversationId: 1 }),
  });
  expect(draft.status).toBe(401);

  const transcription = await browserFetch(page, "/api/transcription/jobs/20260101000000-aaaaaaaa");
  expect(transcription.status).toBe(403);
  expect(JSON.parse(transcription.body)).toEqual({ error: "forbidden" });
});

test("client cannot access finance, documents, client records, AI, or transcription", async ({ page }) => {
  await login(page, "client@demo.kg", "client123", /\/portal$/);

  for (const route of ["/finance", "/documents", "/clients", "/transcription-lab"]) {
    await page.goto(route);
    await expect(page).toHaveURL(/\/portal$/);
  }

  for (const route of ["/api/ai/summary", "/api/ai/draft"]) {
    const response = await browserFetch(page, route, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: 1, conversationId: 1 }),
    });
    expect(response.status, route).toBe(401);
  }

  const transcription = await browserFetch(page, "/api/transcription/jobs/20260101000000-aaaaaaaa");
  expect(transcription.status).toBe(403);
});

test("sales role cannot access finance or another user's portal", async ({ page }) => {
  await login(page, "sales@demo.kg", "sales123", /\/sales$/);
  await page.goto("/finance");
  await expect(page).toHaveURL(/\/access-denied\?from=%2Ffinance$/);
  await expect(page.getByText("Защищённые данные раздела не загружались.")).toBeVisible();
  await page.goto("/portal");
  await expect(page).toHaveURL(/\/dashboard$/);
});

test("admin can reach the lab and authenticated transcription handlers enforce limits", async ({ page }) => {
  await login(page, "admin@demo.kg", "admin123");
  await page.goto("/access-denied?from=%2Ffinance");
  await expect(page).toHaveURL(/\/finance$/);
  await page.goto("/transcription-lab");
  await expect(page.getByRole("heading", { name: "Live MP3 Transcription Lab" })).toBeVisible();

  const missing = await page.evaluate(async () => {
    const response = await fetch("/api/transcription/jobs", {
      method: "POST",
      body: new FormData(),
    });
    return { status: response.status, body: await response.text() };
  });
  expect(missing.status).toBe(400);
  expect(JSON.parse(missing.body)).toEqual({ error: "exactly_one_file_required" });

  const invalidSignature = await page.evaluate(async () => {
    const form = new FormData();
    form.set("file", new File(["not an mp3"], "call.mp3", { type: "audio/mpeg" }));
    const response = await fetch("/api/transcription/jobs", { method: "POST", body: form });
    return { status: response.status, body: await response.text() };
  });
  expect(invalidSignature.status).toBe(415);
  expect(JSON.parse(invalidSignature.body)).toEqual({ error: "unsupported_file_type" });

  const tooManyFiles = await page.evaluate(async () => {
    const form = new FormData();
    const header = new Uint8Array([0x49, 0x44, 0x33]);
    form.append("file", new File([header], "first.mp3", { type: "audio/mpeg" }));
    form.append("file", new File([header], "second.mp3", { type: "audio/mpeg" }));
    const response = await fetch("/api/transcription/jobs", { method: "POST", body: form });
    return { status: response.status, body: await response.text() };
  });
  expect(tooManyFiles.status).toBe(400);
  expect(JSON.parse(tooManyFiles.body)).toEqual({ error: "exactly_one_file_required" });

  const notFound = await browserFetch(page, "/api/transcription/jobs/20260101000000-aaaaaaaa");
  expect(notFound.status).toBe(404);
  expect(JSON.parse(notFound.body)).toEqual({ error: "not_found" });

  const improvement = await browserFetch(
    page,
    "/api/transcription/jobs/20260101000000-aaaaaaaa/improve",
    { method: "POST" },
  );
  expect(improvement.status).toBe(503);
  expect(JSON.parse(improvement.body)).toEqual({ error: "external_processing_disabled" });
});
