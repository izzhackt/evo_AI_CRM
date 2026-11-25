// «Проверить состояние» и «Открыть список документов»: порядок шагов без экрана и без сети.
import type { ApplicationRequirementsActionResult, ApplicationRequirementsFailure, ApplicationRequirementsIntent } from "@web/lib/portal/application-requirements";
import { parseApplicationPackageReadiness, type ApplicationPackageReadiness } from "@web/lib/portal/application-packages";

import { initializeErrorKey, memoryIntentHolder, runRequirementsUpdate } from "@/features/preparations/requirements-flow";
import { APPLICATION_ID, STUDENT_CASE_ID, initializeReceipt, starterReadiness, uninitializedReadiness } from "@/test-fixtures/preparations";

const target = { studentCaseId: STUDENT_CASE_ID, applicationId: APPLICATION_ID };
const parse = (value: unknown) => parseApplicationPackageReadiness(value, target) as ApplicationPackageReadiness;
const EMPTY = parse(uninitializedReadiness());
const STARTER = parse(starterReadiness());

const ids = ["99999999-0000-4000-8000-000000000001", "99999999-0000-4000-8000-000000000002", "99999999-0000-4000-8000-000000000003"];

function setup(options: { reads?: (ApplicationPackageReadiness | Error)[]; results?: ApplicationRequirementsActionResult[]; canInitialize?: boolean; initialize?: boolean; slot?: ApplicationRequirementsIntent | null } = {}) {
  const reads = [...(options.reads ?? [EMPTY, STARTER])];
  const results = [...(options.results ?? [])];
  const sent: ApplicationRequirementsIntent[] = [];
  const slot = { current: options.slot ?? null };
  let issued = 0;
  const run = (over: { initialize?: boolean; canInitialize?: boolean } = {}) =>
    runRequirementsUpdate({
      initialize: over.initialize ?? options.initialize ?? true,
      canInitialize: over.canInitialize ?? options.canInitialize ?? true,
      studentCaseId: STUDENT_CASE_ID,
      applicationId: APPLICATION_ID,
      read: async () => {
        const next = reads.shift();
        if (next === undefined) throw new Error("no more reads");
        if (next instanceof Error) throw next;
        return next;
      },
      runInitialize: async (intent) => {
        sent.push(intent);
        const result = results.shift();
        if (!result) throw new Error("no more results");
        return result;
      },
      intents: memoryIntentHolder(slot),
      newRequestId: () => ids[issued++]!,
    });
  return { run, sent, slot, reads, issued: () => issued };
}

const ok = (requestId: string): ApplicationRequirementsActionResult => ({
  ok: true,
  receipt: initializeReceipt(requestId) as never,
});
const fail = (reason: ApplicationRequirementsFailure, intent: ApplicationRequirementsIntent): ApplicationRequirementsActionResult => ({ ok: false, reason, intent });

describe("проверка состояния", () => {
  it("читает один раз, ничего не пишет", async () => {
    const t = setup({ initialize: false, reads: [EMPTY] });
    expect(await t.run()).toEqual({ error: null, initialized: false });
    expect(t.sent).toHaveLength(0);
    expect(t.reads).toHaveLength(0);
  });

  it("сбой чтения: «не удалось загрузить требования», записи нет", async () => {
    const t = setup({ initialize: true, reads: [new Error("offline")] });
    expect(await t.run()).toEqual({ error: "requirementsUnavailable", initialized: false });
    expect(t.sent).toHaveLength(0);
  });
});

