import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page, type Route } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { readFileSync } from "node:fs";
import { chmod } from "node:fs/promises";
import { join } from "node:path";
import type { AdmissionsWorkspace } from "../../src/lib/platform-admissions-playbook-contract";

const today = new Date().toISOString().slice(0, 10);
const later = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
function env(name: string): string {
  const value = process.env[`EVO_ADMISSIONS_${name}`];
  if (!value) throw new Error(`E5 environment missing ${name}`);
  return value;
}
interface Fixture {
  organizationId: string; curatorEmail: string; curatorMembershipId: string;
  cases: Record<string, { caseId: string; leadId: string }>;
}
function fixture(): Fixture { return JSON.parse(readFileSync(env("FIXTURE_PATH"), "utf8")); }
function caseId(scenario: string): string { return fixture().cases[scenario].caseId; }
function route(scenario: string): string { return `/v3/profile?case=${caseId(scenario)}&tab=route`; }
function client() {
  const url = env("SUPABASE_URL");
  if (new URL(url).hostname !== "127.0.0.1") throw new Error("E5 API must be isolated loopback");
  return createClient(url, env("SUPABASE_PUBLISHABLE_KEY"), {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}
async function api(kind: "curator" | "student" | "student_second" = "curator") {
  const connection = client();
  const { error } = await connection.auth.signInWithPassword({
    email: kind === "curator" ? fixture().curatorEmail : env(`${kind.toUpperCase()}_EMAIL`),
    password: env(`${kind.toUpperCase()}_PASSWORD`),
  });
  if (error) throw new Error(`E5 ${kind} Auth login failed`);
  return connection;
}
async function rpc(connection: Awaited<ReturnType<typeof api>>, name: string, args: Record<string, unknown>) {
  const { data, error } = await connection.schema("platform").rpc(name, args);
  if (error) throw new Error(`E5 ${name}: ${error.code} ${error.message}`);
  return data as Record<string, unknown>;
}
async function workspace(scenario: string): Promise<AdmissionsWorkspace> {
  return await rpc(await api(), "staff_case_admissions_workspace_v1", { p_student_case_id: caseId(scenario) }) as unknown as AdmissionsWorkspace;
}
async function dbRead<T>(read: (sql: ReturnType<typeof postgres>) => Promise<T>): Promise<T> {
  const url = env("DB_URL");
  if (new URL(url).hostname !== "127.0.0.1") throw new Error("E5 DB must be isolated loopback");
  const sql = postgres(url, { max: 1, prepare: false });
  try { return await read(sql); } finally { await sql.end({ timeout: 5 }); }
}
async function login(page: Page, kind: "curator" | "admin" = "curator") {
  await page.goto("/login");
  await page.locator("#staff-email").fill(kind === "curator" ? fixture().curatorEmail : env("ADMIN_EMAIL"));
  await page.locator("#staff-password").fill(env(`${kind.toUpperCase()}_PASSWORD`));
  await page.locator('form[aria-labelledby="login-title"] button[type="submit"]').click();
  await expect(page).toHaveURL(kind === "curator" ? /\/v3\/calendar$/ : /\/v3\/main$/);
  await expect(page.getByTestId("v3-shell")).toBeVisible();
}
async function expand(parent: Page | Locator, name: string): Promise<Locator> {
  // Exact visible summary text identifies the disclosure; never mutate its state.
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const summary = parent.locator("summary").filter({ hasText: new RegExp(`^${escaped}(?:$|не заполнено|\\d+ заполнено| ·| — основная)`) }).first();
  const box = summary.locator("..");
  if (await box.getAttribute("open") === null) await summary.click();
  return box;
}
async function setFields(editor: Locator, values: Record<string, string>) {
  for (const [label, value] of Object.entries(values)) {
    // Wrapped native selects include their option text in Playwright's label
    // text query; the visible field label still uniquely identifies the input.
    const input = editor.getByLabel(label, { exact: false });
    await expect(input).toHaveCount(1);
    if (await input.evaluate((element) => element.tagName === "SELECT")) {
      await expect(input).toHaveAccessibleName(label);
      await input.selectOption(value);
    } else await input.fill(value);
  }
}
async function save(editor: Locator) {
  await editor.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(editor).not.toBeVisible();
}
async function editCase(page: Page, section: string, values: Record<string, string>) {
  await expand(page.getByTestId("admissions-route"), "Данные маршрута, жильё и поездка");
  const box = await expand(page.getByTestId("admissions-route"), section);
  await box.getByRole("button", { name: "Изменить", exact: true }).click();
  const editor = page.getByRole("region", { name: section, exact: true });
  await setFields(editor, values); await save(editor);
}
async function editApplication(page: Page, institution: string, section: string, values: Record<string, string>) {
  const app = await expand(page.getByTestId("admissions-route"), institution);
  const box = await expand(app, section);
  await box.getByRole("button", { name: "Изменить", exact: true }).click();
  const editor = page.getByRole("region", { name: `${institution}: ${section}`, exact: true });
  await setFields(editor, values); await save(editor);
}
async function applicationStatus(page: Page, scenario: string, institution: string, status: string) {
  const controls = await expand(page, "Заявки, статусы и визовое дело");
  const application = controls.getByTestId("v3-profile-application").filter({ has: page.getByText(institution, { exact: true }) });
  const form = await expand(application, "Изменить статус");
  await setFields(form, { "Статус": status, "Ссылка на подтверждение": `E5 fictional canonical ${status} evidence` });
  const submitted = {
    scenario,
    expectedVersion: await form.locator('input[name="expected_version"]').inputValue(),
    status: await form.getByRole("combobox", { name: "Статус", exact: true }).inputValue(),
    evidence: await form.getByRole("textbox", { name: "Ссылка на подтверждение", exact: true }).inputValue(),
  };
  // Only generated fictional values, never Auth requests, cookies or tokens.
  console.info("E5_CANONICAL_APPLICATION_SUBMIT", JSON.stringify(submitted));
  expect(submitted.status).toBe(status);
  expect(submitted.evidence).toBe(`E5 fictional canonical ${status} evidence`);
  await form.getByRole("button", { name: "Сохранить статус", exact: true }).click();
  await expect.poll(async () => (await workspace(scenario)).applications.find((item) => item.institutionName === institution)?.status).toBe(status);
  const confirmed = (await workspace(scenario)).applications.find((item) => item.institutionName === institution)!;
  console.info("E5_CANONICAL_APPLICATION_CONFIRMED", JSON.stringify({ scenario, status: confirmed.status, version: confirmed.version }));
  expect(BigInt(confirmed.version)).toBe(BigInt(submitted.expectedVersion) + BigInt(1));
  await page.reload();
}

async function submissionWithDelayedRefresh(page: Page, scenario: string, institution: string) {
  const controls = await expand(page, "Заявки, статусы и визовое дело");
  const application = controls.getByTestId("v3-profile-application").filter({ has: page.getByText(institution, { exact: true }) });
  const canonical = await expand(application, "Изменить статус");
  let held = false;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const handler = async (intercepted: Route) => {
    const request = intercepted.request();
    if (!held && request.method() === "GET" && request.headers().rsc === "1") {
      held = true;
      await gate;
    }
    // Delay the real RSC request, never fabricate a backend response.
    await intercepted.continue();
  };
  await page.route("**/v3/profile?**", handler);
  const saving = editApplication(page, institution, "Подача", {
    "Фактическая дата подачи в университет": today,
    "Номер / ссылка подачи": "E5 actual fictional university reference",
    "Основание фактической подачи": "E5 separate fictional university acknowledgement",
  });
  try {
    await expect.poll(() => held).toBe(true);
    await expect(canonical.getByRole("combobox", { name: "Статус", exact: true })).toBeDisabled();
    await expect(canonical.getByRole("textbox", { name: "Ссылка на подтверждение", exact: true })).toBeDisabled();
    await expect(canonical.getByRole("button", { name: "Сохранить статус", exact: true })).toBeDisabled();
    await capture(page, `${scenario}-refresh-freezes-sibling-form`);
  } finally {
    release();
    await saving;
    await page.unroute("**/v3/profile?**", handler);
  }
  await applicationStatus(page, scenario, institution, "submitted");
}
async function editVisa(page: Page, section: string, values: Record<string, string>) {
  const controls = await expand(page.getByTestId("admissions-route"), "Готовность к въезду · EMGS, eVAL и MDAC");
  const box = await expand(controls, section);
  await box.getByRole("button", { name: "Изменить", exact: true }).click();
  const editor = page.getByRole("region", { name: section, exact: true });
  if (section === "Паспорт и виза") {
    for (const label of ["Дата выдачи визы", "Виза действительна до", "Китай: основание / JW-документ"])
      await expect(editor.getByLabel(label, { exact: true })).toHaveCount(0);
  }
  await setFields(editor, values); await save(editor);
}
async function configure(page: Page, scenario: string, direction: "CN" | "MY") {
  await page.goto(route(scenario));
  await expect(page.getByTestId("admissions-route")).toBeVisible();
  const ack = page.getByTestId("v3-handoff-acknowledgement");
  await ack.getByRole("button", { name: "Принять дело", exact: true }).click();
  await ack.getByLabel("Согласованная дата контакта · необязательно").fill(today);
  await ack.getByRole("button", { name: "Подтвердить приём", exact: true }).click();
  await expect(ack.getByRole("status")).toContainText("Ответ сохранён");
  await page.getByRole("button", { name: "Выбрать маршрут", exact: true }).click();
  const editor = page.getByRole("region", { name: "Выбрать направление и маршрут", exact: true });
  await setFields(editor, { "Направление": direction, "Следующий шаг": `E5 ${scenario}: согласовать программу`, "Срок следующего шага": today });
  await save(editor);
  await expect.poll(async () => (await workspace(scenario)).case.direction).toBe(direction);
  await expect(page.getByRole("button", { name: "Завершить этап и перейти дальше", exact: true })).toBeEnabled();
}
async function nextStage(page: Page, expectedStage: string) {
  await page.getByRole("button", { name: "Завершить этап и перейти дальше", exact: true }).click();
  const editor = page.getByRole("region", { name: `Перейти: ${expectedStage}`, exact: true });
  await editor.getByLabel("Основание действия").fill("E5 проверены реальные записи фиктивного дела");
  await save(editor);
  await expect(page.getByTestId("admissions-route").locator("section").first().getByRole("heading", { level: 3 })).toHaveText(expectedStage);
  await expect(page.getByTestId("admissions-route").getByRole("button", { name: new RegExp(`^\\d+\\. ${expectedStage} — текущий этап дела$`) })).toHaveAttribute("aria-pressed", "true");
}
async function capture(page: Page, name: string) {
  await page.evaluate(async () => { await document.fonts.ready; window.scrollTo(0, 0); });
  const path = join(env("SCREENSHOT_DIR"), `${name}.png`);
  await page.screenshot({ path, fullPage: true }); await chmod(path, 0o600);
}
async function visualChecks(page: Page) {
  await expect(page.getByTestId("v3-shell")).toBeVisible();
  await expect(page.getByRole("heading").first()).toBeVisible();
  await expect(page.locator("[data-nextjs-dialog-overlay]")).toHaveCount(0);
  const geometry = await page.evaluate(() => ({ width: innerWidth, content: document.documentElement.scrollWidth }));
  expect(geometry.content).toBeLessThanOrEqual(geometry.width + 1);
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(results.violations.map(({ id, nodes }) => ({ id, targets: nodes.map((node) => node.target) }))).toEqual([]);
}
async function applicationFixtures(scenario: string) {
  const connection = await api(); const id = caseId(scenario); const org = fixture().organizationId;
  const institution = `E5 ${scenario} University`;
  const primary = await rpc(connection, "create_university_application", {
    p_organization_id: org, p_student_case_id: id, p_institution_name: institution,
    p_program_name: "Fictional Programme", p_status: "preparation", p_evidence_reference: null,
    p_is_primary: false, p_university_deadline_on: later, p_country: null, p_degree: null, p_expected_version: 0,
    p_note: "Synthetic application via real curator RPC", p_request_id: crypto.randomUUID(),
  });
  const alternate = await rpc(connection, "create_university_application", {
    p_organization_id: org, p_student_case_id: id, p_institution_name: "E5 Alternative University",
    p_program_name: "Alternative Programme", p_status: "preparation", p_evidence_reference: null,
    p_is_primary: false, p_university_deadline_on: later, p_country: null, p_degree: null, p_expected_version: 0,
    p_note: "Must remain independent", p_request_id: crypto.randomUUID(),
  });
  const primaryId = String(primary.university_application_id);
  for (const [name, target] of [["E5 primary requirement", primaryId], ["E5 other application only", String(alternate.university_application_id)]]) {
    const slot = await rpc(connection, "create_custom_document_slot", {
      p_organization_id: org, p_student_case_id: id, p_label: name, p_group_label: "E5 fictional requirements", p_request_id: crypto.randomUUID(),
    });
    await rpc(connection, "set_document_slot_case_link", {
      p_organization_id: org, p_student_case_id: id, p_document_slot_id: slot.document_slot_id,
      p_target_kind: "university_application", p_target_id: target, p_enabled: true,
      p_expected_version: 1, p_reason: "E5 exact application requirement", p_request_id: crypto.randomUUID(),
    });
  }
  return { institution, primaryId };
}

async function completeMalaysia(page: Page, scenario: string, institution: string) {
  await editApplication(page, institution, "Решение", { "Условия выполнены": today, "Основание выполнения условий": "E5 fictional fulfilled condition" });
  await nextStage(page, "Виза");
  await expect(page.getByRole("button", { name: "Завершить этап и перейти дальше", exact: true })).toBeDisabled();
  await expand(page, "Заявки, статусы и визовое дело");
  const visa = page.locator("#visa");
  await setFields(visa, { "Статус": "docs", "Ссылка на подтверждение": "E5 fictional prearrival preparation, NOT an issued Student Pass", "Заметка": "Student Pass remains pending after arrival" });
  await visa.getByRole("button", { name: "Создать визовое дело", exact: true }).click();
  await expect.poll(async () => (await workspace(scenario)).visa?.status).toBe("docs");
  await page.reload();
  await editVisa(page, "Паспорт и виза", {
    "Паспорт действителен до": later, "Требуется ли студенческая виза": "required",
    "Основание применимости визы": "E5 fictional applicant assessment", "Официальный источник по визе": "https://www.imi.gov.my/index.php/en/main-services/pass/student-pass/",
    "Дата проверки визовых требований": today,
  });
  await editVisa(page, "EMGS / eVAL", {
    "Малайзия: номер EMGS": "E5-FICTIONAL-EMGS", "Статус EMGS по фактической проверке": "E5 fictional clearance recorded",
    "Статус eVAL": "approved", "Номер eVAL": "E5-FICTIONAL-EVAL", "eVAL выдан": today,
    "eVAL действителен до": later, "Основание eVAL": "E5 fictional eVAL proof, not a real document",
  });
  await editVisa(page, "Въезд и MDAC", {
    "SEV / eVISA: требуется ли": "required", "Основание применимости SEV / eVISA": "E5 fictional nationality-specific assessment",
    "Официальный источник SEV / eVISA": "https://www.imi.gov.my/index.php/en/main-services/pass/student-pass/", "Дата проверки SEV / eVISA": today,
    "Статус SEV / eVISA": "approved", "Основание SEV / eVISA": "E5 fictional entry visa proof", "SEV / eVISA действительна до": later,
    "MDAC: требуется ли": "required", "Основание применимости MDAC": "E5 fictional applicant not exempt",
    "Официальный источник MDAC": "https://imigresen-online.imi.gov.my/mdac/main", "Дата проверки MDAC": today,
    "MDAC подана": today, "Подтверждение MDAC": "E5 fictional MDAC receipt, no external submission",
  });
  await expand(page, "Заявки, статусы и визовое дело");
  const visaSnapshot = (await workspace(scenario)).visa!;
  await expect(visa.locator('input[name="expected_version"]')).toHaveValue(visaSnapshot.version);
  await setFields(visa, { "Статус": "approved", "Ссылка на подтверждение": "E5 fictional prearrival clearance, NOT an issued Student Pass" });
  console.info("E5_CANONICAL_VISA_SUBMIT", JSON.stringify({ scenario, expectedVersion: await visa.locator('input[name="expected_version"]').inputValue(), status: await visa.getByRole("combobox", { name: "Статус", exact: true }).inputValue() }));
  await visa.getByRole("button", { name: "Обновить визу", exact: true }).click();
  await expect.poll(async () => (await workspace(scenario)).visa?.status).toBe("approved");
  expect(BigInt((await workspace(scenario)).visa!.version)).toBe(BigInt(visaSnapshot.version) + BigInt(1));
  await page.reload();
  await editCase(page, "Жильё", {
    "Нужно ли жильё": "required", "Пожелание по бюджету жилья": "Fictional budget only", "Валюта бюджета жилья": "MYR",
    "Кампус для подбора жилья": "Fictional Campus", "Плановая дата заселения": today,
    "Согласованный вариант жилья": "E5 fictional residence", "Дата согласования жилья": today,
    "Условия договора жилья": "E5 fictional agreement", "Условия депозита (не подтверждение оплаты)": "E5 no actual payment",
    "Подтверждение бронирования": "E5 fictional booking proof",
  });
  await editCase(page, "Поездка и прибытие", {
    "Дата выезда": today, "Подтверждение фактического выезда": "E5 fictional departure proof",
    "Плановое прибытие": today, "Контакт встречающей стороны": "E5 Fictional Receiving Desk",
    "Встречающая сторона уведомлена": today, "Подтверждение договорённости о встрече": "E5 fictional receiving acknowledgement",
    "Рейс / подтверждение билетов": "E5-FICTIONAL-FLIGHT, no booking",
  });
  await capture(page, "my-desktop-prearrival-clearance");
  await nextStage(page, "Поездка и прибытие");
  await expect(page.getByRole("button", { name: "Завершить по подтверждённому прибытию", exact: true })).toBeDisabled();
  await editCase(page, "После прибытия", {
    "Медицинское обследование после прибытия": "pending", "Регистрация в университете": "pending",
    "Student Pass / разрешение на пребывание": "pending", "Инструкции после прибытия переданы": today,
    "Основание передачи инструкций": "E5 fictional instructions acknowledged",
  });
  await editCase(page, "Поездка и прибытие", {
    "Фактическая дата прибытия": today, "Кто подтвердил прибытие": "E5 Fictional Receiving Desk",
    "Основание подтверждения прибытия": "E5 fictional arrival confirmation, distinct from tickets",
  });
  await page.getByRole("button", { name: "Завершить по подтверждённому прибытию", exact: true }).click();
  const completion = page.getByRole("region", { name: "Подтвердить завершение по прибытию", exact: true });
  await completion.getByLabel("Основание действия").fill("E5 fictional actual arrival confirmed; post-arrival formalities remain pending");
  await save(completion);
  await expect(page.getByRole("heading", { name: "Прибытие подтверждено", exact: true })).toBeVisible();
  let current = await workspace(scenario);
  expect(current.case).toMatchObject({ state: "closed", outcome: "arrived", facts: { medicalStatus: "pending", registrationStatus: "pending", studentPassStatus: "pending" } });
  expect(current.visa?.details.visaIssuedOn).toBeUndefined(); expect(current.visa?.details.visaExpiresOn).toBeUndefined();
  await capture(page, "my-desktop-arrived-formalities-pending"); await visualChecks(page);
  const report = await page.context().newPage();
  async function arrivals(expected: number) {
    await report.goto("/v3/profile?direction=MY");
    const metric = report.getByRole("region", { name: "Сводка по поступлению" }).getByText(`Прибыли за ${today.slice(0, 7)}`, { exact: true }).locator("..");
    await expect(metric.locator("span").last()).toHaveText(String(expected));
  }
  await arrivals(1); await capture(report, "my-desktop-arrival-report");
  await page.getByRole("button", { name: "Возобновить работу по делу", exact: true }).click();
  const reopen = page.getByRole("region", { name: "Перейти: Поездка и прибытие", exact: true });
  await reopen.getByLabel("Основание действия").fill("E5 fictional explicit reopening audit"); await save(reopen);
  current = await workspace(scenario);
  expect(current.case).toMatchObject({ state: "active", outcome: "active", facts: { arrivalOn: today, studentPassStatus: "pending" } });
  await arrivals(0); await capture(report, "my-desktop-reopened-report-excluded"); await report.close();
}

test.afterEach(async ({ page }) => { await expect(page.locator("[data-nextjs-dialog-overlay]")).toHaveCount(0); });

for (const direction of ["CN", "MY"] as const) {
  test(`${direction}: real handoff, route, primary-linked documents, receipt versus submission and conditional decision`, async ({ page }, info) => {
    test.setTimeout(300_000);
    test.skip(info.project.name !== "desktop-chromium", "Desktop operational journey; mobile has its own cases");
    const scenario = `${direction.toLowerCase()}-desktop`;
    const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
    await login(page); await configure(page, scenario, direction);
    await capture(page, `${scenario}-intake`);
    const { institution, primaryId } = await applicationFixtures(scenario);
    await page.reload(); await nextStage(page, "Выбор программы");
    await expect(page.getByRole("button", { name: "Завершить этап и перейти дальше", exact: true })).toBeDisabled();
    await editCase(page, "Выбор программы", {
      "Кампус": "Fictional Campus", "Набор": "Fictional 2027", "Выбранная программа": "Fictional Programme",
      "Дата согласования выбора": today, "Кто согласовал выбор": "E5 Fictional Student",
      "Основание согласованного выбора": "E5 fictional choice proof", "Основная заявка": primaryId,
      "Маршрут согласован": "approved",
    });
    await nextStage(page, "Документы");
    const app = await expand(page.getByTestId("admissions-route"), institution);
    const docs = await expand(app, "Документы заявки");
    await docs.getByRole("button", { name: "Изменить", exact: true }).click();
    const editor = page.getByRole("region", { name: `${institution}: Документы заявки`, exact: true });
    await expect(editor.getByRole("checkbox", { name: "E5 other application only" })).toHaveCount(0);
    await setFields(editor, { "Документы этой заявки": "required", "Основание списка документов": "E5 fictional university checklist", "Список документов проверен": today });
    await editor.getByRole("group", { name: "Обязательные документы этой заявки", exact: true }).getByRole("checkbox", { name: "E5 primary requirement" }).check();
    await save(editor);
    await expect(page.getByText("Документы основной заявки ещё не приняты или не привязаны к этой заявке", { exact: true })).toBeVisible();
    await docs.getByRole("button", { name: "Изменить", exact: true }).click();
    const waiver = page.getByRole("region", { name: `${institution}: Документы заявки`, exact: true });
    await waiver.getByRole("group", { name: "Документы с согласованным исключением", exact: true }).getByRole("checkbox", { name: "E5 primary requirement" }).check();
    await setFields(waiver, { "Причина исключения": "Fictional university waived this exact slot", "Основание исключения": "E5 dated fictional waiver, not an uploaded document" });
    await save(waiver); await nextStage(page, "Подача через партнёра");
    await editApplication(page, institution, "Передача партнёру", {
      "Партнёр, который подаёт документы": "E5 Fictional Submission Partner", "Роль получателя документов": "Submission partner, not referral",
      "Ссылка на переданный пакет": "E5 package", "Версия пакета": "1", "Документы переданы партнёру": today,
      "Партнёр подтвердил получение": today, "Подтверждение получения партнёром": "E5 receipt only", "Ожидаемый ответ партнёра": later,
    });
    let state = await workspace(scenario);
    expect(state.applications.find((item) => item.id === primaryId)?.status).toBe("preparation");
    expect(state.gates.find((item) => item.stage === "applications")?.ready).toBe(false);
    await expect(page.getByRole("button", { name: "Завершить этап и перейти дальше", exact: true })).toBeDisabled();
    await capture(page, `${scenario}-partner-not-submitted`);
    if (direction === "CN") await submissionWithDelayedRefresh(page, scenario, institution);
    else {
      await editApplication(page, institution, "Подача", { "Фактическая дата подачи в университет": today, "Номер / ссылка подачи": "E5 actual fictional university reference", "Основание фактической подачи": "E5 separate fictional university acknowledgement" });
      await applicationStatus(page, scenario, institution, "submitted");
    }
    await nextStage(page, "Решение университета");
    await editApplication(page, institution, "Решение", {
      "Решение университета": "conditional", "Номер / ссылка решения": "E5 offer", "Дата решения": today,
      "Основание решения": "E5 fictional conditional offer", "Условия предложения": "Fictional condition not yet fulfilled",
      "Срок ответа / выполнения условий": later, "Предложение выбрано клиентом": today,
      "Кто подтвердил выбор предложения": "E5 Student", "Основание выбора предложения": "E5 fictional selection",
    });
    await applicationStatus(page, scenario, institution, "offer");
    await expect(page.getByText("Условия предложения ещё не подтверждены как выполненные", { exact: true })).toBeVisible();
    state = await workspace(scenario);
    expect(state.applications.find((item) => item.id !== primaryId)?.status).toBe("preparation");
    expect(state.gates.find((item) => item.stage === "decisions")?.ready).toBe(false);
    await capture(page, `${scenario}-conditional-offer`);
    await visualChecks(page); expect(errors).toEqual([]);
    await page.reload(); expect((await workspace(scenario)).case.stage).toBe("decisions");
    if (direction === "MY") await completeMalaysia(page, scenario, institution);
    const proof = await dbRead(async (sql) => sql`SELECT count(*)::int AS count FROM platform.sales_admissions_handoffs WHERE student_case_id=${caseId(scenario)}`);
    expect(proof[0].count).toBe(1);
  });
}

test("two real tabs reject stale full snapshots and require explicit refresh", async ({ page, context }, info) => {
  test.skip(info.project.name !== "desktop-chromium", "Desktop concurrency gate");
  await login(page); await configure(page, "stale", "CN");
  const second = await context.newPage(); await second.goto(route("stale"));
  for (const tab of [page, second]) await tab.getByRole("button", { name: "Следующий шаг", exact: true }).click();
  const firstEditor = page.getByRole("region", { name: "Следующий шаг и маршрут" });
  const staleEditor = second.getByRole("region", { name: "Следующий шаг и маршрут" });
  await firstEditor.getByLabel("Следующий шаг", { exact: true }).fill("E5 first tab confirmed");
  await staleEditor.getByLabel("Следующий шаг", { exact: true }).fill("E5 stale must not overwrite");
  await save(firstEditor);
  await staleEditor.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(staleEditor.getByRole("alert")).toBeVisible();
  await expect(staleEditor.getByLabel("Следующий шаг", { exact: true })).toHaveValue("E5 stale must not overwrite");
  await expect(staleEditor.getByRole("button", { name: "Сохранить", exact: true })).toBeDisabled();
  expect((await workspace("stale")).case.nextAction).toBe("E5 first tab confirmed");
  await capture(second, "desktop-stale-snapshot");
  second.once("dialog", (dialog) => dialog.accept());
  await staleEditor.getByRole("button", { name: "Загрузить актуальные данные" }).click();
  await expect(staleEditor).not.toBeVisible();
  await expect(second.getByTestId("admissions-route").getByText(/^E5 first tab confirmed\s*до /)).toBeVisible();
  await second.close();
});

test("real offline save freezes uncertain input and protects navigation, logout and Back", async ({ page, context }, info) => {
  test.skip(info.project.name !== "desktop-chromium", "Desktop network failure gate");
  await login(page); await configure(page, "offline", "CN");
  await page.goto("/v3/profile"); await page.goto(route("offline"));
  await page.getByRole("button", { name: "Следующий шаг", exact: true }).click();
  const editor = page.getByRole("region", { name: "Следующий шаг и маршрут" });
  await editor.getByLabel("Следующий шаг", { exact: true }).fill("E5 offline draft retained");
  await context.setOffline(true);
  const original = page.url();
  await page.getByRole("navigation", { name: "Работа по делу" }).getByRole("link", { name: "Документы", exact: true }).click();
  await expect(page).toHaveURL(original);
  await page.getByRole("button", { name: /Выйти/ }).click();
  await expect(page).toHaveURL(original);
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.goBack({ waitUntil: "commit", timeout: 5000 }).catch(() => null);
  await expect(page).toHaveURL(original);
  await editor.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(editor.getByRole("button", { name: "Повторить тот же запрос" })).toBeVisible();
  await expect(editor.getByLabel("Следующий шаг", { exact: true })).toBeDisabled();
  await expect(editor.getByRole("button", { name: "Отмена", exact: true })).toBeDisabled();
  await capture(page, "desktop-offline-pending-retry");
  await context.setOffline(false);
  await editor.getByRole("button", { name: "Повторить тот же запрос" }).click();
  await expect(editor).not.toBeVisible();
  await page.reload(); expect((await workspace("offline")).case.nextAction).toBe("E5 offline draft retained");
  const proof = await dbRead(async (sql) => sql`SELECT count(*)::int AS count FROM platform_private.admissions_events WHERE student_case_id=${caseId("offline")} AND kind='facts_updated'`);
  expect(proof[0].count).toBe(1);
});

test("manager summary and five direction filters reproduce live scoped worklist", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop-chromium", "Desktop report; mobile route checks are separate");
  await login(page, "admin"); await page.goto("/v3/profile");
  const directory = page.getByTestId("v3-student-case-directory");
  const nav = page.getByRole("navigation", { name: "Направления поступления" });
  for (const country of ["Китай", "Малайзия", "Европа", "ОАЭ", "Турция"]) await expect(nav.getByRole("link", { name: country, exact: true })).toBeVisible();
  await nav.getByRole("link", { name: "Китай", exact: true }).click();
  await expect(page).toHaveURL(/direction=CN/);
  const expected = await dbRead(async (sql) => sql`SELECT count(*)::int AS count FROM platform.student_cases WHERE organization_id=${fixture().organizationId} AND admissions_direction='CN' AND state='active'`);
  await expect(directory.getByTestId("v3-student-case-row")).toHaveCount(expected[0].count);
  await expect(page.getByRole("region", { name: "Сводка по поступлению" }).getByRole("link", { name: new RegExp(`Дела в работе сейчас.*${expected[0].count}`) })).toBeVisible();
  await capture(page, "desktop-cn-worklist-report"); await visualChecks(page);
  await nav.getByRole("link", { name: "Европа", exact: true }).click();
  await expect(directory.getByText("По вашему запросу ничего не найдено.", { exact: true })).toBeVisible();
});

test("both real Students are denied staff Admissions workspace", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop-chromium", "One authority probe per isolated runtime");
  for (const kind of ["student", "student_second"] as const) {
    const connection = await api(kind);
    const { data, error } = await connection.schema("platform").rpc("staff_case_admissions_workspace_v1", { p_student_case_id: caseId("cn-desktop") });
    expect(error?.code).toBe("42501"); expect(data).toBeNull();
  }
  await page.goto("/login"); await expect(page.locator("#staff-email")).toBeVisible();
});

