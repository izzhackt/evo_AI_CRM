"use client";

import { CircleCheckIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { DataTable, DetailSheet, EmptyState, SectionTabs, StatusBadge, type DataTableColumn } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { sheetEscape } from "@/components/v3/panel/sheet-escape";
import { aiAgentHref, aiDateTime } from "@/lib/v3/ai-agent";
import { aiReviewErrorCopy, type AiReviewItem } from "@/lib/v3/ai-agent-knowledge";

import { AiReviewItemSheet, reviewPlace } from "./AiReviewItemSheet";
import { AiUnavailableNext } from "./AiUnavailableNext";
import type { AiAgentNextBody } from "./ai-agent-next-types";

const STATE: Readonly<Record<string, Readonly<[string, "warn" | "ok" | "neutral" | "info"]>>> = {
  open: ["Открыт", "warn"], applying: ["Применяется", "info"], resolved: ["Решён", "ok"], dismissed: ["Оставлен как есть", "neutral"],
};

const columns: DataTableColumn<AiReviewItem>[] = [
  {
    id: "item", accessorFn: (item) => `${item.documentTitle} ${item.contextLabel ?? ""}`, header: "Пункт", meta: { mobile: "title" }, enableHiding: false,
    cell: ({ row }) => {
      // Исправление не применилось — ошибка на виду в списке (как в прежнем виде), а не только в панели: по списку видно, какие числа ждут.
      const error = row.original.status === "open" ? aiReviewErrorCopy(row.original.errorCode) : null;
      return (
        <span className="block min-w-0">
          <span className="block font-medium text-fg [overflow-wrap:anywhere]">{row.original.documentTitle}</span>
          <span className="block t-meta text-fg-3">{reviewPlace(row.original)}{row.original.contextLabel ? ` · ${row.original.contextLabel}` : ""}</span>
          {error ? <span className="block t-meta text-warn">{error}</span> : null}
        </span>
      );
    },
  },
  { id: "proposed", accessorFn: (item) => item.proposed ?? "", header: "Предложено", cell: ({ row }) => <span className="font-mono tabular-nums">{row.original.proposed ?? "—"}</span> },
  { id: "state", accessorFn: (item) => STATE[item.status]?.[0] ?? item.status, header: "Состояние", cell: ({ row }) => <StatusBadge label={STATE[row.original.status]?.[0] ?? row.original.status} tone={STATE[row.original.status]?.[1] ?? "neutral"} /> },
  { id: "created", accessorFn: (item) => item.createdAt, header: "Найден", meta: { wide: true }, cell: ({ row }) => <span className="tabular-nums">{aiDateTime(row.original.createdAt)}</span> },
];

/**
 * «Лист сверки» (план §7): числа из сканов, которые ни одно чтение не подтвердило уверенно. Пока пункт открыт, документ уже ищется, а
 * ответы помечают это число непроверенным (это за «?»). Три списка-ссылки — открытые, решённые, оставленные; пункт открывается в панели
 * с вырезкой, чтениями и действиями. Показаны первые N — сказано словами, когда список неполный. Пункт, чьё исправление не применилось,
 * назван в строке списка предупреждающим цветом (полная фраза — и в панели).
 */
export function AiReviewNext({ read, filter, documentId, preview, requestIds, retryHref }: Extract<AiAgentNextBody, { kind: "review" }>) {
  const [openId, setOpenId] = useState<string | null>(null);
  if (read.status !== "available") return <AiUnavailableNext what="«Лист сверки»" retryHref={retryHref} />;
  const { items, hasMore, pendingCount } = read.data;
  const canManage = read.data.canManage && !preview;
  const openTabCount = documentId === null ? pendingCount : filter === "open" && !hasMore ? items.length : null;
  const documentTitle = documentId ? items.find((item) => item.documentId === documentId)?.documentTitle ?? null : null;
  const open = items.find((item) => item.id === openId) ?? null;
  return (
    <div className="grid min-w-0 gap-4" data-testid="v3-ai-review">
      <SectionTabs label="Пункты сверки" value={filter} tabs={[
        { key: "open", label: "Открытые", count: openTabCount, href: aiAgentHref("review", { document: documentId }) },
        { key: "resolved", label: "Решённые", href: aiAgentHref("review", { status: "resolved", document: documentId }) },
        { key: "dismissed", label: "Оставлены как есть", href: aiAgentHref("review", { status: "dismissed", document: documentId }) },
      ]} />
      {documentId ? (
        <p className="flex flex-wrap items-center gap-x-3 t-body-compact text-fg-2">
          <span>Документ: {documentTitle ? `«${documentTitle}»` : "выбранный"}</span>
          <Button variant="ghost" asChild><Link href={aiAgentHref("review", { status: filter === "open" ? null : filter })}>Все документы</Link></Button>
        </p>
      ) : null}
      <DataTable
        label="Пункты сверки"
        data={items}
        columns={columns}
        getRowId={(item) => item.id}
        getRowLabel={(item) => `${item.documentTitle}, ${reviewPlace(item)}`}
        onRowClick={(item) => setOpenId(item.id)}
        searchPlaceholder="Найти пункт"
        columnMenu={false}
        paginate={false}
        empty={filter === "open" ? (
          <div data-testid="v3-ai-review-done"><EmptyState icon={CircleCheckIcon} title="Всё сверено" description="Новые пункты появятся, когда агент распознает сканы и найдёт число, в котором не уверен." /></div>
        ) : <EmptyState title={filter === "resolved" ? "Решённых пунктов пока нет." : "Оставленных как есть пунктов нет."} />}
      />
      {hasMore ? (
        <p className="t-meta text-fg-3">
          Показаны первые {items.length}. {filter === "open" ? "Решите эти — следующие появятся сами." : ""}
          {items.length > 0 ? ` Последний — ${aiDateTime(items[items.length - 1]!.createdAt)}.` : ""}
        </p>
      ) : null}
      <DetailSheet onEscapeKeyDown={sheetEscape} open={open !== null} onOpenChange={(next) => { if (!next) setOpenId(null); }} title={open?.documentTitle ?? "Пункт сверки"} description={open ? reviewPlace(open) : undefined}
        help="Числа из сканов, в которых агент не уверен. Пока пункт открыт, ответы помечают число как непроверенное.">
        {open ? <AiReviewItemSheet key={open.id} item={open} requestId={requestIds[open.id] ?? ""} canManage={canManage} /> : null}
      </DetailSheet>
    </div>
  );
}
