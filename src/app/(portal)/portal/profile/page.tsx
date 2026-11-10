import type { Metadata } from "next";
import Link from "next/link";

import { AiConsentSettingsRow } from "@/components/portal/consent/AiConsent";
import { ConsultationRequest } from "@/components/portal/consultation/ConsultationRequest";
import { AccountDeletionPanel } from "@/components/account-deletion/AccountDeletionPanel";
import { LanguageSwitch } from "@/components/portal/LanguageSwitch";
import { ProfileHero } from "@/components/portal/profile/ProfileHero";
import { PasswordChangeForm } from "@/components/portal/profile/PasswordChangeForm";
import { ProfileIcon } from "@/components/portal/profile/ProfileIcon";
import { stageLabel } from "@/components/portal/admission/OverviewView";
import { readStudentCountryChoice } from "@/lib/portal/country-choice-source";
import { readStudentPortalOverview } from "@/lib/v3/portal-source";
import { isStudyCountryCode, studyCountryName } from "@/lib/study-countries";
import { getLocale } from "@/lib/i18n";
import type { Locale } from "@/lib/i18n-data";
import {
  openConsultationRequest,
  type ConsultationReceipt,
} from "@/lib/portal/consultation";
import { readOwnConsultationRequests } from "@/lib/portal/consultation-source";
import { formatPortalString, getPortalStrings, type PortalStrings } from "@/lib/portal/i18n";
import { readOwnAccountDeletion } from "@/lib/account-deletion/own-source";
import { readOwnAiConsentForProfile } from "@/lib/portal/ai-consent-source";
import { readOwnPortalProfile } from "@/lib/portal/portal-profile-source";
import { readOwnStudentLogin } from "@/lib/portal/student-login-source";
import type { PortalProfile } from "@/lib/portal/portal-profile";
import { logoutStudentPortalAction } from "@/lib/student-portal-auth-actions";
import { localizedApplicationAnswers } from "@/lib/student-application-answers";
import { readOwnStudentApplication } from "@/lib/v3/student-application-source";
import { requireStudentPortalActor } from "@/lib/student-portal-guards";
import { WRITE_EVO_HREF } from "@/lib/portal/write-evo";

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

export async function generateMetadata(): Promise<Metadata> {
  const strings = getPortalStrings("profile", await getLocale());
  return { title: `${strings.title} — EVO Admissions` };
}

/**
 * Экран «Профиль» (PORT-5a, план §6 «Профиль», §13; дизайн-контракт §6):
 * «Мои данные» (#1360: имя, почта и логин для входа, телефон и имя правит куратор; пароль меняется здесь же), язык RU/KY (RPC 196 + cookie в одном действии), личные
 * результаты тестов, согласие на ИИ-помощников (320), выход и удаление
 * аккаунта (280): запрос, срок 30 дней и его статус с сервера.
 */
