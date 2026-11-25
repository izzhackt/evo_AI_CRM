// «Подбор с Эви» (веб: вкладка «Подбор с Эви» в «Профессиях», `?view=evi`): разговор с ИИ-профориентатором. Состояние разговора -
// общий с вебом хук (`@web/lib/portal/evi-conversation`), ответы идут на сервер приложения (POST /api/portal/mobile/evi).
// Разговор помнится, пока открыт кабинет (веб #1530): его держит память оболочки (`EviMemory.tsx`), не экран; после выхода и
// после нового запуска приложения он начинается заново.
// Экран без напоминаний о конфиденциальности: согласие на ИИ-помощников спрашивают при регистрации, не здесь.
// Как страница веба, экран сам решает, пускать ли: согласие отозвано - уходит в каталог (`?view=evi` ведёт в каталог); ключа Эви на
// сервере нет - «Эви сейчас недоступен» и «Открыть каталог» с первого экрана, поле закрыто (`EviChat offline`). Не удалось узнать ни то
// ни другое - чат открывается как прежде, ответит или откажет сервер.
import { router } from "expo-router";
import { ArrowUp, Check, SquarePen } from "lucide-react-native";
import { useCallback, useEffect, useRef } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EVI_FAILURE_ACTION, EVI_LIMITS, type EviResult } from "@web/lib/portal/evi";
import { useEviConversation, type EviMessage } from "@web/lib/portal/evi-conversation";

import { usePortalApi } from "@/api/PortalApi";
import type { EviApi } from "@/features/learning/evi/api";
import { useEviMemory } from "@/features/learning/evi/EviMemory";
import { EviRobot } from "@/features/learning/evi/EviRobot";
import { FAILURE_TEXT, EviThread } from "@/features/learning/evi/EviThread";
import { useEviApi, useEviGate } from "@/features/learning/evi/hooks";
import { leaveEviForCatalog } from "@/features/learning/evi/navigation";
import { TypingDots } from "@/features/learning/evi/TypingDots";
import { SubHeader, useBack } from "@/features/learning/ui";
import { useKeyboardInset } from "@/features/inbox/useKeyboardInset";
import type { PortalStrings } from "@/i18n";
import { useLang } from "@/i18n/LangProvider";
import { TOP_BAR_HEIGHT } from "@/shell/top-bar-metrics";
import { sansFont } from "@/theme/fonts";
import { useTheme } from "@/theme/ThemeProvider";
import { useFocusEffect } from "@/lib/focus";
import { useAnnouncer } from "@/ui/useAnnouncer";
import { MIN_TARGET, CardSkeleton } from "@/ui/CardParts";
import { Text } from "@/ui/Text";

type Strings = PortalStrings<"professions">;

export function EviScreen({ api }: { api?: EviApi }) {
  const { userKey } = usePortalApi();
  const evi = useEviApi(api);
  const gate = useEviGate(evi);
  // Согласие отозвано: как `redirect("/portal/professions")` веба. Уходим, только когда экран на виду: Эви под другим экраном стека
  // не должна дёргать навигацию, пока студент смотрит на карточку профессии.
  const redirect = gate.state === "redirect";
  useFocusEffect(
    useCallback(() => {
      if (redirect) leaveEviForCatalog();
    }, [redirect]),
  );
  if (gate.state !== "open") return <EviWaiting />;
  // Чат принадлежит одному студенту (веб: key={owner}): если на том же месте окажется другой, он начнёт с приветствия, а не перепишет
  // чужой разговор на себя. Смена «ключ есть / ключа нет» тоже открывает чат заново: приветствие и «недоступен» - разные экраны.
  return <EviChat key={`${userKey}:${gate.offline ? "offline" : "online"}`} api={evi} offline={gate.offline} />;
}

/** Пока читается согласие (или экран уходит в каталог): шапка и заглушка, самого чата ещё нет. */
function EviWaiting() {
  const { tokens } = useTheme();
  const { m, t } = useLang();
  const back = useBack("/professions");
  const p = t("professions");
  return (
    <View style={{ flex: 1, backgroundColor: tokens.bg }} testID="evi-waiting">
      <SubHeader title={p["evi.name"]} onBack={back} backLabel={p.backToGrid} testID="evi-title" />
      <View style={{ padding: 16 }}>
        <CardSkeleton label={m("state.loading")} lines={3} />
      </View>
    </View>
  );
}

/** Что читает экранная читалка вместо живой области веба: реплика Эви и, у итога, заголовок с тремя названиями. */
export function replyAnnouncement(message: EviMessage, strings: Strings): string {
  if (!message.results || message.results.length === 0) return message.text;
  const titles = message.results.map((result, index) => `${index + 1}. ${result.title}`).join(", ");
  return `${message.text} ${strings["evi.resultsTitle"]}: ${titles}`;
}

