"use client";

import Link from "next/link";

import { WidgetCard } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icons";

import { ListSearch } from "../list-next/ListSearch";
import type { ManageIndexProps } from "./manage-index-types";

/**
 * Индекс «Управления каталогом»: поиск по названию, «На проверке» (черновики страницами сервера) и подготовленные сведения из
 * открытых источников по странам, свёрнутыми группами. Те же чтения, права и адреса; пояснение про подготовленные сведения — за «?».
 */
export function ManageIndexNext({ query, resetHref, drafts, batchHref, groups, groupsEmptyText }: ManageIndexProps) {
  return (
    <div className="grid min-w-0 gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <ListSearch action="/v3/universities/manage" value={query} placeholder="Название университета" label="Название университета" hidden={{}} maxLength={200} />
        {resetHref ? <Button variant="ghost" asChild><Link href={resetHref}>Сбросить</Link></Button> : null}
      </div>
      <WidgetCard title="На проверке">
        {drafts === null ? (
          <p role="alert" className="t-body-compact text-danger">Не удалось загрузить черновики. Обновите страницу, чтобы повторить загрузку.</p>
        ) : (
          <div className="grid gap-3">
            {drafts.rows.length ? (
              <ul className="divide-y divide-border">
                {drafts.rows.map((draft) => (
                  <li key={draft.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2">
                    <div className="min-w-0 break-words"><p className="t-item text-fg">{draft.name}</p><p className="t-meta text-fg-2">На основе опубликованной версии {draft.baseVersion}</p></div>
                    <Button variant="outline" asChild><Link href={draft.href}>Проверить<span className="sr-only">: {draft.name}</span></Link></Button>
                  </li>
                ))}
              </ul>
            ) : <p role="status" className="t-body-compact text-fg-2">{drafts.emptyText}</p>}
            {drafts.firstHref || drafts.nextHref ? (
              <nav aria-label="Страницы черновиков" className="flex flex-wrap gap-2">
                {drafts.firstHref ? <Button variant="outline" asChild><Link href={drafts.firstHref}>К началу списка</Link></Button> : null}
                {drafts.nextHref ? <Button variant="outline" asChild><Link href={drafts.nextHref}>Следующие черновики</Link></Button> : null}
              </nav>
            ) : null}
          </div>
        )}
      </WidgetCard>
      <WidgetCard
        title="Подготовленные сведения из открытых источников"
        help="Исходные материалы для проверки, не опубликованные записи; они не означают партнёрство с EVO. Для опубликованного вуза: «Предложить обновление» в его карточке."
        actions={<Button variant="outline" asChild><Link href={batchHref}>Проверить и опубликовать пакет</Link></Button>}
      >
        {groups.length ? (
          <div className="divide-y divide-border" data-testid="manage-template-groups">
            {groups.map((group) => (
              <details key={group.code} open={Boolean(query)} className="group">
                <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 t-item text-fg [&::-webkit-details-marker]:hidden">
                  <Icon name="chevron-right" size={16} className="shrink-0 text-fg-3 transition-transform group-open:rotate-90 motion-reduce:transition-none" />{group.label}
                  <span className="t-body-compact tabular-nums text-fg-3">{group.items.length}</span>
                </summary>
                <ul className="divide-y divide-border ps-6">
                  {group.items.map((item) => (
                    <li key={item.key} className="min-w-0">
                      <Link className="flex min-h-11 items-center justify-between gap-3 break-words t-body-compact text-fg hover:underline hover:underline-offset-4" href={item.href}>
                        {item.name}<span className="shrink-0 t-label text-fg-2">Подготовить</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </div>
        ) : <p role="status" className="t-body-compact text-fg-2">{groupsEmptyText}</p>}
      </WidgetCard>
    </div>
  );
}
