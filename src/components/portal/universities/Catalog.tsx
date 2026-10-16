import type { Locale } from "@/lib/i18n-data";
import type { PublishedUniversity } from "@/lib/platform-university-catalog";
import { formatPortalString, type PortalStrings } from "@/lib/portal/i18n";
import { publishedTileModel, tileStrings } from "@/lib/portal/university-tiles";

import { UniversityTile } from "./UniversityTile";

/**
 * Общие части портального каталога «Атлас». Экраны S3 (страны → города →
 * вузы) собраны из Places/UniversityTile; здесь карточка вуза по полной
 * опубликованной карточке (для «Избранного»), честная ошибка чтения и
 * сводка карты. Staff продолжает пользоваться
 * `src/components/v3/universities/UniversityCatalogue` (разделение аудиторий
 * по дизайн-контракту).
 */

type Strings = PortalStrings<"universities">;

export function UniversityCard({
  item,
  strings,
  locale,
  now,
  favored = null,
  priority = false,
}: {
  item: PublishedUniversity;
  strings: Strings;
  locale: Locale;
  now: Date;
  /** null: состояние избранного неизвестно (toggle не показывается). */
  favored?: boolean | null;
  /** Первые карточки экрана: фото грузится сразу, не лениво. */
  priority?: boolean;
}) {
  return (
    <UniversityTile
      model={publishedTileModel(item, { strings, locale, now, favored })}
      strings={tileStrings(strings)}
      priority={priority}
      headingLevel={2}
    />
  );
}

export function UniversitiesUnavailable({ strings }: { strings: Strings }) {
  return <p role="alert" className="pt-alert">{strings.unavailable}</p>;
}

/** Честная сводка карты: сколько точек показано и сколько вузов без точки. */
export function UniversitiesMapSummary({
  shown,
  missing,
  strings,
}: {
  shown: number;
  missing: number;
  strings: Strings;
}) {
  return (
    <p className="pt-map-note">
      <span>{formatPortalString(strings.mapShown, { count: String(shown) })}</span>
      {missing > 0 ? (
        <span> · {formatPortalString(strings.mapWithoutPoint, { count: String(missing) })}</span>
      ) : null}
    </p>
  );
}
