import Link from "next/link";

import { Button } from "@/components/ui/button";

import { NamedCard } from "./NamedCard";
import { FeedOverflow } from "./FeedOverflow";

/** Сколько последних строк видно на странице: остальные уходят в панель «Ещё N». */
export const FEED_SHOWN_NEXT = 5;

/**
 * «Лента» карточки лида и дела: заметка в одну строку, последние записи, «Ещё N» - панелью, страницы заметок.
 * Строки приходят готовыми (`FeedRow`); откуда они - решает вид лида или дела, здесь только раскладка.
 */
export function FeedCard({
  id,
  titleId,
  testId,
  listTestId,
  notices,
  composer,
  extras,
  rows,
  empty,
  footer,
}: Readonly<{
  id?: string;
  titleId?: string;
  testId: string;
  listTestId: string;
  /** Сбои чтения (звонки, журнал): остаются на виду над лентой. */
  notices?: React.ReactNode;
  composer?: React.ReactNode;
  /** Заявки с сайта и другое, что стоит над строками. */
  extras?: React.ReactNode;
  rows: readonly React.ReactNode[];
  empty: string;
  /** Страницы заметок и пометка о неполном списке звонков. */
  footer?: React.ReactNode;
}>) {
  const shown = rows.slice(0, FEED_SHOWN_NEXT);
  const rest = rows.slice(FEED_SHOWN_NEXT);
  return (
    <NamedCard title="Лента" id={id} titleId={titleId} testId={testId}>
      <div className="grid grid-cols-1 gap-3">
        {notices}
        {composer}
        {extras}
        {rows.length > 0 ? (
          <ol className="divide-y divide-border border-t border-border" data-testid={listTestId}>{shown}</ol>
        ) : (
          <p className="border-t border-border pt-3 t-body-compact text-fg-3">{empty}</p>
        )}
        {rest.length > 0 ? <FeedOverflow count={rest.length} title="Лента">{rest}</FeedOverflow> : null}
        {footer}
      </div>
    </NamedCard>
  );
}

/** Страницы заметок: «К последним» и «Ранее» - те же адреса, что у прежней ленты. */
export function FeedPager({ olderHref, latestHref }: Readonly<{ olderHref: string | null; latestHref: string | null }>) {
  if (!olderHref && !latestHref) return null;
  return (
    <nav aria-label="Страницы заметок" className="flex flex-wrap gap-x-2 border-t border-border pt-1">
      {latestHref ? <Button asChild variant="ghost"><Link href={latestHref} prefetch={false}>К последним</Link></Button> : null}
      {olderHref ? <Button asChild variant="ghost"><Link href={olderHref} prefetch={false}>Ранее</Link></Button> : null}
    </nav>
  );
}
