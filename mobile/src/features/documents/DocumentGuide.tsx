// Кнопка «!» и лист «Что это за документ» (веб: DocumentGuide.tsx, #1478; каталог - src/lib/portal/document-guides.ts).
// Каталог и подбор справки общие с вебом (@web), образцы - те же SVG из public/portal/document-samples
// (через document-samples.generated.ts, npm run sync-document-samples). Нет подходящей справки - кнопки нет.
// Образец крупно открывается в том же листе (два Modal на iOS подряд не дружат).
import { Info, Maximize2, X } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Modal, Platform, Pressable, ScrollView, useWindowDimensions, View } from "react-native";
import { SvgXml } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { documentGuideView, type DocumentGuideView } from "@web/lib/portal/document-guides";

import type { PortalTone } from "@/domain/documents-model";
import { DOCUMENT_SAMPLE_SVG } from "@/features/documents/document-samples.generated";
import { go } from "@/features/portal/navigation";
import { useLang } from "@/i18n/LangProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { Button } from "@/ui/Button";
import { LinkButton, MIN_TARGET } from "@/ui/CardParts";
import { StatusPill } from "@/ui/StatusPill";
import { Text } from "@/ui/Text";

const PROGRAMS_ROUTE = "/universities";
const SAMPLE_RATIO = 640 / 400;

export type GuideAction = Readonly<{ label: string; accessibilityLabel?: string; onPress: () => void; testID?: string; busy?: boolean }>;

/** Свой вид и ключ: подбор справки. Тесты и экраны проверяют «есть ли справка» без отрисовки. */
export function guideFor(label: string, requirementKey: string | null, lang: "ru" | "ky"): DocumentGuideView | null {
  return documentGuideView({ requirementKey, label }, lang);
}

/**
 * react-native-svg не раскодирует сущности в тексте (в образце паспорта строка MRZ с `&lt;` рисовалась буквально).
 * Раскодируем сами; «<» заменяем полноширинным «＜» (вид тот же, а разбор XML не ломается).
 */
export function decodeSvgText(xml: string): string {
  return xml.replace(/>([^<]+)</g, (_match, text: string) => `>${text.replaceAll("&lt;", "\uFF1C").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&apos;", "'").replaceAll("&amp;", "&")}<`);
}

function sampleXml(sampleSrc: string): string | null {
  const name = sampleSrc.split("/").pop() ?? "";
  return Object.hasOwn(DOCUMENT_SAMPLE_SVG, name) ? decodeSvgText(DOCUMENT_SAMPLE_SVG[name]) : null;
}

function Sample({ guide, width }: { guide: DocumentGuideView; width: number }) {
  const { tokens } = useTheme();
  const xml = sampleXml(guide.sampleSrc);
  if (!xml) return null;
  return (
    <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width, height: width / SAMPLE_RATIO, borderRadius: tokens.radiusControl, overflow: "hidden", borderWidth: 1, borderColor: tokens.line }} testID="guide-sample">
      <SvgXml xml={xml} width={width} height={width / SAMPLE_RATIO} />
      {guide.pins.map((pin) => (
        <View key={pin.n} style={{ position: "absolute", left: `${pin.x}%`, top: `${pin.y}%`, width: 24, height: 24, marginLeft: -12, marginTop: -12, borderRadius: 12, backgroundColor: tokens.accent, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "#FFFFFF" }}>
          <Text variant="caption" bold tone="onAccent" style={{ fontSize: 12, lineHeight: 14 }}>
            {pin.n}
          </Text>
        </View>
      ))}
    </View>
  );
}

function Legend({ guide }: { guide: DocumentGuideView }) {
  const { tokens } = useTheme();
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 12, rowGap: 4 }} testID="guide-legend">
      {guide.pins.map((pin) => (
        <View key={pin.n} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: tokens.accent, alignItems: "center", justifyContent: "center" }}>
            <Text variant="caption" bold tone="onAccent" style={{ fontSize: 11, lineHeight: 13 }}>
              {pin.n}
            </Text>
          </View>
          <Text variant="caption" tone="text2">
            {pin.legend}
          </Text>
        </View>
      ))}
    </View>
  );
}

/**
 * «!» рядом с названием документа. `action` - главное действие в листе (загрузить, заменить или скачать):
 * лист закрывается, действие выполняется после закрытия (на iOS два окна подряд иначе не открываются).
 */
