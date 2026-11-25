"use client";

import Link from "next/link";

import { MoreHorizontalIcon } from "lucide-react";

import { PageShell } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

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
export function UniversityDetailNext({ name, place, programs, overview, websiteUrl, sourceUrl, verified, photo, manage, children }: UniversityDetailProps) {
  const list = <UniversityProgramGroups programs={programs} titled={!children} />;
  return (
    <PageShell
      title={name}
      testId="v3-university-next"
      meta={place}
      back={<UniversityBack href="/universities" label="Все университеты" />}
      actions={manage ? (
        // Управление каталогом — редкая задача редактора: одна кнопка «⋯» рядом с названием, а не строка ссылок под ним.
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" aria-label="Действия с карточкой университета" data-testid="university-manage-menu"><MoreHorizontalIcon aria-hidden="true" /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuItem asChild><Link href={manage.formsHref}>Бланки университета</Link></DropdownMenuItem>
            <DropdownMenuItem asChild><Link href={manage.editHref}>Предложить обновление</Link></DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
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
              <ExternalButton href={websiteUrl}>Официальный сайт</ExternalButton>
              <ExternalButton href={sourceUrl}>Источник данных</ExternalButton>
            </div>
            <p className="t-meta text-fg-3">Данные проверены <time dateTime={verified.dateTime} className="font-mono tabular-nums">{verified.text}</time></p>
          </div>
        </div>
      </section>
      {children ? <UniversityDetailTabs programsCount={programs.length} programs={list} geography={children} /> : list}
    </PageShell>
  );
}