export default async function ProfilePage() {
  const [actor, locale] = await Promise.all([
    requireStudentPortalActor(),
    getLocale(),
  ]);
  const strings = getPortalStrings("profile", locale);
  const consultationStrings = getPortalStrings("consultation", locale);
  const deletionStrings = getPortalStrings("accountDeletion", locale);
  const aiConsentStrings = getPortalStrings("aiConsent", locale);
  const applyStrings = getPortalStrings("apply", locale);

  // Четыре независимых чтения — одним заходом (план A, 16.10.2026).
  // Запрос консультации (PORT-5b): история и открытый запрос читаются
  // отдельно от профиля; сбой чтения — честная строка, не пустая история.
  // Удаление аккаунта (280): статус своего запроса читается отдельно от
  // профиля 196, который не знает «в обработке». Согласие на ИИ-помощников
  // (320, 25.10.2026) — тоже отдельное чтение со своей честной строкой сбоя,
  // у любого студента кабинета (345, 07.11.2026): согласие даётся при регистрации,
  // поэтому и самостоятельный студент (accessTier approved) видит его и может отозвать.
  // Метки карточки студента (03.11.2026): страна поступления (чтение 284) и
  // этап дела (обзор, только у клиента на сопровождении); сбой — без метки.
  // Своя анкета (/apply, 03.11.2026): только чтение; у студента без анкеты
  // (приглашённого или заведённого вручную) блока нет, сбой — честная строка.
  const [profile, deletion, consultationHistory, countryChoice, overview, application, ownLogin, aiConsent] = await Promise.all([
    readOwnPortalProfile().catch((): PortalProfile | null => null),
    readOwnAccountDeletion(),
    readOwnConsultationRequests().catch((): readonly ConsultationReceipt[] | null => null),
    readStudentCountryChoice().catch((): null => null),
    actor.accessTier === "assisted" ? readStudentPortalOverview().catch((): null => null) : null,
    readOwnStudentApplication().catch((): undefined => undefined),
    readOwnStudentLogin(),
    readOwnAiConsentForProfile(actor.accessTier),
  ]);
  const admissionStrings = getPortalStrings("admission", locale);
  const country = countryChoice?.country ?? null;
  const stage = overview ? stageLabel(overview.operationalStage, admissionStrings) : null;
  const heroChips = [
    country !== null && isStudyCountryCode(country) ? studyCountryName(country, locale) : null,
    stage ? `${admissionStrings.stageTerm}: ${stage}` : null,
  ].filter((chip): chip is string => chip !== null);

  return (
    <main className="pt-page pt-profile">
      <header className="pt-page-header">
        <h1 className="pt-page-title">{strings.title}</h1>
      </header>
      {profile === null ? (
        <p role="alert" className="pt-alert">{strings.unavailable}</p>
      ) : (
        <>
          <ProfileHero
            displayName={profile.displayName}
            chips={heroChips}
            action={(
              <>
                {/* Телефон: низа рейла нет, язык меняется здесь. */}
                <span className="pt-profile-lang-phone"><LanguageSwitch locale={locale} /></span>
                <form action={logoutStudentPortalAction}>
                  <button type="submit" className="pt-btn-ghost">{strings.logout}</button>
                </form>
              </>
            )}
            footer={(
              <Link href="/portal/tests" className="pt-profile-row-link">
                <ProfileIcon name="tests" />
                <span>{strings.testsLink}</span>
                <span aria-hidden="true">→</span>
              </Link>
            )}
          />

          <div className="pt-profile-sections">
            {application === null ? null : (
              <section aria-labelledby="portal-profile-application" className="pt-profile-card pt-profile-application">
                <h2 id="portal-profile-application" className="pt-section-title">
                  <ProfileIcon name="application" />
                  {applyStrings.answersHeading}
                </h2>
                {application === undefined ? (
                  <p role="alert" className="pt-alert">{strings.applicationUnavailable}</p>
                ) : (
                  <dl className="pt-profile-answers">
                    {localizedApplicationAnswers(application.questionnaire, applyStrings, locale).map((item) => (
                      <div key={item.label}>
                        <dt>{item.label}</dt>
                        <dd>{item.value}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </section>
            )}

            <section aria-labelledby="portal-profile-mydata" className="pt-profile-card">
              <h2 id="portal-profile-mydata" className="pt-section-title">
                <ProfileIcon name="data" />
                {strings.dataHeading}
              </h2>
              <dl className="pt-profile-answers">
                <div>
                  <dt>{strings.nameLabel}</dt>
                  <dd>{profile.displayName}</dd>
                </div>
                <div>
                  <dt>{strings.emailLabel}</dt>
                  <dd translate="no">{profile.email}</dd>
                </div>
                {ownLogin ? (
                  <div>
                    <dt>{strings.loginLabel}</dt>
                    <dd translate="no">{ownLogin}</dd>
                  </div>
                ) : null}
              </dl>
              {/* Телефон и имя в кабинете не правятся: записи в базе для этого нет (проверено, #1360). Меняет куратор. */}
              <p className="pt-profile-note">
                {actor.accessTier === "assisted" ? strings.dataNote : strings.dataNoteApproved}{" "}
                {actor.accessTier === "assisted" ? (
                  <Link href={WRITE_EVO_HREF} className="pt-link">{strings.dataWrite}</Link>
                ) : null}
              </p>
            </section>

            <section aria-labelledby="portal-profile-consultation" className="pt-profile-card">
              <h2 id="portal-profile-consultation" className="pt-section-title">
                <ProfileIcon name="consultation" />
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

            {aiConsent.status === "not_applicable" ? null : (
              <section aria-labelledby="portal-profile-ai-consent" className="pt-profile-card">
                <h2 id="portal-profile-ai-consent" className="pt-section-title">
                  <ProfileIcon name="ai" />
                  {aiConsentStrings.rowHeading}
                </h2>
                {aiConsent.status === "ready" ? (
                  <AiConsentSettingsRow initialConsent={aiConsent.consent} strings={aiConsentStrings} />
                ) : (
                  <p role="alert" className="pt-account-deletion-error">{aiConsentStrings.unavailable}</p>
                )}
              </section>
            )}

            <section aria-labelledby="portal-profile-password" className="pt-profile-card">
              <h2 id="portal-profile-password" className="pt-section-title">
                <ProfileIcon name="security" />
                {strings.passwordHeading}
              </h2>
              <PasswordChangeForm strings={strings} />
            </section>

            <section aria-labelledby="portal-profile-deletion" className="pt-profile-card">
              <h2 id="portal-profile-deletion" className="pt-section-title">
                <ProfileIcon name="deletion" />
                {deletionStrings.heading}
              </h2>
              <AccountDeletionPanel
                initialRequest={deletion.status === "ready" ? deletion.request : null}
                unavailable={deletion.status === "unavailable"}
                strings={deletionStrings}
                look="portal"
              />
            </section>
          </div>
        </>
      )}
    </main>
  );
}
