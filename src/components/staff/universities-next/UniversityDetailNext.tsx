"use client";

import Link from "next/link";

import { PageShell } from "@/components/kit";

import { UniversityBack } from "./UniversityBack";
import { UniversityDetailTabs } from "./UniversityDetailTabs";
import { UniversityProgramGroups } from "./UniversityProgramGroups";
import { ExternalButton } from "./UniversityProgramSection";
import type { UniversityDetailProps } from "./university-detail-types";

/**
 * Карточка университета в «Новом виде» (вид 25.11.2026). Сверху — карточка «Об университете»: фото сбоку, описание, ссылки на
 * сайт и источник, день проверки. Ниже — программы (у вуза с длинным списком — поиск и свёрнутые группы по уровню,
 * `UniversityProgramGroups`). У редактора каталога программы и «Город и стоимость» — две вкладки на месте
 * (`UniversityDetailTabs`), а не панель под всей страницей. Чтение и права те же; управление каталогом (бланки,
 * «Предложить обновление») — тихие кнопки в шапке только тому, у кого есть право.
 */
const QUIET = "inline-flex min-h-11 items-center t-label text-fg-2 underline underline-offset-4 hover:text-fg";

export function UniversityDetailNext({ name, place, programs, overview, websiteUrl, sourceUrl, verified, photo, manage, children }: UniversityDetailProps) {
  const list = <UniversityProgramGroups programs={programs} titled={!children} />;
  return (
    <PageShell
      title={name}
      testId="v3-university-next"
      meta={place}
      back={<UniversityBack href="/universities" label="Все университеты" />}
      actions={manage ? (
        // Управление каталогом — редкая задача редактора: тихие ссылки в одну строку, как на списке «Университетов».
        <div className="flex flex-wrap gap-x-4 max-sm:-my-2">
          <Link href={manage.formsHref} className={QUIET}>Бланки университета</Link>
          <Link href={manage.editHref} className={QUIET}>Предложить обновление</Link>
        </div>
      ) : undefined}
    >
      {/* Фото кампуса — обложка карточки во всю ширину, с авторством под ним; без фото карточка начинается с текста. */}
      <section aria-labelledby="university-about" className="@container min-w-0 overflow-hidden rounded-card border border-border bg-surface">
        <aside aria-label="Фото кампуса" className="hidden min-w-0 has-[.v3-uni-photo]:block">{photo}</aside>
        <div className="grid min-w-0 gap-5 p-4 sm:p-5">
          <div className="grid min-w-0 content-start gap-2">
            <h2 id="university-about" className="t-section text-fg">Об университете</h2>
            <p className="max-w-[70ch] t-body text-fg">{overview}</p>
            <div className="-ms-4 flex flex-wrap items-center gap-x-1">
              <ExternalButton href={websiteUrl}>Сайт учебного заведения</ExternalButton>
              <ExternalButton href={sourceUrl}>Основной источник карточки</ExternalButton>
            </div>
            <p className="t-meta text-fg-3">Карточка проверена <time dateTime={verified.dateTime} className="font-mono tabular-nums">{verified.text}</time></p>
          </div>
        </div>
      </section>
      {children ? <UniversityDetailTabs programsCount={programs.length} programs={list} geography={children} /> : list}
    </PageShell>
  );
}
