"use client";

import Link from "next/link";

import { PageShell } from "@/components/kit";
import { Button } from "@/components/ui/button";

import { UniversityBack } from "./UniversityBack";
import { UniversityProgramGroups } from "./UniversityProgramGroups";
import { ExternalButton } from "./UniversityProgramSection";
import type { UniversityDetailProps } from "./university-detail-types";

/**
 * Карточка университета в «Новом виде» (порядок 25.11.2026): сначала «Об университете» с фото сбоку, у редактора каталога —
 * город и стоимость для кабинета студента, затем программы и их наборы (у вуза с длинным списком — поиск и группы по уровню,
 * `UniversityProgramGroups`). Чтение и права те же; управление каталогом (бланки, «Предложить обновление») — тихие кнопки в
 * шапке только тому, у кого есть право.
 */
export function UniversityDetailNext({ name, place, programs, overview, websiteUrl, sourceUrl, verified, photo, manage, children }: UniversityDetailProps) {
  return (
    <PageShell
      title={name}
      testId="v3-university-next"
      meta={place}
      back={<UniversityBack href="/universities" label="Все университеты" />}
      actions={manage ? <>
        <Button variant="ghost" asChild><Link href={manage.formsHref}>Бланки университета</Link></Button>
        <Button variant="outline" asChild><Link href={manage.editHref}>Предложить обновление</Link></Button>
      </> : undefined}
    >
      <div className="@container min-w-0">
        <div className="grid min-w-0 gap-4 @4xl:grid-cols-[minmax(0,1fr)_18rem] @4xl:items-start">
          <div className="grid min-w-0 content-start gap-8">
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
      <div className="mt-10 grid min-w-0 gap-4 border-t border-border pt-6">
        <UniversityProgramGroups programs={programs} />
      </div>
    </PageShell>
  );
}
