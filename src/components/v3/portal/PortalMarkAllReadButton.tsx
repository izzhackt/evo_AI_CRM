"use client";

import { useFormStatus } from "react-dom";

/** Bulk sibling of `PortalNotificationReadButton`: same visual language, own label. */
export function PortalMarkAllReadButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      aria-disabled={pending}
      className="inline-flex min-h-11 items-center justify-center rounded-nav border border-control-edge bg-surface px-3 text-sm font-medium text-fg transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-60"
    >
      <span aria-live="polite">
        {pending ? "Отмечаем…" : "Отметить все прочитанными"}
      </span>
    </button>
  );
}
