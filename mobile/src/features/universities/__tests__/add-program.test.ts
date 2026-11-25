// «Добавить в мои программы» (G39): порядок действий как у веба - запрос хранится, список читается перед отправкой, выбор, потом
// отдельно список документов; тексты отказов из словаря веба. Транспорт поддельный, хранилище настоящее (AsyncStorage в памяти).
import AsyncStorage from "@react-native-async-storage/async-storage";

import { getPortalStrings } from "@web/lib/portal/i18n";
import type { CatalogPreparationFailure } from "@web/lib/portal/catalog-preparations";

import { addProgram, openRequirements, selectionFailure, selectionMessage, type AddDeps } from "@/features/universities/add-program";
import { intentStore, selectionTarget } from "@/features/universities/pending-intents";
import { RpcError, rpcRead } from "@/lib/rpc";
import { detailBody, documentsBody, initializeReceipt, preparationItem, selectReceipt, twelvePrograms } from "@/test-fixtures/programs";
import { fakeTransport, failure, STUDENT_CASE_ID, uuidN } from "@/test-fixtures/universities";

const programs = twelvePrograms();
const item = preparationItem({ n: 9, programs, programId: "cs-b" });
const intake = programs[0]!.intakes[0]!;
const target = { institutionId: uuidN(1), programId: "cs-b", intakeId: intake.id as string, publicationVersion: 3 };
const targetKey = selectionTarget(target);
const scope = { userKey: "user-test", studentCaseId: STUDENT_CASE_ID };

let counter = 0;
const newId = () => uuidN(++counter, "eeeeeeee");

function deps(transport: AddDeps["transport"], over: Partial<AddDeps> = {}): AddDeps {
  return { transport, store: intentStore(scope), newId, studentCaseId: STUDENT_CASE_ID, canSelect: true, ...over };
}

/** Сервер, у которого выбор ещё не сделан: список пуст до выбора и содержит заявку после него. */
function server(extra: Record<string, unknown> = {}) {
  let selected = false;
  return fakeTransport({
    student_catalog_preparations_v1: () => (selected ? [item] : []),
    student_select_catalog_intake_v1: (args: Record<string, unknown> | undefined) => {
      selected = true;
      return selectReceipt(item, args);
    },
    student_application_documents_v1: documentsBody(item.applicationId),
    student_initialize_application_requirements_v1: (args: Record<string, unknown> | undefined) => initializeReceipt(item.applicationId, args),
    ...extra,
  });
}

const names = (calls: { name: string }[]) => calls.map((call) => call.name);

beforeEach(async () => {
  counter = 0;
  await AsyncStorage.clear();
});

describe("порядок действий", () => {
  it("список читается до выбора и после него, потом открывается список документов; запросы уходят с id, запись очищена", async () => {
    const { transport, calls } = server();
    const outcome = await addProgram(deps(transport), target);
    expect(outcome).toEqual({ ok: true, applicationId: item.applicationId });
    expect(names(calls)).toEqual([
      "student_catalog_preparations_v1",
      "student_select_catalog_intake_v1",
      "student_catalog_preparations_v1",
      "student_application_documents_v1",
      "student_initialize_application_requirements_v1",
    ]);
    const select = calls[1]!.args!;
    expect(select).toEqual({
      p_student_case_id: STUDENT_CASE_ID,
      p_catalog_institution_id: target.institutionId,
      p_program_id: "cs-b",
      p_intake_id: target.intakeId,
      p_publication_version: 3,
      p_request_id: uuidN(1, "eeeeeeee"),
    });
    expect(calls[4]!.args).toEqual({ p_student_case_id: STUDENT_CASE_ID, p_application_id: item.applicationId, p_request_id: uuidN(2, "eeeeeeee") });
    expect(await AsyncStorage.getAllKeys()).toEqual([]);
  });

  it("запрос выбора сохраняется до ответа сервера", async () => {
    let seen: unknown = null;
    const { transport } = server({
      student_select_catalog_intake_v1: async (args: Record<string, unknown> | undefined) => {
        seen = await intentStore(scope).readSelection(targetKey);
        return selectReceipt(item, args);
      },
    });
    await addProgram(deps(transport), target);
    expect(seen).toMatchObject({ requestId: uuidN(1, "eeeeeeee"), programId: "cs-b" });
  });
});

