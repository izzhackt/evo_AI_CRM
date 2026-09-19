import Link from "next/link";

import { DeleteAccountRequest } from "@/components/portal/profile/DeleteAccountRequest";
import { LanguageForm } from "@/components/portal/profile/LanguageForm";
import { getLocale } from "@/lib/i18n";
import { getPortalStrings } from "@/lib/portal/i18n";
import { readOwnPortalProfile } from "@/lib/portal/portal-profile-source";
import type { PortalProfile } from "@/lib/portal/portal-profile";
import { logoutStudentPortalAction } from "@/lib/student-portal-auth-actions";
import { requireStudentPortalActor } from "@/lib/student-portal-guards";

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

  let profile: PortalProfile | null = null;
  try {
    profile = await readOwnPortalProfile();
  } catch {
    profile = null;
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
