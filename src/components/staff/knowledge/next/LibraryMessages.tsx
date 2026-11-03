import { Button } from "@/components/ui/button";

/** Ошибка чтения или команды (остаётся на виду, с «Повторить») и слово о последней операции с «Отменить» там, где есть обратная команда. */
export function LibraryMessages({ error, onRetry, status, canUndo, busy, onUndo }: Readonly<{
  error: string;
  onRetry: () => void;
  status: string;
  canUndo: boolean;
  busy: boolean;
  onUndo: () => void;
}>) {
  return (
    <>
      {error ? (
        <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-card border border-border bg-surface px-3 py-2 t-body-compact text-danger">
          <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{error}</span>
          <Button variant="outline" onClick={onRetry}>Повторить</Button>
        </div>
      ) : null}
      {status ? (
        <p role="status" aria-live="polite" className="flex flex-wrap items-center gap-x-3 t-body-compact text-fg-2">
          {status}
          {canUndo ? <Button variant="ghost" disabled={busy} onClick={onUndo}>Отменить</Button> : null}
        </p>
      ) : null}
    </>
  );
}
