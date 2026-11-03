import { AlertTriangleIcon } from "lucide-react";

import type { MarketingSignal } from "@/lib/marketing-view";

/** Сигналы раздела (расход есть, а заявок нет; источник неизвестен у большинства) — предупреждение остаётся на виду над плитками. */
export function SignalsNotice({ signals }: Readonly<{ signals: readonly MarketingSignal[] }>) {
  if (!signals.length) return null;
  return (
    <div role="status" data-testid="marketing-signals" className="flex gap-3 rounded-card bg-warn-weak px-4 py-3 text-warn">
      <AlertTriangleIcon aria-hidden="true" className="mt-0.5 size-[18px] shrink-0" />
      <ul className="grid gap-1">
        {signals.map((signal) => <li key={signal.key} className="t-body-compact">{signal.text}</li>)}
      </ul>
    </div>
  );
}
