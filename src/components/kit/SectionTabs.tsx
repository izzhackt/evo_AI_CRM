import { QueueViewTabs } from "@/components/v3/queue/QueueViewTabs";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

export type SectionTab = Readonly<{
  key: string;
  label: string;
  /** Число у вкладки; `null` — числа в данных нет, не рисуется. */
  count?: number | null;
  /** Адрес вкладки (`?tab=`): переход по ссылке. Если он есть у всех вкладок, это ряд ссылок. */
  href?: string;
  /** Содержимое для вкладок без адреса (переключаются на месте). */
  content?: React.ReactNode;
}>;

/**
 * Разделы карточки. Два вида:
 *  - у каждой вкладки есть `href` — ряд настоящих ссылок с `aria-current` (`QueueViewTabs`): вкладку можно
 *    переслать, вернуться кнопкой «Назад», открыть без JavaScript; текущую задаёт `value`. Так устроены
 *    профиль и страница агента, и CLAUDE.md требует оставить переходы ссылками;
 *  - иначе — вкладки на месте (Radix): `content` у каждой, `value`/`onValueChange` или `defaultValue`.
 * Набор вкладок зависит от человека/записи: вкладку, которой нет, не передают (пустой вкладки с объяснением нет).
 */
export function SectionTabs({
  label,
  tabs,
  value,
  defaultValue,
  onValueChange,
  className,
  focusable = false,
}: Readonly<{
  label: string;
  tabs: readonly SectionTab[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  className?: string;
  /** Ряд ссылок принимает фокус сам (профиль): на него возвращается фокус после ответа в панели. */
  focusable?: boolean;
}>) {
  if (tabs.length > 0 && tabs.every((tab) => tab.href)) {
    return (
      <div className={cn("min-w-0", className)}>
        <QueueViewTabs
          label={label}
          focusable={focusable}
          tabs={tabs.map((tab) => ({ key: tab.key, label: tab.label, href: tab.href ?? "#", count: tab.count ?? null, current: tab.key === value }))}
        />
      </div>
    );
  }
  return (
    <Tabs value={value} defaultValue={value === undefined ? (defaultValue ?? tabs[0]?.key) : undefined} onValueChange={onValueChange} className={className}>
      <TabsList aria-label={label}>
        {tabs.map((tab) => (
          <TabsTrigger key={tab.key} value={tab.key}>
            {tab.label}
            {typeof tab.count === "number" ? <span className="tabular-nums text-fg-3">{tab.count}</span> : null}
          </TabsTrigger>
        ))}
      </TabsList>
      {tabs.map((tab) => (
        <TabsContent key={tab.key} value={tab.key}>
          {tab.content}
        </TabsContent>
      ))}
    </Tabs>
  );
}
