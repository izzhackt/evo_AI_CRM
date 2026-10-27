import { AlertTriangleIcon } from "lucide-react";
import Link from "next/link";

import { KeyFacts, WidgetCard } from "@/components/kit";
import { Button } from "@/components/ui/button";

/** Факты эксплуатации (аудит 26.09): не тревога дня, а то, что администратору нужно знать о платформе; остаются на виду. */
const OPERATIONS: readonly (readonly [string, string])[] = [
  ["Автоматические оповещения", "Не подключены. При сбое свяжитесь с техническим специалистом."],
  ["Восстановление данных", "Восстановление из резервной копии не проверено."],
  ["План восстановления", "Допустимая потеря данных и время восстановления не согласованы."],
];

/** «Платформа»: что сейчас запущено, переход к настройке «Отчёта продаж» (если есть право) и факты эксплуатации. */
export function PlatformNext({ platform, salesImportHref, salesManagersHref }: Readonly<{ platform: string; salesImportHref?: string; salesManagersHref?: string }>) {
  const links = [[salesImportHref, "Перенос данных"], [salesManagersHref, "Менеджеры в отчёте"]].filter((entry): entry is [string, string] => Boolean(entry[0]));
  return (
    <div className="grid min-w-0 gap-4" data-testid="v3-settings-platform">
      <WidgetCard headingLevel={3} title="Что сейчас запущено" help="Настройки окружения меняются на сервере, из браузера их менять нельзя.">
        <KeyFacts columns={2} facts={[{ label: "База данных", value: platform }, { label: "Настройки окружения", value: "только для чтения" }]} />
      </WidgetCard>
      {links.length ? (
        <WidgetCard headingLevel={3} title="Отчёт продаж" bodyClassName="flex flex-wrap gap-2">
          {links.map(([href, label]) => <Button key={label} variant="outline" asChild><Link href={href}>{label}</Link></Button>)}
        </WidgetCard>
      ) : null}
      <WidgetCard headingLevel={3} title="Эксплуатация">
        <ul className="grid gap-3">
          {OPERATIONS.map(([what, why]) => (
            <li key={what} className="flex items-start gap-2">
              <AlertTriangleIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warn" />
              <p className="t-body-compact min-w-0 text-fg-2"><span className="font-medium text-fg">{what}.</span> {why}</p>
            </li>
          ))}
        </ul>
      </WidgetCard>
    </div>
  );
}
