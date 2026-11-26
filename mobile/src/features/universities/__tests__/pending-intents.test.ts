// Неотправленные до конца запросы выбора программ (G39): хранятся по студенту, делу и набору, переживают закрытие экрана,
// удаляются при известном исходе и при выходе.
import AsyncStorage from "@react-native-async-storage/async-storage";

import { clearUniversityCaches } from "@/features/universities/cache";
import { clearPendingIntents, intentStore, PENDING_INTENT_PREFIX, selectionTarget } from "@/features/universities/pending-intents";
import { STUDENT_CASE_ID, uuidN } from "@/test-fixtures/universities";

jest.mock("expo-file-system", () => {
  class Directory {
    exists = false;
    delete() {}
  }
  return { Directory, File: class {}, Paths: { cache: "cache" } };
});

const scope = { userKey: "user-a", studentCaseId: STUDENT_CASE_ID };
const identity = { institutionId: uuidN(1), programId: "cs", intakeId: "11111111-1111-4111-8111-111111111111" };
const intent = { ...identity, studentCaseId: STUDENT_CASE_ID, publicationVersion: 3, requestId: uuidN(5, "eeeeeeee") };
const requirements = { studentCaseId: STUDENT_CASE_ID, applicationId: uuidN(9, "bbbbbbbb"), requestId: uuidN(6, "eeeeeeee") };

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe("хранилище запросов", () => {
  it("запрос выбора читается по набору, в том числе новым сеансом (после перезапуска)", async () => {
    const store = intentStore(scope);
    expect(await store.readSelection(selectionTarget(identity))).toBeNull();
    await store.persist(intent);
    expect(await intentStore(scope).readSelection(selectionTarget(identity))).toEqual(intent);
  });

  it("личность выбора - вуз, программа и набор: версия публикации её не меняет", () => {
    expect(selectionTarget(identity)).toBe(`${identity.institutionId}:cs:${identity.intakeId}`);
    expect(selectionTarget({ ...identity, ...{ publicationVersion: 9 } } as typeof identity)).toBe(selectionTarget(identity));
  });

  it("запрос списка документов хранится отдельно по заявке", async () => {
    const store = intentStore(scope);
    await store.persist(requirements);
    expect(await store.readRequirements(requirements.applicationId)).toEqual(requirements);
    expect(await store.readRequirements(uuidN(8, "bbbbbbbb"))).toBeNull();
    expect(await store.readSelection(selectionTarget(identity))).toBeNull();
  });

  it("студент и дело изолированы: чужой запрос не читается", async () => {
    await intentStore(scope).persist(intent);
    expect(await intentStore({ userKey: "user-b", studentCaseId: STUDENT_CASE_ID }).readSelection(selectionTarget(identity))).toBeNull();
    expect(await intentStore({ userKey: "user-a", studentCaseId: uuidN(3, "99999999") }).readSelection(selectionTarget(identity))).toBeNull();
  });

  it("запрос другого дела не сохраняется", async () => {
    await expect(intentStore(scope).persist({ ...intent, studentCaseId: uuidN(3, "99999999") })).rejects.toThrow();
    expect(await AsyncStorage.getAllKeys()).toEqual([]);
  });

  it("очистка удаляет только свой запрос: новый запрос по тому же набору не затирается", async () => {
    const store = intentStore(scope);
    await store.persist(intent);
    await store.clear({ ...intent, requestId: uuidN(7, "eeeeeeee") }); // чужой, прежний запрос
    expect(await store.readSelection(selectionTarget(identity))).toEqual(intent);
    await store.clear(intent);
    expect(await store.readSelection(selectionTarget(identity))).toBeNull();
  });

  it("испорченная запись не мешает: читается как «нет запроса» и удаляется", async () => {
    const store = intentStore(scope);
    await store.persist(intent);
    const [key] = await AsyncStorage.getAllKeys();
    for (const bad of ["не json", JSON.stringify({ ...intent, requestId: "не uuid" }), JSON.stringify({ ...intent, extra: 1 }), JSON.stringify({ ...intent, institutionId: uuidN(2) })]) {
      await AsyncStorage.setItem(key!, bad);
      expect(await store.readSelection(selectionTarget(identity))).toBeNull();
      expect(await AsyncStorage.getItem(key!)).toBeNull();
    }
  });
});

describe("выход из аккаунта", () => {
  it("clearPendingIntents стирает записи всех студентов и не трогает чужие ключи", async () => {
    await intentStore(scope).persist(intent);
    await intentStore({ userKey: "user-b", studentCaseId: STUDENT_CASE_ID }).persist(requirements);
    await AsyncStorage.setItem("evo.lang", "ru");
    expect((await AsyncStorage.getAllKeys()).filter((key) => key.startsWith(PENDING_INTENT_PREFIX))).toHaveLength(2);
    await clearPendingIntents();
    expect(await AsyncStorage.getAllKeys()).toEqual(["evo.lang"]);
  });

  it("clearUniversityCaches, который зовёт выход, стирает и запросы выбора", async () => {
    await intentStore(scope).persist(intent);
    await clearUniversityCaches();
    expect(await intentStore(scope).readSelection(selectionTarget(identity))).toBeNull();
  });
});
