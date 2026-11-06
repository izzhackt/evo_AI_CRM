import { WidgetCard } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { CountryCuratorForm } from "@/components/staff/settings/CountryCuratorForm";
import { COUNTRY_CURATOR_TITLE, type CountryCuratorDirection, type CountryCuratorsRead } from "@/lib/country-curator-contract";

/**
 * «Кураторы стран» (миграция 335): куратор Китая и куратор Малайзии. Форма «Отчёта продаж» подставляет его сама по стране из
 * анкеты лида или из поля «Страна». В просмотре роли — только кто назначен.
 */
export function CountryCuratorsNext({ read, readOnly, ids }: Readonly<{
  read: CountryCuratorsRead;
  readOnly: boolean;
  ids: Readonly<Record<CountryCuratorDirection, string>>;
}>) {
  if (read.status !== "available") {
    return (
      <WidgetCard headingLevel={3} title="Кураторы стран" bodyClassName="grid gap-3">
        <p role="alert" className="t-body-compact text-fg">Не удалось прочитать кураторов стран.</p>
        <div><Button variant="outline" asChild><a href="/settings?section=curators">Обновить</a></Button></div>
      </WidgetCard>
    );
  }
  return (
    <div className="grid min-w-0 gap-4" data-testid="v3-settings-country-curators">
      {read.data.countries.map((row) => (
        <WidgetCard headingLevel={3} key={row.direction} title={COUNTRY_CURATOR_TITLE[row.direction]} bodyClassName="grid gap-3">
          {readOnly
            ? <p className="t-body-compact text-fg">{row.curatorLabel ?? "Куратор не задан"}</p>
            : <CountryCuratorForm row={row} curators={read.data.curators} requestId={ids[row.direction]} />}
        </WidgetCard>
      ))}
      <p className="t-meta text-fg-3">
        {readOnly ? "В режиме просмотра роли кураторы не меняются." : "Куратор страны сам подставится в «Отчёте продаж», если в анкете ученика первой выбрана эта страна. Его всегда можно сменить в самой форме."}
      </p>
    </div>
  );
}