describe("обрыв: повтор с тем же запросом", () => {
  it("исход неизвестен - запрос остаётся, повтор шлёт тот же p_request_id, успех очищает запись", async () => {
    // Слой RPC сам повторяет запись дважды тем же запросом; первая попытка студента падает, когда обрывов три подряд.
    let selected = false;
    const { transport, calls } = server({
      student_select_catalog_intake_v1: (args: Record<string, unknown> | undefined, n: number) => {
        if (n <= 3) return new RpcError("transport");
        selected = true;
        return selectReceipt(item, args);
      },
      // после обрыва заявка ещё не появилась (сервер не успел): список пуст до второй попытки
      student_catalog_preparations_v1: () => (selected ? [item] : []),
    });
    const attempt = await addProgram(deps(transport), target);
    expect(attempt).toEqual({ ok: false, reason: "unavailable", uncertain: true });
    expect(await intentStore(scope).readSelection(targetKey)).toMatchObject({ requestId: uuidN(1, "eeeeeeee") });
    const retry = await addProgram(deps(transport), target);
    expect(retry.ok).toBe(true);
    const sends = calls.filter((call) => call.name === "student_select_catalog_intake_v1");
    expect(sends).toHaveLength(4); // три обрыва и успех
    expect(new Set(sends.map((call) => call.args?.p_request_id))).toEqual(new Set([uuidN(1, "eeeeeeee")]));
    expect(await intentStore(scope).readSelection(targetKey)).toBeNull();
  });

  it("потерянный ответ уже сохранил выбор: повтор находит заявку в списке и второй раз не отправляет", async () => {
    const { transport, calls } = server({ student_catalog_preparations_v1: [item] });
    const outcome = await addProgram(deps(transport), target);
    expect(outcome).toEqual({ ok: true, applicationId: item.applicationId });
    expect(names(calls)).not.toContain("student_select_catalog_intake_v1");
  });

  it("не удалось прочитать список перед отправкой: выбор не уходит, исход неизвестен, запрос остаётся", async () => {
    const { transport, calls } = server({ student_catalog_preparations_v1: new RpcError("transport") });
    expect(await addProgram(deps(transport), target)).toEqual({ ok: false, reason: "unavailable", uncertain: true });
    expect(names(calls)).not.toContain("student_select_catalog_intake_v1");
    expect(await intentStore(scope).readSelection(targetKey)).not.toBeNull();
  });

  it("квитанция о другом выборе - неизвестный исход, а не успех", async () => {
    const { transport } = server({ student_select_catalog_intake_v1: (args: Record<string, unknown> | undefined) => ({ ...selectReceipt(item, args), programId: "other" }) });
    expect(await addProgram(deps(transport), target)).toMatchObject({ ok: false, reason: "unavailable", uncertain: true });
  });

  it("хранилище не работает: выбор всё равно уходит", async () => {
    const broken = {
      readSelection: () => Promise.reject(new Error("disk full")),
      readRequirements: () => Promise.reject(new Error("disk full")),
      persist: () => Promise.reject(new Error("disk full")),
      clear: () => Promise.resolve(),
    };
    const { transport, calls } = server();
    expect((await addProgram(deps(transport, { store: broken }), target)).ok).toBe(true);
    expect(names(calls)).toContain("student_select_catalog_intake_v1");
  });
});

describe("окончательные отказы", () => {
  const refusals: readonly (readonly [string, string, CatalogPreparationFailure])[] = [
    ["PT409", "catalog_preparation_stale_publication", "stale_publication"],
    ["PT409", "catalog_preparation_intake_closed", "intake_closed"],
    ["PT409", "catalog_preparation_intake_expired", "intake_expired"],
    ["PT409", "catalog_preparation_case_ineligible", "case_ineligible"],
    ["PT409", "catalog_preparation_unsupported_country", "unsupported_country"],
    ["PT409", "catalog_preparation_intake_identity_required", "intake_identity_required"],
    ["PT409", "catalog_preparation_program_unavailable", "program_unavailable"],
    ["22023", "catalog_preparation_request_conflict", "request_conflict"],
  ];
  it.each(refusals)("%s %s: причина %s, запрос удалён, повтора с прежним id нет", async (code, message, reason) => {
    const { transport } = server({
      student_select_catalog_intake_v1: async () => {
        throw await asRpcError(code, message);
      },
    });
    expect(await addProgram(deps(transport), target)).toEqual({ ok: false, reason, uncertain: false });
    expect(await intentStore(scope).readSelection(targetKey)).toBeNull();
  });

  it("42501: «нет доступа», запрос удалён", async () => {
    const { transport } = server({ student_select_catalog_intake_v1: failure("42501", 403) });
    expect(await addProgram(deps(transport), target)).toEqual({ ok: false, reason: "forbidden", uncertain: false });
    expect(await intentStore(scope).readSelection(targetKey)).toBeNull();
  });

  it("сервер 500 и неизвестная причина - неизвестный исход, запрос остаётся", async () => {
    const { transport } = server({ student_select_catalog_intake_v1: failure("XX000", 500) });
    expect(await addProgram(deps(transport), target)).toEqual({ ok: false, reason: "unavailable", uncertain: true });
    expect(await intentStore(scope).readSelection(targetKey)).not.toBeNull();
  });
});

/** Ошибка слоя RPC так, как её строит транспорт (код и текст сервера), без сети. */
async function asRpcError(code: string, message: string): Promise<RpcError> {
  const error = await rpcRead(() => Promise.resolve({ data: null, error: { code, message } as never, status: 409 }), "x").catch((e: unknown) => e);
  return error as RpcError;
}

