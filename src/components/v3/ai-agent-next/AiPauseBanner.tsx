import { AlertTriangleIcon } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { AiActionForm } from "@/components/v3/ai-agent/AiActionForm";
import { pauseAiAutosendAction } from "@/lib/platform-ai-agent-autosend-actions";
import { AI_AUTOSEND_COPY, aiAutosendDayTime, aiAutosendPauseReason, type AiAutosendState } from "@/lib/v3/ai-agent-autosend";

import { AI_OUTLINE_BUTTON } from "./ai-buttons";

/**
 * «Автоответчик на паузе: {причина} · Снять паузу» — над всем разделом автоответчика; снять паузу может только человек (§11, правило 11).
 * В других подразделах вместо кнопки — ссылка в «Автоответчик» (`compactHref`): снимать паузу там, где видно, почему она встала.
 */
export function AiPauseBanner({ state, preview, resumeRequestId, compactHref = null }: Readonly<{ state: AiAutosendState; preview: boolean; resumeRequestId: string; compactHref?: string | null }>) {
  if (!state.pause) return null;
  const since = state.pause.at ? aiAutosendDayTime(state.pause.at) : "";
  return (
    <section
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-card bg-warn-weak px-4 py-2.5 text-warn"
      aria-label={AI_AUTOSEND_COPY.pauseBanner}
      data-testid="v3-ai-autosend-pause-banner"
      data-code={state.pause.code}
    >
      <p className="flex min-w-0 flex-1 basis-72 items-start gap-2 t-body-compact">
        <AlertTriangleIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        <span>
          <span className="font-semibold">{AI_AUTOSEND_COPY.pauseBanner}:</span> {aiAutosendPauseReason(state.pause)}
          {since ? <span className="text-fg-2"> · с {since}</span> : null}
        </span>
      </p>
      {compactHref ? (
        <Button variant="outline" asChild><Link href={compactHref}>Открыть «{AI_AUTOSEND_COPY.title}»</Link></Button>
      ) : !preview ? (
        <AiActionForm
          requestId={resumeRequestId}
          action={pauseAiAutosendAction}
          fields={{ pause_action: "resume", expected_version: String(state.version) }}
          label={AI_AUTOSEND_COPY.resume}
          pendingLabel="Снимаю паузу…"
          buttonClassName={AI_OUTLINE_BUTTON}
          messages={{ saved: "Пауза снята.", forbidden: "Нет права снять паузу." }}
          testId="v3-ai-autosend-resume"
        />
      ) : null}
    </section>
  );
}
