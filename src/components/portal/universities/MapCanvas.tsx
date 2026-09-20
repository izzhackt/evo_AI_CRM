"use client";

import {
  AttributionControl,
  LngLatBounds,
  Map as MapLibreMap,
  Marker,
  NavigationControl,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import type { UniversityMapPin } from "@/lib/portal/universities";

import type { UniversitiesMapStrings } from "./MapView";

/**
 * Холст MapLibre GL (PORT-3a). Тайлы — публичный инстанс OpenFreeMap:
 * условия проверены 2026-09-19 (без ключей и лимитов, коммерческое
 * использование разрешено; обязательная атрибуция OpenMapTiles + OSM) —
 * запись в docs/PLAN_CHANGES.md. Пины — только вузы с проверенной
 * координатой из src/lib/university-geo-library.json; клик по пину открывает
 * мини-карточку со ссылкой на карточку вуза.
 *
 * prefers-reduced-motion: без анимаций fitBounds и fade тайлов.
 */

const TILE_STYLES = {
  light: "https://tiles.openfreemap.org/styles/liberty",
  dark: "https://tiles.openfreemap.org/styles/dark",
} as const;

const ATTRIBUTION =
  '<a href="https://openfreemap.org" target="_blank" rel="noopener noreferrer">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener noreferrer">OpenMapTiles</a> © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors';

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

export function MapCanvas({ pins, base, strings, onReady, onFail }: MapCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const [selected, setSelected] = useState<UniversityMapPin | null>(null);
  // A11y (PORT-6a): id пина, чья карточка уже получила фокус, — чтобы
  // фокусировать диалог один раз на открытие/смену пина, а не на каждый
  // ре-рендер (инлайновый ref-колбэк вызывается на каждом рендере).
  const focusedCardId = useRef<string | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || mapRef.current !== null) return;
    let map: MapLibreMap;
    try {
      map = new MapLibreMap({
        container,
        style: window.matchMedia("(prefers-color-scheme: dark)").matches
          ? TILE_STYLES.dark
          : TILE_STYLES.light,
        center: [58, 32],
        zoom: 1.7,
        attributionControl: false,
        fadeDuration: reducedMotion() ? 0 : 300,
      });
    } catch {
      // WebGL недоступен — карта честно сообщает об ошибке, список работает.
      onFail();
      return;
    }
    mapRef.current = map;
    map.addControl(
      new AttributionControl({ compact: false, customAttribution: ATTRIBUTION }),
    );
    map.addControl(new NavigationControl({ showCompass: false }), "top-right");
    let loaded = false;
    map.on("load", () => {
      loaded = true;
      onReady();
    });
    map.on("error", () => {
      // Ошибка до первого рендера стиля означает, что карты не будет
      // (стиль/тайлы недоступны); одиночные ошибки тайлов после загрузки
      // MapLibre переживает сам.
      if (!loaded) onFail();
    });
    return () => {
      for (const marker of markersRef.current) marker.remove();
      markersRef.current = [];
      mapRef.current = null;
      map.remove();
    };
  }, [onReady, onFail]);

  useEffect(() => {
    const map = mapRef.current;
    if (map === null) return;
    for (const marker of markersRef.current) marker.remove();
    markersRef.current = pins.map((pin) => {
      const element = document.createElement("button");
      element.type = "button";
      element.className = "pt-map-marker";
      element.setAttribute("aria-label", pin.name);
      element.addEventListener("click", (event) => {
        event.stopPropagation();
        setSelected(pin);
      });
      return new Marker({ element })
        .setLngLat([pin.lng, pin.lat])
        .addTo(map);
    });
    focusedCardId.current = null;
    setSelected(null);
    if (pins.length > 0) {
      const bounds = new LngLatBounds();
      for (const pin of pins) bounds.extend([pin.lng, pin.lat]);
      map.fitBounds(bounds, {
        padding: 56,
        maxZoom: 11,
        duration: reducedMotion() ? 0 : 600,
      });
    }
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
            // Инлайновый ref-колбэк вызывается на каждом рендере (null → node),
            // поэтому сбрасываем маркер только при настоящем закрытии (см.
            // кнопку закрытия и эффект пинов), а не в null-ветке.
            if (node !== null && focusedCardId.current !== selected.id) {
              focusedCardId.current = selected.id;
              node.focus();
            }
          }}
        >
          <h3 className="pt-map-card-name">{selected.name}</h3>
          <p className="pt-map-card-place">{selected.place}</p>
          <div className="pt-map-card-actions">
            <Link className="pt-btn" href={`${base}/${selected.id}`}>
              {strings.mapOpenCard}
              <span className="pt-sr-only"> — {selected.name}</span>
            </Link>
            <button
              type="button"
              className="pt-btn-ghost"
              onClick={() => {
                focusedCardId.current = null;
                // A11y: карточка размонтируется вместе с кнопкой закрытия —
                // возвращаем фокус на маркер выбранного вуза, а не на <body>.
                const index = pins.findIndex((pin) => pin.id === selected.id);
                markersRef.current[index]?.getElement().focus();
                setSelected(null);
              }}
            >
              {strings.mapCloseCard}
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
