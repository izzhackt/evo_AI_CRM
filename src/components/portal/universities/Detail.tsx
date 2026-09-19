import Link from "next/link";

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

import { PhotoFigure } from "./PhotoFigure";

/**
 * Карточка вуза в стиле «Атлас» (PORT-3a): фото-герой с атрибуцией, страна и
 * город, программы с наборами. Состав фактов полностью повторяет прежнюю
 * портальную карточку: обзор, сайт, программы, интейки с датами и
 * источниками, основной источник карточки.
 */

type Strings = PortalStrings<"universities">;

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
}: {
  intake: UniversityIntake;
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
      <ExternalLink href={intake.sourceUrl} newTab={strings.newTab}>
        {strings.intakeSource}
      </ExternalLink>
    </li>
  );
}

function Program({
  program,
  strings,
  locale,
  now,
}: {
  program: UniversityProgram;
  strings: Strings;
  locale: Locale;
  now: Date;
}) {
  // Как и в прежней карточке: непроверенные интейки не показываются как факт.
  const intakes = program.intakes.filter(
    (intake) => intake.status !== "unknown" && intake.status !== "needs_reconfirmation",
  );
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
            <Intake key={index} intake={intake} strings={strings} locale={locale} now={now} />
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
}: {
  university: PublishedUniversity;
  base: string;
  strings: Strings;
  locale: Locale;
  now: Date;
}) {
  const content = university.content;
  return (
    <article className="pt-uni-detail">
      <p>
        <Link href={base} className="pt-btn-ghost">← {strings.backToCatalog}</Link>
      </p>
      <header className="pt-uni-hero">
        <PhotoFigure content={content} large strings={strings} />
        <p className="pt-page-kicker">
          {universityCountryLabel(content.country, locale)}
          {content.city ? ` · ${content.city}` : ""}
        </p>
        <h1 className="pt-page-title">{content.name}</h1>
        <p className="pt-page-lead">{strings.detailLead}</p>
      </header>
      <div className="pt-uni-overview">
        <p>{content.overview}</p>
        <ExternalLink href={content.websiteUrl} newTab={strings.newTab}>
          {strings.website}
        </ExternalLink>
      </div>
      <section aria-labelledby="portal-university-programs">
        <h2 id="portal-university-programs" className="pt-section-title">
          {strings.programsHeading}
        </h2>
        <div className="pt-program-list">
          {content.programs.map((program) => (
            <Program
              key={program.id}
              program={program}
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
