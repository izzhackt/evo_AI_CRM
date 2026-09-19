"use client";

import { useFormStatus } from "react-dom";

export function PortalNotificationReadButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      aria-disabled={pending}
      className="pt-btn-ghost"
    >
      <span aria-live="polite">
        {pending ? "Отмечаем…" : "Отметить прочитанным"}
      </span>
    </button>
  );
}
