// RPC комплекта программы: отправка, проверка исхода, комплект подробно, история комплектов и решений. Разбор ответов сверен с
// общими векторами протокола `tests/fixtures/application-packages-v1.json` (их же использует веб и iPhone).
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  readPackageDetail,
  readPackageHistory,
  readPackageReviewHistory,
  recoverApplicationPackage,
  submitApplicationPackage,
} from "@/api/preparations-packages";
import { PortalDecodeError } from "@/domain/portal-source";
import { RpcError, type RpcTransport, type RpcTransportResult } from "@/lib/rpc";
import { STUDENT_CASE_ID, APPLICATION_ID } from "@/test-fixtures/preparations";
import { PACKAGE_REQUEST, packageId, recoveryAbsent, recoveryCommitted, submitIntentOf, submitReceiptOf } from "@/test-fixtures/preparations-packages";
import { failure, fakeTransport } from "@/test-fixtures/universities";

// Файл общих векторов лежит в корне репозитория; в CI клонируется весь репозиторий, как и для других сверок с вебом.
const shared = JSON.parse(readFileSync(path.join(__dirname, "../../../../tests/fixtures/application-packages-v1.json"), "utf8")) as Record<string, any>;

function scripted(results: (RpcTransportResult | Error)[]) {
  const calls: { name: string; args: unknown; get: boolean }[] = [];
  const transport: RpcTransport = async (name, args, options) => {
    calls.push({ name, args, get: options.get });
    const next = results.shift();
    if (next === undefined) throw new Error("no more");
    if (next instanceof Error) throw next;
    return next;
  };
  return { transport, calls };
}
const ok = (data: unknown): RpcTransportResult => ({ data, error: null, status: 200 });
const bad = (code: string | null, status: number, message: string | null = null): RpcTransportResult => ({ data: null, error: { code, message }, status });

const intent = submitIntentOf([0, 1], [3, 4]);

describe("application_package_submit_v1", () => {
  it("весь запрос одним аргументом p_intent, квитанция принимается только на этот запрос", async () => {
    const { transport, calls } = scripted([ok(submitReceiptOf(intent))]);
    const result = await submitApplicationPackage(transport, intent);
    expect(result).toMatchObject({ ok: true, receipt: { requestId: PACKAGE_REQUEST, packageId: packageId(1), packageVersion: "1", reused: false } });
    expect(calls).toEqual([{ name: "application_package_submit_v1", get: false, args: { p_intent: intent } }]);
  });

  it("общий вектор протокола: запрос и квитанция из `application-packages-v1.json`", async () => {
    const { transport } = scripted([ok(shared.submitReceipt)]);
    const result = await submitApplicationPackage(transport, shared.submitIntent);
    expect(result).toMatchObject({ ok: true, receipt: { packageId: shared.submitReceipt.packageId } });
  });

  it("негодный запрос не уходит на сервер", async () => {
    const { transport, calls } = scripted([]);
    for (const value of [null, {}, { ...intent, items: [] }, { ...intent, requestId: "x" }]) {
      expect(await submitApplicationPackage(transport, value)).toEqual({ ok: false, reason: "invalid", resolution: "retain" });
    }
    expect(calls).toHaveLength(0);
  });

  it("отказы базы по тексту ошибки: причины общего разборщика веба", async () => {
    const cases: [RpcTransportResult, string][] = [
      [bad("42501", 403), "forbidden"],
      [bad("PT403", 403, "application_packages_unavailable"), "forbidden"],
      [bad("22023", 400, "application_package_invalid_intent"), "invalid"],
      [bad("22023", 400, "application_package_intent_conflict"), "request_conflict"],
      [bad("PT409", 409, "application_package_stale_requirements"), "stale_context"],
      [bad("PT409", 409, "application_package_previous_package_changed"), "stale_context"],
      [bad("PT409", 409, "application_package_previous_submission_changed"), "stale_context"],
      [bad("PT409", 409, "application_package_not_ready"), "not_ready"],
      [bad("PT409", 409, "application_package_reuse_unavailable"), "reuse_unavailable"],
      [bad("PT418", 418, "что-то непонятное"), "unavailable"],
    ];
    for (const [response, reason] of cases) {
      const { transport } = scripted([response]);
      expect([response.error?.message, await submitApplicationPackage(transport, intent)]).toEqual([response.error?.message, { ok: false, reason, resolution: "retain" }]);
    }
  });

  it("обрыв повторяет тот же запрос; без связи совсем исход неизвестен", async () => {
    const first = scripted([new Error("offline"), bad(null, 503), ok(submitReceiptOf(intent))]);
    expect((await submitApplicationPackage(first.transport, intent)).ok).toBe(true);
    expect(new Set(first.calls.map((c) => JSON.stringify(c.args))).size).toBe(1);
    const second = scripted([new Error("a"), new Error("b"), new Error("c")]);
    expect(await submitApplicationPackage(second.transport, intent)).toEqual({ ok: false, reason: "unavailable", resolution: "retain" });
  });

  it("квитанция на другой запрос, чужой состав или чужой формы - не успех", async () => {
    const good = submitReceiptOf(intent) as Record<string, any>;
    const reordered = { ...good, items: [...good.items].reverse() };
    const otherVersion = { ...good, items: [{ ...good.items[0], documentVersionId: "11111111-0000-4000-8000-000000000099" }, good.items[1]] };
    for (const receipt of [{ ...good, requestId: "99999999-0000-4000-8000-0000000000a2" }, reordered, otherVersion, { ...good, extra: 1 }, { ...good, packageVersion: "0" }, null]) {
      const { transport } = scripted([ok(receipt)]);
      expect(await submitApplicationPackage(transport, intent)).toEqual({ ok: false, reason: "unavailable", resolution: "retain" });
    }
  });
});

