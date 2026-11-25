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
/**
 * Рамка уже этого размера (градусов по большей стороне) при ширине карты около 360 pt дала бы масштаб крупнее `FIT_MAX_ZOOM`:
 * ширина мира 360° занимает 256 * 2^z пунктов, значит на 360 pt при z = 11 помещается около 0,1°. Такие точки вместо рамки
 * показываются центром на предельном масштабе.
 */
const MIN_FIT_SPAN = 0.1;

/** Камера: рамка по точкам; одна точка или точки в одном месте - центр на предельном масштабе (как у веба); разброс - рамка. */
export function initialCamera(pins: MapPins) {
  const bounds = pinsBounds(pins);
  if (bounds === null) return { center: [58, 32] as [number, number], zoom: 1.7 };
  if (Math.max(bounds[2] - bounds[0], bounds[3] - bounds[1]) < MIN_FIT_SPAN) {
    return { center: [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2] as [number, number], zoom: FIT_MAX_ZOOM };
  }
  return { bounds, padding: { top: 48, right: 48, bottom: 48, left: 48 } };
}
