// Карта вузов страны: MapLibre Native (@maplibre/maplibre-react-native), тот же стиль и тайлы
// OpenFreeMap, что в вебе, без ключей. Точки только у вузов с проверенной координатой, группы
// собирает сам источник; нажатие на группу приближает, на точку открывает мини-карточку.
// Карта - второй путь к тем же вузам: вид «Списком» всегда доступен.
//
// Как в вебе (MapCanvas.tsx, MapView.tsx; аудит паритета 25.11.2026, G43): кнопки «+» и «-», пока карта грузится - «Загружаем карту…»,
// при «Уменьшить движение» камера прыгает без анимации, мини-карточка закрывается кнопкой «Закрыть» и кнопкой «Назад» Android,
// а каждый вуз на карте доступен читалке отдельной кнопкой (у веба маркеры - кнопки DOM; слои нативной карты читалка не видит).
import { Camera, GeoJSONSource, Layer, Map as MapView, type CameraRef, type GeoJSONSourceRef, type MapRef } from "@maplibre/maplibre-react-native";
import { Minus, Plus } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BackHandler, Platform, Pressable, View, useWindowDimensions, type AccessibilityActionEvent, type AccessibilityActionInfo, type NativeSyntheticEvent } from "react-native";

import { useLang } from "@/i18n/LangProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { announce, useReducedMotion } from "@/ui/a11y";
import { Button } from "@/ui/Button";
import { MIN_TARGET } from "@/ui/CardParts";
import { Text } from "@/ui/Text";

import { initialCamera, MAP_STYLES, MAX_ZOOM, MIN_ZOOM, pinsToGeoJSON, type MapPins } from "./map-data";

type PressLike = Readonly<{ features: GeoJSON.Feature[] }>;

/** Шаг кнопок «+» и «-» (один уровень масштаба, как у NavigationControl веба) и время плавного перехода. */
const ZOOM_STEP = 1;
const EASE_MS = 400;
const ZOOM_MS = 250;

/** Высота карты и поля экрана по бокам (по 16 pt у `Screen`): по ним считается рамка камеры. */
const MAP_HEIGHT = 420;
const SCREEN_GUTTERS = 32;

/**
 * Вид, невидимый глазу и видимый читалке: 1 x 1 pt без фона. Читалка (VoiceOver, TalkBack) не видит слоёв нативной карты, а кнопка
 * размером в точку у неё есть; пока читалка выключена, она никому не мешает. Касаниям вид недоступен (`pointerEvents="none"` на
 * слое): вуз открывается только жестом читалки, а не касанием левого верхнего угла карты.
 */
const READER_ONLY = { position: "absolute", left: 0, top: 0, width: 1, height: 1, overflow: "hidden" } as const;
/** TalkBack доставляет двойное касание действием `activate` (ACTION_CLICK), а не касанием экрана; на iOS для этого `onAccessibilityTap`. */
const ACTIVATE: readonly AccessibilityActionInfo[] = [{ name: "activate" }];

