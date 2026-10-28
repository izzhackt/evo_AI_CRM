"use client";

import { WidgetCard } from "@/components/kit";
import { AiLaboratory } from "@/components/v3/ai-agent/AiLaboratory";

import { AiExamplesNext } from "./AiExamplesNext";
import type { AiAgentNextBody } from "./ai-agent-next-types";

/**
 * «Лаборатория»: проверка ответа агента (вопрос как клиент → ответ с источниками → «Что не так?» → предложение правки) и эталонные ответы под ней.
 * Движок Лаборатории прежний (`AiLaboratory`: потоки, предложения, «Применить», «Отклонить»); меняется рамка и список примеров.
 */
export function AiLabNext({ initial, featureOn, preview, requestIds, examples, exampleIds }: Extract<AiAgentNextBody, { kind: "lab" }>) {
  return (
    <div className="grid min-w-0 gap-4" data-testid="v3-ai-lab">
      <WidgetCard>
        <AiLaboratory initial={initial} featureOn={featureOn} preview={preview} requestIds={requestIds} />
      </WidgetCard>
      <AiExamplesNext read={examples} preview={preview} requestIds={exampleIds} />
    </div>
  );
}
