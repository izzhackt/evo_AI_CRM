import { logoutPlatformAction } from "@/lib/platform-admissions-actions";
import {
  formatPortalDate,
  PortalMissingCase,
  PortalNotice,
  PortalPageHeader,
  PortalPanel,
  portalStyles as styles,
} from "@/components/platform/portal/PortalPrimitives";
import { PortalIcon } from "@/components/platform/portal/PortalIcon";
import { PortalPlatformLanguageSwitcher } from "@/components/platform/portal/PortalShell";
import { getPortalCopy } from "@/components/platform/portal/portal-copy";
import type { Locale } from "@/lib/i18n-data";
import { getPortalPageData } from "@/lib/portal";

const PROFILE_LABELS = {
  ru: {
    admissionProfile: "Профиль поступления",
    preferredName: "Предпочитаемое имя",
    legalName: "Имя по документам",
    dateOfBirth: "Дата рождения",
    communicationLanguage: "Язык общения",
    citizenship: "Гражданство",
    residency: "Страна проживания",
    currentEducation: "Текущее образование",
    academicSummary: "Академический профиль",
    languageSummary: "Языковой профиль",
    budgetBand: "Бюджетный диапазон",
    decisionParticipants: "Участники решения",
    consentStatus: "Статус согласия",
    routeSummary: "Маршрут поступления",
    programDirection: "Направление программы",
    intake: "Набор",
    requiredFields: "Обязательные поля профиля",
    profileComplete: "Все обязательные поля заполнены.",
    nextStep: "Следующий шаг по профилю",
  },
  ky: {
    admissionProfile: "Окууга тапшыруу профили",
    preferredName: "Тандалган аты",
    legalName: "Документтеги аты",
    dateOfBirth: "Туулган күнү",
    communicationLanguage: "Байланыш тили",
    citizenship: "Жарандыгы",
    residency: "Жашаган өлкөсү",
    currentEducation: "Учурдагы билими",
    academicSummary: "Академиялык профиль",
    languageSummary: "Тил профили",
    budgetBand: "Бюджет диапазону",
    decisionParticipants: "Чечимге катышуучулар",
    consentStatus: "Макулдуктун абалы",
    routeSummary: "Окууга тапшыруу багыты",
    programDirection: "Программанын багыты",
    intake: "Кабыл алуу мезгили",
    requiredFields: "Профилдин милдеттүү талаалары",
    profileComplete: "Бардык милдеттүү талаалар толтурулган.",
    nextStep: "Профиль боюнча кийинки кадам",
  },
  en: {
    admissionProfile: "Admissions profile",
    preferredName: "Preferred name",
    legalName: "Legal name",
    dateOfBirth: "Date of birth",
    communicationLanguage: "Communication language",
    citizenship: "Citizenship",
    residency: "Country of residence",
    currentEducation: "Current education",
    academicSummary: "Academic profile",
    languageSummary: "Language profile",
    budgetBand: "Budget band",
    decisionParticipants: "Decision participants",
    consentStatus: "Consent status",
    routeSummary: "Admissions route",
    programDirection: "Program direction",
    intake: "Intake",
    requiredFields: "Required profile fields",
    profileComplete: "All required profile fields are complete.",
    nextStep: "Next profile step",
  },
} as const satisfies Record<Locale, Record<string, string>>;

function displayProfileKey(value: string) {
  return value.replaceAll("_", " ");
}

