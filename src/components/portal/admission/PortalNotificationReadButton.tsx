"use client";

import { useFormStatus } from "react-dom";

import type { Locale } from "@/lib/i18n-data";
import { getPortalStrings } from "@/lib/portal/i18n";

/** PORT-6a: подписи — из неймспейса admission (RU байт-в-байт прежние). */
export function PortalNotificationReadButton({ locale }: { locale: Locale }) {
  const { pending } = useFormStatus();
  const strings = getPortalStrings("admission", locale);

  return (
    <button
      type="submit"
      disabled={pending}
      aria-disabled={pending}
      className="pt-btn-ghost"
    >
      <span aria-live="polite">
        {pending ? strings.marking : strings.markRead}
      </span>
    </button>
  );
}
