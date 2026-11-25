// Образцы в листе «Пример» (веб: DocumentGuideSamples.tsx): наборы вкладками, страница крупно на сером «столе», подпись
// со счётчиком, ряд миниатюр, крупный просмотр с листанием. Картинки НЕ лежат в сборке: грузятся по адресу портала
// (public/portal/document-samples, вход не нужен), миниатюры `-t.jpg` в ряду, полный файл на странице и в просмотре;
// кэш на диске ведёт expo-image. Не загрузилась страница (нет сети) - вместо образцов нарисованная схема с метками,
// как было до «Примера» (GuideScheme.tsx); следующее открытие листа пробует картинки снова.
// Доступность: вкладки (`tablist`/`tab`), страницы ряда с состоянием «выбрано», кнопки «Предыдущая/Следующая страница»,
// смена страницы озвучивается (iOS: announce, Android: живая область). Окно просмотра - в том же `Modal`, что и лист;
// `accessibilityViewIsModal` внутри `Modal` не используется (ломал дерево доступности, #1488), фокус переносится на заголовок.
import { Image, type ImageStyle } from "expo-image";
import { ChevronLeft, ChevronRight, Download, Maximize2, X } from "lucide-react-native";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AccessibilityInfo, Platform, Pressable, ScrollView, View, useWindowDimensions, type HostInstance, type ScrollViewInstance, type StyleProp } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { DocumentGuideView } from "@web/lib/portal/document-guides";

import type { DownloadErrorKey } from "@/features/documents/download";
import { currentSample, guideBlank, sampleHeadingKey, sampleUrl, type CurrentSample, type SampleCursor } from "@/features/documents/guide-model";
import { SchemeFigure, SchemeLegend } from "@/features/documents/GuideScheme";
import type { MobileStringKey } from "@/i18n";
import { useLang } from "@/i18n/LangProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { MIN_TARGET } from "@/ui/CardParts";
import { Text } from "@/ui/Text";

export type BlankState = Readonly<{ status: "idle" }> | Readonly<{ status: "busy" }> | Readonly<{ status: "error"; error: DownloadErrorKey }>;

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
function SampleImage(props: SampleImageProps) {
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

/** «Развернуть» в углу картинки: подсказка, что она открывается крупно. Для читалки скрыта (кнопка вокруг уже подписана). */
function ZoomBadge() {
  const { tokens } = useTheme();
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ position: "absolute", right: 12, bottom: 12, width: 32, height: 32, borderRadius: 16, backgroundColor: tokens.surface, alignItems: "center", justifyContent: "center", boxShadow: tokens.shadowCard }}
    >
      <Maximize2 size={14} strokeWidth={2} color={tokens.text} />
    </View>
  );
}

function useErrorText() {
  const { m, t } = useLang();
  const strings = t("admission");
  return (key: DownloadErrorKey): string => (key.startsWith("docs.") ? m(key as MobileStringKey) : (strings as Record<string, string>)[key] ?? strings.errorUnavailable);
}

function BlankChip({ label, blank, onPress, id }: { label: string; blank: BlankState; onPress: () => void; id: string }) {
  const { tokens } = useTheme();
  const { m } = useLang();
  const busy = blank.status === "busy";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: busy, busy }}
      disabled={busy}
      onPress={onPress}
      hitSlop={8}
      testID={`${id}-blank`}
      style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 6, minHeight: 32, paddingHorizontal: 12, borderRadius: tokens.radiusChip, backgroundColor: tokens.bg, borderWidth: 1, borderColor: pressed ? tokens.controlEdge : tokens.bg, opacity: busy ? 0.7 : 1 })}
    >
      <Download size={15} strokeWidth={2} color={tokens.text2} />
      <Text variant="caption" bold>
        {busy ? m("docs.downloading") : label}
      </Text>
    </Pressable>
  );
}

