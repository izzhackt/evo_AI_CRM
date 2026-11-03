"use client";

import { useRef, useState, useTransition } from "react";

import { IntentPrefetchLink } from "@/components/IntentPrefetchLink";
import type { Locale } from "@/lib/i18n-data";
import { getPortalStrings } from "@/lib/portal/i18n";
import { setPortalLanguageAction } from "@/lib/portal/portal-profile-actions";
import type { PortalLanguage } from "@/lib/portal/portal-profile";

import { accountInitials } from "./initials";

const LANGUAGES = [
  { value: "ru", code: "RU" },
  { value: "ky", code: "KY" },
] as const satisfies readonly { value: PortalLanguage; code: string }[];

/**
 * Низ рейла на широком экране (03.11.2026, по образцу кабинета, присланного
 * пользователем): переключатель языка RU | KY и карточка студента — инициалы,
 * имя целиком, страна поступления и роль («Малайзия · Студент») — со ссылкой на «Профиль» (отдельного пункта «Профиль» в рейле нет). Язык сохраняет то же действие, что
 * форма «Профиля» (RPC 196 + cookie, затем перерисовка layout); выбранным он
 * считается только после ответа сервера, сбой остаётся на виду.
 */
export function RailFooter({ displayName, studyCountry, locale, current }: Readonly<{
  displayName: string;
  /** Страна поступления («Малайзия»); без неё подпись — только роль. */
  studyCountry: string | null;
  locale: Locale;
  /** Открыт «Профиль»: карточка заменяет его пункт в рейле и отмечается так же. */
  current: boolean;
}>) {
  const shell = getPortalStrings("shell", locale);
  const profile = getPortalStrings("profile", locale);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  const pendingRef = useRef(false);

  function choose(language: PortalLanguage) {
    if (pendingRef.current || language === locale) return;
    pendingRef.current = true;
    setFailed(false);
    startTransition(async () => {
      try {
        const result = await setPortalLanguageAction(language);
        if (!result.ok) setFailed(true);
      } catch {
        setFailed(true);
      } finally {
        pendingRef.current = false;
      }
    });
  }

  return (
    <div className="pt-nav-footer">
      <div className="pt-lang-switch" role="group" aria-label={profile.languageHeading} aria-busy={pending}>
        {LANGUAGES.map((language) => (
          <button
            key={language.value}
            type="button"
            className="pt-lang-option"
            aria-pressed={locale === language.value}
            aria-disabled={pending}
            onClick={() => choose(language.value)}
          >
            {language.code}
            <span className="pt-sr-only">
              {" — "}
              {language.value === "ru" ? profile.languageRu : profile.languageKy}
            </span>
          </button>
        ))}
      </div>
      {failed ? <p role="alert" className="pt-lang-error">{profile.languageError}</p> : null}
      <IntentPrefetchLink href="/portal/profile" aria-current={current ? "page" : undefined} className="pt-nav-account">
        <span className="pt-nav-account-initials" aria-hidden="true">{accountInitials(displayName)}</span>
        <span className="pt-nav-account-text">
          <span className="pt-nav-account-name">{displayName}</span>
          <span className="pt-nav-account-role">
            {studyCountry ? `${studyCountry} · ${shell.accountRole}` : shell.accountRole}
          </span>
        </span>
      </IntentPrefetchLink>
    </div>
  );
}
