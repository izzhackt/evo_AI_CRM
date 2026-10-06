import Link from "next/link";

import { Icon } from "@/components/icons";
import { QueueViewTabs } from "@/components/v3/queue/QueueViewTabs";
import { aiAgentHref, aiDateTime, type AiReviewFilter } from "@/lib/v3/ai-agent";
import {
  aiCropHref,
  aiReviewErrorCopy,
  type AiReviewItem,
  type AiReviewList,
} from "@/lib/v3/ai-agent-knowledge";
import type { AiRead } from "@/lib/v3/ai-agent-source";

import { AiUnavailable } from "./AiAgentViews";
import { AiReviewItemActions } from "./AiReviewItemActions";

/**
 * «Лист сверки» (план §7): числа из сканов, которые ни одно чтение не
 * подтвердило уверенно. У пункта — вырезка строки, три прочтения
 * («Первое чтение» — Tesseract, «Второе чтение» — Gemini vision, «Проверка
 * фрагмента» — арбитр) и предложенное значение. Пока пункт открыт, документ
 * уже ищется, а ответы помечают это число. Молча цифра не меняется никогда.
 */
function Reading({ label, value, meta, strong = false }: Readonly<{ label: string; value: string | null; meta?: string | null; strong?: boolean }>) {
  return (
    <>
      <dt className="t-meta text-fg-3">{label}</dt>
      <dd className={`min-w-0 break-words font-mono tabular-nums ${strong ? "t-item font-semibold text-fg" : "t-body-compact text-fg-2"}`}>
        {value ?? <span className="font-sans text-fg-3">—</span>}
        {meta ? <span className="block font-sans t-meta font-normal text-fg-3 xl:ml-2 xl:inline">{meta}</span> : null}
      </dd>
    </>
  );
}

function ReviewRow({ item, requestId, canManage }: Readonly<{ item: AiReviewItem; requestId: string; canManage: boolean }>) {
  const place = item.sheetName ? `лист «${item.sheetName}»` : `стр. ${item.pageNo}`;
  const error = item.status === "open" ? aiReviewErrorCopy(item.errorCode) : null;
  return (
    <li className="v3-ai-review-row" data-testid="v3-ai-review-item" data-status={item.status}>
      <div className="min-w-0 space-y-1.5">
        {item.hasCrop ? (
          <div className="v3-ai-crop">
            {/* eslint-disable-next-line @next/next/no-img-element -- приватная вырезка через маршрут CRM */}
            <img src={aiCropHref(item.documentId, item.id)} alt={`Вырезка: ${place}, «${item.documentTitle}»`} loading="lazy" />
          </div>
        ) : (
          <p className="v3-ai-crop t-meta text-fg-3">Вырезки нет</p>
        )}
        <p className="t-meta text-fg-3">
          <Link href={aiAgentHref("documents", { document: item.documentId, page: item.pageNo })} className="text-fg-2 underline decoration-border-strong underline-offset-4 hover:decoration-fg">
            {item.documentTitle}
          </Link>
          {` · ${place}`}
          {item.contextLabel ? ` · ${item.contextLabel}` : ""}
        </p>
      </div>
      <dl className="v3-ai-readings">
        <Reading label="Первое чтение" value={item.readings.tesseract} />
        <Reading label="Второе чтение" value={item.readings.vision} />
        <Reading label="Проверка фрагмента" value={item.readings.arbiter} meta={item.readings.arbiterModel} />
        <Reading label="Предложено" value={item.proposed} strong />
      </dl>
      <div className="min-w-0 space-y-2">
        {error ? (
          <p className="v3-ai-flag t-body-compact"><Icon name="alert" size={16} className="mt-0.5 shrink-0" />{error}</p>
        ) : null}
        <AiReviewItemActions item={item} requestId={requestId} canManage={canManage} />
      </div>
    </li>
  );
}

export function AiReviewSheet({
  read,
  filter,
  documentId,
  preview,
  requestIds,
  retryHref,
}: Readonly<{
  read: AiRead<AiReviewList>;
  filter: AiReviewFilter;
  documentId: string | null;
  preview: boolean;
  requestIds: Readonly<Record<string, string>>;
  retryHref: string;
}>) {
  if (read.status !== "available") return <AiUnavailable what="«Лист сверки»" retryHref={retryHref} />;
  const { items, hasMore, openCount } = read.data;
  const canManage = read.data.canManage && !preview;
  const documentTitle = documentId ? items.find((item) => item.documentId === documentId)?.documentTitle ?? null : null;
  return (
    <section aria-labelledby="ai-review-title" className="space-y-3" data-testid="v3-ai-review">
      <div className="space-y-1">
        <h2 id="ai-review-title" className="t-section text-fg">Лист сверки</h2>
        <p className="max-w-[72ch] t-body-compact text-fg-2">
          Числа из сканов, которые агент не прочитал уверенно. Документ уже ищется, но пока пункт открыт, ответы помечают это число как непроверенное.
        </p>
      </div>
      <QueueViewTabs
        label="Пункты сверки"
        tabs={[
          { key: "open", label: "Открытые", count: openCount, current: filter === "open", href: aiAgentHref("review", { document: documentId }) },
          { key: "resolved", label: "Решённые", count: null, current: filter === "resolved", href: aiAgentHref("review", { status: "resolved", document: documentId }) },
          { key: "dismissed", label: "Оставлены как есть", count: null, current: filter === "dismissed", href: aiAgentHref("review", { status: "dismissed", document: documentId }) },
        ]}
      />
      {documentId ? (
        <p className="flex flex-wrap items-center gap-x-3 t-body-compact text-fg-2">
          <span>Документ: {documentTitle ? `«${documentTitle}»` : "выбранный"}</span>
          <Link href={aiAgentHref("review", { status: filter === "open" ? null : filter })} className="inline-flex min-h-11 items-center t-label text-fg-2 underline underline-offset-4 hover:text-fg">
            Все документы
          </Link>
        </p>
      ) : null}
      {items.length === 0 ? (
        filter === "open" ? (
          <div className="rounded-card border border-border bg-surface px-4 py-8 text-center" data-testid="v3-ai-review-done">
            <p className="flex items-center justify-center gap-2 t-section text-fg"><Icon name="circle-check" size={18} className="text-ok" />Всё сверено</p>
            <p className="mx-auto mt-1 max-w-[52ch] t-body-compact text-fg-2">
              Новые пункты появятся, когда агент распознает сканы и найдёт число, в котором не уверен.
            </p>
          </div>
        ) : (
          <p className="rounded-card border border-border bg-surface px-4 py-6 t-body-compact text-fg-2">
            {filter === "resolved" ? "Решённых пунктов пока нет." : "Оставленных как есть пунктов нет."}
          </p>
        )
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-card border border-border bg-surface">
          {items.map((item) => (
            <ReviewRow key={item.id} item={item} requestId={requestIds[item.id] ?? ""} canManage={canManage} />
          ))}
        </ul>
      )}
      {hasMore ? (
        <p className="t-meta text-fg-3">
          Показаны первые {items.length}. {filter === "open" ? "Решите эти — следующие появятся сами." : ""}
          {items.length > 0 ? ` Последний — ${aiDateTime(items[items.length - 1]!.createdAt)}.` : ""}
        </p>
      ) : null}
    </section>
  );
}
