import Link from "next/link";

import { ConsultationRequest } from "@/components/portal/consultation/ConsultationRequest";
import { DeleteAccountRequest } from "@/components/portal/profile/DeleteAccountRequest";
import { LanguageForm } from "@/components/portal/profile/LanguageForm";
import { getLocale } from "@/lib/i18n";
import type { Locale } from "@/lib/i18n-data";
import {
  openConsultationRequest,
  type ConsultationReceipt,
} from "@/lib/portal/consultation";
import { readOwnConsultationRequests } from "@/lib/portal/consultation-source";
import { formatPortalString, getPortalStrings, type PortalStrings } from "@/lib/portal/i18n";
import { readOwnPortalProfile } from "@/lib/portal/portal-profile-source";
import type { PortalProfile } from "@/lib/portal/portal-profile";
import { logoutStudentPortalAction } from "@/lib/student-portal-auth-actions";
import { requireStudentPortalActor } from "@/lib/student-portal-guards";

function consultationDate(value: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === "ky" ? "ky" : "ru", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}

/**
 * История запросов консультации со статусами (PORT-5b, план §6): каждый
 * запрос — фактическое состояние «отправлен/обработан» с датами, выбранным
 * вузом и заметкой; никаких обещаний сроков.
 */
function ConsultationHistory({
  history,
  strings,
  locale,
}: {
  history: readonly ConsultationReceipt[];
  strings: PortalStrings<"consultation">;
  locale: Locale;
}) {
  if (history.length === 0) return null;
  return (
    <>
      <h3 className="pt-section-title">{strings.historyHeading}</h3>
      <ul className="pt-consult-history">
        {history.map((receipt) => (
          <li key={receipt.requestId} className="pt-consult-history-item">
            <p className="pt-consult-history-status">
              {receipt.status === "handled" ? strings.statusHandled : strings.statusRequested}
            </p>
            {receipt.institutionName !== null ? (
              <p className="pt-consult-history-meta">
                {formatPortalString(strings.universityLine, { name: receipt.institutionName })}
              </p>
            ) : null}
            {receipt.note !== null ? (
              <p className="pt-consult-history-note">{receipt.note}</p>
            ) : null}
            <p className="pt-consult-history-meta">
              {formatPortalString(strings.historyDate, {
                date: consultationDate(receipt.requestedAt, locale),
              })}
              {receipt.handledAt !== null
                ? ` · ${formatPortalString(strings.handledDate, {
                  date: consultationDate(receipt.handledAt, locale),
                })}`
                : ""}
            </p>
          </li>
        ))}
      </ul>
    </>
  );
}

export const dynamic = "force-dynamic";

/**
 * Экран «Профиль» (PORT-5a, план §6 «Профиль», §13; дизайн-контракт §6):
 * данные read-only, язык RU/KY (RPC 196 + cookie в одном действии), личные
 * результаты тестов, выход и инициирование удаления аккаунта с честным
 * состоянием запроса.
 */
export default async function ProfilePage() {
  const [, locale] = await Promise.all([
    requireStudentPortalActor(),
    getLocale(),
  ]);
  const strings = getPortalStrings("profile", locale);
  const consultationStrings = getPortalStrings("consultation", locale);

  let profile: PortalProfile | null = null;
  try {
    profile = await readOwnPortalProfile();
  } catch {
    profile = null;
  }

  // Запрос консультации (PORT-5b): история и открытый запрос читаются
  // отдельно от профиля; сбой чтения — честная строка, не пустая история.
  let consultationHistory: readonly ConsultationReceipt[] | null = null;
  try {
    consultationHistory = await readOwnConsultationRequests();
  } catch {
    consultationHistory = null;
  }

  return (
    <main className="pt-page">
      <header className="pt-page-header">
        <p className="pt-page-kicker">{strings.kicker}</p>
        <h1 className="pt-page-title">{strings.title}</h1>
        <p className="pt-page-lead">{strings.lead}</p>
      </header>
      {profile === null ? (
        <p role="alert" className="pt-alert">{strings.unavailable}</p>
      ) : (
        <div className="pt-profile-sections">
          <section aria-labelledby="portal-profile-data" className="pt-profile-card">
            <h2 id="portal-profile-data" className="pt-section-title">{strings.dataHeading}</h2>
            <dl className="pt-facts">
              <div className="pt-fact">
                <dt>{strings.nameLabel}</dt>
                <dd>{profile.displayName}</dd>
              </div>
              <div className="pt-fact">
                <dt>{strings.emailLabel}</dt>
                <dd className="pt-data">{profile.email}</dd>
              </div>
            </dl>
            <p>
              <Link href="/portal/tests" className="pt-link">{strings.testsLink}</Link>
            </p>
          </section>

          <section aria-labelledby="portal-profile-consultation" className="pt-profile-card">
            <h2 id="portal-profile-consultation" className="pt-section-title">
              {consultationStrings.heading}
            </h2>
            {consultationHistory === null ? (
              <p role="alert" className="pt-alert">{consultationStrings.historyUnavailable}</p>
            ) : (
              <>
                <ConsultationRequest
                  initialOpenRequest={openConsultationRequest(consultationHistory)}
                  strings={consultationStrings}
                />
                <ConsultationHistory
                  history={consultationHistory}
                  strings={consultationStrings}
                  locale={locale}
                />
              </>
            )}
          </section>

          <section aria-labelledby="portal-profile-language" className="pt-profile-card">
            <h2 id="portal-profile-language" className="pt-section-title">
              {strings.languageHeading}
            </h2>
            <LanguageForm
              initialLanguage={profile.portalLanguage}
              strings={{
                languageHeading: strings.languageHeading,
                languageHint: strings.languageHint,
                languageRu: strings.languageRu,
                languageKy: strings.languageKy,
                languageSave: strings.languageSave,
                languageSaved: strings.languageSaved,
                languageError: strings.languageError,
              }}
            />
          </section>

          <section aria-labelledby="portal-profile-session" className="pt-profile-card">
            <h2 id="portal-profile-session" className="pt-section-title">
              {strings.sessionHeading}
            </h2>
            <form action={logoutStudentPortalAction}>
              <button type="submit" className="pt-btn-ghost">{strings.logout}</button>
            </form>
          </section>

          <section aria-labelledby="portal-profile-deletion" className="pt-profile-card">
            <h2 id="portal-profile-deletion" className="pt-section-title">
              {strings.deleteHeading}
            </h2>
            <DeleteAccountRequest
              initialRequestedAt={profile.deletionRequestedAt}
              strings={{
                deleteDescription: strings.deleteDescription,
                deleteConfirm: strings.deleteConfirm,
                deleteRequested: strings.deleteRequested,
                deleteError: strings.deleteError,
              }}
            />
          </section>
        </div>
      )}
    </main>
  );
}
