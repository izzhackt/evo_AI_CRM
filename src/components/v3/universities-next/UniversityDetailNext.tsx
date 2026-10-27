"use client";

import Link from "next/link";

import { ExternalLinkIcon } from "lucide-react";

import { KeyFacts, PageShell } from "@/components/kit";
import { Button } from "@/components/ui/button";

import { UniversityBack } from "./UniversityBack";
import { UniversityIntakes } from "./UniversityIntakes";
import type { UniversityDetailProps } from "./university-detail-types";

function ExternalButton({ href, children }: Readonly<{ href: string; children: string }>) {
  return (
    <Button variant="ghost" asChild>
      <a href={href} target="_blank" rel="noopener noreferrer">{children}<ExternalLinkIcon aria-hidden="true" /><span className="sr-only"> (в новой вкладке)</span></a>
    </Button>
  );
}

/**
 * Карточка университета в «Новом виде»: сначала программы и их наборы (каждая — своя карточка со срок-таблицей), рядом
 * фото с авторством, ниже «Об университете» и, у редактора каталога, прежняя панель города и стоимости. Чтение и права те же;
 * управление каталогом (бланки, «Предложить обновление») — тихие кнопки в шапке только тому, у кого есть право.
 */
export function UniversityDetailNext({ name, place, programs, overview, websiteUrl, sourceUrl, verified, photo, manage, children }: UniversityDetailProps) {
  return (
    <PageShell
      title={name}
      testId="v3-university-next"
      meta={place}
      back={<UniversityBack href="/v3/universities" label="Все университеты" />}
      actions={manage ? <>
        <Button variant="ghost" asChild><Link href={manage.formsHref}>Бланки университета</Link></Button>
        <Button variant="outline" asChild><Link href={manage.editHref}>Предложить обновление</Link></Button>
      </> : undefined}
    >
      <div className="@container min-w-0">
        <div className="grid min-w-0 gap-4 @4xl:grid-cols-[minmax(0,1fr)_18rem] @4xl:items-start">
          <div className="grid min-w-0 gap-8">
            {programs.map((program) => (
              <section key={program.id} id={`program-${program.id}`} aria-labelledby={`program-title-${program.id}`} data-program={program.id} className="grid min-w-0 scroll-mt-4 gap-3">
                <div className="flex flex-wrap items-center justify-between gap-x-4">
                  <h2 id={`program-title-${program.id}`} className="t-section min-w-0 text-fg">{program.title}</h2>
                  <ExternalButton href={program.sourceUrl}>Страница программы</ExternalButton>
                </div>
                <KeyFacts columns={3} facts={[{ label: "Уровень", value: program.level }, { label: "Длительность", value: program.duration }, { label: "Язык обучения", value: program.language }]} />
                <p className="max-w-[70ch] t-body-compact text-fg-2">{program.summary}</p>
                {program.intakes.length ? <UniversityIntakes title={program.title} intakes={program.intakes} /> : null}
              </section>
            ))}
            <section aria-labelledby="university-about" className="grid min-w-0 gap-2">
              <h2 id="university-about" className="t-section text-fg">Об университете</h2>
              <p className="max-w-[70ch] t-body text-fg">{overview}</p>
              <div className="flex flex-wrap items-center gap-x-4">
                <ExternalButton href={websiteUrl}>Сайт учебного заведения</ExternalButton>
                <ExternalButton href={sourceUrl}>Основной источник карточки</ExternalButton>
                <span className="t-meta text-fg-3">Карточка проверена <time dateTime={verified.dateTime} className="font-mono tabular-nums">{verified.text}</time></span>
              </div>
            </section>
          </div>
          <aside aria-label="Фото кампуса" className="min-w-0 @max-4xl:max-w-80">{photo}</aside>
        </div>
      </div>
      {children}
    </PageShell>
  );
}
