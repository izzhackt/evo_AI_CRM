import { btnGhostCls } from "@/components/ui";
import { StatusChip } from "@/components/v3/blocks/StatusChip";
import { deleteAiExampleAction } from "@/lib/platform-ai-agent-actions";
import { aiDateTime } from "@/lib/v3/ai-agent";
import { AI_EXAMPLE_STALE_LABEL, type AiGoldenExample } from "@/lib/v3/ai-agent-knowledge";
import type { AiRead } from "@/lib/v3/ai-agent-source";

import { AiActionForm } from "./AiActionForm";

/**
 * Эталонные ответы Лаборатории (план §8): подтверждённые сотрудником примеры,
 * которые агент находит по похожим вопросам. Пример действует, пока не
 * изменились его документы, «Правила общения» и модель (273); иначе — «нужна
 * проверка» и агент его не берёт. Новые вопросы примерами сами не становятся.
 */
export function AiExamplesList({
  read,
  preview,
  requestIds,
}: Readonly<{
  read: AiRead<Readonly<{ items: readonly AiGoldenExample[]; hasMore: boolean; canManage: boolean }>>;
  preview: boolean;
  requestIds: Readonly<Record<string, string>>;
}>) {
  return (
    <section aria-labelledby="ai-examples-title" className="min-w-0 space-y-2" data-testid="v3-ai-examples">
      <h2 id="ai-examples-title" className="t-section text-fg">
        Эталонные ответы {read.status === "available" ? <span className="tabular-nums text-fg-3">{read.data.items.length}</span> : null}
      </h2>
      {read.status !== "available" ? (
        <p className="t-body-compact text-fg-3">Не удалось загрузить эталонные ответы.</p>
      ) : read.data.items.length === 0 ? (
        <p className="t-body-compact text-fg-3">Пока нет. Они появляются после «Применить» в Лаборатории.</p>
      ) : (
        <ol className="divide-y divide-border rounded-card border border-border bg-surface">
          {read.data.items.map((example) => (
            <li key={example.id} className="space-y-1 px-3 py-2.5" data-testid="v3-ai-example" data-valid={example.valid || undefined}>
              <p className="t-item break-words text-fg">{example.question}</p>
              <p className="v3-ai-example-answer t-body-compact text-fg-2">{example.answer}</p>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                {example.valid
                  ? <StatusChip label="действует" tone="ok" />
                  : <StatusChip label={`нужна проверка — ${example.staleReason ? AI_EXAMPLE_STALE_LABEL[example.staleReason] : "знания изменились"}`} tone="warn" />}
                <span className="t-meta text-fg-3">{example.confirmedByName ? `${example.confirmedByName} · ` : ""}{aiDateTime(example.confirmedAt)}</span>
              </div>
              {read.data.canManage && !preview && requestIds[example.id] ? (
                <details>
                  <summary className="inline-flex min-h-11 cursor-pointer list-none items-center t-label text-fg-2 underline decoration-fg-3 underline-offset-4 hover:text-fg [&::-webkit-details-marker]:hidden">
                    Удалить…
                  </summary>
                  <AiActionForm
                    requestId={requestIds[example.id]!}
                    action={deleteAiExampleAction}
                    fields={{ example_id: example.id }}
                    label="Удалить пример"
                    pendingLabel="Удаляю…"
                    buttonClassName={btnGhostCls}
                    messages={{ saved: "Пример удалён." }}
                  />
                </details>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
