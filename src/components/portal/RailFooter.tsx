import { IntentPrefetchLink } from "@/components/IntentPrefetchLink";
import { ThemeToggle } from "@/components/ThemeToggle";
import type { Locale } from "@/lib/i18n-data";
import { getPortalStrings } from "@/lib/portal/i18n";
import type { Theme } from "@/lib/theme";

import { accountInitials } from "./initials";
import { LanguageSwitch } from "./LanguageSwitch";

/**
 * Низ рейла на широком экране (03.11.2026, по образцу кабинета, присланного
 * пользователем): переключатель языка RU | KY, кнопка темы и карточка
 * студента — инициалы,
 * имя целиком, страна поступления и роль («Малайзия · Студент») — со ссылкой
 * на «Профиль» (отдельного пункта «Профиль» в рейле нет).
 */
export function RailFooter({ displayName, studyCountry, locale, theme, current }: Readonly<{
  displayName: string;
  /** Страна поступления («Малайзия»); без неё подпись — только роль. */
  studyCountry: string | null;
  locale: Locale;
  theme: Theme;
  /** Открыт «Профиль»: карточка заменяет его пункт в рейле и отмечается так же. */
  current: boolean;
}>) {
  const shell = getPortalStrings("shell", locale);

  return (
    <div className="pt-nav-footer">
      <div className="pt-rail-controls">
        <LanguageSwitch locale={locale} />
        <ThemeToggle locale={locale} initialTheme={theme} />
      </div>
      <IntentPrefetchLink href="/portal/profile" aria-current={current ? "page" : undefined} className="pt-nav-account">
        <span className="pt-nav-account-initials" aria-hidden="true">{accountInitials(displayName)}</span>
        <span className="pt-nav-account-text">
          <span className="pt-sr-only">{shell["nav.profile"]}: </span>
          <span className="pt-nav-account-name">{displayName}</span>
          <span className="pt-nav-account-role">
            {studyCountry ? `${studyCountry} · ${shell.accountRole}` : shell.accountRole}
          </span>
        </span>
      </IntentPrefetchLink>
    </div>
  );
}
