"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { Icon } from "@/components/icons";
import { btnGhostCls } from "@/components/ui";
import { LEAD_CHANNEL_AI_NOTE, leadChannelText } from "@/lib/lead-channel-contract";
import type { MarketingCursor, MarketingLeadFilters, MarketingLeadRow, MarketingLeadsPage } from "@/lib/marketing-contract";
import { formatBishkekMoment, formatIsoDay, formatMinor, stageWord } from "@/lib/marketing-view";
import { loadMoreMarketingLeadsAction } from "@/lib/platform-marketing-actions";
import { SALES_STAGE_TITLE, source as sourceWord } from "@/lib/v3/wording";
import { ChannelLabel } from "./ChannelLabel";

const TH = "whitespace-nowrap px-2 py-2 text-left t-caption font-medium text-fg-2";
const TD = "px-2 py-2.5 align-top t-body-compact text-fg";
const META = "block t-meta text-fg-2";
const PAID_SOURCE = { case: "по платежам дела", gate: "подтверждено вручную", report: "по записи отчёта" } as const;

/** Канал связи: ручной и автоматический WhatsApp — одна строка «WhatsApp» (план §3.1). */
function connectionWord(sourceKey: string): string {
  const word = sourceKey === "whatsapp_manual" ? "WhatsApp" : sourceWord(sourceKey) ?? sourceKey;
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function Row({ row }: Readonly<{ row: MarketingLeadRow }>) {
  return (
    <tr className="border-b border-border" data-lead-id={row.leadId}>
      <th scope="row" className={`${TD} min-w-32 text-left font-medium`}>
        <Link href={`/v3/profile?id=${row.leadId}`} className="underline-offset-4 hover:underline">{row.name ?? "Лид без имени"}</Link>
      </th>
      <td className={`${TD} whitespace-nowrap tabular-nums`}>{row.phone ?? <span className="text-fg-2">—</span>}</td>
      <td className={`${TD} whitespace-nowrap tabular-nums`}>{formatBishkekMoment(row.createdAt)}</td>
      <td className={TD}>{connectionWord(row.sourceKey)}</td>
      <td className={`${TD} min-w-40`}>
        <ChannelLabel channel={row.channel}>{leadChannelText(row)}</ChannelLabel>
        {row.aiAssistant ? <span className={`${META} pl-4`}>{LEAD_CHANNEL_AI_NOTE}</span> : null}
      </td>
      <td className={`${TD} max-w-32 break-words`}>{row.campaign ?? <span className="text-fg-2">—</span>}</td>
      <td className={`${TD} max-w-40 break-all`}>{row.landingPath ?? <span className="text-fg-2">—</span>}</td>
      <td className={`${TD} whitespace-nowrap`}>{stageWord(row.stage, row.lifecycleState, SALES_STAGE_TITLE)}</td>
      <td className={`${TD} whitespace-nowrap tabular-nums`}>
        {row.contractSignedOn ? formatIsoDay(row.contractSignedOn) : <span className="text-fg-2">—</span>}
        {row.contractLinkedManually ? <span className={META}>связано вручную</span> : null}
      </td>
      <td className={`${TD} whitespace-nowrap tabular-nums`}>
        {row.paid ? (
          <span className="inline-flex items-center gap-1.5">
            <Icon name="circle-check" size={14} className="flex-none text-ok" />
            {row.paid.amountMinor !== null && row.paid.currency !== null ? formatMinor(row.paid.amountMinor, row.paid.currency) : "Оплата есть"}
          </span>
        ) : <span className="text-fg-2">—</span>}
        {row.paid && (row.paid.amountMinor === null || row.paid.currency === null) ? <span className={`${META} pl-5`}>сумма не названа</span> : null}
        {row.paid ? <span className={`${META} pl-5`}>{PAID_SOURCE[row.paid.source]}</span> : null}
      </td>
      <td className={`${TD} min-w-28`}>{row.owner?.name ?? <span className="text-fg-2">не назначен</span>}</td>
    </tr>
  );
}

/**
 * Таблица заявок: первая страница пришла с сервера, «Показать ещё» читает следующую по курсору
 * `(created_at, id)` — страница ≤ 50, имён и телефонов в адресе и в вызове нет. Строки не
 * дублируются: курсор — последняя показанная.
 */
export function MarketingLeadsTable({ initial, request }: Readonly<{
  initial: MarketingLeadsPage;
  request: Readonly<{ from: string; to: string; filters: MarketingLeadFilters }>;
}>) {
  const [rows, setRows] = useState<readonly MarketingLeadRow[]>(initial.rows);
  const [cursor, setCursor] = useState<MarketingCursor | null>(initial.nextCursor);
  const [failed, setFailed] = useState(false);
  const [pending, start] = useTransition();
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
    <div>
      <p className="t-meta text-fg-2" data-testid="marketing-leads-count" data-total={initial.total}>
        Заявок по фильтрам: <span className="tabular-nums">{initial.total.toLocaleString("ru-RU")}</span>
        {initial.total > 0 ? <> · показано <span className="tabular-nums">{rows.length.toLocaleString("ru-RU")}</span></> : null}
      </p>
      {rows.length === 0 ? <p className="mt-3 t-body-compact text-fg-2">За этот период заявок по фильтрам нет.</p> : (
        <div className="relative mt-2 overflow-x-auto">
          <table className="min-w-[60rem] w-full border-collapse">
            <caption className="sr-only">Заявки периода: кто пришёл, откуда и что с ними стало</caption>
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className={TH}>Имя</th>
                <th scope="col" className={TH}>Телефон</th>
                <th scope="col" className={TH}>Пришёл</th>
                <th scope="col" className={TH}>Канал связи</th>
                <th scope="col" className={TH}>Откуда узнал</th>
                <th scope="col" className={TH}>Кампания</th>
                <th scope="col" className={TH}>Страница входа</th>
                <th scope="col" className={TH}>Этап</th>
                <th scope="col" className={TH}>Договор</th>
                <th scope="col" className={TH}>Оплата</th>
                <th scope="col" className={TH}>Ответственный</th>
              </tr>
            </thead>
            <tbody>{rows.map((row) => <Row key={row.leadId} row={row} />)}</tbody>
          </table>
        </div>
      )}
      {cursor ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button type="button" className={btnGhostCls} disabled={pending} onClick={more}>{pending ? "Загружаем…" : "Показать ещё"}</button>
          {failed ? <p role="alert" className="t-body-compact text-fg-2">Не удалось загрузить следующую страницу. Повторите.</p> : null}
        </div>
      ) : null}
    </div>
  );
}
