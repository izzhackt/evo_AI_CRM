// Где `Intl.PluralRules` есть (Node, Android), polyfill ничего не ломает.
import "@/polyfills";

describe("polyfills при встроенном Intl.PluralRules", () => {
  it("формы слов прежние", () => {
    expect(new Intl.PluralRules("ru").select(2)).toBe("few");
    expect(new Intl.PluralRules("ky").select(1)).toBe("one");
  });
});
