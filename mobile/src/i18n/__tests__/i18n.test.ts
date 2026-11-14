import { getPortalStrings, getPasswordRecoveryStrings } from "@/i18n";
import { PENDING_OWNER_KEYS } from "@/i18n/strings-documents";
import { MOBILE_STRINGS } from "@/i18n/mobile-strings";
import { REGISTRATION_RU } from "@/i18n/strings-registration";

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

// Решение владельца 14.11.2026: на рабочих экранах приложения нет напоминаний о данных (политика, согласие, хранение
// файлов, антивирус, ИИ, «видите только вы»). Они живут только в регистрации и на экране «Конфиденциальность»; тот же
// запрет для общего словаря веба держит tests/portal-i18n.test.mjs. Строки регистрации (мастер анкеты) исключены.
const DATA_REMINDER = [
  /видите только|видит только|только вы(?![\p{L}\p{N}_])|только вам(?![\p{L}\p{N}_])|только сам(?![\p{L}\p{N}_])|видны только/iu,
  /сиз гана|өзүңүз гана|гана көрөсүз|гана көрөт/iu,
  /вирус|антивирус/iu,
  /Anthropic|Gemini|Claude/u,
  /не передаётся куратору|не показываются сотрудникам|без вашего имени|обезлич/iu,
  /конфиденциальн|купуялык|приватн/iu,
  /хранятся закрыто|жабык сакталат|будут стёрты|өчүрүлөт/iu,
];

describe("рабочие экраны без напоминаний о данных (владелец, 14.11.2026)", () => {
  it("в строках приложения нет таких фраз ни в RU, ни в KY", () => {
    const registration = new Set(Object.keys(REGISTRATION_RU));
    for (const lang of ["ru", "ky"] as const) {
      for (const [key, value] of Object.entries(MOBILE_STRINGS[lang])) {
        if (registration.has(key)) continue;
        for (const pattern of DATA_REMINDER) expect([key, lang, pattern.test(value)]).toEqual([key, lang, false]);
      }
    }
  });
});
