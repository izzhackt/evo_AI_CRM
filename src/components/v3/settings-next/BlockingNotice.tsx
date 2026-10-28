import { AlertTriangleIcon } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import type { IntegrationRow } from "@/components/v3/settings/types";

const lowerFirst = (text: string) => text.charAt(0).toLocaleLowerCase("ru") + text.slice(1);

/**
 * Одно предупреждение над разделами — только когда настроенный сервис сломан и работа стоит (`blocksWork`). Нет таких — нет и
 * строки: «не используется» и «не проверялось» — факты таблицы, не тревога. На самих «Интеграциях» то же стоит в таблице.
 */
export function BlockingNotice({ rows, href }: Readonly<{ rows: readonly IntegrationRow[]; href: string }>) {
  const blocking = rows.filter((row) => row.blocksWork);
  if (!blocking.length) return null;
  return (
    <div role="status" data-testid="v3-settings-blocking" className="flex flex-wrap items-start gap-x-3 gap-y-2 rounded-card border border-border bg-surface px-4 py-3">
      <AlertTriangleIcon aria-hidden="true" className="mt-0.5 size-[18px] shrink-0 text-danger" />
      <p className="t-body-compact min-w-0 flex-1 text-fg">
        <span className="font-medium text-danger">{blocking.length === 1 ? "Не работает" : "Не работают"}: </span>
        {blocking.map((row) => `${row.name}${row.detail ? ` — ${lowerFirst(row.detail.replace(/\.$/u, ""))}` : ""}`).join("; ")}.
      </p>
      <Button variant="outline" asChild><Link href={href}>Открыть «Интеграции»</Link></Button>
    </div>
  );
}
