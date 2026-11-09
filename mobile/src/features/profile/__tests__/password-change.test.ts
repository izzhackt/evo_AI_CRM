import type { ChangePasswordResult } from "@/api/portal-auth";
import { submitPasswordChange, validatePasswordChange, webMessageKey, type PasswordChangeDeps } from "@/features/profile/password-change";

const GOOD = { current: "old-password-1", next: "new-password-123", confirm: "new-password-123" };

function deps(results: ChangePasswordResult[], tokens: { get?: string | null; refresh?: (string | null)[] } = {}) {
  const calls: { token: string; current: string; next: string }[] = [];
  const refreshes = [...(tokens.refresh ?? ["fresh-token"])];
  let refreshCount = 0;
  const value: PasswordChangeDeps = {
    changeOwnPassword: async (token, current, next) => {
      calls.push({ token, current, next });
      return results.shift() ?? { ok: false, reason: "unavailable" };
    },
    getAccessToken: async () => (tokens.get === undefined ? "token-1" : tokens.get),
    refreshAccessToken: async () => {
      refreshCount += 1;
      return refreshes.shift() ?? null;
    },
  };
  return { value, calls, refreshCount: () => refreshCount };
}

describe("проверка полей (правила веба)", () => {
  it("порядок: текущий, длина, максимум в байтах, совпадение, одинаковый пароль", () => {
    expect(validatePasswordChange({ ...GOOD, current: "" })).toBe("wrong_current");
    expect(validatePasswordChange({ ...GOOD, next: "short", confirm: "short" })).toBe("too_short");
    const long = "я".repeat(40); // 80 байт
    expect(validatePasswordChange({ ...GOOD, next: long, confirm: long })).toBe("too_long");
    expect(validatePasswordChange({ ...GOOD, confirm: "different-pass-1" })).toBe("mismatch");
    expect(validatePasswordChange({ current: "same-password-1", next: "same-password-1", confirm: "same-password-1" })).toBe("same_password");
    expect(validatePasswordChange(GOOD)).toBeNull();
  });

  it("локальная ошибка не доходит до сервера", async () => {
    const d = deps([{ ok: true }]);
    await expect(submitPasswordChange(d.value, { ...GOOD, confirm: "x" })).resolves.toBe("mismatch");
    expect(d.calls).toHaveLength(0);
  });
});

describe("автомат отправки", () => {
  it("200 -> done; уходят токен, текущий и новый пароль", async () => {
    const d = deps([{ ok: true }]);
    await expect(submitPasswordChange(d.value, GOOD)).resolves.toBe("done");
    expect(d.calls).toEqual([{ token: "token-1", current: GOOD.current, next: GOOD.next }]);
    expect(d.refreshCount()).toBe(0);
  });

  it.each([
    ["wrong_current", "wrong_current"],
    ["weak_password", "rejected"],
    ["same_password", "same_password"],
    ["rate_limited", "rate_limited"],
    ["staff_account", "staff_account"],
    ["network", "offline"],
    ["unavailable", "unavailable"],
    ["invalid_request", "unavailable"],
  ] as const)("отказ %s -> %s", async (reason, status) => {
    const d = deps([{ ok: false, reason }]);
    await expect(submitPasswordChange(d.value, GOOD)).resolves.toBe(status);
    expect(d.refreshCount()).toBe(0);
  });

  it("401: сессия обновляется один раз и запрос повторяется с новым токеном", async () => {
    const d = deps([{ ok: false, reason: "unauthorized" }, { ok: true }]);
    await expect(submitPasswordChange(d.value, GOOD)).resolves.toBe("done");
    expect(d.refreshCount()).toBe(1);
    expect(d.calls.map((c) => c.token)).toEqual(["token-1", "fresh-token"]);
  });

  it("повторный 401 -> sign_in_required, третьей попытки нет", async () => {
    const d = deps([{ ok: false, reason: "unauthorized" }, { ok: false, reason: "unauthorized" }]);
    await expect(submitPasswordChange(d.value, GOOD)).resolves.toBe("sign_in_required");
    expect(d.refreshCount()).toBe(1);
    expect(d.calls).toHaveLength(2);
  });

  it("401 и обновление не удалось -> sign_in_required", async () => {
    const d = deps([{ ok: false, reason: "unauthorized" }], { refresh: [null] });
    await expect(submitPasswordChange(d.value, GOOD)).resolves.toBe("sign_in_required");
    expect(d.calls).toHaveLength(1);
  });

  it("нет токена: одно обновление, потом вход заново", async () => {
    const d = deps([{ ok: true }], { get: null, refresh: [null] });
    await expect(submitPasswordChange(d.value, GOOD)).resolves.toBe("sign_in_required");
    expect(d.calls).toHaveLength(0);
  });

  it("строки: у исходов веба есть ключ, у idle/offline/staff_account нет", () => {
    expect(webMessageKey("done")).toBe("passwordDone");
    expect(webMessageKey("wrong_current")).toBe("passwordWrongCurrent");
    expect(webMessageKey("idle")).toBeNull();
    expect(webMessageKey("offline")).toBeNull();
  });
});