describe("application_package_recover_v1", () => {
  it("операция submit и тот же запрос; комплект записан или не записан", async () => {
    const committed = scripted([ok(recoveryCommitted(intent))]);
    const result = await recoverApplicationPackage(committed.transport, intent);
    expect(result).toMatchObject({ ok: true, recovery: { status: "committed", requestId: PACKAGE_REQUEST } });
    expect(committed.calls).toEqual([{ name: "application_package_recover_v1", get: false, args: { p_operation: "submit", p_intent: intent } }]);
    const absent = scripted([ok(recoveryAbsent(intent))]);
    expect(await recoverApplicationPackage(absent.transport, intent)).toMatchObject({ ok: true, recovery: { status: "not_written", receipt: null } });
  });

  it("общие векторы протокола: «записан» и «не записан»", async () => {
    expect(await recoverApplicationPackage(scripted([ok(shared.recoveryCommitted)]).transport, shared.submitIntent)).toMatchObject({ ok: true, recovery: { status: "committed" } });
    expect(await recoverApplicationPackage(scripted([ok(shared.recoveryAbsent)]).transport, shared.submitIntent)).toMatchObject({ ok: true, recovery: { status: "not_written" } });
  });

  it("ответ про другой запрос, другую программу или другую операцию отклоняется", async () => {
    const good = recoveryAbsent(intent) as Record<string, any>;
    for (const value of [{ ...good, requestId: "99999999-0000-4000-8000-0000000000a2" }, { ...good, applicationId: "bbbbbbbb-0000-4000-8000-000000000099" }, { ...good, operation: "review" }, { ...good, status: "committed" }, null]) {
      expect(await recoverApplicationPackage(scripted([ok(value)]).transport, intent)).toEqual({ ok: false, reason: "unavailable", resolution: "retain" });
    }
  });

  it("негодный запрос не уходит; сбой сети и отказ базы разобраны", async () => {
    const { transport, calls } = scripted([]);
    expect(await recoverApplicationPackage(transport, {})).toEqual({ ok: false, reason: "invalid", resolution: "retain" });
    expect(calls).toHaveLength(0);
    expect(await recoverApplicationPackage(scripted([bad("42501", 403)]).transport, intent)).toEqual({ ok: false, reason: "forbidden", resolution: "retain" });
    expect(await recoverApplicationPackage(scripted([new Error("a"), new Error("b"), new Error("c")]).transport, intent)).toEqual({ ok: false, reason: "unavailable", resolution: "retain" });
  });
});

