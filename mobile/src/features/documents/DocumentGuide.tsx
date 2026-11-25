// Кнопка «Пример» и лист «Пример» (веб: DocumentGuide.tsx, #1526; каталог и подбор - src/lib/portal/document-guides.ts).
// Лист показывает только пример (решение владельца 24.11.2026: без советов): настоящие образцы с вкладками и страницами,
// бланк для скачивания, у «Фото» - картинки «правильно / неправильно» с размером страны; нет настоящих образцов или
// нет сети - нарисованная схема с метками. Под примером действие строки (загрузить, заменить или скачать) и «Спросить
// куратора». Описание, «Где взять», формат, частые ошибки и «Мои программы» лист не показывает: их тексты остаются в
// общем каталоге веба. Нет подходящей справки - кнопки нет.
// Крупный просмотр - карточка по центру поверх затемнённого листа в том же Modal (два Modal на iOS подряд не дружат; как в
// вебе лист под ним остаётся открытым). Пока она открыта, лист скрыт от читалки (`accessibilityElementsHidden`);
// `accessibilityViewIsModal` внутри Modal не ставим (ломал дерево доступности после закрытия, #1488).
import { Download, X } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Modal, Platform, Pressable, ScrollView, StyleSheet, useWindowDimensions, View, type HostInstance } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { documentGuideView, type DocumentGuideView } from "@web/lib/portal/document-guides";

import { usePortalApi } from "@/api/PortalApi";
import type { PortalTone } from "@/domain/documents-model";
import { downloadPublicFile } from "@/features/documents/download";
import { FIRST_PAGE, guideBlank, PHONE_WIDTH, sampleFileName, sampleUrl, type SampleCursor } from "@/features/documents/guide-model";
import { GuideLightbox } from "@/features/documents/GuideLightbox";
import { GuideMark } from "@/features/documents/GuideMark";
import { GuidePhotoRules } from "@/features/documents/GuidePhotoRules";
import { GuideSamples, type BlankState } from "@/features/documents/GuideSamples";
import type { DocumentsIo } from "@/features/documents/io";
import { go } from "@/features/portal/navigation";
import { useLang } from "@/i18n/LangProvider";
import { sansFont } from "@/theme/fonts";
import { useTheme } from "@/theme/ThemeProvider";
import { Button } from "@/ui/Button";
import { MIN_TARGET } from "@/ui/CardParts";
import { StatusPill } from "@/ui/StatusPill";
import { Text } from "@/ui/Text";

export type GuideAction = Readonly<{
  label: string;
  accessibilityLabel?: string;
  onPress: () => void;
  testID?: string;
  busy?: boolean;
  /** Скачивание принятого файла: тёмная кнопка со значком, как у веба (`.pt-doc-guide-download`). */
  kind?: "download";
}>;

/**
 * Подбор справки. `country` - страна дела (`CN`, `MY`...): по ней выбираются образцы страны (бланк медсправки Китая) и
 * размер фото; без неё справка общая. Тесты и экраны проверяют «есть ли справка» без отрисовки.
 */
export function guideFor(label: string, requirementKey: string | null, lang: "ru" | "ky", country: string | null = null): DocumentGuideView | null {
  return documentGuideView({ requirementKey, label }, lang, country);
}

