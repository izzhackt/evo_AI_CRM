import { StatTile } from "@/components/kit";
import type { TodayBandView } from "@/lib/v3/today-queue";

/** Адрес виджета группы на странице: плитка переводит к нему. */
export const todayWidgetId = (band: string) => `today-band-${band}`;

/** Название группы без даты: «Сегодня · сб 26.09» → «Сегодня»; число дня уже стоит под заголовком страницы. */
export const todayBandTitle = (label: string) => label.split(" · ")[0];

/**
 * Плитки групп: число строк каждой непустой группы. Числа только из чтения (`band.count`): у группы без честного
 * числа — «—», выдуманных итогов нет. Красным окрашено только число просроченного и только когда оно больше нуля.
 */
export function TodayTiles({ bands }: Readonly<{ bands: readonly TodayBandView[] }>) {
  return (
    <ul className="grid grid-cols-2 gap-3 md:grid-cols-5" aria-label="Числа по группам" data-testid="today-tiles">
      {bands.map((band) => (
        <li key={band.band} className="min-w-0">
          <StatTile label={todayBandTitle(band.label)} value={band.count} tone={band.danger && (band.count ?? 0) > 0 ? "danger" : "neutral"} href={`#${todayWidgetId(band.band)}`} />
        </li>
      ))}
    </ul>
  );
}
