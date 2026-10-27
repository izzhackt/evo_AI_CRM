import { InboxIcon, TriangleAlertIcon } from "lucide-react";

import { EmptyState } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Строки состояния раздела «ИИ-агенты» в «Новом виде»: то же, что `InfoLine` прежнего вида, — предупреждение о
 * настоящем состоянии остаётся на виду (жёлтая подложка, слова), спокойная справка — нейтральной рамкой.
 */
export function AgentAlert({
  tone,
  children,
  testId,
  role,
  action,
}: Readonly<{
  tone: "warn" | "muted";
  children: React.ReactNode;
  testId?: string;
  role?: "status" | "alert";
  /** Кнопка в конце строки (тёмная): слова и действие в одной строке. */
  action?: React.ReactNode;
}>) {
  return (
    <div
      data-testid={testId}
      className={cn(
        "flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-card border px-4 py-3 t-body-compact",
        tone === "warn" ? "border-transparent bg-warn-weak text-warn" : "border-border bg-surface text-fg-2",
      )}
    >
      {/* Читалка зачитывает только слова: кнопка в конце строки в «живой регион» не входит. */}
      <span role={role} className="flex min-w-0 flex-[1_1_16rem] items-start gap-2">
        {tone === "warn" ? <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> : null}
        <span className="min-w-0">{children}</span>
      </span>
      {action}
    </div>
  );
}

export function NextApiKeyMissing() {
  return (
    <AgentAlert tone="warn" testId="v3-aia-key-missing" role="status">
      Ключ Claude API не задан в CRM: агенты не запустятся. Его добавляет администратор.
    </AgentAlert>
  );
}

export function NextPreviewLine() {
  return (
    <AgentAlert tone="muted" testId="v3-aia-preview" role="status">
      Вы смотрите раздел глазами роли: кнопки действий отключены.
    </AgentAlert>
  );
}

/** Функций 317-й миграции ещё нет в базе: раздел не падает, а говорит об этом. */
export function NextNotReady() {
  return (
    <div className="rounded-card border border-border bg-surface" data-testid="v3-aia-not-ready">
      <EmptyState
        icon={InboxIcon}
        title="Раздел готовится"
        description="База ещё не обновлена: агенты появятся здесь, как только обновление будет применено."
      />
    </div>
  );
}

export function NextUnavailable({ what, retryHref, denied = false }: Readonly<{ what: string; retryHref: string; denied?: boolean }>) {
  return (
    <div role="alert" className="rounded-card border border-border bg-surface" data-testid="v3-aia-unavailable">
      <EmptyState
        tone="danger"
        title={denied ? "Нет доступа к этому разделу." : `Не удалось загрузить ${what}.`}
        action={denied ? undefined : <Button variant="outline" asChild><a href={retryHref}>Повторить</a></Button>}
      />
    </div>
  );
}
