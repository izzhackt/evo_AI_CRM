import type { Metadata } from "next";
import Link from "next/link";

import { CscaLessonsView } from "@/components/portal/csca/LessonsView";
import { CscaOverview } from "@/components/portal/csca/Overview";
import { SessionPicker } from "@/components/portal/csca/SessionPicker";
import { sessionLabels } from "@/components/portal/csca/session-labels";
import { getLocale } from "@/lib/i18n";
import { getPortalStrings } from "@/lib/portal/i18n";
import { cscaDayLabel } from "@/lib/portal/csca";
import { CSCA_OVERVIEW } from "@/lib/portal/csca-overview";
import { readCscaHome } from "@/lib/portal/csca-source";
import { requireStudentPortalActor } from "@/lib/student-portal-guards";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const strings = getPortalStrings("csca", await getLocale());
  return { title: `${strings.title} · EVO Admissions` };
}

/**
 * «CSCA» (S5.1; разгрузка 03.11.2026 по замечанию пользователя «перегружено,
 * информацию не найдёшь»): заголовок и две вкладки-ссылки, первая и по
 * умолчанию «Об экзамене» — обзор из src/content/csca/overview.json и
 * календарь сессий csca.cn (обзор статичен и виден, даже если занятия не
 * загрузились); «Занятия» (?view=lessons) — следующий шаг, плитки с числами,
 * тесты на время и программа по модулям (learning_track_home_v1).
 */
export default async function CscaHomePage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ view?: string }> }>) {
  const [, locale, home, params] = await Promise.all([
    requireStudentPortalActor(),
    getLocale(),
    readCscaHome().catch(() => null),
    searchParams,
  ]);
  const view = params.view === "lessons" ? "lessons" : "about";
  const strings = getPortalStrings("csca", locale);
  const universities = getPortalStrings("universities", locale);
  const track = home?.modules[0] ?? null;
  const sessionsShown = home !== null && track !== null && home.sessions.length > 0;

  return (
    <main className="pt-page cs-page">
      <header className="cs-head">
        <h1 id="cs-title" className="cs-head-title">{CSCA_OVERVIEW.exam.short}</h1>
        <p className="cs-head-name" lang="en">{CSCA_OVERVIEW.exam.nameEn}</p>
      </header>

      <nav className="cs-tabs" aria-label={strings.tabsLabel}>
        <Link className="cs-tab" href="/portal/csca" aria-current={view === "about" ? "true" : undefined}>
          {strings["tab.about"]}
        </Link>
        <Link className="cs-tab" href="/portal/csca?view=lessons" aria-current={view === "lessons" ? "true" : undefined}>
          {strings["tab.lessons"]}
        </Link>
      </nav>

      {view === "about" ? (
        <CscaOverview
          locale={locale}
          sessionsShown={sessionsShown}
          sessions={home && sessionsShown ? (
            <SessionPicker
              sessions={home.sessions}
              labels={sessionLabels(home.sessions, locale, strings, { serverNow: home.serverNow, today: home.today })}
              verifiedLabel={cscaDayLabel(home.sessions.map((session) => session.verifiedOn).sort().at(-1) ?? home.today, locale, true)}
              initialTarget={home.targetSessionKey}
              today={home.today}
              strings={strings}
            />
          ) : null}
          strings={strings}
          rightsStrings={{
            photoRights: universities.photoRights,
            photoCredit: universities.photoCredit,
            photoCreditSource: universities.photoCreditSource,
            photoCreditOfficial: universities.photoCreditOfficial,
            newTab: universities.newTab,
          }}
        />
      ) : home === null ? (
        <p role="alert" className="pt-alert">{strings.unavailable}</p>
      ) : track === null ? (
        <div className="pt-empty">
          <p className="pt-empty-title">{strings.emptyTitle}</p>
          <p className="pt-empty-body">{strings.emptyBody}</p>
        </div>
      ) : (
        <CscaLessonsView home={home} track={track} locale={locale} strings={strings} />
      )}

      <footer className="cs-own">
        <p>{strings.ownWork}</p>
        {track ? (
          <a className="pt-link" href={track.metadata.syllabus_url} target="_blank" rel="noopener noreferrer">
            {strings.syllabusLink}
          </a>
        ) : null}
      </footer>
    </main>
  );
}
