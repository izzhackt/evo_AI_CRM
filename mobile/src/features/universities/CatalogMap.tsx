// Карта вузов страны: MapLibre Native (@maplibre/maplibre-react-native), тот же стиль и тайлы
// OpenFreeMap, что в вебе, без ключей. Точки только у вузов с проверенной координатой, группы
// собирает сам источник; нажатие на группу приближает, на точку открывает мини-карточку.
// Карта - второй путь к тем же вузам: вид «Списком» всегда доступен.
import { Camera, GeoJSONSource, Layer, Map as MapView, type CameraRef, type GeoJSONSourceRef } from "@maplibre/maplibre-react-native";
import { useMemo, useRef, useState } from "react";
import type { NativeSyntheticEvent } from "react-native";
import { View } from "react-native";

import { useLang } from "@/i18n/LangProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { Button } from "@/ui/Button";
import { Text } from "@/ui/Text";

import { initialCamera, MAP_STYLES, pinsToGeoJSON, type MapPins } from "./map-data";

type PressLike = Readonly<{ features: GeoJSON.Feature[] }>;

export function CatalogMap({ pins, onOpen, onFail }: { pins: MapPins; onOpen: (id: string) => void; onFail: () => void }) {
  const { tokens, scheme } = useTheme();
  const { t } = useLang();
  const strings = t("universities");
  const camera = useRef<CameraRef>(null);
  const source = useRef<GeoJSONSourceRef>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const data = useMemo(() => pinsToGeoJSON(pins), [pins]);
  const initial = useMemo(() => initialCamera(pins), [pins]);

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
      camera.current?.easeTo({ center, zoom: (zoom ?? 6) + 0.2, duration: 400 });
    } else if (typeof props.pin === "number") {
      setSelected(props.pin);
    }
  };

  const pin = selected === null ? null : (pins[selected] ?? null);
  return (
    <View style={{ height: 420, borderRadius: tokens.radiusCard, overflow: "hidden", borderWidth: 1, borderColor: tokens.line }} accessibilityLabel={strings.mapAria} testID="catalog-map">
      <MapView
        style={{ flex: 1 }}
        mapStyle={MAP_STYLES[scheme === "dark" ? "dark" : "light"]}
        logo={false}
        attribution
        attributionPosition={{ bottom: 8, right: 8 }}
        compass={false}
        onDidFailLoadingMap={onFail}
        onPress={() => setSelected(null)}
      >
        <Camera ref={camera} initialViewState={initial} />
        <GeoJSONSource ref={source} id="universities" data={data} cluster clusterRadius={44} clusterMaxZoom={13} onPress={onPress}>
          <Layer
            id="clusters"
            type="circle"
            filter={["has", "point_count"]}
            paint={{ "circle-color": tokens.accent, "circle-radius": ["step", ["get", "point_count"], 18, 10, 22, 50, 28], "circle-stroke-width": 2, "circle-stroke-color": "#ffffff" }}
          />
          <Layer
            id="cluster-count"
            type="symbol"
            filter={["has", "point_count"]}
            layout={{ "text-field": ["get", "point_count_abbreviated"], "text-size": 13, "text-font": ["Noto Sans Bold"], "text-allow-overlap": true }}
            paint={{ "text-color": "#ffffff" }}
          />
          <Layer
            id="points"
            type="circle"
            filter={["!", ["has", "point_count"]]}
            paint={{ "circle-color": tokens.accent, "circle-radius": 9, "circle-stroke-width": 3, "circle-stroke-color": "#ffffff" }}
          />
        </GeoJSONSource>
      </MapView>
      {pin ? (
        <View style={{ position: "absolute", zIndex: 10, elevation: 10, left: 8, right: 8, bottom: 8, padding: 12, gap: 8, borderRadius: tokens.radiusItem, backgroundColor: tokens.surface, borderWidth: 1, borderColor: tokens.line }} testID="map-card">
          <View>
            <Text variant="body" bold>
              {pin.name}
            </Text>
            <Text variant="secondary" tone="text2">
              {pin.place}
            </Text>
          </View>
          <Button label={strings.mapOpenCard} onPress={() => onOpen(pin.id)} testID="map-open" />
        </View>
      ) : null}
    </View>
  );
}
