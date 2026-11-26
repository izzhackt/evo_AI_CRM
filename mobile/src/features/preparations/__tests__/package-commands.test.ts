// Отправка комплекта и проверка исхода: настоящее хранилище запросов и поддельные отправка и проверка. Повторяет сценарии
// `tests/application-package-commands.test.mjs` веба (запись до отправки, снятие только по доказательству, чужое не затирается).
import { applicationDocumentCanonical as canonical } from "@web/lib/portal/application-documents";
import type { ApplicationPackageRecoveryResult, ApplicationPackageSubmitIntent, ApplicationPackageSubmitResult } from "@web/lib/portal/application-packages";

import { packageCommandFailure, runPackageCommand, type PackageCommandResult } from "@/features/preparations/package-commands";
import { packagesPending } from "@/features/preparations/packages-pending";
import type { PendingScope } from "@/features/preparations/pending-store";
import { APPLICATION_ID, REVISION_ID, STUDENT_CASE_ID } from "@/test-fixtures/preparations";
import { PACKAGE_REQUEST, recoveryAbsent, recoveryCommitted, submitIntentOf, submitReceiptOf } from "@/test-fixtures/preparations-packages";
import { memoryPendingStorage } from "@/test-fixtures/pending-storage";

const scope: PendingScope = { organizationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", membershipId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", studentCaseId: STUDENT_CASE_ID, applicationId: APPLICATION_ID };
const intent = submitIntentOf([0, 1], [3, 4]) as unknown as ApplicationPackageSubmitIntent;

function world(over: { respond?: (kind: "submit" | "recover") => unknown; failWrite?: boolean; failRemove?: boolean } = {}) {
  const storage = memoryPendingStorage();
  if (over.failWrite) storage.forgetting = true;
  if (over.failRemove) storage.stubborn = true;
  const calls: { kind: "submit" | "recover"; intent: ApplicationPackageSubmitIntent }[] = [];
  const check = async (kind: "submit" | "recover", value: ApplicationPackageSubmitIntent) => {
    calls.push({ kind, intent: value });
    // точный запрос записан до вызова
    const stored = await packagesPending.read(scope, "submit", value.requirementsRevisionId, storage);
    expect(canonical(stored.intent)).toBe(canonical(value));
  };
  const submit = async (value: ApplicationPackageSubmitIntent): Promise<ApplicationPackageSubmitResult> => {
    await check("submit", value);
    const custom = over.respond?.("submit");
    if (custom instanceof Error) throw custom;
    return (custom ?? { ok: true, receipt: submitReceiptOf(value as never) }) as ApplicationPackageSubmitResult;
  };
  const recover = async (value: ApplicationPackageSubmitIntent): Promise<ApplicationPackageRecoveryResult> => {
    await check("recover", value);
    const custom = over.respond?.("recover");
    if (custom instanceof Error) throw custom;
    return (custom ?? { ok: true, recovery: recoveryCommitted(value as never) }) as ApplicationPackageRecoveryResult;
  };
  const run = (checkOnly: boolean, value = intent): Promise<PackageCommandResult> => runPackageCommand({ scope, intent: value, checkOnly, submit, recover, storage });
  return { storage, calls, run, stored: () => packagesPending.list(scope, storage) };
}

