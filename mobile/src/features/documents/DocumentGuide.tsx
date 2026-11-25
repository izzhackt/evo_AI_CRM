// Кнопка «Пример» и лист «Пример» (веб: DocumentGuide.tsx, #1526; каталог и подбор - src/lib/portal/document-guides.ts).
// Лист показывает только пример (решение владельца 24.11.2026: без советов): настоящие образцы с вкладками и страницами,
// бланк для скачивания, у «Фото» - картинки «правильно / неправильно» с размером страны; нет настоящих образцов или
// нет сети - нарисованная схема с метками. Под примером действие строки (загрузить, заменить или скачать) и «Спросить
// куратора». Описание, «Где взять», формат, частые ошибки и «Мои программы» лист не показывает: их тексты остаются в
// общем каталоге веба. Нет подходящей справки - кнопки нет.
// Крупный просмотр открывается в том же листе (два Modal на iOS подряд не дружат); `accessibilityViewIsModal` внутри
// Modal не ставим (ломал дерево доступности после закрытия, #1488).
import { X } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Modal, Platform, Pressable, ScrollView, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { documentGuideView, type DocumentGuideView } from "@web/lib/portal/document-guides";

import { usePortalApi } from "@/api/PortalApi";
import type { PortalTone } from "@/domain/documents-model";
import { downloadPublicFile } from "@/features/documents/download";
import { FIRST_PAGE, guideBlank, sampleFileName, sampleUrl, type SampleCursor } from "@/features/documents/guide-model";
import { GuidePhotoRules } from "@/features/documents/GuidePhotoRules";
import { GuideLightbox, GuideSamples, type BlankState } from "@/features/documents/GuideSamples";
import type { DocumentsIo } from "@/features/documents/io";
import { go } from "@/features/portal/navigation";
import { useLang } from "@/i18n/LangProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { Button } from "@/ui/Button";
import { LinkButton, MIN_TARGET } from "@/ui/CardParts";
import { StatusPill } from "@/ui/StatusPill";
import { Text } from "@/ui/Text";

export type GuideAction = Readonly<{ label: string; accessibilityLabel?: string; onPress: () => void; testID?: string; busy?: boolean }>;

/**
 * Подбор справки. `country` - страна дела (`CN`, `MY`...): по ней выбираются образцы страны (бланк медсправки Китая) и
 * размер фото; без неё справка общая. Тесты и экраны проверяют «есть ли справка» без отрисовки.
 */
export function guideFor(label: string, requirementKey: string | null, lang: "ru" | "ky", country: string | null = null): DocumentGuideView | null {
  return documentGuideView({ requirementKey, label }, lang, country);
}

/**
 * Кнопка «Пример» рядом со статусом документа. `action` - главное действие в листе (загрузить, заменить или скачать):
 * лист закрывается, действие выполняется после закрытия (на iOS два окна подряд иначе не открываются). `io` нужен для
 * бланка («Скачать бланк»): пустой PDF качается в кэш и открывается системным просмотром, как остальные файлы.
 */
export function DocumentGuideButton({
  label,
  requirementKey,
  country = null,
  statusLabel = null,
  statusTone = "neutral",
  action = null,
  io,
  testID,
}: {
  label: string;
  requirementKey: string | null;
  country?: string | null;
  statusLabel?: string | null;
  statusTone?: PortalTone;
  action?: GuideAction | null;
  io: DocumentsIo;
  testID?: string;
}) {
  const { lang, t, format } = useLang();
  const { tokens } = useTheme();
  const api = usePortalApi();
  const strings = t("admission");
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const guide = guideFor(label, requirementKey, lang, country);
  const [open, setOpen] = useState(false);
  const [enlarged, setEnlarged] = useState(false);
  const [cursor, setCursor] = useState<SampleCursor>(FIRST_PAGE);
  const [schemeOnly, setSchemeOnly] = useState(false);
  const [blank, setBlank] = useState<BlankState>({ status: "idle" });
  const pending = useRef<(() => void) | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);
  const shown = useRef(false);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);
  // Скачивание бланка читает «лист ещё открыт?» после ожидания, когда замыкание уже устарело: нужна ссылка.
  useEffect(() => {
    shown.current = open;
  }, [open]);

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
  const enlarge = () => setEnlarged(true);
  const shrink = () => setEnlarged(false);
  // Каждое открытие пробует картинки заново: «нет сети» прошлого раза листу не прилипает.
  const openSheet = () => {
    setSchemeOnly(false);
    setBlank({ status: "idle" });
    setOpen(true);
  };

  const blankHref = guide ? (guideBlank(guide)?.href ?? null) : null;
  const downloadBlank = async () => {
    if (!blankHref || blank.status === "busy") return;
    const url = sampleUrl(api.portalBaseUrl, blankHref);
    if (!url) {
      setBlank({ status: "error", error: "docs.downloadFailed" });
      return;
    }
    setBlank({ status: "busy" });
    const result = await downloadPublicFile(io.createDownloadDeps(api.portalBaseUrl, api.getAccessToken, api.refreshAccessToken), url, sampleFileName(blankHref), "application/pdf");
    // Лист закрыли, пока файл качался: просмотр сам не всплывает.
    if (!alive.current || !shown.current) return;
    if (!result.ok) {
      setBlank({ status: "error", error: result.error });
      return;
    }
    setBlank({ status: "idle" });
    closeThen(() => void io.openLocalFile(result.uri, "application/pdf").catch(() => undefined));
  };

  if (!guide) return null;
  const id = testID ?? "guide";
  const sheetWidth = Math.min(width, 640);
  const contentWidth = sheetWidth - 32;

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={format(strings.guideButtonAria, { name: label })}
        onPress={openSheet}
        hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
        testID={`${id}-open`}
        style={({ pressed }) => ({ alignSelf: "flex-start", minHeight: 32, paddingHorizontal: 14, justifyContent: "center", borderRadius: tokens.radiusChip, backgroundColor: tokens.bg, borderWidth: 1, borderColor: pressed ? tokens.controlEdge : tokens.line, transform: [{ scale: pressed ? tokens.pressScale : 1 }] })}
      >
        <Text variant="caption" bold>
          {strings.guideButton}
        </Text>
      </Pressable>
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => (enlarged ? shrink() : close())} onDismiss={flush} statusBarTranslucent>
        <View style={{ flex: 1, justifyContent: "flex-end", alignItems: "center" }}>
          <Pressable accessibilityLabel={strings.guideClose} accessibilityRole="button" onPress={close} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.45)" }} />
          {enlarged ? (
            <GuideLightbox guide={guide} base={api.portalBaseUrl} label={label} sheetWidth={sheetWidth} cursor={cursor} onSelect={setCursor} onClose={shrink} schemeOnly={schemeOnly} onImageError={() => setSchemeOnly(true)} id={id} />
          ) : (
            <View testID={`${id}-sheet`} style={{ width: sheetWidth, maxHeight: height * 0.92, backgroundColor: tokens.surface, borderTopLeftRadius: 16, borderTopRightRadius: 16 }}>
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
              <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 16, gap: 14 }}>
                {guide.photoRules ? (
                  <GuidePhotoRules country={guide.photoRules.country} width={contentWidth} id={id} />
                ) : (
                  <GuideSamples
                    guide={guide}
                    base={api.portalBaseUrl}
                    width={contentWidth}
                    cursor={cursor}
                    onSelect={setCursor}
                    onOpen={enlarge}
                    schemeOnly={schemeOnly}
                    onImageError={() => setSchemeOnly(true)}
                    blank={blank}
                    onBlank={() => void downloadBlank()}
                    id={id}
                  />
                )}
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
