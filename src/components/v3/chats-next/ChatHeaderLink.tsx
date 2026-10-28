import Link from "next/link";
import type { LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Ссылка шапки чата («Карточка лида», «Открыть дело»): кнопка с подписью, а в узкой рабочей области — только значок 44 px с
 * тем же именем для читалки и подсказкой: иначе две кнопки сжимают имя клиента до слога на строку (телефон 320–390 px).
 */
export function ChatHeaderLink({ href, label, icon: Icon, testId }: Readonly<{ href: string; label: string; icon: LucideIcon; testId?: string }>) {
  return (
    <Button variant="outline" asChild className="@max-2xl:w-11 @max-2xl:px-0">
      <Link href={href} title={label} data-testid={testId}>
        <Icon aria-hidden="true" className="@2xl:hidden" />
        <span className="@max-2xl:sr-only">{label}</span>
      </Link>
    </Button>
  );
}
