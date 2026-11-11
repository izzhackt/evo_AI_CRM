import { ChevronLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ProfessionDetailMore } from "@/components/portal/professions/ProfessionDetailMore";
import { ProfessionProgramsTable } from "@/components/portal/professions/ProfessionProgramsTable";
import { getLocale } from "@/lib/i18n";
import { getPortalStrings } from "@/lib/portal/i18n";
import { isLearningUuid } from "@/lib/portal/learning";
import type { ProfessionProgramRow } from "@/lib/portal/profession-guide";
import type { ProfessionCard } from "@/lib/portal/professions";
import { readProfessionCard, readProfessionPrograms } from "@/lib/portal/professions-source";
import { requireStudentPortalActor } from "@/lib/student-portal-guards";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const strings = getPortalStrings("professions", await getLocale());
  return { title: `${strings.cardTitle} — EVO Admissions` };
}

/**
 * Страница профессии (PORT-4c; вид по драфту владельца 10.11.2026, «Вести к
 * вузам»): что это за работа, школьные предметы и навыки, ниже программы
 * каталога EVO с ценой, ближайшим набором и избранным. Остальные разделы
 * карточки — под «Подробнее о работе». Атрибуция O*NET обязательна
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

  // Сбой каталога не роняет страницу: направления остаются текстом.
  let rows: ProfessionProgramRow[] | null = null;
  try {
    rows = await readProfessionPrograms(actor, body.linked_program_refs, new Date());
  } catch {
    rows = null;
  }

  const ky = locale === "ky";
  const subjects = ky ? body.school_subjects_ky : body.school_subjects_ru;
  const panels = [
    ...(subjects ? [{ heading: strings.subjectsHeading, items: subjects }] : []),
    { heading: strings.skillsHeading, items: ky ? body.skills_ky : body.skills_ru },
  ];

  return (
    <main className="pt-page pt-prof-page">
      <header className="pt-page-header pt-prof-detail-head">
        <p className="pt-prof-back">
          <Link className="pt-prof-back-link" href="/portal/professions">
            <ChevronLeft size={18} aria-hidden="true" />
            {strings.backToGrid}
          </Link>
        </p>
        <h1 className="pt-page-title">{ky ? body.title_ky : body.title_ru}</h1>
        <p className="pt-chip-row">
          {body.orvis_scales.map((scale) => (
            <span key={scale} className="pt-chip">{strings[`scale.${scale}`]}</span>
          ))}
        </p>
        {(ky ? body.summary_ky : body.summary_ru) ? (
          <p className="pt-prof-lead">{ky ? body.summary_ky : body.summary_ru}</p>
        ) : null}
        <p className="pt-prof-day">{ky ? body.day_in_work_ky : body.day_in_work_ru}</p>
      </header>

      <div className="pt-prof-panels">
        {panels.map((panel) => (
          <section key={panel.heading} className="pt-prof-panel">
            <h2 className="pt-prof-panel-title">{panel.heading}</h2>
            <ul className="pt-prof-panel-list">
              {panel.items.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </section>
        ))}
      </div>

      <section className="pt-prof-block" aria-labelledby="pt-prof-study-title">
        <h2 id="pt-prof-study-title" className="pt-prof-block-title">{strings.studyInEvoHeading}</h2>
        {rows ? (
          <ProfessionProgramsTable rows={rows} locale={locale} strings={strings} />
        ) : (
          <ul className="pt-prof-panel-list pt-prof-directions">
            {(ky ? body.study_directions_ky : body.study_directions_ru).map((item) => <li key={item}>{item}</li>)}
          </ul>
        )}
      </section>

      <ProfessionDetailMore body={body} locale={locale} strings={strings} />
    </main>
  );
}