describe("чтения комплектов", () => {
  const caseApp = { studentCaseId: shared.target.studentCaseId as string, applicationId: shared.target.applicationId as string };

  it("комплект подробно: общий вектор, аргументы по именам веба", async () => {
    const { transport, calls } = fakeTransport({ application_package_detail_v1: shared.detail });
    const detail = await readPackageDetail(transport, caseApp, shared.detail.package.packageId);
    expect(detail.items).toHaveLength(shared.detail.items.length);
    expect(detail.package.packageId).toBe(shared.detail.package.packageId);
    expect(calls[0]).toMatchObject({ name: "application_package_detail_v1", get: false, args: { p_student_case_id: caseApp.studentCaseId, p_application_id: caseApp.applicationId, p_package_id: shared.detail.package.packageId } });
  });

  it("комплект другого идентификатора и чужая форма отклоняются; негодные аргументы не уходят", async () => {
    const wrong = fakeTransport({ application_package_detail_v1: shared.detail });
    await expect(readPackageDetail(wrong.transport, caseApp, packageId(77))).rejects.toBeInstanceOf(PortalDecodeError);
    for (const bad of [null, {}, { ...shared.detail, extra: 1 }]) {
      const { transport } = fakeTransport({ application_package_detail_v1: bad });
      await expect(readPackageDetail(transport, caseApp, shared.detail.package.packageId)).rejects.toBeInstanceOf(PortalDecodeError);
    }
    const { transport, calls } = fakeTransport({ application_package_detail_v1: shared.detail });
    await expect(readPackageDetail(transport, caseApp, "x")).rejects.toBeInstanceOf(PortalDecodeError);
    await expect(readPackageDetail(transport, { ...caseApp, applicationId: "y" }, shared.detail.package.packageId)).rejects.toBeInstanceOf(PortalDecodeError);
    expect(calls).toHaveLength(0);
    const down = fakeTransport({ application_package_detail_v1: failure("PT500", 500) });
    await expect(readPackageDetail(down.transport, caseApp, shared.detail.package.packageId)).rejects.toBeInstanceOf(RpcError);
  });

  it("история комплектов: общий вектор, курсор и размер страницы уходят", async () => {
    const { transport, calls } = fakeTransport({ application_package_history_v1: shared.history });
    const history = await readPackageHistory(transport, caseApp, { createdAt: "2026-09-22T10:00:00+00:00", id: shared.detail.package.packageId });
    expect(history.packages.length).toBe(shared.history.packages.length);
    expect(calls[0]!.args).toMatchObject({ p_student_case_id: caseApp.studentCaseId, p_application_id: caseApp.applicationId, p_cursor: { createdAt: "2026-09-22T10:00:00+00:00", id: shared.detail.package.packageId }, p_limit: 20 });
    const none = fakeTransport({ application_package_history_v1: shared.history });
    await readPackageHistory(none.transport, caseApp);
    expect(none.calls[0]!.args).toMatchObject({ p_cursor: null });
    await expect(readPackageHistory(none.transport, caseApp, { createdAt: "вчера", id: "x" })).rejects.toBeInstanceOf(PortalDecodeError);
    const wrong = fakeTransport({ application_package_history_v1: { ...shared.history, extra: 1 } });
    await expect(readPackageHistory(wrong.transport, caseApp)).rejects.toBeInstanceOf(PortalDecodeError);
  });

  it("история решений по комплекту: общий вектор, комплект в запросе", async () => {
    const { transport, calls } = fakeTransport({ application_package_review_history_v1: shared.reviewHistory });
    const history = await readPackageReviewHistory(transport, caseApp, shared.reviewHistory.packageId);
    expect(history.reviews.length).toBe(shared.reviewHistory.reviews.length);
    expect(calls[0]!.args).toMatchObject({ p_package_id: shared.reviewHistory.packageId, p_cursor: null, p_limit: 20 });
    await expect(readPackageReviewHistory(transport, caseApp, packageId(88))).rejects.toBeInstanceOf(PortalDecodeError);
    await expect(readPackageReviewHistory(transport, caseApp, "x")).rejects.toBeInstanceOf(PortalDecodeError);
  });
});

it("общие векторы протокола лежат там, где их ждёт сверка", () => {
  expect(Object.keys(shared)).toEqual(expect.arrayContaining(["submitIntent", "submitReceipt", "recoveryCommitted", "recoveryAbsent", "detail", "history", "reviewHistory", "readiness"]));
  expect([STUDENT_CASE_ID, APPLICATION_ID].every((id) => typeof id === "string")).toBe(true);
});
