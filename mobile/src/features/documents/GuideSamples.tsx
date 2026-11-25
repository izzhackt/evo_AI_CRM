// Образцы в листе «Пример» (веб: DocumentGuideSamples.tsx): наборы вкладками, страница листом на сером «столе», подпись
// со счётчиком, ряд миниатюр. Картинки НЕ лежат в сборке: грузятся по адресу портала (public/portal/document-samples, вход
// не нужен), миниатюры `-t.jpg` в ряду, полный файл на странице и в просмотре; кэш на диске ведёт expo-image. Пропорции
// страницы известны заранее (document-sample-sizes.generated.ts), поэтому лист встаёт в рамку и получает тень до загрузки.
// Не загрузилась страница (нет сети) - вместо образцов нарисованная схема с метками, как было до «Примера»
// (GuideScheme.tsx); следующее открытие листа пробует картинки снова. Крупный просмотр - GuideLightbox.tsx.
// Доступность: вкладки (`tablist`/`tab`), страницы ряда с состоянием «выбрано», кнопка вокруг страницы подписана
// «Открыть пример целиком: набор, подпись».
import { Download, Maximize2 } from "lucide-react-native";
import { useEffect, useRef, type Ref } from "react";
import { Pressable, ScrollView, View, useWindowDimensions, type HostInstance, type ScrollViewInstance } from "react-native";
import type { DocumentGuideView } from "@web/lib/portal/document-guides";

import type { DownloadErrorKey } from "@/features/documents/download";
import { SampleImage, ScanPage } from "@/features/documents/GuideImages";
import { currentSample, guideBlank, pageAspect, PHONE_WIDTH, sampleHeadingKey, sampleUrl, type CurrentSample, type SampleCursor } from "@/features/documents/guide-model";
import { SchemeFigure, SchemeLegend } from "@/features/documents/GuideScheme";
import { GuideTitle } from "@/features/documents/GuideTitle";
import { fitContain } from "@/features/documents/zoom-math";
import type { MobileStringKey } from "@/i18n";
import { useLang } from "@/i18n/LangProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { Text } from "@/ui/Text";

export type BlankState = Readonly<{ status: "idle" }> | Readonly<{ status: "busy" }> | Readonly<{ status: "error"; error: DownloadErrorKey }>;

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
            hitSlop={{ top: 6, bottom: 6 }}
            testID={`${id}-tab-${item.id}`}
            style={{ minHeight: 36, paddingHorizontal: 12, justifyContent: "center", borderRadius: tokens.radiusControl, backgroundColor: on ? tokens.surface : "transparent", boxShadow: on && scheme === "light" ? tokens.shadowCard : undefined }}
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
      contentContainerStyle={{ flexGrow: 1, justifyContent: "center", gap: 8, paddingHorizontal: 4, paddingTop: 4, paddingBottom: 6 }}
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
  /** Кнопка, открывающая крупный просмотр: после его закрытия фокус читалки возвращается на неё. */
  openerRef: Ref<HostInstance>;
  /** Настоящая страница не загрузилась: показываем схему, пока лист открыт. */
  schemeOnly: boolean;
  onImageError: () => void;
  blank: BlankState;
  onBlank: () => void;
  id: string;
}>;

export function GuideSamples({ guide, base, width, cursor, onSelect, onOpen, openerRef, schemeOnly, onImageError, blank, onBlank, id }: SamplesProps) {
  const { tokens } = useTheme();
  const { format, t } = useLang();
  const { width: screen } = useWindowDimensions();
  const errorText = useErrorText();
  const strings = t("admission");
  const picked = schemeOnly ? null : currentSample(guide, cursor);
  const heroUri = picked ? sampleUrl(base, picked.page.src) : null;
  // Настоящий образец показываем, только если есть и страница, и её адрес; иначе - схема.
  const real = picked !== null && heroUri !== null ? { current: picked, heroUri } : null;
  const download = guideBlank(guide);
  const counter = (index: number, total: number) => format(strings.guidePageCounter, { n: String(index + 1), m: String(total) });
  // Стол под страницей: на телефоне 280 px и поля 12, шире - 340 и 16 (веб: `.pt-doc-guide-scan`).
  const phone = screen < PHONE_WIDTH;
  const heroHeight = phone ? 280 : 340;
  const pad = phone ? 12 : 16;
  const box = { width: width - 2 * pad, height: heroHeight - 2 * pad };
  const aspect = real ? pageAspect(real.current.page.src) : null;
  const size = aspect ? fitContain(aspect, box) : null;

  return (
    <View style={{ gap: 12 }} testID={`${id}-samples`}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <GuideTitle style={{ flexShrink: 1 }}>{real ? strings[sampleHeadingKey(guide, real.current)] : strings.guideSample}</GuideTitle>
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
            ref={openerRef}
            accessibilityRole="button"
            accessibilityLabel={`${strings.guideSampleOpen}: ${real.current.set.label}, ${real.current.page.caption}`}
            onPress={onOpen}
            testID={`${id}-sample-open`}
            style={{ height: heroHeight, alignItems: "center", justifyContent: "center", borderRadius: tokens.radiusCard, backgroundColor: tokens.bg, overflow: "hidden" }}
          >
            <ScanPage uri={real.heroUri} placeholderUri={sampleUrl(base, real.current.page.thumb)} size={size} box={box} onFailed={onImageError} testID={`${id}-hero-image`} />
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
          <Pressable ref={openerRef} accessibilityRole="button" accessibilityLabel={strings.guideSampleOpen} onPress={onOpen} testID={`${id}-sample-open`} style={{ borderRadius: tokens.radiusCard, overflow: "hidden", alignSelf: "flex-start" }}>
            <SchemeFigure guide={guide} width={width} />
            <ZoomBadge />
          </Pressable>
          <SchemeLegend guide={guide} />
        </>
      )}
    </View>
  );
}
