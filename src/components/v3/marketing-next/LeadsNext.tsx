"use client";

import { useMemo, useState, useTransition } from "react";

import { DataTable, DetailSheet, EmptyState } from "@/components/kit";
import { Button } from "@/components/ui/button";
import type { LeadChannelRead } from "@/lib/lead-channel-contract";
import type { MarketingCursor, MarketingLeadRow, MarketingLeadsPage } from "@/lib/marketing-contract";
import { loadMoreMarketingLeadsAction } from "@/lib/platform-marketing-actions";

import { LeadFiltersSheet } from "./LeadFiltersSheet";
import { LeadSheetBody } from "./LeadSheetBody";
import { leadColumns, type LeadChannelSaves } from "./LeadColumns";
import type { MarketingLeadsBody } from "./marketing-next-types";

/**
 * Таблица заявок: первая страница пришла с сервера, «Показать ещё» читает следующую по курсору `(created_at, id)` — страница ≤ 50,
 * имён и телефонов в адресе и в вызове нет, строки не дублируются. Итог — с первого чтения набора фильтров: после «Указать»
 * страница перечитывается, а строки остаются на месте до перезагрузки, и счётчик не должен с ними расходиться.
 */
function LeadsTable({ initial, request, body }: Readonly<{
  initial: MarketingLeadsPage;
  request: Readonly<{ from: string; to: string; filters: MarketingLeadsBody["filters"] }>;
  body: MarketingLeadsBody;
}>) {
  const [rows, setRows] = useState<readonly MarketingLeadRow[]>(initial.rows);
  const [total] = useState(initial.total);
  const [cursor, setCursor] = useState<MarketingCursor | null>(initial.nextCursor);
  const [failed, setFailed] = useState(false);
  const [pending, start] = useTransition();
  const [openId, setOpenId] = useState<string | null>(null);
  const [saved, setSaved] = useState<LeadChannelSaves>({});
  const onSaved = useMemo(() => (leadId: string, read: LeadChannelRead) => setSaved((current) => ({ ...current, [leadId]: read })), []);
  const columns = useMemo(() => leadColumns(saved, onSaved), [saved, onSaved]);
  const open = rows.find((row) => row.leadId === openId) ?? null;
  const more = () => start(async () => {
    if (!cursor) return;
    try {
      const read = await loadMoreMarketingLeadsAction({
        from: request.from, to: request.to, channel: request.filters.channel, campaign: request.filters.campaign,
        stage: request.filters.stage, hasContract: request.filters.hasContract, unknownOnly: request.filters.unknownOnly,
        noOwner: request.filters.noOwner, cursor: { createdAt: cursor.createdAt, id: cursor.id },
      });
      if (read.status !== "available") { setFailed(true); return; }
      setFailed(false);
      setRows((current) => {
        const seen = new Set(current.map((row) => row.leadId));
        return [...current, ...read.page.rows.filter((row) => !seen.has(row.leadId))];
      });
      setCursor(read.page.nextCursor);
    } catch { setFailed(true); }
  });
  return (
    <div className="grid min-w-0 gap-3">
      <p className="t-meta text-fg-3" data-testid="marketing-leads-count" data-total={total}>
        Заявок по фильтрам: <span className="tabular-nums">{total.toLocaleString("ru-RU")}</span>
        {total > 0 ? <> · показано <span className="tabular-nums">{rows.length.toLocaleString("ru-RU")}</span></> : null}
      </p>
      <DataTable
        label="Таблица заявок"
        data={rows}
        columns={columns}
        getRowId={(row) => row.leadId}
        getRowLabel={(row) => row.name ?? "Лид без имени"}
        onRowClick={(row) => setOpenId(row.leadId)}
        searchPlaceholder="Найти среди показанных"
        pageSize={25}
        partial={cursor !== null}
        columnMenu={false}
        toolbar={<LeadFiltersSheet period={body.period} filters={body.filters} clearHref={body.clearHref} />}
        empty={<EmptyState title="За этот период заявок по фильтрам нет." />}
      />
      {cursor ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" disabled={pending} onClick={more}>{pending ? "Загружаем…" : "Показать ещё"}</Button>
          {failed ? <p role="alert" className="t-body-compact text-danger">Не удалось загрузить следующую страницу. Повторите.</p> : null}
        </div>
      ) : null}
      <DetailSheet
        open={open !== null}
        onOpenChange={(next) => { if (!next) setOpenId(null); }}
        title={open?.name ?? "Лид без имени"}
        description={open ? "Заявка маркетинга" : undefined}
      >
        {open ? <LeadSheetBody row={open} saved={saved[open.leadId]} onSaved={onSaved} /> : null}
      </DetailSheet>
    </div>
  );
}

/** «Заявки» маркетинга в новом виде. Читает администратор; сбой чтения — слова и «Повторить», а не пустая таблица. */
export function LeadsNext({ body }: Readonly<{ body: MarketingLeadsBody }>) {
  const { read } = body;
  return (
    <div className="grid min-w-0 gap-4" data-testid="marketing-leads">
      {read.status === "denied" ? <p role="alert" className="t-body-compact text-fg-2">Раздел доступен только администратору.</p> : null}
      {read.status === "unavailable" ? (
        <div role="alert" className="rounded-card border border-border bg-surface">
          <EmptyState tone="danger" title="Не удалось загрузить заявки." action={<Button variant="outline" asChild><a href={body.retryHref}>Повторить</a></Button>} />
        </div>
      ) : null}
      {read.status === "available"
        ? <LeadsTable key={JSON.stringify([body.period.from, body.period.to, body.filters])} initial={read.page} request={{ from: body.period.from, to: body.period.to, filters: body.filters }} body={body} />
        : null}
    </div>
  );
}
