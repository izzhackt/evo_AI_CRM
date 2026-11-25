// Картинки образцов «Примера»: одна картинка из сети с запасным видом и страница «листом бумаги» (веб: `.pt-doc-guide-scan`).
// Кэш на диске ведёт expo-image; он не следует заголовкам Cache-Control, поэтому `max-age=0` у файлов портала не мешает.
import { Image, type ImageStyle } from "expo-image";
import { useState, type ReactNode } from "react";
import { View, type StyleProp } from "react-native";

import type { Size } from "@/features/documents/zoom-math";

/** Лист бумаги на сером столе: скругление 3 px и мягкая тень (веб: `.pt-doc-guide-scan img`). */
export const PAGE_SHADOW = "0 1px 2px rgb(16 24 40 / 0.1), 0 8px 24px -10px rgb(16 24 40 / 0.28)";
export const PAGE_RADIUS = 3;

type SampleImageProps = Readonly<{
  uri: string;
  /** Миниатюра на время загрузки крупной страницы: вместо пустого места - размытый вид той же страницы. */
  placeholderUri?: string | null;
  fit?: "contain" | "cover";
  label?: string;
  onFailed?: () => void;
  /** Что рисовать вместо картинки, если она не загрузилась. */
  fallback?: ReactNode;
  style?: StyleProp<ImageStyle>;
  testID?: string;
}>;

/**
 * Одна картинка образца. Состояние «не загрузилась» привязано к адресу (`key`): другая страница - новая попытка, а
 * старая картинка не висит под новой подписью.
 */
export function SampleImage(props: SampleImageProps) {
  return <SampleImageView key={props.uri} {...props} />;
}

function SampleImageView({ uri, placeholderUri = null, fit = "contain", label, onFailed, fallback = null, style, testID }: SampleImageProps) {
  const [failed, setFailed] = useState(false);
  if (failed) return <>{fallback}</>;
  return (
    <Image
      source={{ uri }}
      placeholder={placeholderUri ? { uri: placeholderUri } : undefined}
      placeholderContentFit={fit}
      contentFit={fit}
      contentPosition={fit === "cover" ? "top center" : "center"}
      cachePolicy="disk"
      transition={150}
      accessible={label !== undefined}
      accessibilityLabel={label}
      onError={() => {
        setFailed(true);
        onFailed?.();
      }}
      style={style}
      testID={testID}
    />
  );
}

/**
 * Страница образца листом: известные пропорции дают точный размер (`size`), лист получает тень и скругление. Размера нет -
 * картинка просто вписывается в место (`box`, `contain`), без тени.
 */
export function ScanPage({ uri, placeholderUri, size, box, onFailed, testID }: { uri: string; placeholderUri: string | null; size: Size | null; box: Size; onFailed: () => void; testID: string }) {
  if (!size) {
    return (
      <View style={{ width: box.width, height: box.height }}>
        <SampleImage uri={uri} placeholderUri={placeholderUri} onFailed={onFailed} style={{ flex: 1 }} testID={testID} />
      </View>
    );
  }
  return (
    <View style={{ width: size.width, height: size.height, borderRadius: PAGE_RADIUS, backgroundColor: "#ffffff", boxShadow: PAGE_SHADOW }}>
      <SampleImage uri={uri} placeholderUri={placeholderUri} onFailed={onFailed} style={{ width: size.width, height: size.height, borderRadius: PAGE_RADIUS }} testID={testID} />
    </View>
  );
}
