import { isPlatformApplicationCountryCode } from "@/lib/platform-application-contract";
import { SelectionAction, type StudentSelectionContext } from "./SelectionAction";

import type { Locale } from "@/lib/i18n-data";
import {
  type PublishedUniversity,
  type UniversityIntake,
  type UniversityLevel,
  type UniversityProgram,
} from "@/lib/platform-university-catalog";
import { formatPortalString, type PortalStrings } from "@/lib/portal/i18n";
import { PROGRAM_DURATIONS, PROGRAM_FIELDS, programFacets, type ProgramFacets } from "@/lib/portal/program-facets";
import type { UniversityCosts } from "@/lib/portal/university-index";
import {
  universityDateLabel,
  universityIntakeStatusKey,
  universityLevelKey,
  universityLevels,
  universityMonthLabel,
} from "@/lib/portal/universities";

import {
  ConsultationRequest,
  type ConsultationRequestStrings,
} from "@/components/portal/consultation/ConsultationRequest";
import type { ConsultationReceipt } from "@/lib/portal/consultation";

import { IntentPrefetchLink } from "@/components/IntentPrefetchLink";

import { CostTable } from "./CostTable";
import { FavoriteToggle } from "./FavoriteToggle";
import { PhotoFigure } from "./PhotoFigure";
import { ProgramList } from "./ProgramList";
import { ProgramCard } from "./ProgramCard";
import { Breadcrumbs, type Crumb } from "./Places";

/**
 * Карточка вуза в стиле «Атлас» (PORT-3a, S3): путь «Университеты › Страна ›
 * Город», фото-герой, программы с наборами и блок «Стоимость», только когда
 * у вуза есть опубликованные строки (нет данных, нет блока). Состав фактов
 * прежней карточки сохранён: обзор, сайт, программы, интейки с датами и
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
  facets,
  strings,
  locale,
  now,
  selection,
}: {
  program: UniversityProgram;
  facets: ProgramFacets;
  selection: ProgramSelection;
  strings: Strings;
  locale: Locale;
  now: Date;
}) {
  // Uncertain intakes remain visible with an explicit, truthful status.
  const intakes = program.intakes;
  // Карточка подбора (10.11.2026): длительность и наборы на карточке, всё остальное - в окне программы.
  return (
    <ProgramCard
      field={facets.field}
      fieldLabel={strings[`programField.${facets.field}`]}
      level={strings[universityLevelKey(program.level)]}
      title={program.title}
      duration={program.duration ?? null}
      starts={[...new Set(intakes.map((intake) => intake.label))].join(" · ")}
      moreLabel={strings.programMore}
      closeLabel={strings.mapCloseCard}
    >
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
    </ProgramCard>
  );
}

/** Варианты полей подбора, которые есть у вуза: уровни по шкале, направления и длительности по порядку, месяцы по году. */
function programOptions(facets: readonly ProgramFacets[], levels: readonly UniversityLevel[], strings: Strings, locale: Locale) {
  const month = new Intl.DateTimeFormat(locale === "ky" ? "ky" : "ru", { month: "long", timeZone: "UTC" });
  const months = [...new Set(facets.flatMap((item) => item.months))].sort((a, b) => a - b);
  return {
    level: levels.map((level) => ({ value: level, label: strings[universityLevelKey(level)] })),
    field: PROGRAM_FIELDS.filter((field) => facets.some((item) => item.field === field))
      .map((field) => ({ value: field, label: strings[`programField.${field}`] })),
    month: months.map((value) => {
      const label = month.format(new Date(Date.UTC(2026, value - 1, 15)));
      return { value: String(value), label: label.charAt(0).toUpperCase() + label.slice(1) };
    }),
    duration: PROGRAM_DURATIONS.filter((duration) => facets.some((item) => item.duration === duration))
      .map((duration) => ({ value: duration, label: strings[`programDuration.${duration}`] })),
  };
}

/** «1 программа», «3 программы», «64 программы» по правилам склонения словаря. */
function programCountLabel(count: number, strings: Strings, locale: Locale): string {
  const form = new Intl.PluralRules(locale === "ky" ? "ky" : "ru").select(count);
  return formatPortalString(strings[`count.program.${form === "one" ? "one" : form === "few" ? "few" : "many"}`], { count: String(count) });
}

export function UniversityDetailView({
  university,
  crumbs,
  costs,
  strings,
  locale,
  now,
  favored = null,
  consultation = null,
  writeEvo = null,
  selection = null,
}: {
  university: PublishedUniversity;
  selection?: StudentSelectionContext | null;
  /** Путь по каталогу: Университеты › Страна › Город (город, если есть). */
  crumbs: readonly Crumb[];
  /** null: опубликованных строк стоимости нет, блока нет. */
  costs: UniversityCosts | null;
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
  /**
   * Клиент с сопровождением (#1356): вместо запроса консультации один вход «Написать EVO» — чат «Входящих».
   * Студенту без сопровождения чата нет, ему остаётся запрос консультации.
   */
  writeEvo?: Readonly<{ href: string; label: string }> | null;
}) {
  const content = university.content;
  const programs = content.programs.map((program) => ({ program, facets: programFacets(program) }));
  return (
    <article className="pt-uni-detail">
      <Breadcrumbs crumbs={crumbs} label={strings.breadcrumbAria} />
      <header className="pt-uni-hero">
        <PhotoFigure content={content} strings={strings} />
        <div className="pt-uni-hero-head">
          <h1 className="pt-page-title">{content.name}</h1>
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
      {writeEvo !== null ? (
        <p className="pt-uni-write">
          <IntentPrefetchLink className="pt-btn-ghost" href={writeEvo.href}>{writeEvo.label}</IntentPrefetchLink>
        </p>
      ) : null}
      {costs !== null ? (
        <CostTable costs={costs} programs={content.programs} strings={strings} locale={locale} newTab={strings.newTab} />
      ) : null}
      <section aria-labelledby="portal-university-programs">
        <h2 id="portal-university-programs" className="pt-section-title">
          {strings.programsHeading}
        </h2>
        {selection && !selection.canSelect && selection.bindings !== null ? (
          <p className="pt-prep-note">{selection.strings.caseIneligible}</p>
        ) : null}
        <ProgramList
          items={programs.map(({ program, facets }) => ({
            id: program.id,
            level: program.level,
            field: facets.field,
            months: facets.months,
            duration: facets.duration,
            search: `${program.title} ${program.summary}`,
            node: (
              <Program
                program={program}
                facets={facets}
                selection={selection ? { context: selection, university } : null}
                strings={strings}
                locale={locale}
                now={now}
              />
            ),
          }))}
          options={programOptions(programs.map(({ facets }) => facets), universityLevels(content), strings, locale)}
          totalLabel={programCountLabel(programs.length, strings, locale)}
          strings={strings}
        />
      </section>
      <p>
        <ExternalLink href={content.sourceUrl} newTab={strings.newTab}>
          {strings.cardSource}
        </ExternalLink>
      </p>
    </article>
  );
}
