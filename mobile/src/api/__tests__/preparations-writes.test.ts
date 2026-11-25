// «Открыть список документов»: student_initialize_application_requirements_v1 через общие разборщики веба.
import { initializeApplicationRequirements } from "@/api/preparations-writes";
import type { RpcTransport, RpcTransportResult } from "@/lib/rpc";
import { APPLICATION_ID, STUDENT_CASE_ID, initializeReceipt } from "@/test-fixtures/preparations";

const REQUEST_ID = "99999999-0000-4000-8000-000000000001";
const intent = { studentCaseId: STUDENT_CASE_ID, applicationId: APPLICATION_ID, requestId: REQUEST_ID };

function scripted(results: (RpcTransportResult | Error)[]) {
  const calls: { name: string; args: unknown; get: boolean }[] = [];
  const transport: RpcTransport = async (name, args, options) => {
    calls.push({ name, args, get: options.get });
    const next = results.shift();
    if (next === undefined) throw new Error("no more scripted results");
    if (next instanceof Error) throw next;
    return next;
  };
  return { transport, calls };
}
const noWait = async () => undefined;
const ok = (data: unknown): RpcTransportResult => ({ data, error: null, status: 200 });
const bad = (code: string | null, status: number, message: string | null = null): RpcTransportResult => ({ data: null, error: { code, message }, status });

describe("student_initialize_application_requirements_v1", () => {
  it("шлёт аргументы веба с тем же p_request_id и принимает точную квитанцию", async () => {
    const { transport, calls } = scripted([ok(initializeReceipt(REQUEST_ID))]);
    const result = await initializeApplicationRequirements(transport, intent);
    expect(result).toMatchObject({ ok: true, receipt: { requestId: REQUEST_ID, origin: "evo_starter", items: [{ requirementKey: "evo.photo.v1" }, { requirementKey: "evo.passport.v1" }] } });
    expect(calls).toEqual([
      { name: "student_initialize_application_requirements_v1", args: { p_student_case_id: STUDENT_CASE_ID, p_application_id: APPLICATION_ID, p_request_id: REQUEST_ID }, get: false },
    ]);
  });

  it("негодный запрос не уходит на сервер", async () => {
    const { transport, calls } = scripted([]);
    for (const value of [null, {}, { ...intent, requestId: "nope" }, { ...intent, extra: 1 }]) {
      expect(await initializeApplicationRequirements(transport, value)).toEqual({ ok: false, reason: "invalid", intent: null });
    }
    expect(calls).toHaveLength(0);
  });

  it("отказы сервера сопоставляются с причинами веба и возвращают тот же запрос", async () => {
    const cases: [RpcTransportResult, string][] = [
      [bad("42501", 403), "forbidden"],
      [bad("22023", 400, "application_requirements_request_conflict"), "request_conflict"],
      [bad("22023", 400, "application_requirements_invalid_intent"), "invalid"],
      [bad("PT409", 409, "application_requirements_case_ineligible"), "case_ineligible"],
      [bad("PT409", 409, "application_requirements_application_ineligible"), "application_ineligible"],
      [bad("PT409", 409, "application_requirements_needs_configuration"), "needs_configuration"],
      [bad("55000", 500, "application_requirements_invariant_conflict"), "invariant_conflict"],
      [bad("PT418", 418, "что-то неизвестное"), "unavailable"],
    ];
    for (const [response, reason] of cases) {
      const { transport } = scripted([response]);
      expect(await initializeApplicationRequirements(transport, intent)).toEqual({ ok: false, reason, intent });
    }
  });

  it("обрыв связи: тот же запрос повторяется сам и успех принимается", async () => {
    const { transport, calls } = scripted([new Error("Network request failed"), bad(null, 503), ok(initializeReceipt(REQUEST_ID))]);
    const result = await initializeApplicationRequirements(transport, intent, { wait: noWait });
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(3);
    expect(new Set(calls.map((c) => JSON.stringify(c.args))).size).toBe(1);
  });

  it("повтор при обрыве идёт с паузой, а не подряд (пауза по умолчанию 250 мс)", async () => {
    jest.useFakeTimers();
    try {
      const { transport, calls } = scripted([new Error("Network request failed"), ok(initializeReceipt(REQUEST_ID))]);
      const pending = initializeApplicationRequirements(transport, intent);
      await jest.advanceTimersByTimeAsync(249);
      expect(calls).toHaveLength(1);
      await jest.advanceTimersByTimeAsync(1);
      expect((await pending).ok).toBe(true);
      expect(calls).toHaveLength(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it("связи нет совсем: результат неизвестен (unavailable), запрос возвращается для повтора", async () => {
    const { transport, calls } = scripted([new Error("a"), new Error("b"), new Error("c")]);
    expect(await initializeApplicationRequirements(transport, intent, { wait: noWait })).toEqual({ ok: false, reason: "unavailable", intent });
    expect(calls).toHaveLength(3);
  });

  it("квитанция на чужой запрос или чужой формы не считается успехом", async () => {
    for (const receipt of [
      initializeReceipt("99999999-0000-4000-8000-000000000002"),
      { ...initializeReceipt(REQUEST_ID), origin: "staff_confirmed" },
      { ...initializeReceipt(REQUEST_ID), items: [] },
      { ...initializeReceipt(REQUEST_ID), extra: true },
      null,
    ]) {
      const { transport } = scripted([ok(receipt)]);
      expect(await initializeApplicationRequirements(transport, intent)).toEqual({ ok: false, reason: "unavailable", intent });
    }
  });

  it("не повторяет отказ сервера", async () => {
    const { transport, calls } = scripted([bad("PT409", 409, "application_requirements_case_ineligible"), ok(initializeReceipt(REQUEST_ID))]);
    await initializeApplicationRequirements(transport, intent);
    expect(calls).toHaveLength(1);
  });
});
