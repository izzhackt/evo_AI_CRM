"use client";

import { IntentPrefetchLink } from "@/components/IntentPrefetchLink";
import { Icon } from "@/components/icons";

/** Возврат над заголовком вложенной страницы (тот же вид и размер цели, что у `PartShell`). */
export function UniversityBack({ href, label }: Readonly<{ href: string; label: string }>) {
  return (
    <IntentPrefetchLink href={href} className="inline-flex min-h-11 items-center gap-1.5 t-label text-fg-2 hover:text-fg hover:underline hover:underline-offset-4">
      <Icon name="arrow-left" size={16} />{label}
    </IntentPrefetchLink>
  );
}
