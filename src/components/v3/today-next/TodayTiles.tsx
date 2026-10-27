import { StatTile } from "@/components/kit";
import type { TodayBandView } from "@/lib/v3/today-queue";

/** Адрес виджета группы на странице: плитка переводит к нему. */
export const todayWidgetId = (band: string) => `today-band-${band}`;

/** Название группы без даты: «Сегодня · сб 26.09» → «Сегодня»; число дня уже стоит под заголовком страницы. */
export const todayBandTitle = (label: string) => label.split(" · ")[0];

/**
 * Плитки групп: число строк каждой непустой группы. Числа только из чтения (`band.count`): у группы без честного
 * числа — «—», выдуманных итогов нет. Красным окрашено только число просроченного и только когда оно больше нуля.
 * Телефон: один ряд, который листается вбок (три ряда плиток уводили бы строки ниже первого экрана); от `md` —
 * сетка по числу групп (`auto-fit`): у дня с двумя группами нет пустых пятых долей.
 */
export function TodayTiles({ bands }: Readonly<{ bands: readonly TodayBandView[] }>) {
  return (
    <ul
      className="-mx-4 flex snap-x gap-3 scroll-px-4 overflow-x-auto px-4 py-1 sm:-mx-6 sm:scroll-px-6 sm:px-6 md:mx-0 md:grid md:grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] md:overflow-visible md:px-0 md:py-0"
      aria-label="Числа по группам"
      data-testid="today-tiles"
    >
      {bands.map((band) => (
        <li key={band.band} className="w-36 shrink-0 snap-start md:w-auto md:min-w-0 md:shrink">
          <StatTile label={todayBandTitle(band.label)} value={band.count} tone={band.danger && (band.count ?? 0) > 0 ? "danger" : "neutral"} href={`#${todayWidgetId(band.band)}`} />
        </li>
      ))}
    </ul>
  );
}
