import { LanguageSwitch } from "@/components/portal/LanguageSwitch";
import type { Locale } from "@/lib/i18n-data";
import { getPortalStrings } from "@/lib/portal/i18n";

import { ProfileIcon } from "./ProfileIcon";

/**
 * «Контакты и доступ» в «Профиле» (03.11.2026, по образцу кабинета,
 * присланного пользователем): строки «подпись — значение». Только то, что
 * есть у студента: почта из профиля 196, телефон из его анкеты (без анкеты —
 * «Не указано»), язык кабинета (на широком экране значение, переключатель —
 * внизу рейла; на телефоне переключатель здесь) и часовой пояс, по которому
 * кабинет показывает все сроки. Данных о родителе у студента нет — строки
 * нет; карандашей тоже: сохранять эти поля студенту пока нечем.
 */
export function ProfileContacts({ email, phone, locale }: Readonly<{
  email: string;
  phone: string | null;
  locale: Locale;
}>) {
  const strings = getPortalStrings("profile", locale);
  return (
    <section aria-labelledby="portal-profile-contacts" className="pt-profile-card">
      <h2 id="portal-profile-contacts" className="pt-section-title">
        <ProfileIcon name="access" />
        {strings.contactsHeading}
      </h2>
      <dl className="pt-profile-rows">
        <div className="pt-profile-row">
          <dt>{strings.emailLabel}</dt>
          <dd>{email}</dd>
        </div>
        <div className="pt-profile-row">
          <dt>{strings.phoneLabel}</dt>
          <dd data-empty={phone ? undefined : ""}>{phone ?? strings.notSpecified}</dd>
        </div>
        <div className="pt-profile-row">
          <dt>{strings.languageHeading}</dt>
          <dd>
            {/* Широкий экран: переключатель внизу рейла, здесь — только значение. */}
            <span className="pt-profile-lang-value">{locale === "ky" ? strings.languageKy : strings.languageRu}</span>
            <span className="pt-profile-lang-control"><LanguageSwitch locale={locale} /></span>
          </dd>
        </div>
        <div className="pt-profile-row">
          <dt>
            {strings.timezoneLabel}
            <span className="pt-profile-row-hint">{strings.timezoneHint}</span>
          </dt>
          <dd>{strings.timezoneValue}</dd>
        </div>
      </dl>
      <p className="pt-profile-note">
        <ProfileIcon name="access" />
        {strings.contactsNote}
      </p>
    </section>
  );
}
