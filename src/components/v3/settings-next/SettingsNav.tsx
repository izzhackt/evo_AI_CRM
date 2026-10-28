import Link from "next/link";

import { SectionTabs } from "@/components/kit";
import { Button } from "@/components/ui/button";

import type { SettingsNavItem } from "./settings-next-types";

const keyOf = (item: SettingsNavItem) => `${item.key}:${item.view ?? ""}`;

/**
 * Ряд разделов «Настроек»: от 56rem ширины области — столбец слева (десять названий, все на виду, как раньше), уже — ряд вкладок-ссылок, который
 * прокручивается вбок, а текущая вкладка видна. Раздел — настоящая ссылка: адрес несёт `?section=` и `&view=`, его можно переслать, вернуться кнопкой
 * «Назад» и открыть без JavaScript. Число у «Запросов на удаление» — открытые запросы (срок — 30 дней).
 */
export function SettingsNav({ items }: Readonly<{ items: readonly SettingsNavItem[] }>) {
  const current = items.find((item) => item.current) ?? items[0];
  return (
    <>
      <div className="min-w-0 @4xl:hidden" data-testid="v3-settings-nav-compact">
        <SectionTabs label="Разделы настроек" value={keyOf(current)} tabs={items.map((item) => ({ key: keyOf(item), label: item.title, href: item.href, count: item.count }))} />
      </div>
      <nav aria-label="Разделы настроек" className="hidden min-w-0 @4xl:block" data-testid="v3-settings-nav">
        <ul className="grid gap-1">
          {items.map((item) => (
            <li key={keyOf(item)}>
              <Button variant="ghost" asChild className="w-full justify-start aria-[current=page]:bg-surface-2 aria-[current=page]:text-fg">
                <Link href={item.href} aria-current={item.current ? "page" : undefined}>
                  <span className="min-w-0 flex-1 truncate text-left">{item.title}</span>
                  {item.count !== null ? <span className="tabular-nums text-fg-3" data-testid={item.key === "deletion" ? "v3-settings-deletion-count" : undefined}>{item.count}</span> : null}
                </Link>
              </Button>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}
