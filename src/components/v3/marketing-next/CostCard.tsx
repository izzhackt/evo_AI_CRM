import { KeyFacts, WidgetCard } from "@/components/kit";
import type { MarketingOverview } from "@/lib/marketing-contract";
import { costPerLead, formatPerLead } from "@/lib/marketing-view";

import { leadsWord } from "./marketing-next-format";

/**
 * «Цена заявки Instagram-рекламы» — три уровня, не одно число: по метке, со слов клиента и вместе с неизвестными. Расхода нет —
 * карточки нет (об этом уже сказано в «Расходе периода»); расход в разных валютах — слова вместо цены, валюты не складываются;
 * меньше 10 заявок — только их число.
 */
export function CostCard({ overview }: Readonly<{ overview: MarketingOverview }>) {
  const cost = costPerLead(overview);
  if (cost.status === "no_spend") return null;
  return (
    <WidgetCard
      title="Цена заявки Instagram-рекламы"
      help="Расход Instagram-рекламы на одну заявку: по метке, со слов клиента и вместе с заявками без известного источника. В расход входят только записи, целиком лежащие в периоде."
    >
      <div data-testid="marketing-cost">
        {cost.status === "mixed_currencies"
          ? <p className="t-body-compact text-fg-2">Расход в разных валютах ({cost.currencies.join(", ")}): цена не считается, валюты не складываются.</p>
          : (
            <KeyFacts columns={3} facts={cost.levels.map((level) => ({
              label: level.title,
              value: (
                <span data-cost-level={level.key}>
                  {level.leads === 0 ? <><span className="t-item">—</span> <span className="text-fg-3">заявок нет</span></>
                    : level.perLeadMinor === null ? <><span className="t-item">—</span> <span className="text-fg-3">мало заявок для цены: {leadsWord(level.leads)}</span></>
                    : <><span className="t-item tabular-nums">{formatPerLead(level.perLeadMinor, cost.currency)}</span> <span className="text-fg-3">на {leadsWord(level.leads)}</span></>}
                </span>
              ),
            }))} />
          )}
      </div>
    </WidgetCard>
  );
}
