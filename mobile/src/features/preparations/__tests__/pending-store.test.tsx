// Хранилище незавершённых записей: тот же формат ключа и записи, что у веба; договор «записать до отправки, не затирать чужое,
// проверить чтением, замок на цель».
import { act, render, screen } from "@testing-library/react-native";
import { Text } from "react-native";

import { documentsPending, isSubmitIntent, isUploadIntent } from "@/features/preparations/documents-pending";
import { usePending, type PendingScope } from "@/features/preparations/pending-store";
import { APPLICATION_ID, STUDENT_CASE_ID, REVISION_ID, itemId, slotId, sha, versionId, uploadId } from "@/test-fixtures/preparations";
import { memoryPendingStorage } from "@/test-fixtures/pending-storage";

const scope: PendingScope = { organizationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", membershipId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", studentCaseId: STUDENT_CASE_ID, applicationId: APPLICATION_ID };
const item = itemId(0);
const REQUEST = "99999999-0000-4000-8000-000000000001";
const uploadIntent = (over: Record<string, unknown> = {}) => ({
  protocolVersion: 1,
  studentCaseId: STUDENT_CASE_ID,
  applicationId: APPLICATION_ID,
  requirementsRevisionId: REVISION_ID,
  requirementItemId: item,
  documentSlotId: slotId(0),
  requestId: REQUEST,
  file: { originalFilename: "scan.pdf", declaredMimeType: "application/pdf", byteSize: "1024", sha256Hex: sha(1) },
  ...over,
});
const submitIntent = (over: Record<string, unknown> = {}) => ({
  studentCaseId: STUDENT_CASE_ID,
  applicationId: APPLICATION_ID,
  requirementsRevisionId: REVISION_ID,
  requirementItemId: item,
  requestId: REQUEST,
  selection: { kind: "program_upload", uploadContextId: uploadId(1), documentVersionId: versionId(1) },
  expectedPreviousSubmissionId: null,
  ...over,
});
type Web = {
  applicationDocumentPendingKey: (scope: PendingScope, operation: string, target: string) => string;
  readApplicationDocumentPending: (scope: PendingScope, operation: string, target: string, storage: unknown) => { intent: unknown; blocked: boolean };
  persistApplicationDocumentPending: (scope: PendingScope, operation: string, target: string, value: unknown, storage: unknown) => void;
};
// requireActual: модуль веба обращается к `window` и `navigator.locks` только внутри функций, импорт в приложении ему запрещён стражем.
const web = jest.requireActual("@web/lib/portal/application-documents-pending") as Web;
/** Синхронный `Storage` над тем же словарём: так читает и пишет веб. */
const syncPort = (data: Map<string, string>) => ({
  getItem: (key: string) => data.get(key) ?? null,
  setItem: (key: string, value: string) => void data.set(key, value),
  removeItem: (key: string) => void data.delete(key),
  key: (index: number) => [...data.keys()][index] ?? null,
  get length() {
    return data.size;
  },
});

describe("формат совпадает с вебом", () => {
  it("ключ записи: evo.application-documents.v1:<организация>:<участник>:<дело>:<программа>:<операция>:<требование>", () => {
    for (const operation of ["upload", "submit"] as const) {
      expect(documentsPending.key(scope, operation, item)).toBe(web.applicationDocumentPendingKey(scope, operation, item));
    }
    expect(documentsPending.key(scope, "upload", item)).toBe(`evo.application-documents.v1:${scope.organizationId}:${scope.membershipId}:${scope.studentCaseId}:${scope.applicationId}:upload:${item}`);
  });

  it("запись приложения читает веб, запись веба читает приложение", async () => {
    const storage = memoryPendingStorage();
    await documentsPending.persist(scope, "upload", item, uploadIntent() as never, storage);
    expect(web.readApplicationDocumentPending(scope, "upload", item, syncPort(storage.data))).toEqual({ intent: uploadIntent(), blocked: false });
    web.persistApplicationDocumentPending(scope, "submit", item, submitIntent(), syncPort(storage.data));
    expect(await documentsPending.read(scope, "submit", item, storage)).toEqual({ intent: submitIntent(), blocked: false });
  });
});

