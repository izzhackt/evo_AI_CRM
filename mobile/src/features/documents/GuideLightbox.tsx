// Крупный просмотр «Примера» (веб: SampleLightboxContent + `.pt-doc-guide-lightbox`): белая карточка по центру поверх
// затемнённого листа (лист под ней остаётся открытым, как в вебе), справа сверху «Закрыть пример», страница на сером
// «столе» по размеру страницы, подпись со счётчиком и «‹ ›» между страницами набора.
// Сверх веба - то, что даёт браузер на телефоне: щипок и двойное касание приближают страницу, палец её двигает, движение
// пальца по целой странице листает (ZoomableScan.tsx). Нет образцов или нет сети - схема с легендой.
// Поверхность жестов - вся карточка, а не рамка: щипок начинается там, куда село первое касание (поле, шапка, подпись).
// Для этого всё, что в карточке не кнопка, касаний не принимает ("none" / "box-none"): цель такого касания - сама карточка.
// Высота рамки одна на весь набор страниц, поэтому карточка не прыгает, когда листаешь страницы разных пропорций.
// Доступность: заголовок «Пример: {документ}» читается первым и получает фокус при открытии; кнопки «Предыдущая /
// Следующая страница» (выключены на краях) - полный запасной способ листать; смена страницы озвучивается (iOS: announce,
// Android: живая область). Лист под карточкой скрыт от читалки родителем (`accessibilityElementsHidden`), не
// `accessibilityViewIsModal` внутри Modal (ломал дерево доступности, #1488).
import { ChevronLeft, ChevronRight, X } from "lucide-react-native";
import { useEffect, useRef } from "react";
import { AccessibilityInfo, Platform, Pressable, ScrollView, View, useWindowDimensions, type HostInstance } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { DocumentGuideView } from "@web/lib/portal/document-guides";

import { currentSample, pageAspect, PHONE_WIDTH, sampleUrl, type SampleCursor } from "@/features/documents/guide-model";
import { SchemeFigure, SchemeLegend } from "@/features/documents/GuideScheme";
import { useZoomSurface, ZoomableScan } from "@/features/documents/ZoomableScan";
import { fitContain, type Size } from "@/features/documents/zoom-math";
import { useLang } from "@/i18n/LangProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { MIN_TARGET } from "@/ui/CardParts";
import { Text } from "@/ui/Text";

/** Поля стола вокруг страницы в просмотре (веб: `.pt-doc-guide-scan.is-large`, padding 20). */
const TABLE_PAD = 20;
const CARD_PAD = 16;

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

/** Самая высокая страница набора, вписанная в `box`: по ней задаётся высота рамки, одна на весь набор. */
function tallestPage(pages: readonly { src: string }[], box: Size): number {
  return pages.reduce((top, page) => {
    const ratio = pageAspect(page.src);
    return Math.max(top, ratio ? fitContain(ratio, box).height : box.height);
  }, 0);
}

type LightboxProps = Readonly<{
  guide: DocumentGuideView;
  base: string;
  /** Название документа: заголовок окна «Пример: {название}». */
  label: string;
  cursor: SampleCursor;
  onSelect: (cursor: SampleCursor) => void;
  onClose: () => void;
  /** Адрес страницы, что только что не загрузилась: вместо неё схема, а «‹ ›» остаются. Другая страница - забыт, попытка заново. */
  failedUri: string | null;
  onImageError: (uri: string) => void;
  id: string;
}>;

