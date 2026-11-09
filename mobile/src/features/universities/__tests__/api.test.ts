import { loadUniversityIndex, selectProgram, selectProgramWrite, setFavorite, readUniversityDetail, UniversityNotFoundError } from "@/features/universities/api";
import type { IndexDisk } from "@/features/universities/cache";
import { RpcError } from "@/lib/rpc";
import { fakeTransport, failure, STUDENT_CASE_ID, uuidN } from "@/test-fixtures/universities";
import { indexBody } from "@/test-fixtures/university-index";

function memoryDisk(initial: Record<string, unknown> = {}) {
  const store = new Map(Object.entries(initial));
  const disk: IndexDisk = {
    read: async (k) => store.get(k) ?? null,
    write: async (k, v) => void store.set(k, v),
    remove: async (k) => void store.delete(k),
  };
  return { disk, store };
}

describe("избранное: запись идемпотентна, правда - квитанция", () => {
  const id = uuidN(1);
  it("шлёт состояние (id, favored) без p_request_id; возвращает то, что сказал сервер", async () => {
    const { transport, calls } = fakeTransport({ set_university_favorite_v1: { institutionId: id, favored: true, favoritesCount: 3 } });
    expect(await setFavorite(transport, id, true)).toBe(true);
    expect(calls[0]).toMatchObject({ name: "set_university_favorite_v1", args: { p_institution_id: id, p_favored: true }, get: false });
    expect(Object.keys(calls[0]!.args!)).not.toContain("p_request_id");
  });

  it("обрыв связи: повтор с теми же аргументами, затем успех", async () => {
    const { transport, calls } = fakeTransport({
      set_university_favorite_v1: (_a: unknown, n: number) => (n < 3 ? new RpcError("transport") : { institutionId: id, favored: false, favoritesCount: 1 }),
    });
    expect(await setFavorite(transport, id, false)).toBe(false);
    expect(calls).toHaveLength(3);
    expect(new Set(calls.map((c) => JSON.stringify(c.args))).size).toBe(1);
  });

  it("конфликт и отказ не повторяются; чужая квитанция - ошибка формы", async () => {
    const denied = fakeTransport({ set_university_favorite_v1: failure("42501", 403) });
    await expect(setFavorite(denied.transport, id, true)).rejects.toMatchObject({ kind: "forbidden" });
    expect(denied.calls).toHaveLength(1);
    const garbage = fakeTransport({ set_university_favorite_v1: { nope: 1 } });
    await expect(setFavorite(garbage.transport, id, true)).rejects.toThrow();
  });
});

