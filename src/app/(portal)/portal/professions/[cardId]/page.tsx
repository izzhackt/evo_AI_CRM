import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { getLocale } from "@/lib/i18n";
import { formatPortalString, getPortalStrings } from "@/lib/portal/i18n";
import { isLearningUuid } from "@/lib/portal/learning";
import type { ProfessionCard, ResolvedProgramRef } from "@/lib/portal/professions";
import {
  readProfessionCard,
  resolveProfessionPrograms,
} from "@/lib/portal/professions-source";
import { requireStudentPortalActor } from "@/lib/student-portal-guards";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const strings = getPortalStrings("professions", await getLocale());
  return { title: `${strings.cardTitle} — EVO Admissions` };
}

/**
 * Карточка профессии (PORT-4c, план §6 «Профессии»): день/среда/навыки/
 * интересное-сложное/пробное задание/куда учиться. Связи с каталогом
 * резолвятся по institution_photo_key -> content.photoKey; ненайденное
 * честно остаётся текстом без ссылки. Атрибуция O*NET обязательна
 * (CC BY 4.0, конвенция professions-notes).
 */
export default async function ProfessionCardPage({
  params,
}: {
  params: Promise<{ cardId: string }>;
}) {
  const [{ cardId }, actor, locale] = await Promise.all([
    params,
    requireStudentPortalActor(),
    getLocale(),
  ]);
  if (!isLearningUuid(cardId)) notFound();
  const strings = getPortalStrings("professions", locale);

  let card: ProfessionCard | null = null;
  try {
    card = await readProfessionCard(cardId);
  } catch {
    card = null;
  }
  if (card === null) notFound();
  const body = card.body;

  // Сбой резолвера каталога не роняет карточку: направления показываются
  // текстом, ссылки честно отсутствуют.
  let resolved: ResolvedProgramRef[] | null = null;
  try {
    resolved = await resolveProfessionPrograms(actor, body.linked_program_refs);
  } catch {
    resolved = null;
  }

  const ky = locale === "ky";
  const lists: { heading: string; items: string[] }[] = [
    { heading: strings.skillsHeading, items: ky ? body.skills_ky : body.skills_ru },
    { heading: strings.interestingHeading, items: ky ? body.interesting_ky : body.interesting_ru },
    { heading: strings.hardHeading, items: ky ? body.hard_ky : body.hard_ru },
    {
      heading: strings.studyHeading,
      items: ky ? body.study_directions_ky : body.study_directions_ru,
    },
  ];

  return (
    <main className="pt-page">
      <header className="pt-page-header">
        <p className="pt-page-kicker">
          <Link className="pt-link" href="/portal/professions">{strings.backToGrid}</Link>
        </p>
        <h1 className="pt-page-title">{ky ? body.title_ky : body.title_ru}</h1>
        <p className="pt-chip-row">
          {body.orvis_scales.map((scale) => (
            <span key={scale} className="pt-chip">{strings[`scale.${scale}`]}</span>
          ))}
        </p>
      </header>

      <div className="pt-prof-sections">
        <section className="pt-prof-section">
          <h2 className="pt-section-title">{strings.dayHeading}</h2>
          <p className="pt-prof-text">{ky ? body.day_in_work_ky : body.day_in_work_ru}</p>
        </section>
        <section className="pt-prof-section">
          <h2 className="pt-section-title">{strings.environmentHeading}</h2>
          <p className="pt-prof-text">{ky ? body.environment_ky : body.environment_ru}</p>
        </section>
        {lists.map((listSection) => (
          <section key={listSection.heading} className="pt-prof-section">
            <h2 className="pt-section-title">{listSection.heading}</h2>
            <ul className="pt-prof-list">
              {listSection.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        ))}
        <section className="pt-prof-section">
          <h2 className="pt-section-title">{strings.trialHeading}</h2>
          <p className="pt-prof-text">{ky ? body.trial_task_ky : body.trial_task_ru}</p>
        </section>

        <section className="pt-prof-section">
          <h2 className="pt-section-title">{strings.programsHeading}</h2>
          <ul className="pt-prof-programs">
            {(resolved ?? body.linked_program_refs.map((ref) => ({
              ref,
              institutionId: null,
              institutionName: null,
              programFound: false,
            }))).map((entry) => (
              <li key={`${entry.ref.institution_photo_key}-${entry.ref.program_hint}`}>
                <p className="pt-prof-program-title" lang="en">
                  {formatPortalString(strings.programLabel, { title: entry.ref.program_hint })}
                </p>
                {entry.institutionId ? (
                  <p>
                    <Link className="pt-link" href={`/portal/universities/${entry.institutionId}`}>
                      {strings.openUniversity}
                      {entry.institutionName ? <> · <span lang="en">{entry.institutionName}</span></> : null}
                    </Link>
                    {!entry.programFound ? (
                      <span className="pt-prof-program-note"> {strings.programMissing}</span>
                    ) : null}
                  </p>
                ) : (
                  <p className="pt-prof-program-note">{strings.universityMissing}</p>
                )}
              </li>
            ))}
          </ul>
          <p>
            <Link className="pt-btn-ghost" href="/portal/tests/career">{strings.testEntry}</Link>
          </p>
        </section>

        <section className="pt-prof-section pt-prof-attribution">
          <h2 className="pt-section-title">{strings.sourcesHeading}</h2>
          <p className="pt-prof-text">{strings.attribution}</p>
          <ul className="pt-prof-list">
            {body.sources.map((source) => (
              <li key={source}>
                <a className="pt-link" href={source} target="_blank" rel="noreferrer">
                  {source}
                </a>
              </li>
            ))}
            <li>
              <a
                className="pt-link"
                href="https://creativecommons.org/licenses/by/4.0/"
                target="_blank"
                rel="noreferrer"
              >
                {strings.attributionLink}
              </a>
            </li>
          </ul>
        </section>
      </div>
    </main>
  );
}
