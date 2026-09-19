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
      className="pt-btn-ghost"
    >
      <span aria-live="polite">
        {pending ? "Отмечаем…" : "Отметить все прочитанными"}
      </span>
    </button>
  );
}
