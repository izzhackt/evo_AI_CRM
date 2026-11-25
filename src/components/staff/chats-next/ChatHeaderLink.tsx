import Link from "next/link";
import type { LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Ссылка шапки чата («Карточка лида», «Открыть дело»): кнопка с подписью, а в узкой рабочей области — только значок 44 px с
 * тем же именем для читалки и подсказкой: иначе две кнопки сжимают имя клиента до слога на строку (телефон 320–390 px).
 */
export function ChatHeaderLink({ href, label, shortLabel, icon: Icon, testId }: Readonly<{
  href: string; label: string;
  /** Короткая видимая подпись на узкой переписке («Дело»): одна иконка папки не говорила, что делает кнопка. Без неё — на узкой только значок 44 px. */
  shortLabel?: string;
  icon: LucideIcon; testId?: string;
}>) {
  if (shortLabel) {
    return (
      <Button variant="outline" asChild className="@max-2xl:px-3">
        <Link href={href} title={label} aria-label={label} data-testid={testId}>
          <Icon aria-hidden="true" className="@2xl:hidden" />
          <span aria-hidden="true" className="@2xl:hidden">{shortLabel}</span>
          <span aria-hidden="true" className="@max-2xl:hidden">{label}</span>
        </Link>
      </Button>
    );
  }
  return (
    <Button variant="outline" asChild className="@max-2xl:w-11 @max-2xl:px-0">
      <Link href={href} title={label} data-testid={testId}>
        <Icon aria-hidden="true" className="@2xl:hidden" />
        <span className="@max-2xl:sr-only">{label}</span>
      </Link>
    </Button>
  );
}