describe("запись и чтение", () => {
  it("записанный запрос читается тем же; чужая цель пуста", async () => {
    const storage = memoryPendingStorage();
    await documentsPending.persist(scope, "upload", item, uploadIntent() as never, storage);
    const read = await documentsPending.read(scope, "upload", item, storage);
    expect(read.blocked).toBe(false);
    expect(isUploadIntent(read.intent)).toBe(true);
    expect(isSubmitIntent(read.intent)).toBe(false);
    expect(await documentsPending.read(scope, "submit", item, storage)).toEqual({ intent: null, blocked: false });
    expect(await documentsPending.read(scope, "upload", itemId(1), storage)).toEqual({ intent: null, blocked: false });
  });

  it("тот же запрос записывается повторно без ошибки; другой запрос на ту же цель - конфликт, запись не тронута", async () => {
    const storage = memoryPendingStorage();
    await documentsPending.persist(scope, "upload", item, uploadIntent() as never, storage);
    await expect(documentsPending.persist(scope, "upload", item, uploadIntent() as never, storage)).resolves.toBeUndefined();
    const before = [...storage.data.entries()];
    await expect(documentsPending.persist(scope, "upload", item, uploadIntent({ requestId: "99999999-0000-4000-8000-000000000002" }) as never, storage)).rejects.toThrow("Pending conflict");
    expect([...storage.data.entries()]).toEqual(before);
  });

  it("негодный запрос и запрос другой цели не записываются", async () => {
    const storage = memoryPendingStorage();
    await expect(documentsPending.persist(scope, "upload", item, uploadIntent({ file: { originalFilename: "a/b.pdf", declaredMimeType: "application/pdf", byteSize: "1", sha256Hex: sha(1) } }) as never, storage)).rejects.toThrow("Pending intent invalid");
    await expect(documentsPending.persist(scope, "upload", itemId(1), uploadIntent() as never, storage)).rejects.toThrow("Pending intent invalid");
    await expect(documentsPending.persist(scope, "upload", item, uploadIntent({ applicationId: itemId(5) }) as never, storage)).rejects.toThrow("Pending intent invalid");
    expect(storage.data.size).toBe(0);
  });

  it("хранилище не держит запись: проверка чтением выдаёт ошибку", async () => {
    const storage = memoryPendingStorage();
    storage.forgetting = true;
    await expect(documentsPending.persist(scope, "upload", item, uploadIntent() as never, storage)).rejects.toThrow("Pending persistence unavailable");
  });

  it("хранилище недоступно: чтение даёт «заблокировано», а не пустоту", async () => {
    const storage = memoryPendingStorage();
    storage.failing = true;
    // хранилище не ответило: «заблокировано», и пометка «не удалось прочитать сейчас» (повтор может помочь); у повреждённой записи её нет
    expect(await documentsPending.read(scope, "upload", item, storage)).toEqual({ intent: null, blocked: true, unavailable: true });
    await expect(documentsPending.persist(scope, "upload", item, uploadIntent() as never, storage)).rejects.toThrow();
  });

  it("повреждённые и чужие записи заблокированы и не затираются", async () => {
    const key = documentsPending.key(scope, "upload", item);
    const good = JSON.stringify({ protocolVersion: 1, scope, operation: "upload", target: item, intent: uploadIntent() });
    const cases: Record<string, string> = {
      "не JSON": "{oops",
      "слишком большая": "x".repeat(16385),
      "чужая версия": good.replace('"protocolVersion":1', '"protocolVersion":2'),
      "чужая программа в области": JSON.stringify({ protocolVersion: 1, scope: { ...scope, applicationId: itemId(7) }, operation: "upload", target: item, intent: uploadIntent() }),
      "чужая операция": JSON.stringify({ protocolVersion: 1, scope, operation: "submit", target: item, intent: uploadIntent() }),
      "другая цель": JSON.stringify({ protocolVersion: 1, scope, operation: "upload", target: itemId(1), intent: uploadIntent() }),
      "запрос другого требования": JSON.stringify({ protocolVersion: 1, scope, operation: "upload", target: item, intent: uploadIntent({ requirementItemId: itemId(1) }) }),
      "лишнее поле": JSON.stringify({ protocolVersion: 1, scope, operation: "upload", target: item, intent: uploadIntent(), extra: true }),
    };
    for (const [name, raw] of Object.entries(cases)) {
      const storage = memoryPendingStorage({ [key]: raw });
      expect([name, await documentsPending.read(scope, "upload", item, storage)]).toEqual([name, { intent: null, blocked: true }]);
      await expect(documentsPending.persist(scope, "upload", item, uploadIntent() as never, storage)).rejects.toThrow("Pending conflict");
      expect(storage.data.get(key)).toBe(raw);
    }
  });

  it("подписчики узнают о записи и снятии", async () => {
    const storage = memoryPendingStorage();
    const seen: string[] = [];
    const off = documentsPending.subscribe(() => seen.push("changed"));
    await documentsPending.persist(scope, "upload", item, uploadIntent() as never, storage);
    await documentsPending.clear(scope, "upload", item, uploadIntent() as never, storage);
    off();
    await documentsPending.persist(scope, "upload", item, uploadIntent() as never, storage);
    expect(seen).toEqual(["changed", "changed"]);
  });

  it("упавший подписчик не ломает запись", async () => {
    const storage = memoryPendingStorage();
    const off = documentsPending.subscribe(() => {
      throw new Error("экран упал");
    });
    await expect(documentsPending.persist(scope, "upload", item, uploadIntent() as never, storage)).resolves.toBeUndefined();
    off();
  });
});

