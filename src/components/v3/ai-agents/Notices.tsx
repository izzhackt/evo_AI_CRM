import type { ReactNode } from "react";

import { Icon } from "@/components/icons";

/*
 * Строки состояния раздела «ИИ-агенты»: словами, без «0 из 0». Тот же вид, что
 * `Line` в «ИИ-агенте» Gemini: предупреждение — жёлтая подложка (не красная:
 * красный здесь только проблема записи и главное действие).
 */

export function InfoLine({
  tone,
  children,
  testId,
  role,
  action,
}: Readonly<{
  tone: "warn" | "muted";
  children: ReactNode;
  testId?: string;
  role?: "status" | "alert";
  /** Действие в конце строки (тёмная кнопка очереди): текст и кнопка в одной строке, без второго красного. */
  action?: ReactNode;
}>) {
  return (
    <div
      data-testid={testId}
      className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-card border px-4 py-3 t-body-compact ${tone === "warn" ? "border-transparent bg-warn-weak text-warn" : "border-border bg-surface text-fg-2"}`}
    >
      {/* Читалка зачитывает только слова: кнопка в конце строки в «живой регион» не входит. */}
      <span role={role} className="flex min-w-0 flex-[1_1_16rem] items-start gap-2">
        {tone === "warn" ? <Icon name="alert" size={16} className="mt-0.5 shrink-0" /> : null}
        <span className="min-w-0">{children}</span>
      </span>
      {action}
    </div>
  );
}

/** Ключ Claude API не задан в CRM: агенты не запустятся, кнопки запуска заперты. */
export function ApiKeyMissingLine() {
  return (
    <InfoLine tone="warn" testId="v3-aia-key-missing" role="status">
      Ключ Claude API не задан в CRM: агенты не запустятся. Его добавляет администратор.
    </InfoLine>
  );
}

/** Функций 317-й миграции ещё нет в базе: раздел не падает, а объясняет. */
export function NotReady() {
  return (
    <section className="rounded-card border border-border bg-surface px-5 py-6" data-testid="v3-aia-not-ready" aria-labelledby="aia-not-ready">
      <h2 id="aia-not-ready" className="t-section text-fg">Раздел готовится</h2>
      <p className="mt-1 max-w-[60ch] t-body-compact text-fg-2">
        База ещё не обновлена: агенты появятся здесь, как только обновление будет применено.
      </p>
    </section>
  );
}

export function Unavailable({ what, retryHref, denied = false }: Readonly<{ what: string; retryHref: string; denied?: boolean }>) {
  return (
    <p role="alert" className="t-body-compact text-fg-2" data-testid="v3-aia-unavailable">
      {denied ? "Нет доступа к этому разделу." : `Не удалось загрузить ${what}.`}{" "}
      {denied ? null : <a href={retryHref} className="inline-flex min-h-11 items-center underline underline-offset-4">Повторить</a>}
    </p>
  );
}

/** Предпросмотр роли: действия отключены, а видно то же, что видит роль. */
export function PreviewLine() {
  return (
    <InfoLine tone="muted" testId="v3-aia-preview" role="status">
      Вы смотрите раздел глазами роли: кнопки действий отключены.
    </InfoLine>
  );
}

/** Итог действия строкой рядом с кнопкой: «сохранено» — спокойно, отказ — словами и красным. */
export function ActionMessage({
  state,
  testId,
}: Readonly<{
  state: Readonly<{ status: "idle" | "saved" | "failed"; message: string | null; warnings?: readonly string[] }>;
  testId?: string;
}>) {
  if (state.status === "idle" || !state.message) return null;
  return (
    <div data-testid={testId} className="space-y-0.5">
      <p role={state.status === "saved" ? "status" : "alert"} className={`t-body-compact ${state.status === "saved" ? "text-fg-2" : "text-danger"}`}>
        {state.message}
      </p>
      {(state.warnings ?? []).map((warning) => <p key={warning} className="t-meta text-fg-3">{warning}</p>)}
    </div>
  );
}
