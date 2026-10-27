import Link from "next/link";
import { Suspense } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

import { HandoffStripBlock } from "../ProfileSalesTransition";
import type { LeadNextSource } from "../LeadWorkParts";
import { FeedCard, FeedPager } from "./FeedCard";
import { LeadSideFacts, LeadSideFactsLoader } from "./LeadSideFacts";
import { NamedCard } from "./NamedCard";

/**
 * «Передача»: договор, первый платёж, запись в отчёте, куратор, принято - полоса та же, что в прежнем виде.
 * «Изменить» - справа у заголовка; пока ничего не подтверждено, действие - кнопка под строкой состояния.
 */
function HandoffCard({ source }: Readonly<{ source: LeadNextSource }>) {
  const { handoff } = source;
  const edit = handoff.edit;
  const link = edit ? (
    <Link href={edit.href} aria-label={edit.ariaLabel} data-testid="v3-handoff-edit">{edit.label}</Link>
  ) : null;
  return (
    <NamedCard
      title="Передача"
      id="lead-handoff"
      testId="v3-lead-handoff"
      actions={link && !handoff.empty ? <Button asChild variant="ghost">{link}</Button> : null}
    >
      {handoff.empty ? (
        <div className="grid gap-3">
          <p className="t-body-compact text-fg-2" data-testid="v3-handoff-empty">договор и первый платёж не подтверждены</p>
          {link ? <Button asChild variant="outline" className="w-fit">{link}</Button> : null}
        </div>
      ) : (
        <HandoffStripBlock gate={handoff.gate} view={handoff.view} className="space-y-3" summary={handoff.summary} />
      )}
    </NamedCard>
  );
}

/** «Лента»: заметка, заявки с сайта, последние записи и звонки; остальное - панелью «Ещё N». */
function LeadFeedCard({ source }: Readonly<{ source: LeadNextSource }>) {
  const { feed } = source;
  return (
    <FeedCard
      titleId="lead-feed-title"
      testId="v3-lead-feed"
      listTestId="v3-lead-feed-items"
      notices={feed.callsUnavailable}
      composer={feed.composer}
      extras={feed.submissions}
      rows={feed.rows}
      empty="Заметок пока нет."
      footer={<>
        {feed.callsShown !== null ? (
          <p className="border-t border-border pt-3 t-meta text-fg-2" data-testid="v3-calls-more">Показаны последние {feed.callsShown} звонков.</p>
        ) : null}
        <FeedPager olderHref={feed.olderHref} latestHref={feed.latestHref} />
      </>}
    />
  );
}

/**
 * «Обзор» лида в «Новом виде»: справа «Сведения» и «Передача», слева «Лента» и «Данные лида» (группы правки -
 * прежние формы, свёрнутые). До 1280 px колонки друг под другом в порядке прежнего вида: сведения, передача,
 * лента, группы.
 */
export function LeadNextOverview({ source }: Readonly<{ source: LeadNextSource }>) {
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]" data-testid="v3-lead-overview">
      <div className="grid min-w-0 grid-cols-1 content-start gap-4 xl:col-start-2 xl:row-start-1" data-testid="v3-lead-side">
        {source.facts.hasInterest ? (
          <Suspense fallback={<Skeleton className="h-40 w-full rounded-card" />}>
            <LeadSideFactsLoader source={source} />
          </Suspense>
        ) : <LeadSideFacts source={source} interest={null} />}
        <HandoffCard source={source} />
      </div>
      <div className="grid min-w-0 grid-cols-1 content-start gap-4 xl:col-start-1 xl:row-start-1">
        <LeadFeedCard source={source} />
        <NamedCard title="Данные лида" id="lead-edit" testId="v3-lead-edit" className="@container">{source.groups}</NamedCard>
      </div>
    </div>
  );
}
