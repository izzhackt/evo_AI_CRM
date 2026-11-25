// Чтение требований программы: `application_package_readiness_v1` через строгие разборщики веба.
import { readApplicationReadiness, readinessEchoesSelections } from "@/api/preparations-reads";
import { PortalDecodeError } from "@/domain/portal-source";
import { RpcError } from "@/lib/rpc";
import {
  APPLICATION_ID,
  STUDENT_CASE_ID,
  documentFile,
  documentState,
  draftOf,
  itemId,
  noRevision,
  readiness,
  readinessWithSelections,
  requirementItem,
  requirements,
  selectionEcho,
  starterReadiness,
  submissionOf,
  uninitializedReadiness,
  versionId,
} from "@/test-fixtures/preparations";
import { failure, fakeTransport } from "@/test-fixtures/universities";

const read = (handler: unknown, selections?: Parameters<typeof readApplicationReadiness>[3]) => {
  const { transport, calls } = fakeTransport({ application_package_readiness_v1: handler });
  return { promise: readApplicationReadiness(transport, STUDENT_CASE_ID, APPLICATION_ID, selections), calls };
};

describe("чтение требований программы", () => {
  it("зовёт application_package_readiness_v1 методом POST с аргументами веба и пустым выбором", async () => {
    const { promise, calls } = read(starterReadiness());
    const value = await promise;
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      name: "application_package_readiness_v1",
      get: false,
      args: { p_student_case_id: STUDENT_CASE_ID, p_application_id: APPLICATION_ID, p_selections: [] },
    });
    expect(value.requirements.state).toBe("initialized");
    expect(value.requirements.items).toHaveLength(2);
    expect(value.documentItems).toHaveLength(2);
    expect(value.canSubmit).toBe(false);
  });

  it("начальный список EVO: фото и паспорт, обязательные, файлов нет", async () => {
    const value = await read(starterReadiness()).promise;
    expect(value.requirements.origin).toBe("evo_starter");
    expect(value.requirements.items.map((item) => [item.requirementKey, item.required, item.technicalAvailability, item.unavailableReasons])).toEqual([
      ["evo.photo.v1", true, "unavailable", ["file_missing"]],
      ["evo.passport.v1", true, "unavailable", ["file_missing"]],
    ]);
  });

  it("список не открыт (uninitialized): без ревизии и без требований", async () => {
    const value = await read(uninitializedReadiness()).promise;
    expect(value.requirements).toMatchObject({ state: "uninitialized", revisionId: null, items: [], configurationReasons: [] });
    expect(value.documentItems).toEqual([]);
  });

  it("нужна настройка куратором (needs_configuration), без ревизии: причины перечислены", async () => {
    const value = await read(readiness(noRevision("needs_configuration", ["legacy_case_checklist"]))).promise;
    expect(value.requirements).toMatchObject({ state: "needs_configuration", configurationReasons: ["legacy_case_checklist"] });
  });

  it("отправленный файл, сохранённый черновик и решение EVO доходят до экрана без потерь", async () => {
    const items = [
      requirementItem(0, { slotStatus: "submitted", currentVersionId: versionId(1), currentVersionNo: "1", technicalAvailability: "available", unavailableReasons: [] }),
      requirementItem(1),
    ];
    const docs = [
      documentState(0, { submission: submissionOf(0, 1, null), canSubmit: false }),
      documentState(1, { savedDraft: draftOf(1, 2) }),
    ];
    const value = await read(readiness(requirements(items), docs)).promise;
    expect(value.documentItems[0]?.submission?.file.originalFilename).toBe("scan-1.pdf");
    expect(value.documentItems[0]?.submission?.review).toBeNull();
    expect(value.documentItems[1]?.savedDraft?.file.documentVersionId).toBe(versionId(2));
    expect(value.documentItems[0]?.requirementItemId).toBe(itemId(0));
  });

  it("чужая форма ответа отклоняется целиком: PortalDecodeError, а не выдуманный пустой список", async () => {
    for (const bad of [null, [], {}, { ...starterReadiness(), extra: 1 }, { ...(starterReadiness() as object), applicationId: "bbbbbbbb-0000-4000-8000-000000000999" }]) {
      await expect(read(bad).promise).rejects.toBeInstanceOf(PortalDecodeError);
    }
  });

  it("число документов обязано совпасть с числом требований", async () => {
    const value = readiness(requirements([requirementItem(0), requirementItem(1)]), [documentState(0)]);
    await expect(read(value).promise).rejects.toBeInstanceOf(PortalDecodeError);
  });

  it("версия файла с недоступностью без причин отклоняется", async () => {
    const docs = [documentState(0, { submission: submissionOf(0, 1, null, { technicalAvailability: "unavailable", unavailableReasons: [] }) })];
    const value = readiness(requirements([requirementItem(0)]), docs);
    await expect(read(value).promise).rejects.toBeInstanceOf(PortalDecodeError);
  });

  it("выбор файлов для комплекта уходит как есть и ответ обязан его повторить", async () => {
    const items = [requirementItem(0), requirementItem(1, { required: false })];
    const reqs = requirements(items);
    const selections = [{ requirementItemId: itemId(0), selection: { kind: "existing_version" as const, documentVersionId: versionId(3) }, expectedPreviousSubmissionId: null }];
    const answer = readinessWithSelections(reqs, undefined, [selectionEcho(0, 3)]);
    const { promise, calls } = read(answer, selections);
    const value = await promise;
    expect(calls[0]?.args).toMatchObject({ p_selections: selections });
    expect(value.selections).toHaveLength(1);
    expect(value.canSubmit).toBe(true);
  });

  it("ответ без выбранного файла на запрос с выбором отклоняется: это ответ на другой вопрос", async () => {
    const selections = [{ requirementItemId: itemId(0), selection: { kind: "existing_version" as const, documentVersionId: versionId(3) }, expectedPreviousSubmissionId: null }];
    await expect(read(starterReadiness(), selections).promise).rejects.toBeInstanceOf(PortalDecodeError);
    // и наоборот: обычное чтение не принимает ответ с чужим выбором
    const reqs = requirements([requirementItem(0)]);
    await expect(read(readinessWithSelections(reqs, undefined, [selectionEcho(0, 3)])).promise).rejects.toBeInstanceOf(PortalDecodeError);
  });

  it("негодный выбор не уходит на сервер", async () => {
    const { transport, calls } = fakeTransport({ application_package_readiness_v1: starterReadiness() });
    const bad = [{ requirementItemId: "x", selection: { kind: "existing_version", documentVersionId: "y" }, expectedPreviousSubmissionId: null }] as never;
    await expect(readApplicationReadiness(transport, STUDENT_CASE_ID, APPLICATION_ID, bad)).rejects.toBeInstanceOf(PortalDecodeError);
    expect(calls).toHaveLength(0);
  });

  it("сбой транспорта: RpcError без текста сервера", async () => {
    const { promise } = read(failure("PT500", 500));
    await expect(promise).rejects.toBeInstanceOf(RpcError);
    await expect(promise).rejects.toMatchObject({ kind: "server", message: "rpc:server" });
  });

  it("нет связи: RpcError вида transport", async () => {
    const { promise } = read(failure(null, 0));
    await expect(promise).rejects.toMatchObject({ kind: "transport" });
  });

  it("негодные идентификаторы не уходят на сервер", async () => {
    const { transport, calls } = fakeTransport({ application_package_readiness_v1: starterReadiness() });
    await expect(readApplicationReadiness(transport, "not-a-uuid", APPLICATION_ID)).rejects.toBeInstanceOf(PortalDecodeError);
    await expect(readApplicationReadiness(transport, STUDENT_CASE_ID, "")).rejects.toBeInstanceOf(PortalDecodeError);
    expect(calls).toHaveLength(0);
  });

  it("выбор, не повторённый в ответе, считается ответом на другой вопрос", () => {
    const selection = { requirementItemId: itemId(0), selection: { kind: "existing_version" as const, documentVersionId: versionId(1) }, expectedPreviousSubmissionId: null };
    expect(readinessEchoesSelections({ selections: [] }, [])).toBe(true);
    expect(readinessEchoesSelections({ selections: [] }, [selection])).toBe(false);
    const echoed = { ...selection, file: documentFile(1) as never, submissionId: null, reasons: [] };
    expect(readinessEchoesSelections({ selections: [echoed] }, [selection])).toBe(true);
    expect(readinessEchoesSelections({ selections: [{ ...echoed, selection: { kind: "existing_version", documentVersionId: versionId(2) } }] }, [selection])).toBe(false);
    expect(readinessEchoesSelections({ selections: [{ ...echoed, expectedPreviousSubmissionId: versionId(3) }] }, [selection])).toBe(false);
    const upload = { requirementItemId: itemId(0), selection: { kind: "program_upload" as const, uploadContextId: versionId(7), documentVersionId: versionId(1) }, expectedPreviousSubmissionId: null };
    expect(readinessEchoesSelections({ selections: [{ ...echoed, selection: upload.selection }] }, [upload])).toBe(true);
    expect(readinessEchoesSelections({ selections: [{ ...echoed, selection: { ...upload.selection, uploadContextId: versionId(8) } }] }, [upload])).toBe(false);
    expect(readinessEchoesSelections({ selections: [{ ...echoed, selection: { kind: "existing_version", documentVersionId: versionId(1) } }] }, [upload])).toBe(false);
  });
});