describe("снятие", () => {
  it("снимается только тот же запрос", async () => {
    const storage = memoryPendingStorage();
    await documentsPending.persist(scope, "upload", item, uploadIntent() as never, storage);
    expect(await documentsPending.clear(scope, "upload", item, uploadIntent({ requestId: "99999999-0000-4000-8000-000000000002" }) as never, storage)).toBe(false);
    expect(storage.data.size).toBe(1);
    expect(await documentsPending.clear(scope, "upload", item, uploadIntent() as never, storage)).toBe(true);
    expect(storage.data.size).toBe(0);
    expect(await documentsPending.clear(scope, "upload", item, uploadIntent() as never, storage)).toBe(false);
  });

  it("хранилище не удаляет: ошибка, а не молчаливый успех", async () => {
    const storage = memoryPendingStorage();
    await documentsPending.persist(scope, "upload", item, uploadIntent() as never, storage);
    storage.stubborn = true;
    await expect(documentsPending.clear(scope, "upload", item, uploadIntent() as never, storage)).rejects.toThrow("Pending clearing unavailable");
  });

  it("запись, изменившаяся между чтениями, не снимается", async () => {
    const storage = memoryPendingStorage();
    await documentsPending.persist(scope, "upload", item, uploadIntent() as never, storage);
    const key = documentsPending.key(scope, "upload", item);
    const raw = storage.data.get(key)!;
    let reads = 0;
    const racy = { ...storage, getItem: async (k: string) => { reads += 1; if (reads === 2) storage.data.set(k, raw + " "); return storage.data.get(k) ?? null; } };
    expect(await documentsPending.clear(scope, "upload", item, uploadIntent() as never, racy)).toBe(false);
    expect(storage.data.has(key)).toBe(true);
  });
});

