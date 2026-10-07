"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { Icon } from "@/components/icons";
import { StatusChip } from "@/components/v3/blocks/StatusChip";
import {
  AUDIENCE_LABEL,
  aiAgentHref,
  aiDateTime,
  documentStatus,
} from "@/lib/v3/ai-agent";
import {
  aiPageImageHref,
  type AiBox,
  type AiDocumentDetail,
  type AiDocumentPage,
} from "@/lib/v3/ai-agent-knowledge";

/**
 * Просмотр документа агента (§12.2: «просмотр страниц и фрагментов»):
 * слева — страницы (у XLSX — листы), в середине — картинка страницы с рамками
 * фрагментов (или текст страницы, если картинки нет), справа — фрагменты.
 * Нажатый фрагмент подсвечивает свою рамку; открытые пункты «Листа сверки» —
 * рамкой «Число не проверено». Картинка — только через CRM
 * (`/api/v3/ai-agent/documents/…/pages/n/image`), путь Storage в браузер не идёт.
 * Страницы — настоящие ссылки (`?document=&page=`), без клиентских запросов.
 * У документа без страниц (TXT, CSV, MD, знания из базы) весь текст — одна
 * «страница 1» (271): тогда без колонки страниц — текст и фрагменты.
 */
const TONE = { ok: "ok", warn: "warn", danger: "danger", muted: "neutral" } as const;

function boxStyle(box: AiBox) {
  return {
    left: `${box.x0 * 100}%`, top: `${box.y0 * 100}%`,
    width: `${(box.x1 - box.x0) * 100}%`, height: `${(box.y1 - box.y0) * 100}%`,
  };
}

function pageLabel(page: Readonly<{ pageNo: number; sheetName: string | null }>): string {
  return page.sheetName ? page.sheetName : `Стр. ${page.pageNo}`;
}

