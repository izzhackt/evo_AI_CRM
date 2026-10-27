"use client";

import { AlertTriangleIcon } from "lucide-react";
import Link from "next/link";

import { AiReviewItemActions } from "@/components/v3/ai-agent/AiReviewItemActions";
import { aiAgentHref } from "@/lib/v3/ai-agent";
import { aiCropHref, aiReviewErrorCopy, type AiReviewItem } from "@/lib/v3/ai-agent-knowledge";

export const reviewPlace = (item: AiReviewItem) => (item.sheetName ? `лист «${item.sheetName}»` : `стр. ${item.pageNo}`);

function Reading({ label, value, meta, strong = false }: Readonly<{ label: string; value: string | null; meta?: string | null; strong?: boolean }>) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 border-b border-border py-2 last:border-b-0">
      <dt className="t-meta text-fg-3">{label}</dt>
      <dd className={`min-w-0 break-words font-mono tabular-nums ${strong ? "t-item font-semibold text-fg" : "t-body-compact text-fg-2"}`}>
        {value ?? <span className="font-sans text-fg-3">—</span>}
        {meta ? <span className="ml-2 font-sans t-meta font-normal text-fg-3">{meta}</span> : null}
      </dd>
    </div>
  );
}

/**
 * Пункт «Листа сверки» в панели: вырезка строки скана, три прочтения («Первое чтение» — Tesseract, «Второе чтение» — Gemini vision,
 * «Проверка фрагмента» — арбитр), предложенное значение и прежние действия (`AiReviewItemActions`): «Подтвердить», «Исправить»,
 * «Оставить как есть», «Открыть снова». Молча цифра не меняется никогда; ошибка применения остаётся на виду.
 */
export function AiReviewItemSheet({ item, requestId, canManage }: Readonly<{ item: AiReviewItem; requestId: string; canManage: boolean }>) {
  const place = reviewPlace(item);
  const error = item.status === "open" ? aiReviewErrorCopy(item.errorCode) : null;
  return (
    <div className="grid gap-4" data-testid="v3-ai-review-item" data-status={item.status}>
      {item.hasCrop ? (
        <div className="v3-ai-crop">
          {/* eslint-disable-next-line @next/next/no-img-element -- приватная вырезка через маршрут CRM */}
          <img src={aiCropHref(item.documentId, item.id)} alt={`Вырезка: ${place}, «${item.documentTitle}»`} loading="lazy" />
        </div>
      ) : <p className="v3-ai-crop t-meta text-fg-3">Вырезки нет</p>}
      <p className="t-meta text-fg-3">
        <Link href={aiAgentHref("documents", { document: item.documentId, page: item.pageNo })} className="text-fg-2 underline underline-offset-4 hover:text-fg">{item.documentTitle}</Link>
        {` · ${place}`}{item.contextLabel ? ` · ${item.contextLabel}` : ""}
      </p>
      <dl>
        <Reading label="Первое чтение" value={item.readings.tesseract} />
        <Reading label="Второе чтение" value={item.readings.vision} />
        <Reading label="Проверка фрагмента" value={item.readings.arbiter} meta={item.readings.arbiterModel} />
        <Reading label="Предложено" value={item.proposed} strong />
      </dl>
      {error ? <p role="alert" className="flex items-start gap-2 t-body-compact text-warn"><AlertTriangleIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />{error}</p> : null}
      <AiReviewItemActions item={item} requestId={requestId} canManage={canManage} />
    </div>
  );
}
