import AsyncStorage from "@react-native-async-storage/async-storage";

import { clearDraft, clearInviteToken, loadDraft, loadInviteToken, saveDraft, saveInviteToken, serializeDraft } from "@/features/registration/draft-store";
import { initialValues } from "@/features/registration/wizard-model";
import { filledValues, INVITE, REQUEST_ID } from "@/test-fixtures/registration";

const mockSecure = new Map<string, string>();
jest.mock("expo-secure-store", () => ({
  setItemAsync: async (key: string, value: string) => void mockSecure.set(key, value),
  getItemAsync: async (key: string) => mockSecure.get(key) ?? null,
  deleteItemAsync: async (key: string) => void mockSecure.delete(key),
}));

beforeEach(async () => {
  await AsyncStorage.clear();
  mockSecure.clear();
});

describe("черновик на устройстве", () => {
  it("сохраняет ответы и шаг, но не пароль и не согласие", async () => {
    const values = filledValues({ consent: true });
    await saveDraft("anonymous", values, 4);
    const raw = (await AsyncStorage.getItem("evo.application-draft.v1:anonymous")) ?? "";
    expect(raw).toBe(serializeDraft(values, 4));
    expect(raw.toLowerCase()).not.toContain("password");
    expect(raw).not.toContain("consent");
    expect(raw).not.toContain("aiConsent");
    expect(raw).not.toContain(INVITE);
    const stored = await loadDraft("anonymous", initialValues(REQUEST_ID));
    expect(stored?.step).toBe(4);
    expect(stored?.values.firstName).toBe("Тест");
    expect(stored?.values.email).toBe("test.student@example.test");
    expect(stored?.values.consent).toBe(false);
  });

  it("области не смешиваются", async () => {
    await saveDraft("user:me@example.test:0", filledValues(), 2);
    expect(await loadDraft("anonymous", initialValues(REQUEST_ID))).toBeNull();
    expect((await loadDraft("user:me@example.test:0", initialValues(REQUEST_ID)))?.step).toBe(2);
    await clearDraft("user:me@example.test:0");
    expect(await loadDraft("user:me@example.test:0", initialValues(REQUEST_ID))).toBeNull();
  });

  it("битый черновик не ломает мастер", async () => {
    await AsyncStorage.setItem("evo.application-draft.v1:anonymous", "{not json");
    expect(await loadDraft("anonymous", initialValues(REQUEST_ID))).toBeNull();
  });
});

describe("личная ссылка в защищённом хранилище", () => {
  it("хранит только настоящий токен и стирается", async () => {
    await saveInviteToken("short");
    expect(await loadInviteToken()).toBeNull();
    await saveInviteToken(INVITE);
    expect(await loadInviteToken()).toBe(INVITE);
    expect(await AsyncStorage.getAllKeys()).toEqual([]);
    await clearInviteToken();
    expect(await loadInviteToken()).toBeNull();
  });
});
