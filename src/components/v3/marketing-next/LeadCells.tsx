"use client";

import { CircleCheckIcon } from "lucide-react";

import { ChannelLabel } from "@/components/v3/marketing/ChannelLabel";
import { LeadChannelCorrection } from "@/components/v3/profile/LeadChannelCorrection";
import { LEAD_CHANNEL_AI_NOTE, LEAD_CHANNEL_BASES, LEAD_CHANNELS, type LeadChannelRead } from "@/lib/lead-channel-contract";
import type { MarketingLeadRow } from "@/lib/marketing-contract";
import { formatIsoDay, formatMinor } from "@/lib/marketing-view";
import { source as sourceWord } from "@/lib/v3/wording";

export const PAID_SOURCE = { case: "по платежам дела", gate: "подтверждено вручную", report: "по записи отчёта" } as const;

/** Канал связи: ручной и автоматический WhatsApp — одна строка «WhatsApp» (план «Маркетинга» §3.1). */
export function connectionWord(sourceKey: string): string {
  const word = sourceKey === "whatsapp_manual" ? "WhatsApp" : sourceWord(sourceKey) ?? sourceKey;
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * «Откуда узнал»: слово канала, чем подтверждён, и у «Не известно» тихое «Указать» (то же `staff_correction`, что «Исправить»
 * в карточке лида, решение 10.10): администратор размечает лиды WhatsApp прямо в очереди, не открывая каждую карточку.
 * Сохранённый канал сразу виден в строке и в панели (`saved` хранит список).
 */
export function ChannelCell({ row, saved, onSaved }: Readonly<{ row: MarketingLeadRow; saved?: LeadChannelRead; onSaved: (leadId: string, read: LeadChannelRead) => void }>) {
  const channel = saved?.channel ?? row.channel;
  const basis = saved?.basis ?? row.basis;
  const notes = [channel !== "unknown" ? LEAD_CHANNEL_BASES[basis] : null, row.aiAssistant ? LEAD_CHANNEL_AI_NOTE : null].filter(Boolean).join(" · ");
  return (
    <span className="block min-w-0">
      <ChannelLabel channel={channel}>{LEAD_CHANNELS[channel]}</ChannelLabel>
      {notes ? <span className="block pl-4 t-meta text-fg-3">{notes}</span> : null}
      {row.channel === "unknown" ? (
        <span className="block pl-4" data-testid="marketing-lead-set-channel">
          <LeadChannelCorrection leadId={row.leadId} current="unknown" onSaved={(read) => onSaved(row.leadId, read)}
            label={<>{saved ? "Изменить" : "Указать"}<span className="sr-only">, откуда узнал: {row.name ?? "лид без имени"}</span></>} />
        </span>
      ) : null}
    </span>
  );
}

/** Договор и оплата одной ячейкой: дата договора и сумма оплаты с источником подтверждения. */
export function DealCell({ row }: Readonly<{ row: MarketingLeadRow }>) {
  const { paid } = row;
  return (
    <span className="block min-w-0 tabular-nums">
      <span className="block">{row.contractSignedOn ? `Договор ${formatIsoDay(row.contractSignedOn)}` : <span className="text-fg-3">Договора нет</span>}</span>
      {row.contractLinkedManually ? <span className="block t-meta text-fg-3">связано вручную</span> : null}
      {paid ? (
        <span className="mt-0.5 flex items-center gap-1.5">
          <CircleCheckIcon aria-hidden="true" className="size-3.5 shrink-0 text-ok" />
          {paid.amountMinor !== null && paid.currency !== null ? formatMinor(paid.amountMinor, paid.currency) : "Оплата есть"}
        </span>
      ) : null}
      {paid ? <span className="block pl-5 t-meta text-fg-3">{paid.amountMinor === null || paid.currency === null ? "сумма не названа · " : ""}{PAID_SOURCE[paid.source]}</span> : null}
    </span>
  );
}