/** Через сколько после закрытия окна читалке возвращают фокус на кнопку, с которой лист открыли (мс). */
const FOCUS_DELAY = 350;
/** Сколько ждём бланк (PDF около 360 КБ), мс: дольше - запрос отменяется и лист говорит, что связи нет. */
const BLANK_TIMEOUT_MS = 30_000;

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
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const [blank, setBlank] = useState<BlankState>({ status: "idle" });
  const pending = useRef<(() => void) | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);
  const button = useRef<HostInstance>(null);
  const opener = useRef<HostInstance>(null);
  /** Какое по счёту «показ листа» идёт: скачивание бланка, начатое в прошлый показ, в новый не вмешивается. */
  const generation = useRef(0);
  const blankJob = useRef<{ abort: AbortController; timer: ReturnType<typeof setTimeout> } | null>(null);

  /** Бланк: отменить скачивание (закрыли лист, открыли заново, ушли с экрана) и сбросить его таймер. */
  const cancelBlank = useCallback(() => {
    const job = blankJob.current;
    blankJob.current = null;
    if (!job) return;
    clearTimeout(job.timer);
    job.abort.abort();
  }, []);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (timer.current) clearTimeout(timer.current);
      if (focusTimer.current) clearTimeout(focusTimer.current);
      cancelBlank();
    };
  }, [cancelBlank]);

  /** Окно закрылось - читалка продолжает с того места, откуда его открыли (веб: `openerRef.current?.focus()`). */
  const restoreFocus = useCallback((target: { current: HostInstance | null }) => {
    if (focusTimer.current) clearTimeout(focusTimer.current);
    focusTimer.current = setTimeout(() => {
      focusTimer.current = null;
      if (target.current) AccessibilityInfo.sendAccessibilityEvent(target.current, "focus");
    }, FOCUS_DELAY);
  }, []);
  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const run = pending.current;
    pending.current = null;
    run?.();
  }, []);
  const close = useCallback(() => {
    // за закрытием идёт действие (загрузка, чат, бланк) - фокус вернётся туда, куда оно приведёт
    if (!pending.current) restoreFocus(button);
    generation.current += 1;
    cancelBlank();
    setOpen(false);
    setEnlarged(false);
  }, [restoreFocus, cancelBlank]);
  const closeThen = (run: () => void) => {
    pending.current = run;
    close();
    if (Platform.OS === "ios") timer.current = setTimeout(flush, 700);
    else flush();
  };
  // Не загрузилась одна страница - схема стоит на её месте, пока студент на ней. Другая страница, вкладка, открытие или
  // закрытие просмотра, новое открытие листа - попытка заново: один сбой не портит остальные страницы.
  const enlarge = () => {
    setFailedUri(null);
    setEnlarged(true);
  };
  const shrink = () => {
    setFailedUri(null);
    setEnlarged(false);
    restoreFocus(opener);
  };
  const select = (next: SampleCursor) => {
    setFailedUri(null);
    setCursor(next);
  };
  const openSheet = () => {
    generation.current += 1;
    cancelBlank();
    setFailedUri(null);
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
    cancelBlank();
    // Закрыли лист или открыли заново, пока файл качался, - его результат уже не нужен (generation сменился, запрос отменён).
    const mine = generation.current;
    const abort = new AbortController();
    const job = { abort, timer: setTimeout(() => abort.abort(), BLANK_TIMEOUT_MS) };
    blankJob.current = job;
    setBlank({ status: "busy" });
    const result = await downloadPublicFile(io.createDownloadDeps(api.portalBaseUrl, api.getAccessToken, api.refreshAccessToken), url, sampleFileName(blankHref), "application/pdf", abort.signal);
    clearTimeout(job.timer);
    if (blankJob.current === job) blankJob.current = null;
    if (!alive.current || generation.current !== mine) return;
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
  // Карточка просмотра: поля 8 на телефоне, 16 шире (веб: `.pt-doc-guide-lightbox[open] { padding }`).
  const margin = width < PHONE_WIDTH ? 8 : 16;

  return (
    <>
      <Pressable
        ref={button}
        accessibilityRole="button"
        accessibilityLabel={format(strings.guideButtonAria, { name: label })}
        onPress={openSheet}
        hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
        testID={`${id}-open`}
        style={({ pressed }) => ({ alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 7, minHeight: 32, paddingLeft: 3, paddingRight: 11, borderRadius: tokens.radiusChip, backgroundColor: tokens.bg, borderWidth: 1, borderColor: pressed ? tokens.controlEdge : tokens.line, transform: [{ scale: pressed ? tokens.pressScale : 1 }] })}
      >
        <GuideMark />
        <Text variant="caption" bold>
          {strings.guideButton}
        </Text>
      </Pressable>
      <Modal testID={`${id}-modal`} visible={open} transparent animationType="slide" onRequestClose={() => (enlarged ? shrink() : close())} onDismiss={flush} statusBarTranslucent>
        <View style={{ flex: 1 }}>
          {/* Лист: пока открыт просмотр, он остаётся на месте (под затемнением), но читалке не виден. */}
          <View
            testID={`${id}-layer`}
            accessibilityElementsHidden={enlarged}
            importantForAccessibility={enlarged ? "no-hide-descendants" : "auto"}
            style={{ flex: 1, justifyContent: "flex-end", alignItems: "center" }}
          >
            <Pressable accessibilityLabel={strings.guideClose} accessibilityRole="button" onPress={close} style={[StyleSheet.absoluteFill, { backgroundColor: tokens.dialogBackdrop }]} />
            <View testID={`${id}-sheet`} style={{ width: sheetWidth, maxHeight: height * 0.92, backgroundColor: tokens.surface, borderTopLeftRadius: tokens.radiusCard, borderTopRightRadius: tokens.radiusCard }}>
              <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12, paddingTop: 24, paddingLeft: 16, paddingRight: 16, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: tokens.line }}>
                <View style={{ flex: 1, gap: 10 }}>
                  <Text variant="title" accessibilityRole="header" style={{ fontFamily: sansFont("bold"), letterSpacing: -0.02 * tokens.sizeTitle }}>
                    {label}
                  </Text>
                  {statusLabel ? <StatusPill label={statusLabel} tone={statusTone} /> : null}
                </View>
                <Pressable accessibilityRole="button" accessibilityLabel={strings.guideClose} onPress={close} testID={`${id}-close`} style={{ width: MIN_TARGET, height: MIN_TARGET, marginTop: -10, marginRight: -10, borderRadius: tokens.radiusChip, alignItems: "center", justifyContent: "center" }}>
                  <X size={20} strokeWidth={1.8} color={tokens.text2} />
                </Pressable>
              </View>
              <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 20, paddingBottom: 24, gap: 14 }}>
                {guide.photoRules ? (
                  <GuidePhotoRules country={guide.photoRules.country} width={contentWidth} id={id} />
                ) : (
                  <GuideSamples
                    guide={guide}
                    base={api.portalBaseUrl}
                    width={contentWidth}
                    cursor={cursor}
                    onSelect={select}
                    onOpen={enlarge}
                    openerRef={opener}
                    failedUri={failedUri}
                    onImageError={setFailedUri}
                    blank={blank}
                    onBlank={() => void downloadBlank()}
                    id={id}
                  />
                )}
              </ScrollView>
              <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 16, rowGap: 8, paddingHorizontal: 16, paddingTop: 12, paddingBottom: Math.max(insets.bottom, 16), borderTopWidth: 1, borderTopColor: tokens.line }}>
                {action ? <ActionButton action={action} closeThen={closeThen} id={id} /> : null}
                <Button variant="ghost" label={strings.guideAskCurator} onPress={() => closeThen(() => go("/messages/chat"))} testID={`${id}-ask`} />
              </View>
            </View>
          </View>
          {enlarged ? (
            <View testID={`${id}-overlay`} style={StyleSheet.absoluteFill}>
              <Pressable testID={`${id}-overlay-scrim`} accessible={false} importantForAccessibility="no" onPress={shrink} style={[StyleSheet.absoluteFill, { backgroundColor: tokens.dialogBackdrop }]} />
              <View pointerEvents="box-none" style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingTop: insets.top + margin, paddingBottom: insets.bottom + margin }}>
                <GuideLightbox guide={guide} base={api.portalBaseUrl} label={label} cursor={cursor} onSelect={select} onClose={shrink} failedUri={failedUri} onImageError={setFailedUri} id={id} />
              </View>
            </View>
          ) : null}
        </View>
      </Modal>
    </>
  );
}