describe("индекс: диск, версия, отказы", () => {
  it("полный ответ пишется на диск как есть и разбирается", async () => {
    const { disk, store } = memoryDisk();
    const body = indexBody("v1");
    const { transport, calls } = fakeTransport({ student_university_index_v1: body });
    const result = await loadUniversityIndex(transport, disk, "u1", null);
    expect(result.index.version).toBe("v1");
    expect(result.refreshFailed).toBe(false);
    expect(calls[0]?.args).toEqual({ p_known_version: null });
    expect(store.get("u1")).toEqual(body);
  });

  it("копия с диска: запрос с известной версией; notModified той же версии отдаёт копию", async () => {
    const { disk } = memoryDisk({ u1: indexBody("v7") });
    const { transport, calls } = fakeTransport({ student_university_index_v1: { notModified: true, version: "v7" } });
    const result = await loadUniversityIndex(transport, disk, "u1", null);
    expect(result.index.version).toBe("v7");
    expect(calls[0]?.args).toEqual({ p_known_version: "v7" });
  });

  it("notModified с другой версией: сбой, копия остаётся и помечена refreshFailed", async () => {
    const { disk, store } = memoryDisk({ u1: indexBody("v7") });
    const { transport } = fakeTransport({ student_university_index_v1: { notModified: true, version: "v8" } });
    const result = await loadUniversityIndex(transport, disk, "u1", null);
    expect(result).toMatchObject({ refreshFailed: true });
    expect(result.index.version).toBe("v7");
    expect(store.has("u1")).toBe(true);
  });

  it("нет связи без копии - ошибка; с копией - копия", async () => {
    const offline = fakeTransport({ student_university_index_v1: new RpcError("transport") });
    await expect(loadUniversityIndex(offline.transport, memoryDisk().disk, "u1", null)).rejects.toMatchObject({ kind: "transport" });
    const withCopy = await loadUniversityIndex(offline.transport, memoryDisk({ u1: indexBody("v2") }).disk, "u1", null);
    expect(withCopy.refreshFailed).toBe(true);
  });

  it("42501 удаляет копию; чужая копия другого пользователя не читается; битая копия удаляется", async () => {
    const forbidden = fakeTransport({ student_university_index_v1: failure("42501", 403) });
    const { disk, store } = memoryDisk({ u1: indexBody("v2") });
    await expect(loadUniversityIndex(forbidden.transport, disk, "u1", null)).rejects.toMatchObject({ kind: "forbidden" });
    expect(store.has("u1")).toBe(false);

    const other = memoryDisk({ u1: indexBody("v2") });
    const t = fakeTransport({ student_university_index_v1: indexBody("fresh") });
    const result = await loadUniversityIndex(t.transport, other.disk, "u2", null);
    expect(t.calls[0]?.args).toEqual({ p_known_version: null });
    expect(result.index.version).toBe("fresh");

    const broken = memoryDisk({ u1: { notModified: true, version: "x" } });
    await loadUniversityIndex(t.transport, broken.disk, "u1", null);
    expect(broken.store.get("u1")).toEqual(indexBody("fresh"));
  });

  it("неверная обёртка ответа - ошибка, диск не трогается", async () => {
    const { disk, store } = memoryDisk();
    const { transport } = fakeTransport({ student_university_index_v1: { countries: [] } });
    await expect(loadUniversityIndex(transport, disk, "u1", null)).rejects.toThrow();
    expect(store.size).toBe(0);
  });
});

describe("страница вуза", () => {
  it("42501 - вуза нет (404 как в вебе)", async () => {
    const { transport } = fakeTransport({ student_university_detail_v1: failure("42501", 403) });
    await expect(readUniversityDetail(transport, uuidN(1))).rejects.toBeInstanceOf(UniversityNotFoundError);
  });
});

describe("выбор программы: замороженная запись", () => {
  const intent = { studentCaseId: STUDENT_CASE_ID, institutionId: uuidN(1), programId: "cs", intakeId: "11111111-1111-4111-8111-111111111111", publicationVersion: 1 };
  const receipt = (requestId: string) => ({
    applicationId: uuidN(9, "bbbbbbbb"), studentCaseId: STUDENT_CASE_ID, institutionId: intent.institutionId, programId: "cs", intakeId: intent.intakeId,
    publicationId: uuidN(9, "cccccccc"), publicationVersion: 1, catalogLevel: "bachelor", applicationDegree: "bachelor",
    selectedAt: "2026-11-09T08:00:00+00:00", deadlineStateAtSelection: "needs_confirmation", requestId,
  });

  it("повтор после обрыва шлёт тот же p_request_id", async () => {
    const write = selectProgramWrite(intent);
    const { transport, calls } = fakeTransport({
      student_select_catalog_intake_v1: (a: Record<string, unknown> | undefined, n: number) => (n < 2 ? new RpcError("transport") : receipt(String(a?.p_request_id))),
    });
    const result = await selectProgram(transport, write, intent);
    expect(result.applicationId).toBe(uuidN(9, "bbbbbbbb"));
    expect(calls).toHaveLength(2);
    expect(calls[0]?.args?.p_request_id).toBe(write.requestId);
    expect(calls[1]?.args).toEqual(calls[0]?.args);
    expect(calls[0]?.args).toMatchObject({ p_catalog_institution_id: intent.institutionId, p_program_id: "cs", p_publication_version: 1 });
  });

  it("квитанция о другом выборе не принимается", async () => {
    const write = selectProgramWrite(intent);
    const { transport } = fakeTransport({ student_select_catalog_intake_v1: { ...receipt(write.requestId), programId: "other" } });
    await expect(selectProgram(transport, write, intent)).rejects.toThrow();
  });
});