function EviChat({ api, offline }: { api: EviApi; offline: boolean }) {
  const { lang, t, format } = useLang();
  const { tokens } = useTheme();
  const portal = usePortalApi();
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardInset();
  const back = useBack("/professions");
  const p = t("professions");
  // Разговор из памяти кабинета: тот же студент получает его обратно, другой - только приветствие (см. EviMemory.tsx). Без ключа на
  // сервере памяти нет (как на вебе: `EviChat offline` без `owner`), и открытие недоступного Эви не стирает прежний разговор.
  const stored = useEviMemory(portal.userKey);
  const memory = offline ? null : stored;
  const chat = useEviConversation({
    strings: p,
    ask: (history) => api.ask(history, lang),
    memory,
    initialFailure: offline ? "unavailable" : null,
  });
  const action = chat.failure ? EVI_FAILURE_ACTION[chat.failure] : null;
  const closed = action === "restart" || action === "catalog";
  const listening = chat.draft.length > 0;
  const openResult = useCallback((result: EviResult) => router.navigate({ pathname: "/professions/[cardId]", params: { cardId: result.cardId } }), []);

  // Живая область веба (`role="log"`, `role="status"`, `role="alert"`): новая реплика, «печатает» и сбой объявляются читалкой. Проход
  // по разговору, который уже был на экране (возврат из памяти, приветствие), ничего не объявляет: только то, что случилось на глазах.
  const { announce, region } = useAnnouncer();
  const last = chat.messages[chat.messages.length - 1];
  const replyKey = !chat.intro && last?.role === "assistant" && last.fresh === true ? `${chat.round}:${chat.messages.length}` : null;
  const spokenReply = useRef(replyKey);
  useEffect(() => {
    if (replyKey === null || replyKey === spokenReply.current || !last) return;
    spokenReply.current = replyKey;
    announce(replyAnnouncement(last, p));
    // Реплика меняется вместе с ключом.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replyKey]);
  const wasPending = useRef(chat.pending);
  useEffect(() => {
    if (chat.pending && !wasPending.current) announce(p["evi.thinking"]);
    wasPending.current = chat.pending;
  }, [chat.pending, announce, p]);
  const spokenFailure = useRef(chat.failure);
  useEffect(() => {
    if (chat.failure && chat.failure !== spokenFailure.current && !chat.intro) announce(p[FAILURE_TEXT[chat.failure]], "assertive");
    spokenFailure.current = chat.failure;
  }, [chat.failure, chat.intro, announce, p]);

  const subtitle = chat.pending
    ? p["evi.typing"]
    : chat.progress
      ? format(p["evi.progress"], { step: String(chat.progress.step), total: String(chat.progress.total) })
      : p["evi.role"];

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? insets.top + TOP_BAR_HEIGHT : 0}
      style={{ flex: 1, backgroundColor: tokens.bg, paddingBottom: keyboard > 0 ? keyboard + insets.bottom : 0 }}
      testID="evi-screen"
    >
      <SubHeader
        title={p["evi.name"]}
        subtitle={chat.intro ? null : subtitle}
        subtitleExtra={chat.pending ? <TypingDots size={4} gap={3} tone="text2" testID="evi-header-dots" /> : null}
        avatar={chat.intro ? null : <EviRobot face={chat.pending ? "thinking" : "happy"} settled still size={44} testID="evi-avatar" />}
        onBack={back}
        backLabel={p.backToGrid}
        testID="evi-title"
        right={
          chat.intro ? null : (
            <Pressable
              accessibilityRole="button"
              onPress={chat.restart}
              testID="evi-new-chat"
              hitSlop={4}
              style={({ pressed }) => ({
                marginRight: 12,
                minHeight: MIN_TARGET,
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                paddingLeft: 12,
                paddingRight: 16,
                borderRadius: tokens.radiusChip,
                borderWidth: 1,
                borderColor: tokens.controlEdge,
                backgroundColor: tokens.surface,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <SquarePen size={20} strokeWidth={2} color={tokens.text} />
              <Text variant="secondary" bold numberOfLines={1}>
                {p["evi.newChat"]}
              </Text>
            </Pressable>
          )
        }
      />
      {chat.progress ? (
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ height: 3, backgroundColor: tokens.line }}>
          <View testID="evi-progress-fill" style={{ height: 3, width: `${Math.round((chat.progress.step / chat.progress.total) * 100)}%`, backgroundColor: tokens.accent }} />
        </View>
      ) : null}

      <EviThread
        strings={p}
        messages={chat.messages}
        round={chat.round}
        intro={chat.intro}
        pending={chat.pending}
        failure={chat.failure}
        listening={listening}
        poke={chat.pokes}
        onOpenResult={openResult}
      />

      <View style={{ gap: 8, paddingHorizontal: 12, paddingTop: 8, paddingBottom: keyboard > 0 ? 8 : Math.max(insets.bottom, 8), borderTopWidth: 1, borderTopColor: tokens.line, backgroundColor: tokens.bg }}>
        {chat.failure ? (
          <View style={{ gap: 8, alignItems: "center" }}>
            {chat.intro ? null : (
              <Text variant="secondary" tone="error" accessibilityRole="alert" testID="evi-failure" style={{ textAlign: "center" }}>
                {p[FAILURE_TEXT[chat.failure]]}
              </Text>
            )}
            {action === "retry" && chat.canRetry ? (
              <Go label={p["evi.retry"]} onPress={chat.retry} testID="evi-retry" />
            ) : action === "restart" ? (
              <Go label={p["evi.newChat"]} onPress={chat.restart} testID="evi-restart" />
            ) : action === "catalog" ? (
              <Go label={p["evi.toCatalog"]} onPress={leaveEviForCatalog} testID="evi-catalog" />
            ) : null}
          </View>
        ) : chat.options.options.length > 0 && !chat.pending ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }} accessibilityLabel={chat.options.multi ? p["evi.optionsMultiLabel"] : p["evi.optionsLabel"]}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 8 }} style={{ flex: 1 }}>
              {chat.options.options.map((option) => {
                const picked = chat.picked.has(option);
                const go = option === chat.options.go;
                return (
                  <Pressable
                    key={option}
                    accessibilityRole="button"
                    accessibilityState={chat.options.multi ? { selected: picked } : undefined}
                    onPress={() => (chat.options.multi ? chat.toggle(option) : chat.send(option))}
                    testID={`evi-option-${option}`}
                    style={{ minHeight: MIN_TARGET, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", gap: 6, justifyContent: "center", borderRadius: tokens.radiusChip, borderWidth: 1, borderColor: go || picked ? tokens.accent : tokens.controlEdge, backgroundColor: go ? tokens.accent : picked ? tokens.accentSoft : tokens.surface }}
                  >
                    {picked ? <Check size={16} strokeWidth={2.4} color={tokens.accent} /> : null}
                    <Text variant="secondary" bold={go || picked} tone={go ? "onAccent" : "text"}>
                      {option}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            {chat.options.multi ? (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: chat.picked.size === 0 }}
                disabled={chat.picked.size === 0}
                onPress={() => chat.send([...chat.picked].join(", "))}
                testID="evi-done"
                style={{ minHeight: MIN_TARGET, paddingHorizontal: 16, justifyContent: "center", borderRadius: tokens.radiusChip, backgroundColor: tokens.accent, opacity: chat.picked.size === 0 ? 0.5 : 1 }}
              >
                <Text variant="secondary" bold tone="onAccent">
                  {p["evi.done"]}
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
        {closed ? null : (
          <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 8 }}>
            <TextInput
              testID="evi-input"
              accessibilityLabel={p["evi.inputLabel"]}
              placeholder={p["evi.placeholder"]}
              placeholderTextColor={tokens.text2}
              value={chat.draft}
              onChangeText={chat.setDraft}
              multiline
              maxLength={EVI_LIMITS.maxUserChars}
              style={{ flex: 1, minHeight: 44, maxHeight: 120, paddingHorizontal: 14, paddingVertical: 11, borderRadius: 22, borderWidth: 1, borderColor: tokens.controlEdge, backgroundColor: tokens.surface, color: tokens.text, fontFamily: sansFont(), fontSize: tokens.sizeBody }}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={p["evi.send"]}
              accessibilityState={{ disabled: chat.pending || chat.draft.trim().length === 0 }}
              disabled={chat.pending || chat.draft.trim().length === 0}
              onPress={() => chat.send(chat.draft)}
              testID="evi-send"
              style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: tokens.accent, opacity: chat.pending || chat.draft.trim().length === 0 ? 0.5 : 1, alignItems: "center", justifyContent: "center" }}
            >
              <ArrowUp size={22} strokeWidth={2} color={tokens.onAccent} />
            </Pressable>
          </View>
        )}
      </View>
      {region}
    </KeyboardAvoidingView>
  );
}

function Go({ label, onPress, testID }: { label: string; onPress: () => void; testID: string }) {
  const { tokens } = useTheme();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} testID={testID} style={{ minHeight: MIN_TARGET, paddingHorizontal: 20, justifyContent: "center", borderRadius: tokens.radiusChip, backgroundColor: tokens.accent }}>
      <Text variant="secondary" bold tone="onAccent">
        {label}
      </Text>
    </Pressable>
  );
}
