import Link from "next/link";
import { isPlatformApplicationCountryCode } from "@/lib/platform-application-contract";
import { SelectionAction, type StudentSelectionContext } from "./SelectionAction";

import type { Locale } from "@/lib/i18n-data";
import {
  type PublishedUniversity,
  type UniversityIntake,
  type UniversityProgram,
} from "@/lib/platform-university-catalog";
import type { PortalStrings } from "@/lib/portal/i18n";
import {
  universityCountryLabel,
  universityDateLabel,
  universityIntakeStatusKey,
  universityLevelKey,
  universityMonthLabel,
} from "@/lib/portal/universities";

import {
  ConsultationRequest,
  type ConsultationRequestStrings,
} from "@/components/portal/consultation/ConsultationRequest";
import type { ConsultationReceipt } from "@/lib/portal/consultation";

import { FavoriteToggle } from "./FavoriteToggle";
import { PhotoFigure } from "./PhotoFigure";

/**
 * Карточка вуза в стиле «Атлас» (PORT-3a): фото-герой с атрибуцией, страна и
 * город, программы с наборами. Состав фактов полностью повторяет прежнюю
 * портальную карточку: обзор, сайт, программы, интейки с датами и
 * источниками, основной источник карточки.
 */

type Strings = PortalStrings<"universities">;
type ProgramSelection = Readonly<{ context: StudentSelectionContext; university: PublishedUniversity }> | null;

function ExternalLink({
  href,
  newTab,
  children,
}: {
  href: string;
  newTab: string;
  children: React.ReactNode;
}) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="pt-link">
      {children}
      <span className="pt-sr-only"> {newTab}</span>
    </a>
  );
}

