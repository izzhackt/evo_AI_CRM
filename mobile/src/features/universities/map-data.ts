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

/** Камера: рамка по точкам; одна точка или все в одном месте - центр и масштаб города. */
export function initialCamera(pins: MapPins) {
  const bounds = pinsBounds(pins);
  if (bounds === null) return { center: [58, 32] as [number, number], zoom: 1.7 };
  if (bounds[0] === bounds[2] && bounds[1] === bounds[3]) return { center: [bounds[0], bounds[1]] as [number, number], zoom: 10 };
  return { bounds, padding: { top: 48, right: 48, bottom: 48, left: 48 } };
}