export function GuideLightbox({ guide, base, label, cursor, onSelect, onClose, failedUri, onImageError, id }: LightboxProps) {
  const { tokens } = useTheme();
  const { format, t } = useLang();
  const insets = useSafeAreaInsets();
  const { width, height, fontScale } = useWindowDimensions();
  const strings = t("admission");
  const surface = useZoomSurface();
  const current = currentSample(guide, cursor);
  const fullUri = current ? sampleUrl(base, current.page.src) : null;
  // Страница есть, адрес годится и она не отказала - показываем её; иначе (и без образцов вовсе) - схема.
  const real = current !== null && fullUri !== null && failedUri !== fullUri ? { current, fullUri } : null;
  const pages = current?.set.pages.length ?? 0;
  const counterText = current && current.many ? format(strings.guidePageCounter, { n: String(current.pageIndex + 1), m: String(pages) }) : "";
  const spoken = current ? (counterText ? `${current.page.caption}, ${counterText}` : current.page.caption) : "";
  const title = `${strings.guideSample}: ${label}`;

  // Карточка по центру с полями (на телефоне 8, шире 16) и страница, вписанная в оставшееся место.
  const margin = width < PHONE_WIDTH ? 8 : 16;
  const cardWidth = Math.min(920, width - 2 * margin);
  const cardMaxHeight = height - insets.top - insets.bottom - 2 * margin;
  const innerWidth = cardWidth - 2 * CARD_PAD;
  const pagerRow = Math.round(Math.max(48, 40 * Math.min(fontScale, 2) + 8));
  const available = { width: innerWidth - 2 * TABLE_PAD, height: Math.max(120, cardMaxHeight - 2 * CARD_PAD - MIN_TARGET - 24 - pagerRow - 2 * TABLE_PAD) };
  const aspect = current ? pageAspect(current.page.src) : null;
  const content = aspect ? fitContain(aspect, available) : available;
  const frame = { width: innerWidth, height: Math.max(content.height, current ? tallestPage(current.set.pages, available) : 0) + 2 * TABLE_PAD };

  // Фокус читалки - на заголовок: лист под карточкой скрыт, а прежний элемент (кнопка страницы) остался под ней.
  const heading = useRef<HostInstance>(null);
  useEffect(() => {
    const timer = setTimeout(() => {
      if (heading.current) AccessibilityInfo.sendAccessibilityEvent(heading.current, "focus");
    }, 250);
    return () => clearTimeout(timer);
  }, []);
  // Листание озвучивается: на iOS - announce, на Android - живая область у подписи (ниже).
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
    <View testID={`${id}-lightbox`} {...surface.props} style={{ width: cardWidth, maxHeight: cardMaxHeight, padding: CARD_PAD, gap: 12, borderRadius: tokens.radiusCard, backgroundColor: tokens.surface, boxShadow: tokens.shadowRaised }}>
      <View ref={heading} pointerEvents="none" accessible accessibilityRole="header" accessibilityLabel={title} style={{ position: "absolute", left: 0, top: 0, width: 1, height: 1 }} />
      <View testID={`${id}-lightbox-top`} pointerEvents="box-none" style={{ flexDirection: "row", justifyContent: "flex-end" }}>
        <Pressable accessibilityRole="button" accessibilityLabel={strings.guideSampleClose} onPress={onClose} testID={`${id}-lightbox-close`} style={{ width: MIN_TARGET, height: MIN_TARGET, borderRadius: tokens.radiusChip, alignItems: "center", justifyContent: "center" }}>
          <X size={20} strokeWidth={1.8} color={tokens.text2} />
        </Pressable>
      </View>
      {real ? (
        <ZoomableScan
          key={real.fullUri}
          uri={real.fullUri}
          placeholderUri={sampleUrl(base, real.current.page.thumb)}
          content={content}
          exact={aspect !== null}
          frame={frame}
          label={`${real.current.set.label}: ${real.current.page.caption}`}
          onFailed={() => onImageError(real.fullUri)}
          onStep={(step) => go(step)}
          connect={surface.connect}
          testID={`${id}-lightbox-zoom`}
          imageTestID={`${id}-lightbox-image`}
        />
      ) : (
        <ScrollView contentContainerStyle={{ gap: 12 }}>
          <SchemeFigure guide={guide} width={innerWidth} />
          <SchemeLegend guide={guide} />
        </ScrollView>
      )}
      {current ? (
        <View testID={`${id}-lightbox-pager`} pointerEvents="box-none" style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 16 }}>
          {current.many ? <PagerButton direction="prev" disabled={current.pageIndex === 0} label={strings.guidePagePrev} onPress={() => go(-1)} id={id} /> : null}
          <View pointerEvents="none" accessible accessibilityLabel={spoken} accessibilityLiveRegion="polite" style={{ minWidth: 140, alignItems: "center", gap: 2, flexShrink: 1 }} testID={`${id}-lightbox-caption`}>
            <Text variant="caption" bold style={{ textAlign: "center" }}>
              {current.page.caption}
            </Text>
            {counterText ? (
              <Text variant="caption" tone="text2">
                {counterText}
              </Text>
            ) : null}
          </View>
          {current.many ? <PagerButton direction="next" disabled={current.pageIndex === pages - 1} label={strings.guidePageNext} onPress={() => go(1)} id={id} /> : null}
        </View>
      ) : null}
    </View>
  );
}
