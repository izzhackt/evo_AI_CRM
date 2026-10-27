import { AiDocumentsNext } from "./AiDocumentsNext";
import { AiViewerNext } from "./AiViewerNext";
import { AiLabNext } from "./AiLabNext";
import { AiRulesNext } from "./AiRulesNext";
import { AiReviewNext } from "./AiReviewNext";
import { AiAutosendNext } from "./AiAutosendNext";
import { AiSpendNext } from "./AiSpendNext";
import { AiUnavailableNext } from "./AiUnavailableNext";
import type { AiAgentNextBody } from "./ai-agent-next-types";

/** Подраздел «ИИ-агента» по виду содержимого, которое выбрала страница. */
export function AiBody({ body }: Readonly<{ body: AiAgentNextBody }>) {
  switch (body.kind) {
    case "unavailable": return <AiUnavailableNext what={body.what} retryHref={body.retryHref} />;
    case "documents": return <AiDocumentsNext {...body} />;
    case "viewer": return <AiViewerNext {...body} />;
    case "review": return <AiReviewNext {...body} />;
    case "lab": return <AiLabNext {...body} />;
    case "rules": return <AiRulesNext {...body} />;
    case "autosend": return <AiAutosendNext {...body} />;
    case "spend": return <AiSpendNext {...body} />;
  }
}