export function DocumentGuideButton({
  label,
  requirementKey,
  statusLabel = null,
  statusTone = "neutral",
  action = null,
  testID,
}: {
  label: string;
  requirementKey: string | null;
  statusLabel?: string | null;
  statusTone?: PortalTone;
  action?: GuideAction | null;
  testID?: string;
}) {
  const { lang, t, format } = useLang();
  const { tokens } = useTheme();
  const strings = t("admission");
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const guide = guideFor(label, requirementKey, lang);
  const [open, setOpen] = useState(false);
  const [enlarged, setEnlarged] = useState(false);
  const pending = useRef<(() => void) | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const run = pending.current;
    pending.current = null;
    run?.();
  }, []);
  const close = useCallback(() => {
    setOpen(false);
    setEnlarged(false);
  }, []);
  const closeThen = (run: () => void) => {
    pending.current = run;
    close();
    if (Platform.OS === "ios") timer.current = setTimeout(flush, 700);
    else flush();
  };

  if (!guide) return null;
  const id = testID ?? "guide";
  const sheetWidth = Math.min(width, 640);
  const sampleWidth = sheetWidth - 32;

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={format(strings.guideOpenAria, { name: label })}
        accessibilityHint={strings.guideTooltip}
        onPress={() => setOpen(true)}
        hitSlop={4}
        testID={`${id}-open`}
        style={({ pressed }) => ({ width: MIN_TARGET, height: MIN_TARGET, alignItems: "center", justifyContent: "center", borderRadius: tokens.radiusControl, backgroundColor: pressed ? tokens.accentSoft : "transparent" })}
      >
        <Info size={20} strokeWidth={1.75} color={tokens.accent} />
      </Pressable>
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => (enlarged ? setEnlarged(false) : close())} onDismiss={flush} statusBarTranslucent>
        <View style={{ flex: 1, justifyContent: "flex-end", alignItems: "center" }}>
          <Pressable accessibilityLabel={strings.guideClose} accessibilityRole="button" onPress={close} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.45)" }} />
          {enlarged ? (
            <View testID={`${id}-lightbox`} accessibilityViewIsModal style={{ width: sheetWidth, maxHeight: height * 0.92, backgroundColor: tokens.surface, borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingHorizontal: 16, paddingTop: 12, paddingBottom: Math.max(insets.bottom, 16) + 8, gap: 12 }}>
              <View style={{ flexDirection: "row", justifyContent: "flex-end" }}>
                <Pressable accessibilityRole="button" accessibilityLabel={strings.guideSampleClose} onPress={() => setEnlarged(false)} testID={`${id}-lightbox-close`} style={{ width: MIN_TARGET, height: MIN_TARGET, alignItems: "center", justifyContent: "center" }}>
                  <X size={20} strokeWidth={1.8} color={tokens.text} />
                </Pressable>
              </View>
              <Sample guide={guide} width={sampleWidth} />
              <Legend guide={guide} />
            </View>
          ) : (
            <View testID={`${id}-sheet`} accessibilityViewIsModal style={{ width: sheetWidth, maxHeight: height * 0.92, backgroundColor: tokens.surface, borderTopLeftRadius: 16, borderTopRightRadius: 16 }}>
              <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8, paddingLeft: 16, paddingRight: 4, paddingTop: 12 }}>
                <View style={{ flex: 1, gap: 6, paddingTop: 8 }}>
                  <Text variant="heading" accessibilityRole="header">
                    {label}
                  </Text>
                  {statusLabel ? <StatusPill label={statusLabel} tone={statusTone} /> : null}
                </View>
                <Pressable accessibilityRole="button" accessibilityLabel={strings.guideClose} onPress={close} testID={`${id}-close`} style={{ width: MIN_TARGET, height: MIN_TARGET, alignItems: "center", justifyContent: "center" }}>
                  <X size={20} strokeWidth={1.8} color={tokens.text} />
                </Pressable>
              </View>
              <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 16, gap: 14 }}>
                <Text variant="body" testID={`${id}-description`}>
                  {guide.description}
                </Text>
                <View style={{ gap: 4 }}>
                  <Text variant="caption" tone="text2" bold accessibilityRole="header">
                    {strings.guideWhere}
                  </Text>
                  {guide.where.map((line) => (
                    <View key={line} style={{ flexDirection: "row", gap: 8 }}>
                      <Text variant="secondary" tone="text2">
                        •
                      </Text>
                      <Text variant="secondary" style={{ flex: 1 }}>
                        {line}
                      </Text>
                    </View>
                  ))}
                </View>
                <View style={{ gap: 8 }}>
                  <Text variant="secondary" tone="text2">
                    {guide.requirements}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={strings.guideSampleOpen}
                    onPress={() => setEnlarged(true)}
                    testID={`${id}-sample-open`}
                    style={{ gap: 8, alignItems: "flex-start" }}
                  >
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, minHeight: 28 }}>
                      <Text variant="caption" tone="accent" bold>
                        {strings.guideSample}
                      </Text>
                      <Maximize2 size={14} strokeWidth={1.8} color={tokens.accent} />
                    </View>
                    <Sample guide={guide} width={sampleWidth} />
                  </Pressable>
                  <Legend guide={guide} />
                </View>
                <Text variant="secondary" testID={`${id}-mistakes`}>
                  {guide.mistakes}
                </Text>
                <View style={{ gap: 2, alignItems: "flex-start" }}>
                  <Text variant="secondary" tone="text2">
                    {strings.guideUniversityNote}
                  </Text>
                  <LinkButton label={strings.guideUniversityLink} onPress={() => closeThen(() => go(PROGRAMS_ROUTE))} testID={`${id}-programs`} />
                </View>
              </ScrollView>
              <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingTop: 10, paddingBottom: Math.max(insets.bottom, 16), borderTopWidth: 1, borderTopColor: tokens.line }}>
                {action ? <ActionButton action={action} closeThen={closeThen} id={id} /> : null}
                <LinkButton label={strings.guideAskCurator} onPress={() => closeThen(() => go("/messages/chat"))} testID={`${id}-ask`} />
              </View>
            </View>
          )}
        </View>
      </Modal>
    </>
  );
}

function ActionButton({ action, closeThen, id }: { action: GuideAction; closeThen: (run: () => void) => void; id: string }): ReactNode {
  return <Button variant="primary" label={action.label} accessibilityLabel={action.accessibilityLabel} busy={action.busy} onPress={() => closeThen(action.onPress)} testID={action.testID ?? `${id}-action`} />;
}
