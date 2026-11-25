// Данные карты (чистые функции, без нативной карты): GeoJSON из точек, рамка камеры, стили.
// Группы (кластеры) собирает сам источник MapLibre (`cluster: true`), как в вебе.
import type { UniversityMapPin } from "@web/lib/portal/universities";

export type MapPins = readonly UniversityMapPin[];

export function pinsToGeoJSON(pins: MapPins): GeoJSON.FeatureCollection<GeoJSON.Point, { pin: number }> {
  return {
    type: "FeatureCollection",
    features: pins.map((pin, index) => ({
      type: "Feature",
      id: index,
      properties: { pin: index },
      geometry: { type: "Point", coordinates: [pin.lng, pin.lat] },
    })),
  };
}

/** [запад, юг, восток, север] или null, если точек нет. */
export function pinsBounds(pins: MapPins): [number, number, number, number] | null {
  if (pins.length === 0) return null;
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const pin of pins) {
    west = Math.min(west, pin.lng);
    east = Math.max(east, pin.lng);
    south = Math.min(south, pin.lat);
    north = Math.max(north, pin.lat);
  }
  return [west, south, east, north];
}

/** Тайлы - публичный OpenFreeMap, как в вебе (src/components/portal/universities/MapCanvas.tsx). */
export const MAP_STYLES = {
  light: "https://tiles.openfreemap.org/styles/positron",
  dark: "https://tiles.openfreemap.org/styles/dark",
} as const;

/**
 * Самый крупный масштаб, на который камера сама приближается к вузам (веб: `fitBounds(..., { maxZoom: 11 })` в MapCanvas.tsx).
 * Дальше студент приближает сам; рамка по двум кампусам в одном городе не должна уезжать на уровень улиц.
 */
export const FIT_MAX_ZOOM = 11;
/** Поле вокруг рамки точек, pt. */
export const FIT_PADDING = 48;
/** Пределы масштаба для кнопок «+» и «-»: целый мир и 22 (предел MapLibre по умолчанию; веб своих пределов карте не задаёт). */
export const MIN_ZOOM = 0;
export const MAX_ZOOM = 22;

/** Размер окна карты на экране, pt. */
export type MapViewport = Readonly<{ width: number; height: number }>;

/** Мир на нулевом масштабе занимает 512 pt (тайлы MapLibre по 512 px), на масштабе z - `512 * 2^z`. */
const WORLD_PT = 512;

/** Положение широты в проекции Меркатора: доля высоты мира от севера (0) к югу (1), как считает MapLibre. */
function mercatorY(lat: number): number {
  const clamped = Math.max(-85.0511, Math.min(85.0511, lat));
  return 0.5 - Math.log(Math.tan(Math.PI / 4 + (clamped * Math.PI) / 360)) / (2 * Math.PI);
}

/**
 * Масштаб, на котором рамка целиком влезает в окно карты с полями: тот же расчёт, что у `fitBounds` MapLibre (веба и нативной карты)
 * без ограничения сверху. Рамка без размера (одна точка, точки в одном месте) - бесконечность.
 */
export function fitZoom(bounds: [number, number, number, number], viewport: MapViewport, padding = FIT_PADDING): number {
  const [west, south, east, north] = bounds;
  const wide = (east - west) / 360;
  const tall = mercatorY(south) - mercatorY(north);
  const room = (side: number) => Math.max(1, side - 2 * padding);
  const byWidth = wide > 0 ? Math.log2(room(viewport.width) / (WORLD_PT * wide)) : Infinity;
  const byHeight = tall > 0 ? Math.log2(room(viewport.height) / (WORLD_PT * tall)) : Infinity;
  return Math.min(byWidth, byHeight);
}

/**
 * Камера: рамка по точкам; если рамка по окну карты встала бы крупнее предельного масштаба (один кампус, два в одном городе) -
 * центр между точками на предельном масштабе (как у веба); разброс - рамка с полями. Окно берётся из размера экрана: на планшете
 * та же рамка уходит глубже, чем на телефоне, и порог зависит от ширины.
 */
export function initialCamera(pins: MapPins, viewport: MapViewport) {
  const bounds = pinsBounds(pins);
  if (bounds === null) return { center: [58, 32] as [number, number], zoom: 1.7 };
  if (fitZoom(bounds, viewport) > FIT_MAX_ZOOM) {
    return { center: [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2] as [number, number], zoom: FIT_MAX_ZOOM };
  }
  return { bounds, padding: { top: FIT_PADDING, right: FIT_PADDING, bottom: FIT_PADDING, left: FIT_PADDING } };
}