function Intake({
  intake,
  strings,
  locale,
  now,
  programId,
  selection,
}: {
  intake: UniversityIntake;
  programId: string;
  selection: ProgramSelection;
  strings: Strings;
  locale: Locale;
  now: Date;
}) {
  const start = intake.startDate
    ? universityDateLabel(intake.startDate, locale)
    : intake.startMonth
      ? universityMonthLabel(intake.startMonth, locale)
      : null;
  const deadline = intake.applicationDeadline
    ? `${universityDateLabel(intake.applicationDeadline, locale)}${
      intake.deadlineTime ? `, ${intake.deadlineTime} (${intake.timezone})` : ""
    }`
    : null;
  return (
    <li className="pt-intake">
      <h4 className="pt-intake-title">{intake.label}</h4>
      <p className="pt-intake-status">{strings[universityIntakeStatusKey(intake, now)]}</p>
      {start !== null || deadline !== null ? (
        <dl className="pt-facts">
          {start !== null ? (
            <div className="pt-fact">
              <dt>{strings.intakeStart}</dt>
              <dd className="pt-data">{start}</dd>
            </div>
          ) : null}
          {deadline !== null ? (
            <div className="pt-fact">
              <dt>{strings.intakeDeadline}</dt>
              <dd className="pt-data">{deadline}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
      {intake.note ? <p className="pt-prep-note">{intake.note}</p> : null}
      <ExternalLink href={intake.sourceUrl} newTab={strings.newTab}>
        {strings.intakeSource}
      </ExternalLink>
      {selection ? <SelectionAction
        key={`${selection.context.scope.organizationId}:${selection.context.scope.membershipId}:${selection.context.scope.studentCaseId}:${selection.university.id}:${programId}:${intake.id ?? "legacy"}`}
        context={selection.context}
        target={intake.id ? {
          studentCaseId: selection.context.scope.studentCaseId,
          institutionId: selection.university.id,
          programId,
          intakeId: intake.id,
          publicationVersion: selection.university.version,
        } : null}
        existingApplicationId={selection.context.bindings?.find((item) =>
          item.institutionId === selection.university.id && item.programId === programId && item.intakeId === intake.id)?.applicationId ?? null}
        blocked={!intake.id ? "identityMissing" : !isPlatformApplicationCountryCode(selection.university.content.country)
          ? "unsupportedCountry" : intake.status === "closed" ? "closedIntake" : null}
        uncertainDeadline={!["open", "announced"].includes(intake.status) || !intake.applicationDeadline || !intake.timezone
          || universityIntakeStatusKey(intake, now) === "intakeStatus.needsConfirmation"}
      /> : null}
    </li>
  );
}

function Program({
  program,
  strings,
  locale,
  now,
  selection,
}: {
  program: UniversityProgram;
  selection: ProgramSelection;
  strings: Strings;
  locale: Locale;
  now: Date;
}) {
  // Uncertain intakes remain visible with an explicit, truthful status.
  const intakes = program.intakes;
  return (
    <article className="pt-program">
      <p className="pt-program-level">{strings[universityLevelKey(program.level)]}</p>
      <h3 className="pt-program-title">{program.title}</h3>
      {program.duration || program.language ? (
        <dl className="pt-facts">
          {program.duration ? (
            <div className="pt-fact">
              <dt>{strings.duration}</dt>
              <dd>{program.duration}</dd>
            </div>
          ) : null}
          {program.language ? (
            <div className="pt-fact">
              <dt>{strings.teachingLanguage}</dt>
              <dd>{program.language}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
      <p className="pt-program-summary">{program.summary}</p>
      <ExternalLink href={program.sourceUrl} newTab={strings.newTab}>
        {strings.programPage}
      </ExternalLink>
      {intakes.length ? (
        <ul className="pt-intake-list">
          {intakes.map((intake, index) => (
            <Intake key={intake.id ?? index} intake={intake} programId={program.id} selection={selection} strings={strings} locale={locale} now={now} />
          ))}
        </ul>
      ) : null}
    </article>
  );
}

export function UniversityDetailView({
  university,
  base,
  strings,
  locale,
  now,
  favored = null,
  consultation = null,
  selection = null,
}: {
  university: PublishedUniversity;
  selection?: StudentSelectionContext | null;
  base: string;
  strings: Strings;
  locale: Locale;
  now: Date;
  /** null — состояние избранного неизвестно (toggle не показывается). */
  favored?: boolean | null;
  /**
   * Запрос консультации по этому вузу (PORT-5b); null — блок не показывается
   * (например, историю запросов не удалось прочитать — submit из профиля
   * остаётся доступным).
   */
  consultation?: Readonly<{
    initialOpenRequest: ConsultationReceipt | null;
    strings: ConsultationRequestStrings;
  }> | null;
}) {
  const content = university.content;
  return (
    <article className="pt-uni-detail">
      <p>
        <Link href={base} className="pt-btn-ghost">← {strings.backToCatalog}</Link>
      </p>
      <header className="pt-uni-hero">
        <PhotoFigure content={content} large strings={strings} />
        <div className="pt-uni-card-top">
          <p className="pt-page-kicker">
            {universityCountryLabel(content.country, locale)}
            {content.city ? ` · ${content.city}` : ""}
          </p>
          {favored !== null ? (
            <FavoriteToggle
              institutionId={university.id}
              initialFavored={favored}
              universityName={content.name}
              strings={{
                favoriteAdd: strings.favoriteAdd,
                favoriteRemove: strings.favoriteRemove,
                favoriteError: strings.favoriteError,
              }}
            />
          ) : null}
        </div>
        <h1 className="pt-page-title">{content.name}</h1>
        <p className="pt-page-lead">{strings.detailLead}</p>
      </header>
      <div className="pt-uni-overview">
        <p>{content.overview}</p>
        <ExternalLink href={content.websiteUrl} newTab={strings.newTab}>
          {strings.website}
        </ExternalLink>
      </div>
      {consultation !== null ? (
        <ConsultationRequest
          institutionId={university.id}
          initialOpenRequest={consultation.initialOpenRequest}
          strings={consultation.strings}
        />
      ) : null}
      <section aria-labelledby="portal-university-programs">
        <h2 id="portal-university-programs" className="pt-section-title">
          {strings.programsHeading}
        </h2>
        <div className="pt-program-list">
          {content.programs.map((program) => (
            <Program
              key={program.id}
              program={program}
              selection={selection ? { context: selection, university } : null}
              strings={strings}
              locale={locale}
              now={now}
            />
          ))}
        </div>
      </section>
      <p>
        <ExternalLink href={content.sourceUrl} newTab={strings.newTab}>
          {strings.cardSource}
        </ExternalLink>
      </p>
    </article>
  );
}