/** Наборы образцов (IELTS и HSK, «Бланк» и «Пример заполнения», аттестат / диплом / табель): вкладки на сером треке. */
function SetTabs({ guide, selected, onSelect, id }: { guide: DocumentGuideView; selected: number; onSelect: (cursor: SampleCursor) => void; id: string }) {
  const { tokens, scheme } = useTheme();
  return (
    <View accessibilityRole="tablist" testID={`${id}-tabs`} style={{ flexDirection: "row", flexWrap: "wrap", gap: 4, padding: 4, alignSelf: "flex-start", maxWidth: "100%", borderRadius: tokens.radiusControl + 4, backgroundColor: tokens.bg }}>
      {guide.sampleSets.map((item, index) => {
        const on = index === selected;
        return (
          <Pressable
            key={item.id}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => onSelect({ set: index, page: 0 })}
            hitSlop={{ top: 4, bottom: 4 }}
            testID={`${id}-tab-${item.id}`}
            style={{ minHeight: 40, paddingHorizontal: 12, justifyContent: "center", borderRadius: tokens.radiusControl, backgroundColor: on ? tokens.surface : "transparent", boxShadow: on && scheme === "light" ? tokens.shadowCard : undefined }}
          >
            <Text variant="caption" bold tone={on ? "text" : "text2"}>
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const THUMB = { width: 48, height: 64 } as const;

/** Страницы выбранного набора: один ряд миниатюр, длинный набор прокручивается вбок. Не загрузилась миниатюра - номер страницы. */
function PageStrip({ current, base, counter, onSelect, id }: { current: CurrentSample; base: string; counter: (index: number, total: number) => string; onSelect: (cursor: SampleCursor) => void; id: string }) {
  const { tokens } = useTheme();
  const scroller = useRef<ScrollViewInstance>(null);
  const total = current.set.pages.length;
  // Страницу выбрали в просмотре - в листе ряд показывает её, а не начало набора.
  useEffect(() => {
    scroller.current?.scrollTo?.({ x: Math.max(0, current.pageIndex * (THUMB.width + 8) - 120), animated: false });
  }, [current.pageIndex]);
  return (
    <ScrollView
      ref={scroller}
      horizontal
      showsHorizontalScrollIndicator={false}
      accessibilityLabel={current.set.label}
      contentContainerStyle={{ flexGrow: 1, justifyContent: "center", gap: 8, paddingHorizontal: 4, paddingVertical: 4 }}
      testID={`${id}-pages`}
    >
      {current.set.pages.map((item, index) => {
        const on = index === current.pageIndex;
        const thumb = sampleUrl(base, item.thumb);
        const number = (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            <Text variant="caption" bold tone="text2">
              {index + 1}
            </Text>
          </View>
        );
        return (
          <Pressable
            key={item.src}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            accessibilityLabel={`${item.caption}, ${counter(index, total)}`}
            onPress={() => onSelect({ set: current.setIndex, page: index })}
            testID={`${id}-page-${index}`}
            style={{ ...THUMB, borderRadius: tokens.radiusItem, overflow: "hidden", backgroundColor: tokens.photoPaper, borderWidth: on ? 2 : 1, borderColor: on ? tokens.text : tokens.line }}
          >
            {thumb ? <SampleImage uri={thumb} fit="cover" style={{ flex: 1 }} fallback={number} testID={`${id}-thumb-${index}`} /> : number}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

type SamplesProps = Readonly<{
  guide: DocumentGuideView;
  /** Адрес портала: от него считаются адреса образцов. */
  base: string;
  /** Ширина листа без полей. */
  width: number;
  cursor: SampleCursor;
  onSelect: (cursor: SampleCursor) => void;
  onOpen: () => void;
  /** Настоящая страница не загрузилась: показываем схему, пока лист открыт. */
  schemeOnly: boolean;
  onImageError: () => void;
  blank: BlankState;
  onBlank: () => void;
  id: string;
}>;

export function GuideSamples({ guide, base, width, cursor, onSelect, onOpen, schemeOnly, onImageError, blank, onBlank, id }: SamplesProps) {
  const { tokens } = useTheme();
  const { format, t } = useLang();
  const { height } = useWindowDimensions();
  const errorText = useErrorText();
  const strings = t("admission");
  const picked = schemeOnly ? null : currentSample(guide, cursor);
  const heroUri = picked ? sampleUrl(base, picked.page.src) : null;
  // Настоящий образец показываем, только если есть и страница, и её адрес; иначе - схема.
  const real = picked !== null && heroUri !== null ? { current: picked, heroUri } : null;
  const download = guideBlank(guide);
  const counter = (index: number, total: number) => format(strings.guidePageCounter, { n: String(index + 1), m: String(total) });
  const heroHeight = Math.round(Math.min(340, Math.max(220, height * 0.36)));

  return (
    <View style={{ gap: 12 }} testID={`${id}-samples`}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <Text variant="caption" tone="text2" bold accessibilityRole="header" style={{ flexShrink: 1 }}>
          {real ? strings[sampleHeadingKey(guide, real.current)] : strings.guideSample}
        </Text>
        {download ? <BlankChip label={download.label} blank={blank} onPress={onBlank} id={id} /> : null}
      </View>
      {blank.status === "error" ? (
        <Text variant="caption" tone="error" accessibilityRole="alert" testID={`${id}-blank-error`}>
          {errorText(blank.error)}
        </Text>
      ) : null}
      {real ? (
        <>
          {guide.sampleSets.length > 1 ? <SetTabs guide={guide} selected={real.current.setIndex} onSelect={onSelect} id={id} /> : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${strings.guideSampleOpen}: ${real.current.set.label}, ${real.current.page.caption}`}
            onPress={onOpen}
            testID={`${id}-sample-open`}
            style={{ height: heroHeight, padding: 12, borderRadius: tokens.radiusCard, backgroundColor: tokens.bg, overflow: "hidden" }}
          >
            <SampleImage uri={real.heroUri} placeholderUri={sampleUrl(base, real.current.page.thumb)} onFailed={onImageError} style={{ flex: 1 }} testID={`${id}-hero-image`} />
            <ZoomBadge />
          </Pressable>
          <Text variant="caption" bold style={{ textAlign: "center" }} testID={`${id}-caption`}>
            {real.current.page.caption}
            {real.current.many ? (
              <Text variant="caption" tone="text2">
                {` · ${counter(real.current.pageIndex, real.current.set.pages.length)}`}
              </Text>
            ) : null}
          </Text>
          {real.current.many ? <PageStrip current={real.current} base={base} counter={counter} onSelect={onSelect} id={id} /> : null}
        </>
      ) : (
        <>
          <Pressable accessibilityRole="button" accessibilityLabel={strings.guideSampleOpen} onPress={onOpen} testID={`${id}-sample-open`} style={{ borderRadius: tokens.radiusControl, overflow: "hidden", alignSelf: "flex-start" }}>
            <SchemeFigure guide={guide} width={width} />
            <ZoomBadge />
          </Pressable>
          <SchemeLegend guide={guide} />
        </>
      )}
    </View>
  );
}

function PagerButton({ direction, disabled, label, onPress, id }: { direction: "prev" | "next"; disabled: boolean; label: string; onPress: () => void; id: string }) {
  const { tokens } = useTheme();
  const Icon = direction === "prev" ? ChevronLeft : ChevronRight;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={4}
      testID={`${id}-pager-${direction}`}
      style={({ pressed }) => ({ width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", backgroundColor: pressed ? tokens.skeleton : tokens.bg, opacity: disabled ? 0.5 : 1 })}
    >
      <Icon size={20} strokeWidth={2.2} color={disabled ? tokens.controlEdge : tokens.text} />
    </Pressable>
  );
}

type LightboxProps = Readonly<{
  guide: DocumentGuideView;
  base: string;
  /** Название документа: заголовок окна «Пример: {название}». */
  label: string;
  /** Ширина листа. */
  sheetWidth: number;
  cursor: SampleCursor;
  onSelect: (cursor: SampleCursor) => void;
  onClose: () => void;
  schemeOnly: boolean;
  onImageError: () => void;
  id: string;
}>;

/** Крупный просмотр: страница на весь лист, подпись со счётчиком и «‹ ›» между страницами набора. Нет образцов или нет сети - схема. */
export function GuideLightbox({ guide, base, label, sheetWidth, cursor, onSelect, onClose, schemeOnly, onImageError, id }: LightboxProps) {
  const { tokens } = useTheme();
  const { format, t } = useLang();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const strings = t("admission");
  const picked = schemeOnly ? null : currentSample(guide, cursor);
  const fullUri = picked ? sampleUrl(base, picked.page.src) : null;
  const real = picked !== null && fullUri !== null ? { current: picked, fullUri } : null;
  const current = real?.current ?? null;
  const pages = current?.set.pages.length ?? 0;
  const counterText = current && current.many ? format(strings.guidePageCounter, { n: String(current.pageIndex + 1), m: String(pages) }) : "";
  const spoken = current ? (counterText ? `${current.page.caption}, ${counterText}` : current.page.caption) : "";
  const imageHeight = Math.round(Math.max(240, Math.min(height * 0.92 - 200 - insets.bottom, 640)));

  // Фокус читалки - на заголовок окна: содержимое листа заменилось, а прежний элемент исчез.
  const heading = useRef<HostInstance>(null);
  useEffect(() => {
    const timer = setTimeout(() => {
      if (heading.current) AccessibilityInfo.sendAccessibilityEvent(heading.current, "focus");
    }, 250);
    return () => clearTimeout(timer);
  }, []);
  // Листание кнопкой озвучивается: на iOS - announce, на Android - живая область у подписи (ниже).
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (Platform.OS === "ios" && spoken) AccessibilityInfo.announceForAccessibility(spoken);
  }, [spoken]);

  const go = (step: number) => {
    if (!current) return;
    const next = current.pageIndex + step;
    if (next >= 0 && next < pages) onSelect({ set: current.setIndex, page: next });
  };

  return (
    <View
      testID={`${id}-lightbox`}
      style={{ width: sheetWidth, maxHeight: height * 0.92, backgroundColor: tokens.surface, borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingHorizontal: 16, paddingTop: 12, paddingBottom: Math.max(insets.bottom, 16) + 8, gap: 12 }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View ref={heading} accessible accessibilityRole="header" style={{ flex: 1 }}>
          <Text variant="heading" numberOfLines={2}>
            {`${strings.guideSample}: ${label}`}
          </Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={strings.guideSampleClose} onPress={onClose} testID={`${id}-lightbox-close`} style={{ width: MIN_TARGET, height: MIN_TARGET, alignItems: "center", justifyContent: "center" }}>
          <X size={20} strokeWidth={1.8} color={tokens.text} />
        </Pressable>
      </View>
      {real ? (
        <>
          <View style={{ height: imageHeight, padding: 12, borderRadius: tokens.radiusCard, backgroundColor: tokens.bg, overflow: "hidden" }}>
            <SampleImage uri={real.fullUri} placeholderUri={sampleUrl(base, real.current.page.thumb)} label={`${real.current.set.label}: ${real.current.page.caption}`} onFailed={onImageError} style={{ flex: 1 }} testID={`${id}-lightbox-image`} />
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 16 }}>
            {real.current.many ? <PagerButton direction="prev" disabled={real.current.pageIndex === 0} label={strings.guidePagePrev} onPress={() => go(-1)} id={id} /> : null}
            <View accessible accessibilityLabel={spoken} accessibilityLiveRegion="polite" style={{ minWidth: 140, alignItems: "center", gap: 2, flexShrink: 1 }} testID={`${id}-lightbox-caption`}>
              <Text variant="caption" bold style={{ textAlign: "center" }}>
                {real.current.page.caption}
              </Text>
              {counterText ? (
                <Text variant="caption" tone="text2">
                  {counterText}
                </Text>
              ) : null}
            </View>
            {real.current.many ? <PagerButton direction="next" disabled={real.current.pageIndex === pages - 1} label={strings.guidePageNext} onPress={() => go(1)} id={id} /> : null}
          </View>
        </>
      ) : (
        <ScrollView contentContainerStyle={{ gap: 12 }}>
          <SchemeFigure guide={guide} width={sheetWidth - 32} />
          <SchemeLegend guide={guide} />
        </ScrollView>
      )}
    </View>
  );
}
