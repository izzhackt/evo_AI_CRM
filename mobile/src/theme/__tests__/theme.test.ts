import { menuTokensFor, resolveScheme, tokensFor } from "@/theme/ThemeProvider";
import { darkTokens, lightTokens } from "@/theme/tokens.generated";

describe("тема", () => {
  it("выбор студента сильнее системы; «как в системе» следует за ней", () => {
    expect(resolveScheme("light", "dark")).toBe("light");
    expect(resolveScheme("dark", "light")).toBe("dark");
    expect(resolveScheme("system", "dark")).toBe("dark");
    expect(resolveScheme("system", null)).toBe("light");
  });
  it("токены из portal.css: светлая и тёмная палитры", () => {
    expect(lightTokens.bg).toBe("#f3f4f6");
    expect(lightTokens.accent).toBe("#d70217");
    expect(darkTokens.bg).toBe("#141311");
    expect(darkTokens.accent).toBe("#ff4a57");
    expect(tokensFor("dark").surface).toBe("#1e1c19");
  });
  it("меню ☰ одинаково тёмное в обеих темах", () => {
    expect(menuTokensFor("light").surface).toBe("#17181c");
    expect(menuTokensFor("dark").surface).toBe("#17181c");
    expect(menuTokensFor("light").railGroup).toBe("#8d919b");
  });
});