describe("отправка комплекта", () => {
  it("запрос записан до отправки и снят только по квитанции на него", async () => {
    const w = world();
    const result = await w.run(false);
    expect(result).toMatchObject({ kind: "committed", cleared: true, proof: { status: "committed", requestId: PACKAGE_REQUEST } });
    expect(w.calls.map((c) => c.kind)).toEqual(["submit"]);
    expect(await w.stored()).toEqual([]);
  });

  it("неизвестный исход: запрос остаётся, другой запрос на программе не начинается", async () => {
    const w = world({ respond: () => ({ ok: false, reason: "unavailable", resolution: "retain" }) });
    expect(await w.run(false)).toEqual({ kind: "error", reason: "unavailable" });
    const before = [...w.storage.data.values()];
    // чужой запрос другой ревизии и другого состава блокируется, пока не известен исход первого
    const other = submitIntentOf([0], [9], { requirementsRevisionId: "dddddddd-0000-4000-8000-000000000002", requestId: "99999999-0000-4000-8000-0000000000a9" }) as unknown as ApplicationPackageSubmitIntent;
    expect(await w.run(false, other)).toEqual({ kind: "pending" });
    expect(w.calls).toHaveLength(1);
    expect([...w.storage.data.values()]).toEqual(before);
  });

  it("повтор берёт ровно тот же запрос и снимает его после квитанции", async () => {
    let retry = false;
    const w = world({ respond: () => (retry ? undefined : { ok: false, reason: "unavailable", resolution: "retain" }) });
    await w.run(false);
    retry = true;
    const result = await w.run(false, JSON.parse(JSON.stringify(intent)));
    expect(result).toMatchObject({ kind: "committed", cleared: true });
    expect(canonical(w.calls[0]!.intent)).toBe(canonical(w.calls[1]!.intent));
    expect(await w.stored()).toEqual([]);
  });

  it("квитанция на другой запрос не считается подтверждением, запрос остаётся", async () => {
    const w = world({ respond: () => ({ ok: true, receipt: submitReceiptOf(intent as never, 1, { requestId: "99999999-0000-4000-8000-0000000000a2" }) }) });
    expect(await w.run(false)).toEqual({ kind: "error", reason: "unavailable" });
    expect(await w.stored()).toHaveLength(1);
  });

  it("исключение при отправке: ошибка (не «хранилище недоступно»), запрос остаётся", async () => {
    const w = world({ respond: () => new Error("request interrupted") });
    expect(await w.run(false)).toEqual({ kind: "error", reason: "unavailable" });
    expect(await w.stored()).toHaveLength(1);
  });

  it("не удалось записать запрос: «хранилище недоступно», отправки не было", async () => {
    const w = world({ failWrite: true });
    expect(await w.run(false)).toEqual({ kind: "storage_unavailable" });
    expect(w.calls).toHaveLength(0);
  });

  it("идёт другая такая же команда: «занято», отправки не было", async () => {
    const w = world();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const holder = packagesPending.withLock(scope, "submit", scope.applicationId, () => gate, w.storage);
    expect(await w.run(false)).toEqual({ kind: "busy" });
    expect(w.calls).toHaveLength(0);
    release();
    await holder;
  });

  it("испорченная запись блокирует новую отправку и не стирается", async () => {
    const w = world();
    const key = packagesPending.key(scope, "submit", REVISION_ID);
    w.storage.data.set(key, "{broken");
    expect(await w.run(false)).toEqual({ kind: "pending" });
    expect(w.calls).toHaveLength(0);
    expect(w.storage.data.get(key)).toBe("{broken");
  });

  it("подтверждённая квитанция остаётся подтверждённой, если запись с телефона снять не вышло", async () => {
    const w = world({ failRemove: true });
    const result = await w.run(false);
    expect(result).toMatchObject({ kind: "committed", cleared: false });
    expect(await w.stored()).toHaveLength(1);
  });
});

describe("проверка результата", () => {
  it("«не записано» снимает запрос, «записан» тоже", async () => {
    const absent = world({ respond: () => ({ ok: true, recovery: recoveryAbsent(intent as never) }) });
    expect(await absent.run(true)).toMatchObject({ kind: "not_written", cleared: true, proof: { status: "not_written" } });
    expect(await absent.stored()).toEqual([]);
    expect(absent.calls.map((c) => c.kind)).toEqual(["recover"]);
    const committed = world();
    expect(await committed.run(true)).toMatchObject({ kind: "committed", cleared: true });
  });

  it("ответ про чужой запрос или чужую программу не снимает запись и не подтверждает", async () => {
    for (const field of ["requestId", "studentCaseId", "applicationId"]) {
      const w = world({ respond: () => ({ ok: true, recovery: { ...(recoveryAbsent(intent as never) as object), [field]: "99999999-0000-4000-8000-0000000000b0" } }) });
      expect([field, await w.run(true)]).toEqual([field, { kind: "error", reason: "unavailable" }]);
      expect(await w.stored()).toHaveLength(1);
    }
  });

  it("отказ проверки: ошибка с причиной, запрос остаётся", async () => {
    const w = world({ respond: () => ({ ok: false, reason: "forbidden", resolution: "retain" }) });
    expect(await w.run(true)).toEqual({ kind: "error", reason: "forbidden" });
    expect(await w.stored()).toHaveLength(1);
  });
});

describe("слова об исходе", () => {
  const strings = { storage: "хранилище", busy: "занято", forbidden: "нет доступа", unavailable: "недоступно", pending: "не подтверждено" };
  it("каждый неуспех называется своими словами", () => {
    expect(packageCommandFailure({ kind: "storage_unavailable" }, strings)).toBe("хранилище");
    expect(packageCommandFailure({ kind: "busy" }, strings)).toBe("занято");
    expect(packageCommandFailure({ kind: "error", reason: "forbidden" }, strings)).toBe("нет доступа не подтверждено");
    expect(packageCommandFailure({ kind: "error", reason: "unavailable" }, strings)).toBe("недоступно не подтверждено");
    expect(packageCommandFailure({ kind: "error", reason: "not_ready" }, strings)).toBe("недоступно не подтверждено");
    expect(packageCommandFailure({ kind: "pending" }, strings)).toBe("не подтверждено");
  });
});
