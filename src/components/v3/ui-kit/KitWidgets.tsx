import { InboxIcon } from "lucide-react";

import { EmptyState, HelpTip, KeyFacts, SectionTabs, StatTile, StatusBadge, WidgetCard } from "@/components/kit";
import { Button } from "@/components/ui/button";

/** Плитки, карточка с ключевыми данными, чипы, вкладки-ссылки и пустое состояние — на синтетических данных. */
export function KitWidgets({ tab }: Readonly<{ tab: string }>) {
  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Новые заявки" value={12} hint="за 7 дней" href="/v3/requests" />
        <StatTile label="Задачи на сегодня" value={5} />
        <StatTile label="Просрочено" value={3} tone="danger" hint="нужно сегодня" />
        <StatTile label="Оплаты за месяц" value={null} />
      </div>
      <WidgetCard title="Карточка записи" help="Не больше четырёх данных в строке. Значения, которых нет, не рисуются." actions={<Button variant="outline">Изменить</Button>}>
        <KeyFacts facts={[
          { label: "Источник", value: "Сайт" },
          { label: "Страна", value: "Китай" },
          { label: "Ответственный", value: "Менеджер Синтетический" },
          { label: "Следующий шаг", value: "Позвонить 28.10" },
          { label: "Бюджет", value: null },
          { label: "Языки", value: "Русский, английский" },
        ]} />
      </WidgetCard>
      <WidgetCard title="Чипы состояния" size="sm">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge label="Нейтральный" />
          <StatusBadge label="Готово" tone="ok" />
          <StatusBadge label="Ждём документы" tone="warn" />
          <StatusBadge label="Просрочено" tone="danger" />
          <StatusBadge label="Новая" tone="info" />
          <HelpTip>Красный — только проблема. Нет настоящего состояния — серое слово.</HelpTip>
        </div>
      </WidgetCard>
      <WidgetCard title="Вкладки-ссылки" help="Переход со своим адресом `?tab=`: его можно переслать и открыть без JavaScript.">
        <SectionTabs label="Разделы примера" value={tab} tabs={[
          { key: "overview", label: "Обзор", href: "/v3/ui-kit?tab=overview" },
          { key: "history", label: "История", count: 4, href: "/v3/ui-kit?tab=history" },
          { key: "files", label: "Файлы", count: null, href: "/v3/ui-kit?tab=files" },
        ]} />
      </WidgetCard>
      <WidgetCard title="Пустое состояние" size="sm">
        <EmptyState icon={InboxIcon} title="Заявок пока нет" description="Новые появятся здесь сами." />
      </WidgetCard>
    </>
  );
}
