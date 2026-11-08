"use client";

import {
  AttributionControl,
  LngLatBounds,
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  setWorkerUrl,
  type GeoJSONFeature,
  type GeoJSONSource,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { maplibreWorkerUrl } from "@/components/portal/universities/maplibre-worker-url";
import type { UniversityMapPin } from "@/lib/portal/universities";

/**
 * Холст карты страны в CRM: MapLibre GL, светлая карта OpenFreeMap (те же
 * условия и подпись, что у кабинета студента, запись PORT-3a в
 * docs/PLAN_CHANGES.md). Пины: только вузы с проверенной координатой.
 * Кластеры, как в кабинете, DOM-кнопки: и вуз, и группа доступны с
 * клавиатуры. Нажатие на группу приближает карту, на вуз открывает
 * мини-карточку со ссылкой на карточку вуза в CRM. Стили: токены CRM
 * (светлая тема), `portal.css` и тёмная тема сюда не подключаются.
 * prefers-reduced-motion: без анимаций приближения.
 */
const TILE_STYLE = "https://tiles.openfreemap.org/styles/positron";
const SOURCE_ID = "crm-universities";
const LAYER_ID = "crm-universities-points";

const FOCUS = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fg";
const MARKER_CLASS = `group grid size-11 cursor-pointer place-items-center rounded-full ${FOCUS}`;
const MARKER_DOT_CLASS = "size-4 rounded-full border-2 border-white bg-accent shadow-md transition-transform group-hover:scale-125";
const CLUSTER_CLASS = `group grid size-12 cursor-pointer place-items-center rounded-full ${FOCUS}`;
const CLUSTER_DOT_CLASS = "grid size-9 place-items-center rounded-full border-2 border-white bg-accent text-sm font-semibold tabular-nums text-on-accent shadow-md transition-transform group-hover:scale-110";

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export type UniversityGeoMapCanvasProps = Readonly<{
  pins: readonly UniversityMapPin[];
  onReady: () => void;
  onFail: () => void;
}>;

function featureCollection(pins: readonly UniversityMapPin[]): GeoJSON.FeatureCollection<GeoJSON.Point, { pin: number }> {
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

function fitToPins(map: MapLibreMap, pins: readonly UniversityMapPin[]) {
  if (pins.length === 0) return;
  const bounds = new LngLatBounds();
  for (const pin of pins) bounds.extend([pin.lng, pin.lat]);
  map.fitBounds(bounds, { padding: 64, maxZoom: 11, duration: reducedMotion() ? 0 : 600 });
}

export function UniversityGeoMapCanvas({ pins, onReady, onFail }: UniversityGeoMapCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const pinsRef = useRef(pins);
  const markersRef = useRef(new Map<string, Marker>());
  const focusedCardId = useRef<string | null>(null);
  const [selected, setSelected] = useState<UniversityMapPin | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || mapRef.current !== null) return;
    let disposed = false;
    const startMap = (element: HTMLDivElement): (() => void) | null => {
      let map: MapLibreMap;
      try {
        map = new MapLibreMap({
          container: element,
          style: TILE_STYLE,
          center: [58, 32],
          zoom: 1.7,
          attributionControl: false,
          fadeDuration: reducedMotion() ? 0 : 300,
        });
      } catch {
        // WebGL недоступен: карта честно сообщает об ошибке, списки работают.
        onFail();
        return null;
      }
      mapRef.current = map;
      const markers = markersRef.current;
      map.addControl(new AttributionControl({ compact: false }));
      map.addControl(new NavigationControl({ showCompass: false }), "top-right");

      const ensureSource = () => {
        if (map.getSource(SOURCE_ID)) return;
        map.addSource(SOURCE_ID, { type: "geojson", data: featureCollection(pinsRef.current), cluster: true, clusterRadius: 44, clusterMaxZoom: 13 });
        // Невидимый слой: источник отдаёт точки и группы, рисуют их кнопки.
        map.addLayer({ id: LAYER_ID, type: "circle", source: SOURCE_ID, paint: { "circle-radius": 0, "circle-opacity": 0 } });
      };

      const markerFor = (key: string, feature: GeoJSONFeature): Marker | null => {
        const existing = markers.get(key);
        if (existing) return existing;
        const coordinates = (feature.geometry as GeoJSON.Point).coordinates as [number, number];
        const properties = feature.properties as Record<string, unknown>;
        const button = document.createElement("button");
        button.type = "button";
        const dot = document.createElement("span");
        dot.setAttribute("aria-hidden", "true");
        if (properties.cluster) {
          const count = Number(properties.point_count);
          const clusterId = Number(properties.cluster_id);
          button.className = CLUSTER_CLASS;
          dot.className = CLUSTER_DOT_CLASS;
          dot.textContent = String(count);
          button.setAttribute("aria-label", `Вузов в этом месте: ${count}. Приблизить`);
          button.addEventListener("click", (event) => {
            event.stopPropagation();
            const source = map.getSource<GeoJSONSource>(SOURCE_ID);
            if (!source) return;
            void source.getClusterExpansionZoom(clusterId).then((zoom) => {
              map.easeTo({ center: coordinates, zoom: Math.min(zoom, 16), duration: reducedMotion() ? 0 : 400 });
            }, () => undefined);
          });
        } else {
          const pin = pinsRef.current[Number(properties.pin)];
          if (!pin) return null;
          button.className = MARKER_CLASS;
          button.dataset.pinId = pin.id;
          dot.className = MARKER_DOT_CLASS;
          button.setAttribute("aria-label", pin.name);
          button.addEventListener("click", (event) => {
            event.stopPropagation();
            setSelected(pin);
          });
        }
        button.append(dot);
        const marker = new Marker({ element: button }).setLngLat(coordinates).addTo(map);
        markers.set(key, marker);
        return marker;
      };

      const syncMarkers = () => {
        if (!map.getSource(SOURCE_ID) || !map.isSourceLoaded(SOURCE_ID)) return;
        const visible = new Set<string>();
        for (const feature of map.querySourceFeatures(SOURCE_ID)) {
          const properties = feature.properties as Record<string, unknown>;
          const key = properties.cluster ? `c${String(properties.cluster_id)}` : `p${String(properties.pin)}`;
          if (visible.has(key)) continue;
          if (markerFor(key, feature)) visible.add(key);
        }
        for (const [key, marker] of markers) {
          if (!visible.has(key)) {
            marker.remove();
            markers.delete(key);
          }
        }
      };

      let loaded = false;
      map.on("style.load", ensureSource);
      map.on("load", () => {
        loaded = true;
        ensureSource();
        fitToPins(map, pinsRef.current);
        onReady();
      });
      map.on("render", syncMarkers);
      // Ошибка до первого рендера стиля значит, что карты не будет;
      // одиночные ошибки тайлов после загрузки MapLibre переживает сам.
      map.on("error", () => {
        if (!loaded) onFail();
      });
      return () => {
        for (const marker of markers.values()) marker.remove();
        markers.clear();
        mapRef.current = null;
        map.remove();
      };
    };

    let stop: (() => void) | null = null;
    // Воркер MapLibre собирается до создания карты (maplibre-worker-url.ts).
    maplibreWorkerUrl().then((url) => {
      if (disposed) return;
      setWorkerUrl(url);
      stop = startMap(container);
    }, () => {
      if (!disposed) onFail();
    });
    return () => {
      disposed = true;
      stop?.();
    };
  }, [onReady, onFail]);

  useEffect(() => {
    pinsRef.current = pins;
    const map = mapRef.current;
    if (map === null) return;
    for (const marker of markersRef.current.values()) marker.remove();
    markersRef.current.clear();
    map.getSource<GeoJSONSource>(SOURCE_ID)?.setData(featureCollection(pins));
    focusedCardId.current = null;
    setSelected(null);
    if (map.loaded()) fitToPins(map, pins);
  }, [pins]);

  const closeCard = () => {
    if (selected === null) return;
    focusedCardId.current = null;
    // Фокус возвращается на кнопку выбранного вуза, а не на <body>.
    containerRef.current?.querySelector<HTMLElement>(`[data-pin-id="${CSS.escape(selected.id)}"]`)?.focus();
    setSelected(null);
  };

  return (
    <>
      {/* Размер задаёт обёртка: `.maplibregl-map` (без слоя) перебивает `absolute` утилит на самом контейнере карты. */}
      <div className="absolute inset-0">
        <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
      </div>
      {selected !== null ? (
        <div
          role="dialog"
          aria-label={selected.name}
          tabIndex={-1}
          data-testid="university-geo-map-card"
          className="absolute inset-x-3 bottom-3 z-10 grid gap-2 rounded-card border border-border bg-surface p-4 shadow-lg outline-none sm:right-auto sm:w-80"
          ref={(node) => {
            if (node !== null && focusedCardId.current !== selected.id) {
              focusedCardId.current = selected.id;
              node.focus();
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") closeCard();
          }}
        >
          <h3 className="t-item text-fg">{selected.name}</h3>
          <p className="t-meta text-fg-2">{selected.place}</p>
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/universities/${selected.id}`}
              className="v3-raised inline-flex h-11 items-center rounded-ctl border border-accent bg-accent px-4 t-label text-on-accent hover:border-accent-2 hover:bg-accent-2"
            >
              Открыть карточку<span className="sr-only">, {selected.name}</span>
            </Link>
            <button type="button" onClick={closeCard} className="inline-flex h-11 items-center rounded-ctl border border-border bg-surface px-4 t-label text-fg-2 hover:bg-surface-2 hover:text-fg">
              Закрыть
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