export function AiDocumentViewer({
  detail,
  page,
  pageNo,
  pageRead,
  highlightChunkId,
}: Readonly<{
  detail: AiDocumentDetail;
  page: AiDocumentPage | null;
  pageNo: number | null;
  /** Чтение страницы не удалось (а не «страниц нет»). */
  pageRead: "available" | "missing" | "unavailable" | "none";
  highlightChunkId: number | null;
}>) {
  const { document, pages } = detail;
  const status = documentStatus(document);
  const [active, setActive] = useState<number | null>(highlightChunkId);
  const listRef = useRef<HTMLOListElement>(null);
  const openOnPage = page ? page.reviewItems.filter((item) => item.status === "open" || item.status === "applying") : [];
  const sheets = pages.some((item) => item.sheetName);
  const textOnly = pages.length === 0;
  const busy = document.status === "queued" || document.status === "processing";
  const placeLabel = textOnly ? "текст документа"
    : pageNo ? pageLabel({ pageNo, sheetName: pages.find((item) => item.pageNo === pageNo)?.sheetName ?? null }).toLowerCase() : "страницу";

  useEffect(() => {
    if (highlightChunkId === null) return;
    listRef.current?.querySelector(`[data-chunk-id="${highlightChunkId}"]`)?.scrollIntoView({ block: "nearest" });
  }, [highlightChunkId]);

  const href = (target: number) => aiAgentHref("documents", { document: document.id, page: target });
  return (
    <section aria-labelledby="ai-viewer-title" className="space-y-4" data-testid="v3-ai-viewer">
      <div className="space-y-1">
        <Link href={aiAgentHref("documents")} className="inline-flex min-h-11 items-center gap-1.5 t-label text-fg-2 hover:text-fg">
          <Icon name="arrow-left" size={16} />
          Материалы агента
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <h2 id="ai-viewer-title" className="min-w-0 break-words t-record-title text-fg">{document.title}</h2>
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusChip label={AUDIENCE_LABEL[document.audience]} tone={document.audience === "internal" ? "info" : "neutral"} />
            <StatusChip label={status.label} tone={TONE[status.tone]} />
            {document.editedInLab ? <StatusChip label="изменён в Лаборатории" tone="neutral" /> : null}
          </div>
        </div>
        <p className="t-meta text-fg-3">
          {pages.length > 0 ? `${sheets ? "листов" : "страниц"}: ${pages.length} · ` : ""}
          {document.chunkCount > 0 ? `фрагментов: ${document.chunkCount} · ` : ""}
          версия текста {document.docVersion} · {aiDateTime(document.updatedAt)}
        </p>
      </div>

      {textOnly && (busy || pageRead === "none" || pageRead === "missing") ? (
        <p className="rounded-card border border-border bg-surface px-4 py-6 t-body-compact text-fg-2" data-testid="v3-ai-viewer-empty">
          {busy ? "Документ ещё обрабатывается — текст появится после разбора." : "У документа пока нет текста для просмотра."}
        </p>
      ) : (
        <div className="v3-ai-viewer" data-sheets={sheets || undefined} data-text-only={textOnly || undefined}>
          {textOnly ? null : (
            <nav aria-label={sheets ? "Листы документа" : "Страницы документа"} className="v3-ai-rail">
              <ol className="flex gap-1 lg:flex-col">
                {pages.map((item) => (
                  <li key={item.pageNo}>
                    <Link
                      href={href(item.pageNo)}
                      scroll={false}
                      aria-current={item.pageNo === pageNo ? "page" : undefined}
                      className="v3-choice inline-flex min-h-11 w-full items-center justify-between gap-2 whitespace-nowrap rounded-nav px-3 t-label text-fg-2 hover:bg-surface-2 hover:text-fg"
                    >
                      <span className="min-w-0 truncate">{pageLabel(item)}</span>
                      {item.openReviewCount > 0 ? (
                        <span className="v3-ai-rail-flag" title="Есть непроверенные числа">
                          <span className="sr-only">, не проверено: </span>{item.openReviewCount}
                        </span>
                      ) : null}
                    </Link>
                  </li>
                ))}
              </ol>
            </nav>
          )}

          <div className="min-w-0 space-y-2">
            {pageRead === "unavailable" || pageRead === "missing" ? (
              <p role="alert" className="rounded-card border border-border bg-surface px-4 py-6 t-body-compact text-fg-2">
                Не удалось загрузить {placeLabel}.{" "}
                <Link href={href(pageNo ?? pages[0]?.pageNo ?? 1)} className="inline-flex min-h-11 items-center underline underline-offset-4">Повторить</Link>
              </p>
            ) : page && page.hasImage ? (
              <figure
                className="v3-ai-page"
                style={page.width && page.height ? { aspectRatio: `${page.width} / ${page.height}` } : undefined}
                data-testid="v3-ai-page-image"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- приватная картинка через маршрут CRM, без оптимизатора */}
                <img src={aiPageImageHref(document.id, page.pageNo)} alt={`${pageLabel(page)} документа «${document.title}»`} />
                {page.chunks.flatMap((chunk) => chunk.boxes.map((box, index) => (
                  <span
                    key={`${chunk.id}-${index}`}
                    className="v3-ai-box"
                    data-active={active === chunk.id || undefined}
                    style={boxStyle(box)}
                    aria-hidden="true"
                  />
                )))}
                {openOnPage.flatMap((item) => item.box ? [(
                  <span key={item.id} className="v3-ai-box" data-review="" style={boxStyle(item.box)} aria-hidden="true">
                    <span className="v3-ai-box-tag">не проверено</span>
                  </span>
                )] : [])}
              </figure>
            ) : page ? (
              <div className="v3-ai-page-text" data-testid="v3-ai-page-text">
                {page.textMd.trim() ? page.textMd : <span className="text-fg-3">{textOnly ? "В документе нет текста." : "На этой странице нет текста."}</span>}
              </div>
            ) : null}
            {openOnPage.length > 0 ? (
              <p className="v3-ai-flag t-body-compact" data-testid="v3-ai-page-unverified">
                <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
                <span>
                  Число не проверено: {openOnPage.map((item) => item.value).filter(Boolean).map((value, index) => (
                    <span key={index} className="font-mono tabular-nums">{index > 0 ? ", " : ""}{value}</span>
                  ))}.{" "}
                  <Link href={aiAgentHref("review", { document: document.id })} className="underline underline-offset-4">Открыть «Лист сверки»</Link>
                </span>
              </p>
            ) : null}
          </div>

          <section aria-labelledby="ai-viewer-chunks" className="min-w-0">
            <h3 id="ai-viewer-chunks" className="t-label text-fg">
              Фрагменты {page ? <span className="tabular-nums text-fg-3">{page.chunks.length}</span> : null}
            </h3>
            {page && page.chunks.length > 0 ? (
              <ol ref={listRef} className="mt-2 space-y-1" data-testid="v3-ai-chunks">
                {page.chunks.map((chunk) => (
                  <li key={chunk.id} data-chunk-id={chunk.id}>
                    <button
                      type="button"
                      className="v3-ai-chunk"
                      aria-pressed={active === chunk.id}
                      onClick={() => setActive((current) => (current === chunk.id ? null : chunk.id))}
                    >
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="t-label text-fg">Фрагмент {chunk.position + 1}</span>
                        {chunk.unverified ? <StatusChip label="Число не проверено" tone="warn" /> : null}
                        {chunk.boxes.length === 0 && page.hasImage ? <span className="t-meta text-fg-3">без рамки</span> : null}
                      </span>
                      {chunk.sectionPath ? <span className="block t-meta text-fg-3">{chunk.sectionPath}</span> : null}
                      {chunk.content ? <span className="v3-ai-chunk-text t-body-compact text-fg-2">{chunk.content}</span> : null}
                    </button>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="mt-1 t-body-compact text-fg-3">{textOnly ? "У документа фрагментов нет." : "На этой странице фрагментов нет."}</p>
            )}
          </section>
        </div>
      )}
    </section>
  );
}
