// `polyfill-force` ставит реализацию formatjs поверх встроенной, как это будет в Hermes
// без `Intl.PluralRules`: общий код веба должен получить те же формы слов.
import "@formatjs/intl-pluralrules/polyfill-force.js";
import "@formatjs/intl-pluralrules/locale-data/ru.js";
import "@formatjs/intl-pluralrules/locale-data/ky.js";

import { getPortalStrings } from "@web/lib/portal/i18n";
import { closesInLabel } from "@web/components/portal/csca/session-labels";

describe("Intl.PluralRules без встроенной реализации", () => {
  it("русские формы", () => {
    const rules = new Intl.PluralRules("ru");
    expect([1, 2, 4, 5, 11, 12, 21, 22, 25].map((n) => rules.select(n))).toEqual(["one", "few", "few", "many", "many", "many", "one", "few", "many"]);
  });
  it("кыргызский: один и остальное", () => {
    const rules = new Intl.PluralRules("ky");
    expect([1, 2, 5, 21].map((n) => rules.select(n))).toEqual(["one", "other", "other", "other"]);
  });
  it("«закрывается через N дней» склоняется как в вебе", () => {
    const strings = getPortalStrings("csca", "ru");
    expect(closesInLabel(1, "ru", strings)).toContain("1 день");
    expect(closesInLabel(4, "ru", strings)).toContain("4 дня");
    expect(closesInLabel(21, "ru", strings)).toContain("21 день");
    expect(closesInLabel(11, "ru", strings)).toContain("11 дней");
    expect(closesInLabel(0, "ru", strings)).toBe(strings.sessionClosesToday);
  });
});
