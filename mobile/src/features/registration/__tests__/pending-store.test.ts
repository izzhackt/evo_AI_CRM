// «Подтвердите почту» переживает перезапуск (G10 аудита паритета 25.11.2026): запись лежит в защищённом хранилище до `expiresAt`.
import { clearPendingSignup, loadPendingSignup, savePendingSignup } from "@/features/registration/pending-store";
import type { PendingConfirmation } from "@/features/registration/registration-api";
import { clearRegistrationLocalData } from "@/features/registration/draft-store";

const mockSecure = new Map<string, string>();
jest.mock("expo-secure-store", () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: "when-unlocked-this-device-only",
  setItemAsync: async (key: string, value: string) => void mockSecure.set(key, value),
  getItemAsync: async (key: string) => mockSecure.get(key) ?? null,
  deleteItemAsync: async (key: string) => void mockSecure.delete(key),
}));

const NOW = Date.UTC(2026, 10, 25, 10, 0, 0);
const pending = (over: Partial<PendingConfirmation> = {}): PendingConfirmation => ({
  maskedEmail: "t***@example.test",
  expiresAt: new Date(NOW + 24 * 3_600_000).toISOString(),
  retryAfterSeconds: 60,
  dispatch: "accepted",
  resendCapability: "cap.synthetic_1234567890",
  ...over,
});
const stored = () => [...mockSecure.values()][0];

beforeEach(() => mockSecure.clear());

describe("запись ожидающей регистрации", () => {
  it("сохраняется и читается: те же поля, срок повторной отправки считается от сохранения", async () => {
    await savePendingSignup(pending(), NOW);
    expect(mockSecure.size).toBe(1);
    const restored = await loadPendingSignup(NOW + 20_000);
    expect(restored?.pending).toEqual(pending());
    // 60 с минус прошедшие 20 с
    expect(restored?.cooldownSeconds).toBe(40);
  });

  it("срок повторной отправки уже прошёл: ждать нечего", async () => {
    await savePendingSignup(pending({ retryAfterSeconds: 30 }), NOW);
    expect((await loadPendingSignup(NOW + 5 * 60_000))?.cooldownSeconds).toBe(0);
  });

  it("сервер не назвал срок: ждать нечего", async () => {
    await savePendingSignup(pending({ retryAfterSeconds: null }), NOW);
    expect((await loadPendingSignup(NOW + 1_000))?.cooldownSeconds).toBe(0);
  });

  it("предъявитель повторной отправки лежит только в защищённом хранилище и не печатается ничем другим", async () => {
    await savePendingSignup(pending(), NOW);
    expect(stored()).toContain("cap.synthetic_1234567890");
    expect([...mockSecure.keys()][0]).toBe("evo.registration-pending.v1");
  });

  it("после `expiresAt` не восстанавливается, а запись стирается", async () => {
    await savePendingSignup(pending(), NOW);
    expect(await loadPendingSignup(NOW + 24 * 3_600_000 + 1)).toBeNull();
    expect(mockSecure.size).toBe(0);
  });

  it("негодный срок `expiresAt`, чужая форма и битый JSON стираются и не восстанавливаются", async () => {
    await savePendingSignup(pending({ expiresAt: "когда-нибудь" }), NOW);
    expect(await loadPendingSignup(NOW)).toBeNull();
    expect(mockSecure.size).toBe(0);

    mockSecure.set("evo.registration-pending.v1", "{не json");
    expect(await loadPendingSignup(NOW)).toBeNull();
    expect(mockSecure.size).toBe(0);

    for (const bad of [
      null,
      [],
      { v: 2, savedAt: NOW, retryAt: null, pending: pending() },
      { v: 1, savedAt: "x", retryAt: null, pending: pending() },
      { v: 1, savedAt: NOW, retryAt: "x", pending: pending() },
      { v: 1, savedAt: NOW, retryAt: null, pending: { ...pending(), dispatch: "weird" } },
      { v: 1, savedAt: NOW, retryAt: null, pending: { ...pending(), resendCapability: "" } },
      { v: 1, savedAt: NOW, retryAt: null, pending: { ...pending(), maskedEmail: 5 } },
      { v: 1, savedAt: NOW, retryAt: null, pending: { ...pending(), retryAfterSeconds: -1 } },
    ]) {
      mockSecure.set("evo.registration-pending.v1", JSON.stringify(bad));
      expect(await loadPendingSignup(NOW)).toBeNull();
      expect(mockSecure.size).toBe(0);
    }
  });

  it("запись старше недели или из будущего не читается", async () => {
    await savePendingSignup(pending({ expiresAt: new Date(NOW + 30 * 24 * 3_600_000).toISOString() }), NOW);
    expect(await loadPendingSignup(NOW + 8 * 24 * 3_600_000)).toBeNull();
    await savePendingSignup(pending(), NOW + 3_600_000);
    expect(await loadPendingSignup(NOW)).toBeNull();
  });

  it("clearPendingSignup стирает; clearRegistrationLocalData (выход) стирает тоже", async () => {
    await savePendingSignup(pending(), NOW);
    await clearPendingSignup();
    expect(mockSecure.size).toBe(0);
    await savePendingSignup(pending(), NOW);
    await clearRegistrationLocalData();
    expect(mockSecure.size).toBe(0);
  });
});
