"use client";

import {
  AttributionControl,
  LngLatBounds,
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  setWorkerUrl,
  type GeoJSONSource,
  type GeoJSONFeature,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { formatPortalString } from "@/lib/portal/i18n";
import type { UniversityMapPin } from "@/lib/portal/universities";
import { readDocumentTheme, type Theme } from "@/lib/theme";

import { maplibreWorkerUrl } from "./maplibre-worker-url";
import type { UniversitiesMapStrings } from "./MapView";

/**
 * Холст MapLibre GL (PORT-3a, S3: карта страны с кластерами). Тайлы —
 * публичный инстанс OpenFreeMap: условия проверены 2026-09-19 (без ключей и
 * лимитов, коммерческое использование разрешено; обязательная атрибуция
 * OpenMapTiles + OSM), запись в docs/PLAN_CHANGES.md. Подпись даёт сам
 * источник тайлов (TileJSON OpenFreeMap: «OpenFreeMap © OpenMapTiles Data
 * from OpenStreetMap», проверено 16.10.2026), один раз: своя подпись сверху
 * её повторяла (review S3 веба, F10). Пины: только вузы с проверенной
 * координатой из src/lib/university-geo-library.json.
 *
 * Кластеры (S3, как в iPhone 1.0): точки собирает GeoJSON-источник MapLibre
 * (`cluster: true`), а рисуются они DOM-кнопками: и одиночный вуз, и группа
 * доступны с клавиатуры и озвучиваются. Нажатие на группу приближает карту
 * до её распада, на вуз — открывает мини-карточку со ссылкой.
 *
 * prefers-reduced-motion: без анимаций fitBounds, приближения и fade тайлов.
 *
 * Тема (решение владельца 02.10): стиль берётся из <html data-theme> и
 * меняется на лету (setStyle на той же карте). Источник точек после смены
 * стиля добавляется заново (style.load), кнопки остаются на месте.
 */

const TILE_STYLES: Readonly<Record<Theme, string>> = {
  light: "https://tiles.openfreemap.org/styles/positron",
  dark: "https://tiles.openfreemap.org/styles/dark",
};

const SOURCE_ID = "pt-universities";
const LAYER_ID = "pt-universities-points";

function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export type MapCanvasProps = {
  pins: readonly UniversityMapPin[];
  base: string;
  strings: UniversitiesMapStrings;
  onReady: () => void;
  onFail: () => void;
};

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

export function MapCanvas({ pins, base, strings, onReady, onFail }: MapCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const pinsRef = useRef(pins);
  const markersRef = useRef(new Map<string, Marker>());
  const stringsRef = useRef(strings);
  const [selected, setSelected] = useState<UniversityMapPin | null>(null);
  // A11y (PORT-6a): id пина, чья карточка уже получила фокус, — чтобы
  // фокусировать диалог один раз на открытие/смену пина, а не на каждый
  // ре-рендер (инлайновый ref-колбэк вызывается на каждом рендере).
  const focusedCardId = useRef<string | null>(null);

  useEffect(() => {
    stringsRef.current = strings;
  }, [strings]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || mapRef.current !== null) return;
    let disposed = false;
    /** Создаёт карту; возвращает её разборку или null, если карты не будет. */
    const startMap = (container: HTMLDivElement): (() => void) | null => {
      let map: MapLibreMap;
      try {
        map = new MapLibreMap({
          container,
          style: TILE_STYLES[readDocumentTheme()],
          center: [58, 32],
          zoom: 1.7,
          attributionControl: false,
          fadeDuration: reducedMotion() ? 0 : 300,
        });
      } catch {
        // WebGL недоступен — карта честно сообщает об ошибке, города работают.
        onFail();
        return null;
      }
      mapRef.current = map;
      const markers = markersRef.current;
      map.addControl(new AttributionControl({ compact: false }));
      map.addControl(new NavigationControl({ showCompass: false }), "top-right");

      const ensureSource = () => {
        if (map.getSource(SOURCE_ID)) return;
        map.addSource(SOURCE_ID, {
          type: "geojson",
          data: featureCollection(pinsRef.current),
          cluster: true,
          clusterRadius: 44,
          clusterMaxZoom: 13,
        });
        // Невидимый слой: источник загружается и отдаёт точки и группы, а
        // рисуют их DOM-кнопки ниже.
        map.addLayer({ id: LAYER_ID, type: "circle", source: SOURCE_ID, paint: { "circle-radius": 0, "circle-opacity": 0 } });
      };

      const markerFor = (key: string, feature: GeoJSONFeature): Marker | null => {
        const existing = markers.get(key);
        if (existing) return existing;
        const coordinates = (feature.geometry as GeoJSON.Point).coordinates as [number, number];
        const properties = feature.properties as Record<string, unknown>;
        const element = document.createElement("button");
        element.type = "button";
        if (properties.cluster) {
          const count = Number(properties.point_count);
          const clusterId = Number(properties.cluster_id);
          element.className = "pt-map-cluster";
          // Кнопку двигает MapLibre (inline transform); масштаб при наведении
          // — у внутреннего круга, иначе он сбил бы положение.
          const badge = document.createElement("span");
          badge.className = "pt-map-cluster-dot";
          badge.setAttribute("aria-hidden", "true");
          badge.textContent = String(count);
          element.append(badge);
          element.setAttribute("aria-label", formatPortalString(stringsRef.current.mapCluster, { count: String(count) }));
          element.addEventListener("click", (event) => {
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
          element.className = "pt-map-marker";
          element.dataset.pinId = pin.id;
          const dot = document.createElement("span");
          dot.className = "pt-map-dot";
          dot.setAttribute("aria-hidden", "true");
          element.append(dot);
          element.setAttribute("aria-label", pin.name);
          element.addEventListener("click", (event) => {
            event.stopPropagation();
            setSelected(pin);
          });
        }
        const marker = new Marker({ element }).setLngLat(coordinates).addTo(map);
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
      map.on("error", () => {
        // Ошибка до первого рендера стиля означает, что карты не будет
        // (стиль/тайлы недоступны); одиночные ошибки тайлов после загрузки
        // MapLibre переживает сам.
        if (!loaded) onFail();
      });
      let theme = readDocumentTheme();
      const themeObserver = new MutationObserver(() => {
        const next = readDocumentTheme();
        if (next === theme) return;
        theme = next;
        map.setStyle(TILE_STYLES[next]);
      });
      themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
      return () => {
        themeObserver.disconnect();
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

  return (
    <>
      <div ref={containerRef} className="pt-map-canvas" />
      {selected !== null ? (
        // A11y (PORT-6a): немодальный диалог получает фокус при открытии и
        // при смене пина — без этого фокус оставался на маркере и карточку
        // приходилось искать табом вслепую.
        <div
          className="pt-map-card"
          role="dialog"
          aria-label={selected.name}
          tabIndex={-1}
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
          <h3 className="pt-map-card-name">{selected.name}</h3>
          <p className="pt-map-card-place">{selected.place}</p>
          <div className="pt-map-card-actions">
            <Link className="pt-btn" href={`${base}/${selected.id}`}>
              {strings.mapOpenCard}
              <span className="pt-sr-only">, {selected.name}</span>
            </Link>
            <button type="button" className="pt-btn-ghost" onClick={closeCard}>
              {strings.mapCloseCard}
            </button>
          </div>
        </div>
      ) : null}
    </>
  );

  function closeCard() {
    if (selected === null) return;
    focusedCardId.current = null;
    // A11y: карточка размонтируется вместе с кнопкой закрытия — возвращаем
    // фокус на кнопку выбранного вуза, а не на <body>.
    const marker = containerRef.current?.querySelector<HTMLElement>(`[data-pin-id="${CSS.escape(selected.id)}"]`);
    marker?.focus();
    setSelected(null);
  }
}

function fitToPins(map: MapLibreMap, pins: readonly UniversityMapPin[]) {
  if (pins.length === 0) return;
  const bounds = new LngLatBounds();
  for (const pin of pins) bounds.extend([pin.lng, pin.lat]);
  map.fitBounds(bounds, { padding: 64, maxZoom: 11, duration: reducedMotion() ? 0 : 600 });
}