export function CatalogMap({ pins, onOpen, onFail }: { pins: MapPins; onOpen: (id: string) => void; onFail: () => void }) {
  const { tokens, scheme } = useTheme();
  const { t, m } = useLang();
  const strings = t("universities");
  const reduced = useReducedMotion();
  const camera = useRef<CameraRef>(null);
  const map = useRef<MapRef>(null);
  const source = useRef<GeoJSONSourceRef>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  const { width } = useWindowDimensions();
  const data = useMemo(() => pinsToGeoJSON(pins), [pins]);
  // Рамка считается по окну карты: на планшете та же рамка встаёт глубже, чем на телефоне (камера принимает её один раз, при показе).
  const initial = useMemo(() => initialCamera(pins, { width: width - SCREEN_GUTTERS, height: MAP_HEIGHT }), [pins, width]);
  const pin = selected === null ? null : (pins[selected] ?? null);

  const close = useCallback(() => setSelected(null), []);
  // Кнопка «Назад» Android закрывает мини-карточку, а не уводит со страницы (веб: Esc закрывает карточку).
  useEffect(() => {
    if (pin === null) return undefined;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      setSelected(null);
      return true;
    });
    return () => subscription.remove();
  }, [pin]);

  const onPress = async (event: NativeSyntheticEvent<PressLike>) => {
    // Нажатие на точку не должно доходить до карты: её onPress закрывает мини-карточку.
    event.stopPropagation();
    const feature = event.nativeEvent.features[0];
    if (!feature) return;
    const props = (feature.properties ?? {}) as Record<string, unknown>;
    const center = (feature.geometry as GeoJSON.Point).coordinates as [number, number];
    if (typeof props.cluster_id === "number") {
      setSelected(null);
      const zoom = await source.current?.getClusterExpansionZoom(props.cluster_id).catch(() => undefined);
      camera.current?.easeTo({ center, zoom: (zoom ?? 6) + 0.2, duration: reduced ? 0 : EASE_MS });
    } else if (typeof props.pin === "number") {
      setSelected(props.pin);
    }
  };

  /** «+» и «-»: на уровень ближе или дальше от нынешнего масштаба (камера знает его только по запросу), в пределах карты. */
  const zoomBy = async (step: number) => {
    const current = await map.current?.getZoom().catch(() => undefined);
    if (current === undefined) return;
    camera.current?.zoomTo(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, current + step)), { duration: reduced ? 0 : ZOOM_MS });
  };

  const choose = (index: number) => {
    setSelected(index);
    const chosen = pins[index];
    if (chosen) announce(`${chosen.name}. ${chosen.place}`);
  };

  return (
    <View style={{ height: MAP_HEIGHT, borderRadius: tokens.radiusCard, overflow: "hidden", borderWidth: 1, borderColor: tokens.line }} accessibilityLabel={strings.mapAria} testID="catalog-map">
      {/* Нативный вид карты читалке не нужен: она идёт по кнопкам вузов ниже. */}
      <View style={{ flex: 1 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <MapView
          ref={map}
          style={{ flex: 1 }}
          mapStyle={MAP_STYLES[scheme === "dark" ? "dark" : "light"]}
          logo={false}
          attribution
          attributionPosition={{ bottom: 8, right: 8 }}
          compass={false}
          onDidFinishLoadingMap={() => setLoaded(true)}
          onDidFailLoadingMap={onFail}
          onPress={close}
        >
          <Camera ref={camera} initialViewState={initial} />
          <GeoJSONSource ref={source} id="universities" data={data} cluster clusterRadius={44} clusterMaxZoom={13} onPress={onPress}>
            {/* Подпись и кольцо берутся из токенов темы: белая подпись на светлом акценте тёмной темы давала около 3,3:1 (G43). */}
            <Layer
              id="clusters"
              type="circle"
              filter={["has", "point_count"]}
              paint={{ "circle-color": tokens.accent, "circle-radius": ["step", ["get", "point_count"], 18, 10, 22, 50, 28], "circle-stroke-width": 2, "circle-stroke-color": tokens.surface }}
            />
            <Layer
              id="cluster-count"
              type="symbol"
              filter={["has", "point_count"]}
              layout={{ "text-field": ["get", "point_count_abbreviated"], "text-size": 13, "text-font": ["Noto Sans Bold"], "text-allow-overlap": true }}
              paint={{ "text-color": tokens.onAccent }}
            />
            <Layer
              id="points"
              type="circle"
              filter={["!", ["has", "point_count"]]}
              paint={{ "circle-color": tokens.accent, "circle-radius": 9, "circle-stroke-width": 3, "circle-stroke-color": tokens.surface }}
            />
          </GeoJSONSource>
        </MapView>
      </View>

      {/* Каждый вуз на карте - кнопка для читалки (веб: маркеры - кнопки с aria-label); касанием не открывается (см. READER_ONLY). */}
      <View accessible={false} pointerEvents="none" style={READER_ONLY} testID="map-reader-pins">
        {pins.map((entry, index) => (
          <View
            key={entry.id}
            accessible
            accessibilityRole="button"
            accessibilityLabel={`${entry.name}. ${entry.place}`}
            accessibilityHint={strings.mapOpenCard}
            accessibilityActions={Platform.OS === "android" ? ACTIVATE : undefined}
            onAccessibilityTap={() => choose(index)}
            onAccessibilityAction={(event: AccessibilityActionEvent) => {
              if (event.nativeEvent.actionName === "activate") choose(index);
            }}
            testID={`map-pin-${entry.id}`}
            style={{ width: 1, height: 1 }}
          />
        ))}
      </View>

      {loaded ? (
        <View
          style={{ position: "absolute", top: 8, right: 8, borderRadius: tokens.radiusItem, borderWidth: 1, borderColor: tokens.line, backgroundColor: tokens.surface, overflow: "hidden" }}
          testID="map-zoom"
        >
          <Pressable accessibilityRole="button" accessibilityLabel={m("uni.mapZoomIn")} onPress={() => void zoomBy(ZOOM_STEP)} testID="map-zoom-in" style={{ width: MIN_TARGET, height: MIN_TARGET, alignItems: "center", justifyContent: "center" }}>
            <Plus size={20} strokeWidth={1.75} color={tokens.text} />
          </Pressable>
          <View style={{ height: 1, backgroundColor: tokens.line }} />
          <Pressable accessibilityRole="button" accessibilityLabel={m("uni.mapZoomOut")} onPress={() => void zoomBy(-ZOOM_STEP)} testID="map-zoom-out" style={{ width: MIN_TARGET, height: MIN_TARGET, alignItems: "center", justifyContent: "center" }}>
            <Minus size={20} strokeWidth={1.75} color={tokens.text} />
          </Pressable>
        </View>
      ) : (
        <View
          accessibilityRole="progressbar"
          accessibilityLabel={strings.mapLoading}
          accessibilityState={{ busy: true }}
          accessibilityLiveRegion="polite"
          testID="map-loading"
          style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, alignItems: "center", justifyContent: "center", backgroundColor: tokens.surface, opacity: 0.9 }}
        >
          <Text variant="secondary" tone="text2">
            {strings.mapLoading}
          </Text>
        </View>
      )}

      {pin ? (
        <View
          style={{ position: "absolute", zIndex: 10, elevation: 10, left: 8, right: 8, bottom: 8, padding: 12, gap: 8, borderRadius: tokens.radiusItem, backgroundColor: tokens.surface, borderWidth: 1, borderColor: tokens.line }}
          testID="map-card"
        >
          <View>
            <Text variant="body" bold>
              {pin.name}
            </Text>
            <Text variant="secondary" tone="text2">
              {pin.place}
            </Text>
          </View>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Button label={strings.mapOpenCard} onPress={() => onOpen(pin.id)} testID="map-open" style={{ flex: 1 }} />
            <Button variant="ghost" label={strings.mapCloseCard} onPress={close} testID="map-close" />
          </View>
        </View>
      ) : null}
    </View>
  );
}