describe("перечень записей программы", () => {
  it("свои записи по порядку, чужие программы и участники не читаются, мусорные ключи пропускаются", async () => {
    const storage = memoryPendingStorage();
    await documentsPending.persist(scope, "submit", item, submitIntent() as never, storage);
    await documentsPending.persist(scope, "upload", item, uploadIntent() as never, storage);
    const other = { ...scope, applicationId: itemId(9) };
    await documentsPending.persist(other, "upload", item, uploadIntent({ applicationId: itemId(9) }) as never, storage);
    // тот же студент и та же программа, но другой участник, другая организация и оба сразу: приставка ключа у каждого своя
    await documentsPending.persist({ ...scope, membershipId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }, "upload", item, uploadIntent() as never, storage);
    await documentsPending.persist({ ...scope, organizationId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" }, "upload", item, uploadIntent() as never, storage);
    await documentsPending.persist({ ...scope, organizationId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", membershipId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }, "submit", item, submitIntent() as never, storage);
    storage.data.set(`${documentsPending.key(scope, "upload", item)}:лишнее`, "x");
    storage.data.set(documentsPending.key(scope, "upload", itemId(1)), "{bad");
    storage.data.set("evo.lang", "ru");
    const list = await documentsPending.list(scope, storage);
    // записи другого участника, другой организации и обоих сразу в перечень не попали (иначе их было бы пять)
    expect(list).toHaveLength(3);
    expect(list.map((entry) => [entry.operation, entry.target, entry.blocked, entry.intent !== null])).toEqual([
      ["submit", item, false, true],
      ["upload", item, false, true],
      ["upload", itemId(1), true, false],
    ]);
  });

  it("хранилище недоступно: ошибка перечня", async () => {
    const storage = memoryPendingStorage();
    storage.failing = true;
    await expect(documentsPending.list(scope, storage)).rejects.toThrow("Pending inventory unavailable");
  });
});

describe("отказ от незавершённой записи", () => {
  const SIBLING = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  /** Записи, которых отказ не касается, и та, которой касается. */
  async function seeded() {
    const storage = memoryPendingStorage();
    await documentsPending.persist(scope, "upload", item, uploadIntent() as never, storage);
    await documentsPending.persist(scope, "submit", item, submitIntent() as never, storage);
    await documentsPending.persist(scope, "upload", itemId(1), uploadIntent({ requirementItemId: itemId(1) }) as never, storage);
    await documentsPending.persist({ ...scope, applicationId: itemId(9) }, "upload", item, uploadIntent({ applicationId: itemId(9) }) as never, storage);
    await documentsPending.persist({ ...scope, membershipId: SIBLING }, "upload", item, uploadIntent() as never, storage);
    return storage;
  }

  it("снимает ровно запись этой операции этого требования: другое требование, другая операция, другая программа и другой участник целы", async () => {
    const storage = await seeded();
    const before = [...storage.data.keys()].sort();
    expect(await documentsPending.discard(scope, "upload", item, storage)).toEqual({ ok: true });
    const mine = documentsPending.key(scope, "upload", item);
    expect([...storage.data.keys()].sort()).toEqual(before.filter((key) => key !== mine));
    expect(await documentsPending.read(scope, "upload", item, storage)).toEqual({ intent: null, blocked: false });
    expect((await documentsPending.read(scope, "submit", item, storage)).intent).not.toBeNull();
  });

  it("снимает и испорченную запись, которую `clear` снять не может", async () => {
    const key = documentsPending.key(scope, "upload", item);
    const storage = memoryPendingStorage({ [key]: "{oops" });
    expect(await documentsPending.read(scope, "upload", item, storage)).toEqual({ intent: null, blocked: true });
    expect(await documentsPending.clear(scope, "upload", item, uploadIntent() as never, storage)).toBe(false);
    expect(storage.data.get(key)).toBe("{oops");
    expect(await documentsPending.discard(scope, "upload", item, storage)).toEqual({ ok: true });
    expect(await documentsPending.read(scope, "upload", item, storage)).toEqual({ intent: null, blocked: false });
  });

  it("подписчики экрана узнают об отказе; записи нет вовсе - тоже без ошибки", async () => {
    const storage = await seeded();
    const seen: string[] = [];
    const off = documentsPending.subscribe(() => seen.push("changed"));
    await documentsPending.discard(scope, "upload", item, storage);
    await documentsPending.discard(scope, "upload", item, storage);
    off();
    expect(seen).toEqual(["changed", "changed"]);
  });

  it("идёт команда этой цели: «занято», запись цела; после неё замок свободен", async () => {
    const storage = await seeded();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const running = documentsPending.withLock(scope, "upload", item, () => gate, storage);
    expect(await documentsPending.discard(scope, "upload", item, storage)).toEqual({ ok: false, reason: "busy" });
    expect((await documentsPending.read(scope, "upload", item, storage)).intent).not.toBeNull();
    release();
    await running;
    expect(await documentsPending.discard(scope, "upload", item, storage)).toEqual({ ok: true });
  });

  it("хранилище не отвечает или не удаляет: ошибка, а не молчаливый успех, и запись на месте", async () => {
    const storage = await seeded();
    storage.stubborn = true;
    expect(await documentsPending.discard(scope, "upload", item, storage)).toEqual({ ok: false, reason: "storage_unavailable" });
    expect(storage.data.has(documentsPending.key(scope, "upload", item))).toBe(true);
    storage.stubborn = false;
    storage.failing = true;
    expect(await documentsPending.discard(scope, "upload", item, storage)).toEqual({ ok: false, reason: "storage_unavailable" });
  });

  it("негодная область или цель: «хранилище недоступно», ничего не тронуто", async () => {
    const storage = await seeded();
    const before = [...storage.data.entries()];
    expect(await documentsPending.discard({ ...scope, membershipId: "нет" }, "upload", item, storage)).toEqual({ ok: false, reason: "storage_unavailable" });
    expect(await documentsPending.discard(scope, "upload", "не uuid", storage)).toEqual({ ok: false, reason: "storage_unavailable" });
    expect([...storage.data.entries()]).toEqual(before);
  });
});

describe("замок цели", () => {
  it("второе нажатие во время работы получает «занято», после работы замок свободен", async () => {
    const storage = memoryPendingStorage();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = documentsPending.withLock(scope, "upload", item, async () => {
      await gate;
      return "первая";
    }, storage);
    const second = await documentsPending.withLock(scope, "upload", item, async () => "вторая", storage);
    expect(second).toEqual({ acquired: false, reason: "busy" });
    release();
    expect(await first).toEqual({ acquired: true, value: "первая" });
    expect(await documentsPending.withLock(scope, "upload", item, async () => "третья", storage)).toEqual({ acquired: true, value: "третья" });
  });

  it("два нажатия одновременно: проходит одно", async () => {
    const storage = memoryPendingStorage();
    const results = await Promise.all([
      documentsPending.withLock(scope, "submit", item, async () => "a", storage),
      documentsPending.withLock(scope, "submit", item, async () => "b", storage),
    ]);
    expect(results.filter((r) => r.acquired)).toHaveLength(1);
    expect(results.filter((r) => !r.acquired)).toEqual([{ acquired: false, reason: "busy" }]);
  });

  it("разные цели и операции не мешают друг другу", async () => {
    const storage = memoryPendingStorage();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = documentsPending.withLock(scope, "upload", item, () => gate, storage);
    expect(await documentsPending.withLock(scope, "submit", item, async () => 1, storage)).toEqual({ acquired: true, value: 1 });
    expect(await documentsPending.withLock(scope, "upload", itemId(1), async () => 2, storage)).toEqual({ acquired: true, value: 2 });
    release();
    await first;
  });

  it("команда бросила или хранилище не отвечает: «хранилище недоступно», замок отпущен", async () => {
    const storage = memoryPendingStorage();
    expect(await documentsPending.withLock(scope, "upload", item, async () => { throw new Error("boom"); }, storage)).toEqual({ acquired: false, reason: "storage_unavailable" });
    storage.failing = true;
    expect(await documentsPending.withLock(scope, "upload", item, async () => 1, storage)).toEqual({ acquired: false, reason: "storage_unavailable" });
    storage.failing = false;
    expect(await documentsPending.withLock(scope, "upload", item, async () => 1, storage)).toEqual({ acquired: true, value: 1 });
  });

  it("негодная область: «хранилище недоступно», команда не запускается", async () => {
    let ran = false;
    const result = await documentsPending.withLock({ ...scope, membershipId: "нет" }, "upload", item, async () => { ran = true; }, memoryPendingStorage());
    expect(result).toEqual({ acquired: false, reason: "storage_unavailable" });
    expect(ran).toBe(false);
  });
});

describe("очистка при выходе", () => {
  it("стираются запросы документов всех участников, остальное не трогается", async () => {
    const storage = memoryPendingStorage({ "evo.lang": "ru", "evo.application-packages.v1:x": "1" });
    await documentsPending.persist(scope, "upload", item, uploadIntent() as never, storage);
    await documentsPending.persist({ ...scope, membershipId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }, "upload", item, uploadIntent() as never, storage);
    await documentsPending.clearAll(storage);
    expect([...storage.data.keys()].sort()).toEqual(["evo.application-packages.v1:x", "evo.lang"]);
  });

  it("хранилище недоступно: выход не ломается", async () => {
    const storage = memoryPendingStorage();
    storage.failing = true;
    await expect(documentsPending.clearAll(storage)).resolves.toBeUndefined();
  });
});

function Probe({ storage, target = item }: { storage: ReturnType<typeof memoryPendingStorage>; target?: string }) {
  const view = usePending(documentsPending, scope, "upload", target, storage);
  return <Text testID="probe">{`${view.hydrated ? "H" : "-"}:${view.blocked ? "B" : "-"}:${view.intent ? "I" : "-"}`}</Text>;
}

describe("usePending", () => {
  it("сначала «не прочитано», потом запись; обновляется, когда запрос записан или снят где угодно", async () => {
    const storage = memoryPendingStorage();
    await render(<Probe storage={storage} />);
    expect(await screen.findByText("H:-:-")).toBeTruthy();
    await act(async () => {
      await documentsPending.persist(scope, "upload", item, uploadIntent() as never, storage);
    });
    expect(await screen.findByText("H:-:I")).toBeTruthy();
    await act(async () => {
      await documentsPending.clear(scope, "upload", item, uploadIntent() as never, storage);
    });
    expect(await screen.findByText("H:-:-")).toBeTruthy();
  });

  it("запись уже есть при открытии: форма видит её", async () => {
    const storage = memoryPendingStorage();
    await documentsPending.persist(scope, "upload", item, uploadIntent() as never, storage);
    await render(<Probe storage={storage} />);
    expect(await screen.findByText("H:-:I")).toBeTruthy();
  });

  it("хранилище недоступно: «заблокировано» после прочтения", async () => {
    const storage = memoryPendingStorage();
    storage.failing = true;
    await render(<Probe storage={storage} />);
    expect(await screen.findByText("H:B:-")).toBeTruthy();
  });
});