for (const direction of ["CN", "MY"] as const) {
  test(`${direction}: 393px keyboard route and real clipboard require resolved placeholders`, async ({ page, context }, info) => {
    test.skip(info.project.name !== "mobile-393-chromium", "Dedicated 393px viewport acceptance");
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const scenario = `${direction.toLowerCase()}-mobile`;
    await login(page); await configure(page, scenario, direction);
    const routeView = page.getByTestId("admissions-route");
    await routeView.getByRole("button", { name: "2. Выбор программы" }).focus();
    await page.keyboard.press("Enter");
    await expect(routeView.getByRole("button", { name: "2. Выбор программы" })).toHaveAttribute("aria-pressed", "true");
    expect((await workspace(scenario)).case.stage).toBe("intake");
    const messages = await expand(routeView, "Подготовить сообщение");
    await messages.getByLabel("Шаблон сообщения").selectOption(`${direction.toLowerCase()}-arrival-confirmation`);
    const copy = messages.getByRole("button", { name: "Скопировать текст", exact: true });
    await expect(copy).toBeDisabled();
    await messages.getByLabel("Согласованное место прибытия", { exact: true }).fill("E5 fictional destination");
    await expect(copy).toBeEnabled();
    const body = await messages.getByLabel("Текст для проверки").inputValue();
    expect(body).not.toMatch(/[{}]/);
    await copy.click(); await expect(messages.getByRole("status")).toContainText("Скопировано");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(body);
    await capture(page, `${scenario}-manual-copy`); await visualChecks(page);
    expect((await workspace(scenario)).case.stage).toBe("intake");
  });
}
