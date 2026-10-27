import { DetailSheet } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import type { AiAgentDigestRow } from "@/lib/ai-agents/contract";
import type { ChartHorizontalRow } from "@/lib/v3/ai-agents-view";

import { ToolBars } from "@/components/v3/ai-agents/Charts";
import { NextDigest } from "./NextDigest";

/** «Что делает агент»: вызовы инструментов за 30 дней — в панели, не на экране «Обзора». */
export function ToolsSheet({ rows }: Readonly<{ rows: readonly ChartHorizontalRow[] }>) {
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  return (
    <div data-testid="v3-aia-tools-panel">
      <DetailSheet
        title="Что делает агент"
        description={`Вызовы инструментов за 30 дней: ${total}`}
        trigger={<Button variant="outline">Что делает агент</Button>}
      >
        <ToolBars rows={rows} emptyText="" />
      </DetailSheet>
    </div>
  );
}

/** «Прошлые отчёты»: все, кроме последнего, одним списком в панели. */
export function OlderDigestsSheet({ digests, now }: Readonly<{ digests: readonly AiAgentDigestRow[]; now: string }>) {
  return (
    <DetailSheet
      title="Прошлые отчёты"
      trigger={<Button variant="outline">Прошлые отчёты <span className="tabular-nums text-fg-3">{digests.length}</span></Button>}
    >
      <div className="grid gap-5">
        {digests.map((digest, index) => (
          <div key={digest.id} className="grid gap-5">
            {index > 0 ? <Separator /> : null}
            <NextDigest digest={digest} now={now} />
          </div>
        ))}
      </div>
    </DetailSheet>
  );
}
