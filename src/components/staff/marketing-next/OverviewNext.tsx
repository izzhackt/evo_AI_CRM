import { EmptyState } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { marketingSignals } from "@/lib/marketing-view";

import { ChannelsCard } from "./ChannelsCard";
import { CostCard } from "./CostCard";
import { OverviewTiles } from "./OverviewTiles";
import { SalesCard } from "./SalesCard";
import { SignalsNotice } from "./SignalsNotice";
import { SpendCard } from "./SpendCard";
import type { MarketingOverviewBody } from "./marketing-next-types";

/**
 * «Обзор» маркетинга в новом виде: сигналы и четыре числа периода, затем когорта заявок по каналам, продажи периода со сверкой
 * и расход с ценой заявки. Чтение то же (`readMarketingOverview`); сбой — слова и «Повторить», а не ноль.
 */
export function OverviewNext({ body }: Readonly<{ body: MarketingOverviewBody }>) {
  const { read } = body;
  if (read.status !== "available") {
    return (
      <div role="alert" className="rounded-card border border-border bg-surface">
        <EmptyState
          tone={read.status === "denied" ? "neutral" : "danger"}
          title={read.status === "denied" ? "Раздел доступен только администратору." : "Не удалось загрузить обзор маркетинга."}
          action={read.status === "denied" ? undefined : <Button variant="outline" asChild><a href={body.retryHref}>Повторить</a></Button>}
        />
      </div>
    );
  }
  const { overview } = read;
  return (
    <div className="grid min-w-0 gap-4" data-testid="marketing-overview">
      <SignalsNotice signals={marketingSignals(overview, body.recent)} />
      <OverviewTiles overview={overview} />
      <ChannelsCard overview={overview} unknownHref={body.unknownHref} />
      <SalesCard overview={overview} />
      <SpendCard overview={overview} period={body.range} addId={body.addId} cancelIds={body.cancelIds} />
      <CostCard overview={overview} />
    </div>
  );
}