describe("открытие списка документов", () => {
  it("свежее чтение, запись с новым запросом, контрольное чтение; запрос после успеха снят", async () => {
    const t = setup({ results: [ok(ids[0]!)] });
    expect(await t.run()).toEqual({ error: null, initialized: true });
    expect(t.sent).toEqual([{ studentCaseId: STUDENT_CASE_ID, applicationId: APPLICATION_ID, requestId: ids[0] }]);
    expect(t.reads).toHaveLength(0); // оба чтения использованы: до записи и после
    expect(t.slot.current).toBeNull();
  });

  it("не пишет, если сервер уже открыл список (потерянный ответ прежней записи не повторяется)", async () => {
    const t = setup({ reads: [STARTER] });
    expect(await t.run()).toEqual({ error: null, initialized: false });
    expect(t.sent).toHaveLength(0);
  });

  it("не пишет, если дело не позволяет (нет сопровождения или программа не на подготовке)", async () => {
    const t = setup({ reads: [EMPTY], canInitialize: false });
    expect(await t.run()).toEqual({ error: null, initialized: false });
    expect(t.sent).toHaveLength(0);
    expect(t.issued()).toBe(0);
  });

  it("обрыв (unavailable): запрос остаётся, следующее нажатие шлёт тот же requestId и новый не создаётся", async () => {
    const t = setup({ reads: [EMPTY, EMPTY, EMPTY, STARTER], results: [fail("unavailable", { studentCaseId: STUDENT_CASE_ID, applicationId: APPLICATION_ID, requestId: ids[0]! }), ok(ids[0]!)] });
    expect(await t.run()).toEqual({ error: "unavailable", initialized: false });
    expect(t.slot.current?.requestId).toBe(ids[0]);
    expect(await t.run()).toEqual({ error: null, initialized: true });
    expect(t.sent.map((s) => s.requestId)).toEqual([ids[0], ids[0]]);
    expect(t.issued()).toBe(1);
    expect(t.slot.current).toBeNull();
  });

  it("запрос из прежней попытки, лежащий в держателе, используется как есть", async () => {
    const kept = { studentCaseId: STUDENT_CASE_ID, applicationId: APPLICATION_ID, requestId: ids[2]! };
    const t = setup({ slot: kept, results: [ok(ids[2]!)] });
    await t.run();
    expect(t.sent).toEqual([kept]);
    expect(t.issued()).toBe(0);
  });

  it.each<[ApplicationRequirementsFailure, string]>([
    ["forbidden", "prep.forbidden"],
    ["needs_configuration", "configurationHelp"],
    ["request_conflict", "requestConflict"],
    ["case_ineligible", "initializationIneligible"],
    ["application_ineligible", "initializationIneligible"],
    ["invalid", "initializationIneligible"],
    ["invariant_conflict", "initializationIneligible"],
  ])("точный отказ сервера %s -> %s, запрос снят (новое нажатие начнёт заново)", async (reason, key) => {
    const intent = { studentCaseId: STUDENT_CASE_ID, applicationId: APPLICATION_ID, requestId: ids[0]! };
    const t = setup({ reads: [EMPTY, EMPTY], results: [fail(reason, intent)] });
    expect(await t.run()).toEqual({ error: key, initialized: false });
    expect(t.slot.current).toBeNull();
  });

  it("контрольное чтение не удалось после успеха: «требования недоступны», но запись помечена выполненной", async () => {
    const t = setup({ reads: [EMPTY, new Error("offline")], results: [ok(ids[0]!)] });
    expect(await t.run()).toEqual({ error: "requirementsUnavailable", initialized: true });
  });

  it("контрольное чтение не удалось после отказа: остаётся причина отказа", async () => {
    const intent = { studentCaseId: STUDENT_CASE_ID, applicationId: APPLICATION_ID, requestId: ids[0]! };
    const t = setup({ reads: [EMPTY, new Error("offline")], results: [fail("needs_configuration", intent)] });
    expect(await t.run()).toEqual({ error: "configurationHelp", initialized: false });
  });

  it("неожиданное исключение записи: «результат неизвестен», запрос остаётся", async () => {
    const t = setup({ reads: [EMPTY], results: [] }); // runInitialize бросит: результатов нет
    expect(await t.run()).toEqual({ error: "unavailable", initialized: false });
    expect(t.slot.current?.requestId).toBe(ids[0]);
  });
});

describe("держатель запроса", () => {
  it("снимает только свой запрос", () => {
    const slot: { current: ApplicationRequirementsIntent | null } = { current: null };
    const holder = memoryIntentHolder(slot);
    const a = { studentCaseId: STUDENT_CASE_ID, applicationId: APPLICATION_ID, requestId: ids[0]! };
    const b = { ...a, requestId: ids[1]! };
    holder.set(a);
    holder.clear(b);
    expect(holder.get()).toEqual(a);
    holder.clear(a);
    expect(holder.get()).toBeNull();
  });

  it("initializeErrorKey: остальные причины ведут к «нельзя открыть автоматически»", () => {
    expect(initializeErrorKey("unavailable")).toBe("unavailable");
    expect(initializeErrorKey("forbidden")).toBe("prep.forbidden");
    expect(initializeErrorKey("needs_configuration")).toBe("configurationHelp");
    expect(initializeErrorKey("request_conflict")).toBe("requestConflict");
    expect(initializeErrorKey("case_ineligible")).toBe("initializationIneligible");
  });
});
