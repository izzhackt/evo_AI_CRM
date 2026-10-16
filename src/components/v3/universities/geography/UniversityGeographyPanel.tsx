import type { StaffGeography } from "@/lib/catalog-geography";
import type { UniversityContent } from "@/lib/platform-university-catalog";
import { isStudyCountryCode } from "@/lib/study-countries";

import { UniversityCityPicker } from "./UniversityCityPicker";
import { UniversityCosts } from "./UniversityCosts";

/**
 * Город и стоимость вуза для кабинета студента (план 7.5). Только у
 * редактора каталога: без права блока нет вовсе (страница не читает
 * `staff_catalog_geography_v1`). Вузы вне шести стран у студента не видны,
 * им города и стоимость не ведутся.
 */
export function UniversityGeographyPanel({ institutionId, content, geography, canConfirm, today }: Readonly<{
  institutionId: string; content: UniversityContent; geography: StaffGeography | null; canConfirm: boolean; today: string;
}>) {
  const frame = "mt-10 space-y-10 border-t border-border pt-6";
  if (geography === null) {
    return <div className={frame}><p role="alert" className="rounded-card border border-border bg-surface p-5 t-body-compact text-danger">Не удалось загрузить город и стоимость. Обновите страницу: это не значит, что строк нет.</p></div>;
  }
  const institution = geography.institutions.find((item) => item.id === institutionId);
  if (!institution || !isStudyCountryCode(content.country)) {
    return <div className={frame}><p className="t-body-compact text-fg-2">Город и стоимость ведутся только для вузов шести стран кабинета студента.</p></div>;
  }
  return (
    <div className={frame} data-testid="university-geography">
      <UniversityCityPicker institution={institution} cities={geography.cities} />
      <UniversityCosts
        institutionId={institutionId}
        country={institution.country}
        programs={content.programs.map((program) => ({ id: program.id, title: program.title, level: program.level }))}
        costs={geography.costs.filter((row) => row.institutionId === institutionId)}
        rates={geography.fxRates}
        canConfirm={canConfirm}
        today={today}
      />
    </div>
  );
}
