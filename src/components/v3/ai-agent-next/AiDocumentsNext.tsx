"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { DataTable, DetailSheet, EmptyState, StatusBadge, type DataTableColumn } from "@/components/kit";
import { AUDIENCE_LABEL, AI_PERSONAL_DOCUMENT_CODE, aiAgentHref, documentStatus } from "@/lib/v3/ai-agent";

import { AiUnavailableNext } from "./AiUnavailableNext";
import { AiDocumentSheet, STATUS_TONE } from "./AiDocumentSheet";
import { AiUploadPanel } from "./AiUploadPanel";
import { documentDay, groupVersions, LIVE, plural, sourceLine, type DocumentRow } from "./ai-document-model";
import type { AiAgentNextBody } from "./ai-agent-next-types";

type Body = Extract<AiAgentNextBody, { kind: "documents" }>;

const columns: DataTableColumn<DocumentRow>[] = [
  {
    id: "title", accessorFn: (row) => row.document.title, header: "Материал", meta: { mobile: "title" }, enableHiding: false,
    cell: ({ row }) => {
      const { document } = row.original;
      const personal = document.status === "failed" && document.errorCode === AI_PERSONAL_DOCUMENT_CODE;
      return (
        <span className="block min-w-0">
          <span className="block font-medium text-fg [overflow-wrap:anywhere]">{document.title}</span>
          <span className="block t-meta text-fg-3">{sourceLine(document)}{document.pageCount ? ` · ${plural(document.pageCount, "страница", "страницы", "страниц")}` : ""}</span>
          {personal ? <span className="block t-meta text-warn">Похоже на документ клиента — нужно решение.</span> : null}
        </span>
      );
    },
  },
  { id: "audience", accessorFn: (row) => AUDIENCE_LABEL[row.document.audience], header: "Для кого", cell: ({ row }) => <StatusBadge label={AUDIENCE_LABEL[row.original.document.audience]} tone={row.original.document.audience === "client" ? "neutral" : "info"} /> },
  {
    id: "status", accessorFn: (row) => documentStatus(row.document).label, header: "Состояние",
    cell: ({ row }) => {
      const status = documentStatus(row.original.document);
      const badge = <StatusBadge tone={STATUS_TONE[status.tone]} label={status.label} wrap />;
      return row.original.document.status === "review" && row.original.document.openReviewCount > 0
        ? <Link href={aiAgentHref("review", { document: row.original.document.id })} className="inline-flex rounded-full" aria-label={`${status.label} — открыть «Лист сверки»`}>{badge}</Link>
        : badge;
    },
  },
  { id: "updated", accessorFn: (row) => row.document.updatedAt, header: "Обновлён", meta: { wide: true }, cell: ({ row }) => <span className="tabular-nums">{documentDay(row.original.document.updatedAt)}</span> },
];

/**
 * «Материалы»: таблица (название и источник, для кого, состояние, дата), строка открывает панель с командами; загрузка и «Новая версия» —
 * раскрывающаяся форма над таблицей. Строка в сводке не «100 документов», а «Показаны первые 100», когда список неполный. Чтение, права,
 * request_id и ссылка `?replace=` — прежние.
 */
export function AiDocumentsNext({ read, preview, requestIds, retryHref, replaceId, featureOn }: Body) {
  const [openId, setOpenId] = useState<string | null>(null);
  const model = useMemo(() => (read.status === "available" ? groupVersions(read.data.items) : null), [read]);
  if (read.status !== "available" || !model) return <AiUnavailableNext what="материалы агента" retryHref={retryHref} />;
  const { items, hasMore } = read.data;
  const canManage = read.data.canManage && !preview;
  const replaceTarget = replaceId
    ? items.find((item) => item.id === replaceId && item.source === "upload" && LIVE.has(item.status)
      && !items.some((other) => other.replacesId === item.id && !LIVE.has(other.status) && other.status !== "superseded")) ?? null
    : null;
  const rows: DocumentRow[] = model.rows.map((document) => ({ document, successor: model.successors.get(document.id) ?? null }));
  const open = rows.find((row) => row.document.id === openId) ?? null;
  const live = items.filter((item) => LIVE.has(item.status));
  const client = live.filter((item) => item.audience === "client").length;
  return (
    <div className="grid min-w-0 gap-4" data-testid="v3-ai-documents">
      {replaceId !== null && replaceTarget === null ? (
        <p role="alert" className="t-body-compact text-fg-2">
          Новую версию этого документа загрузить нельзя: он уже заменён, удалён или ещё не готов.{" "}
          <Link href={aiAgentHref("documents")} className="inline-flex min-h-11 items-center underline underline-offset-4">К материалам</Link>
        </p>
      ) : null}
      {canManage ? (
        <AiUploadPanel requestId={requestIds.upload} featureOn={featureOn} startOpen={items.length === 0}
          replace={replaceTarget ? { id: replaceTarget.id, title: replaceTarget.title, rowVersion: replaceTarget.rowVersion, audienceLabel: AUDIENCE_LABEL[replaceTarget.audience] } : null} />
      ) : null}
      {items.length > 0 ? (
        <p className="t-meta tabular-nums text-fg-3">
          {hasMore ? `Показаны первые ${items.length}` : plural(rows.length, "документ", "документа", "документов")}
          {live.length !== rows.length ? ` · ищутся ${live.length}` : ""} · для клиентов {client}
        </p>
      ) : null}
      <DataTable
        label="Материалы агента"
        data={rows}
        columns={columns}
        getRowId={(row) => row.document.id}
        getRowLabel={(row) => row.document.title}
        onRowClick={(row) => setOpenId(row.document.id)}
        searchPlaceholder="Найти материал"
        columnMenu={false}
        pageSize={25}
        empty={(
          <div data-testid="v3-ai-documents-empty">
            <EmptyState title="Материалов пока нет"
              description={canManage ? "Загрузите прайс, буклет или правила компании — агент будет отвечать по ним и ссылаться на страницу." : "Материалы загружает сотрудник с доступом к «ИИ-агенту»."} />
          </div>
        )}
      />
      <DetailSheet open={open !== null} onOpenChange={(next) => { if (!next) setOpenId(null); }} title={open?.document.title ?? "Материал"}>
        {open ? <AiDocumentSheet key={open.document.id} document={open.document} successor={open.successor} canManage={canManage} requestIds={requestIds} /> : null}
      </DetailSheet>
    </div>
  );
}