export default async function PortalProfilePage() {
  const { snapshot, locale } = await getPortalPageData();
  const copy = getPortalCopy(locale);
  if (!snapshot) return <PortalMissingCase copy={copy} />;
  const profile = snapshot.profile;
  const labels = PROFILE_LABELS[locale];

  return (
    <>
      <PortalPageHeader title={copy.profileTitle} description={copy.profileDescription} />
      <div className={styles.twoColumn}>
        <div className={styles.stack}>
          <PortalPanel title={copy.personalData}>
            <div className={styles.detailGrid}>
              <div>
                <div className={styles.detailLabel}>{copy.email}</div>
                <div className={styles.detailValue}>{snapshot.student.email ?? copy.notAssigned}</div>
              </div>
              <div>
                <div className={styles.detailLabel}>{copy.phone}</div>
                <div className={styles.detailValue}>{snapshot.student.phone ?? copy.notAssigned}</div>
              </div>
            </div>
          </PortalPanel>
          {profile && (
            <>
              <PortalPanel title={labels.admissionProfile}>
                <div className={styles.detailGrid}>
                  <div>
                    <div className={styles.detailLabel}>{labels.preferredName}</div>
                    <div className={styles.detailValue}>{profile.preferredDisplayName ?? copy.notAssigned}</div>
                  </div>
                  <div>
                    <div className={styles.detailLabel}>{labels.legalName}</div>
                    <div className={styles.detailValue}>{profile.legalDisplayName ?? copy.notAssigned}</div>
                  </div>
                  <div>
                    <div className={styles.detailLabel}>{labels.dateOfBirth}</div>
                    <div className={styles.detailValue}>
                      {formatPortalDate(profile.dateOfBirth, locale) ?? copy.notAssigned}
                    </div>
                  </div>
                  <div>
                    <div className={styles.detailLabel}>{labels.communicationLanguage}</div>
                    <div className={styles.detailValue}>{profile.communicationLanguage ?? copy.notAssigned}</div>
                  </div>
                  <div>
                    <div className={styles.detailLabel}>{labels.citizenship}</div>
                    <div className={styles.detailValue}>{profile.citizenshipCountry ?? copy.notAssigned}</div>
                  </div>
                  <div>
                    <div className={styles.detailLabel}>{labels.residency}</div>
                    <div className={styles.detailValue}>{profile.residencyCountry ?? copy.notAssigned}</div>
                  </div>
                  <div>
                    <div className={styles.detailLabel}>{labels.currentEducation}</div>
                    <div className={styles.detailValue}>{profile.currentEducationSummary ?? copy.notAssigned}</div>
                  </div>
                  <div>
                    <div className={styles.detailLabel}>{labels.academicSummary}</div>
                    <div className={styles.detailValue}>{profile.academicSummary ?? copy.notAssigned}</div>
                  </div>
                  <div>
                    <div className={styles.detailLabel}>{labels.languageSummary}</div>
                    <div className={styles.detailValue}>{profile.languageSummary ?? copy.notAssigned}</div>
                  </div>
                  <div>
                    <div className={styles.detailLabel}>{labels.budgetBand}</div>
                    <div className={styles.detailValue}>{profile.budgetBand ?? copy.notAssigned}</div>
                  </div>
                  <div>
                    <div className={styles.detailLabel}>{labels.decisionParticipants}</div>
                    <div className={styles.detailValue}>
                      {profile.decisionParticipantLabels.join(", ") || copy.notAssigned}
                    </div>
                  </div>
                  <div>
                    <div className={styles.detailLabel}>{labels.consentStatus}</div>
                    <div className={styles.detailValue}>{displayProfileKey(profile.consentStatus)}</div>
                  </div>
                  <div>
                    <div className={styles.detailLabel}>{labels.nextStep}</div>
                    <div className={styles.detailValue}>{profile.nextStep ?? copy.notAssigned}</div>
                  </div>
                </div>
              </PortalPanel>

              <PortalPanel title={labels.routeSummary}>
                <div className={styles.detailGrid}>
                  <div>
                    <div className={styles.detailLabel}>{copy.country}</div>
                    <div className={styles.detailValue}>{snapshot.client.targetCountry ?? copy.notAssigned}</div>
                  </div>
                  <div>
                    <div className={styles.detailLabel}>{copy.degree}</div>
                    <div className={styles.detailValue}>{snapshot.client.targetDegree ?? copy.notAssigned}</div>
                  </div>
                  <div>
                    <div className={styles.detailLabel}>{labels.programDirection}</div>
                    <div className={styles.detailValue}>{profile.programDirection ?? copy.notAssigned}</div>
                  </div>
                  <div>
                    <div className={styles.detailLabel}>{labels.intake}</div>
                    <div className={styles.detailValue}>{profile.intake ?? copy.notAssigned}</div>
                  </div>
                </div>
              </PortalPanel>

              <PortalPanel title={labels.requiredFields}>
                <p className={styles.cardMeta}>
                  {profile.requiredFields.length === 0
                    ? labels.profileComplete
                    : profile.requiredFields.map(displayProfileKey).join(", ")}
                </p>
              </PortalPanel>
            </>
          )}
          <PortalNotice
            title={copy.profileReadOnlyTitle}
            body={copy.profileReadOnlyBody}
          />
        </div>

        <aside className={styles.stack}>
          <PortalPanel title={copy.security}>
            <div className={styles.personRow}>
              <span className={styles.cardIcon}>
                <PortalIcon name="shield" size={20} />
              </span>
              <p className={styles.cardMeta}>{copy.protectedSession}</p>
            </div>
            <div style={{ marginTop: 16 }}>
              <PortalNotice
                title={copy.passwordUnavailableTitle}
                body={copy.passwordUnavailableBody}
                tone="warning"
              />
            </div>
          </PortalPanel>

          <PortalPanel title={copy.language}>
            <PortalPlatformLanguageSwitcher current={locale} label={copy.language} />
          </PortalPanel>

          <form action={logoutPlatformAction}>
            <button type="submit" className={styles.logoutButton}>
              <PortalIcon name="log-out" size={17} />
              {copy.signOut}
            </button>
          </form>
        </aside>
      </div>
    </>
  );
}
