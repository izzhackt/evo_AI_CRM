import { getPortalStrings, getPasswordRecoveryStrings } from "@/i18n";
import { PENDING_OWNER_KEYS } from "@/i18n/strings-documents";
import { MOBILE_STRINGS } from "@/i18n/mobile-strings";

describe("строки", () => {
  it("общий словарь веба доступен без копий (RU и KY)", () => {
    expect(getPortalStrings("shell", "ru")["nav.home"]).toBe("Главная");
    expect(getPortalStrings("shell", "ky")["nav.home"]).toBe("Башкы бет");
    expect(getPortalStrings("profile", "ru").logout).toBe("Выйти");
    expect(getPasswordRecoveryStrings("ky").forgotLink).toBeTruthy();
  });
  it("в строках приложения все ключи есть в RU и KY и ни одна не пуста", () => {
    expect(Object.keys(MOBILE_STRINGS.ky).sort()).toEqual(Object.keys(MOBILE_STRINGS.ru).sort());
    for (const lang of ["ru", "ky"] as const) {
      for (const [key, value] of Object.entries(MOBILE_STRINGS[lang])) expect([key, value.trim().length > 0 || PENDING_OWNER_KEYS.includes(key)]).toEqual([key, true]);
    }
  });
});
