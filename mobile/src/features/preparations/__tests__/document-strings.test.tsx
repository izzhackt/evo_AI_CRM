// Тексты документов программы: словарь веба с подменой пяти строк, которые сайт пишет про страницу, вкладку и браузер.
import { getPortalStrings } from "@web/lib/portal/i18n";
import { renderHook } from "@testing-library/react-native";
import type { ReactNode } from "react";

import { DOCUMENT_STRING_OVERRIDES, useDocumentStrings } from "@/features/preparations/document-strings";
import { LangProvider } from "@/i18n/LangProvider";
import { mobileString } from "@/i18n";

function wrapper(lang: "ru" | "ky") {
  return function LangWrapper({ children }: { children: ReactNode }) {
    return <LangProvider initial={lang}>{children}</LangProvider>;
  };
}

describe.each(["ru", "ky"] as const)("тексты документов программы (%s)", (lang) => {
  it("пять строк заменены строками приложения, остальные - ровно словарь веба", async () => {
    const { result } = await renderHook(() => useDocumentStrings(), { wrapper: wrapper(lang) });
    const web = getPortalStrings("programDocuments", lang);
    for (const [key, replacement] of Object.entries(DOCUMENT_STRING_OVERRIDES)) {
      expect(result.current[key as keyof typeof result.current]).toBe(mobileString(lang, replacement));
      expect(result.current[key as keyof typeof result.current]).not.toBe(web[key as keyof typeof web]);
    }
    const replaced = new Set(Object.keys(DOCUMENT_STRING_OVERRIDES));
    for (const key of Object.keys(web) as (keyof typeof web)[]) {
      if (!replaced.has(key)) expect([key, result.current[key]]).toEqual([key, web[key]]);
    }
    expect(Object.keys(result.current).sort()).toEqual(Object.keys(web).sort());
  });

  it("в строках приложения нет слов про страницу и вкладку (в «источник срока» браузер назван, потому что ссылка открывается в нём)", () => {
    for (const [key, replacement] of Object.entries(DOCUMENT_STRING_OVERRIDES)) {
      const text = mobileString(lang, replacement);
      expect([key, /страниц|вкладк|өтмөк/iu.test(text)]).toEqual([key, false]);
      if (key !== "deadlineSource") expect([key, /браузер/iu.test(text)]).toEqual([key, false]);
    }
  });
});

it("подменяются именно те строки веба, где речь о странице, вкладке и браузере (RU)", () => {
  const web = getPortalStrings("programDocuments", "ru");
  expect(web.forbidden).toMatch(/страниц/u);
  expect(web.storageUnavailable).toMatch(/браузер/u);
  expect(web.cleanupFailed).toMatch(/браузер/u);
  expect(web.savedSendBusy).toMatch(/вкладк/u);
  expect(web.deadlineSource).toMatch(/вкладк/u);
});
