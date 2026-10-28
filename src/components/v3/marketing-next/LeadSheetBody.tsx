import Link from "next/link";

import { KeyFacts } from "@/components/kit";
import { Button } from "@/components/ui/button";
import type { LeadChannelRead } from "@/lib/lead-channel-contract";
import type { MarketingLeadRow } from "@/lib/marketing-contract";
import { formatBishkekMoment, stageWord } from "@/lib/marketing-view";
import { SALES_STAGE_TITLE } from "@/lib/v3/wording";

import { ChannelCell, connectionWord, DealCell } from "./LeadCells";

/** Панель заявки: все девять данных строки (в таблице на телефоне видны не все) и переход в карточку лида. */
export function LeadSheetBody({ row, saved, onSaved }: Readonly<{ row: MarketingLeadRow; saved?: LeadChannelRead; onSaved: (leadId: string, read: LeadChannelRead) => void }>) {
  return (
    <div className="grid gap-5" data-testid="marketing-lead-sheet">
      <KeyFacts columns={2} facts={[
        { label: "Пришла", value: <span className="tabular-nums">{formatBishkekMoment(row.createdAt)}</span> },
        { label: "Телефон", value: row.phone ? <span className="tabular-nums">{row.phone}</span> : null },
        { label: "Канал связи", value: connectionWord(row.sourceKey) },
        { label: "Этап", value: stageWord(row.stage, row.lifecycleState, SALES_STAGE_TITLE) },
        { label: "Откуда узнал", value: <ChannelCell row={row} saved={saved} onSaved={onSaved} /> },
        { label: "Ответственный", value: row.owner?.name ?? "Не назначен" },
        { label: "Кампания", value: row.campaign },
        { label: "Страница", value: row.landingPath ? <span className="break-all">{row.landingPath}</span> : null },
        { label: "Договор и оплата", value: <DealCell row={row} /> },
      ]} />
      <div><Button variant="outline" asChild><Link href={`/v3/profile?id=${row.leadId}`}>Открыть карточку</Link></Button></div>
    </div>
  );
}