describe("selectionFailure и тексты", () => {
  it("причина по ошибке: имя из списка, 42501, остальное - неизвестный исход", async () => {
    expect(selectionFailure(await asRpcError("PT409", "catalog_preparation_intake_closed"))).toBe("intake_closed");
    expect(selectionFailure(new RpcError("forbidden", "42501", 403))).toBe("forbidden");
    expect(selectionFailure(new RpcError("transport"))).toBe("unavailable");
    expect(selectionFailure(new Error("что угодно"))).toBe("unavailable");
  });

  it("каждая причина читается словами из словаря веба (RU и KY), без текста сервера", () => {
    for (const lang of ["ru", "ky"] as const) {
      const prep = getPortalStrings("preparations", lang);
      const expected: Readonly<Record<CatalogPreparationFailure, string>> = {
        unavailable: prep.unavailable,
        stale_publication: prep.stalePublication,
        forbidden: prep.forbidden,
        case_ineligible: prep.caseIneligible,
        request_conflict: prep.requestConflict,
        unsupported_country: prep.unsupportedCountry,
        intake_identity_required: prep.identityMissing,
        intake_closed: prep.closedIntake,
        intake_expired: prep.closedIntake,
        invalid: prep.choiceUnavailable,
        program_unavailable: prep.choiceUnavailable,
        intake_unavailable: prep.choiceUnavailable,
      };
      for (const [reason, text] of Object.entries(expected)) expect([lang, reason, selectionMessage(reason as CatalogPreparationFailure, prep)]).toEqual([lang, reason, text]);
    }
  });
});

describe("список документов программы открывается отдельно", () => {
  /** Заявка уже в списке, список документов не открыт. */
  const uninitialized = () => server({ student_catalog_preparations_v1: [item] });

  it("не открывается, если дело не активно, заявка не в подготовке или список уже настроен; выбор от этого не страдает", async () => {
    const blocked = server();
    expect((await addProgram(deps(blocked.transport, { canSelect: false }), target)).ok).toBe(true);
    expect(names(blocked.calls)).not.toContain("student_initialize_application_requirements_v1");

    const submitted = server({ student_catalog_preparations_v1: (_a: unknown, n: number) => (n === 1 ? [] : [preparationItem({ n: 9, programs, programId: "cs-b", status: "submitted" })]) });
    expect((await addProgram(deps(submitted.transport), target)).ok).toBe(true);
    expect(names(submitted.calls)).not.toContain("student_initialize_application_requirements_v1");

    const configured = server({ student_application_documents_v1: documentsBody(item.applicationId, "needs_configuration") });
    expect((await addProgram(deps(configured.transport), target)).ok).toBe(true);
    expect(names(configured.calls)).not.toContain("student_initialize_application_requirements_v1");
  });

  it("сбой чтения или неверный ответ не отменяют выбор", async () => {
    for (const broken of [new RpcError("server", "XX000", 500), { garbage: true }]) {
      const { transport } = server({ student_application_documents_v1: broken });
      expect((await addProgram(deps(transport), target)).ok).toBe(true);
    }
  });

  it("неопределённый сбой открытия оставляет запрос для повтора, окончательный отказ его удаляет", async () => {
    const uncertain = server({ student_initialize_application_requirements_v1: new RpcError("transport") });
    expect((await addProgram(deps(uncertain.transport), target)).ok).toBe(true);
    expect(await intentStore(scope).readRequirements(item.applicationId)).toMatchObject({ applicationId: item.applicationId });

    await AsyncStorage.clear();
    const refused = server({
      student_initialize_application_requirements_v1: async () => {
        throw await asRpcError("PT409", "application_requirements_case_ineligible");
      },
    });
    expect((await addProgram(deps(refused.transport), target)).ok).toBe(true);
    expect(await intentStore(scope).readRequirements(item.applicationId)).toBeNull();
  });

  it("повтор открытия берёт сохранённый запрос, а не новый", async () => {
    await intentStore(scope).persist({ studentCaseId: STUDENT_CASE_ID, applicationId: item.applicationId, requestId: uuidN(40, "eeeeeeee") });
    const { transport, calls } = uninitialized();
    await openRequirements(deps(transport), item.applicationId);
    expect(calls.find((call) => call.name === "student_initialize_application_requirements_v1")?.args?.p_request_id).toBe(uuidN(40, "eeeeeeee"));
    expect(await intentStore(scope).readRequirements(item.applicationId)).toBeNull();
  });
});

describe("карточка вуза с программой, список без чужих заявок", () => {
  it("чужие заявки в списке не принимаются за выбранные", async () => {
    const other = preparationItem({ n: 8, programs, programId: "ai-m" });
    const { transport, calls } = server({ student_catalog_preparations_v1: (_a: unknown, n: number) => (n === 1 ? [other] : [other, item]) });
    const outcome = await addProgram(deps(transport), target);
    expect(outcome).toEqual({ ok: true, applicationId: item.applicationId });
    expect(names(calls)).toContain("student_select_catalog_intake_v1");
    expect(detailBody(programs).university.id).toBe(target.institutionId);
  });
});
