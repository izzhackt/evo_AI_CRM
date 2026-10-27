import type { DataTableColumn } from "@/components/kit";
import { type LeadChannelRead, LEAD_CHANNELS } from "@/lib/lead-channel-contract";
import type { MarketingLeadRow } from "@/lib/marketing-contract";
import { formatBishkekMoment, stageWord } from "@/lib/marketing-view";
import { SALES_STAGE_TITLE } from "@/lib/v3/wording";

import { ChannelCell, connectionWord, DealCell } from "./LeadCells";

export type LeadChannelSaves = Readonly<Record<string, LeadChannelRead>>;

/**
 * Колонки «Заявок» маркетинга. Главная — имя и время; на телефоне под ним три данные (откуда узнал, этап, договор и оплата).
 * Телефон, канал связи и кампания — колонки второго плана (`wide`): они есть и в панели записи.
 */
export function leadColumns(saved: LeadChannelSaves, onSaved: (leadId: string, read: LeadChannelRead) => void): DataTableColumn<MarketingLeadRow>[] {
  return [
    {
      id: "name", accessorFn: (row) => row.name ?? "Лид без имени", header: "Имя и время", meta: { mobile: "title", label: "Имя" }, enableHiding: false,
      cell: ({ row }) => (
        <span className="block min-w-0">
          <span className="block font-medium text-fg [overflow-wrap:anywhere]">{row.original.name ?? "Лид без имени"}</span>
          <span className="block t-meta tabular-nums text-fg-3">{formatBishkekMoment(row.original.createdAt)}</span>
        </span>
      ),
    },
    {
      id: "channel", accessorFn: (row) => LEAD_CHANNELS[saved[row.leadId]?.channel ?? row.channel], header: "Откуда узнал",
      cell: ({ row }) => <ChannelCell row={row.original} saved={saved[row.original.leadId]} onSaved={onSaved} />,
    },
    { id: "stage", accessorFn: (row) => stageWord(row.stage, row.lifecycleState, SALES_STAGE_TITLE), header: "Этап" },
    { id: "deal", accessorFn: (row) => row.contractSignedOn ?? "", header: "Договор и оплата", cell: ({ row }) => <DealCell row={row.original} /> },
    { id: "owner", accessorFn: (row) => row.owner?.name ?? "Не назначен", header: "Ответственный", meta: { mobile: "hide" } },
    { id: "phone", accessorFn: (row) => row.phone ?? "", header: "Телефон", meta: { wide: true, mobile: "hide" }, cell: ({ row }) => <span className="tabular-nums">{row.original.phone ?? "—"}</span> },
    { id: "connection", accessorFn: (row) => connectionWord(row.sourceKey), header: "Канал связи", meta: { wide: true, mobile: "hide" } },
    { id: "campaign", accessorFn: (row) => row.campaign ?? "", header: "Кампания", meta: { wide: true, mobile: "hide" }, cell: ({ row }) => row.original.campaign ?? "—" },
  ];
}