/** Главное действие листа: «Загрузить» / «Заменить» - обычная красная кнопка, «Скачать» - тёмная со значком (как у веба). */
function ActionButton({ action, closeThen, id }: { action: GuideAction; closeThen: (run: () => void) => void; id: string }) {
  const { tokens } = useTheme();
  const testID = action.testID ?? `${id}-action`;
  if (action.kind !== "download") {
    return <Button variant="primary" label={action.label} accessibilityLabel={action.accessibilityLabel} busy={action.busy} onPress={() => closeThen(action.onPress)} testID={testID} />;
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={action.accessibilityLabel ?? action.label}
      accessibilityState={{ disabled: action.busy === true, busy: action.busy === true }}
      disabled={action.busy === true}
      onPress={() => closeThen(action.onPress)}
      testID={testID}
      style={({ pressed }) => ({ minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingHorizontal: 16, borderRadius: tokens.radiusControl, borderWidth: 1, borderColor: tokens.text, backgroundColor: tokens.text, opacity: action.busy ? 0.6 : 1, transform: [{ scale: pressed ? tokens.pressScale : 1 }] })}
    >
      <Download size={15} strokeWidth={2} color={tokens.surface} />
      <Text variant="body" style={{ color: tokens.surface, fontFamily: sansFont("semibold") }}>
        {action.label}
      </Text>
    </Pressable>
  );
}
