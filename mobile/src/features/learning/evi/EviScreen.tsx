// «Подбор с Эви» (веб: вкладка «Подбор с Эви» в «Профессиях»): разговор с ИИ-профориентатором. Состояние разговора -
// общий с вебом хук (`@web/lib/portal/evi-conversation`), ответы идут на сервер приложения (POST /api/portal/mobile/evi).
// Экран без напоминаний о конфиденциальности: согласие на ИИ-помощников спрашивают при регистрации, не здесь. Если оно
// отозвано, сервер отвечает `consent`, и экран говорит то же «Эви сейчас недоступен» с входом в каталог, что и веб.
import { router } from "expo-router";
import { ArrowUp, Bot, Check, SquarePen } from "lucide-react-native";
import { useEffect, useMemo, useRef, type RefObject } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EVI_FAILURE_ACTION, EVI_LIMITS, type EviFailure, type EviResult } from "@web/lib/portal/evi";
import { useEviConversation, type EviMessage } from "@web/lib/portal/evi-conversation";

import { usePortalApi } from "@/api/PortalApi";
import { createEviApi, type EviApi } from "@/features/learning/evi/api";
import { SubHeader, useBack } from "@/features/learning/ui";
import { useKeyboardInset } from "@/features/inbox/useKeyboardInset";
import type { PortalStrings } from "@/i18n";
import { useLang } from "@/i18n/LangProvider";
import { sansFont } from "@/theme/fonts";
import { useTheme } from "@/theme/ThemeProvider";
import { MIN_TARGET } from "@/ui/CardParts";
import { Text } from "@/ui/Text";

type Strings = PortalStrings<"professions">;

const FAILURE_TEXT: Readonly<Record<EviFailure, "evi.unavailable" | "evi.limit" | "evi.busy" | "evi.invalid" | "evi.error">> = {
  consent: "evi.unavailable",
  unavailable: "evi.unavailable",
  limit: "evi.limit",
  busy: "evi.busy",
  invalid: "evi.invalid",
  error: "evi.error",
};

export function EviScreen({ api: apiProp }: { api?: EviApi }) {
  const { lang, t, format } = useLang();
  const { tokens } = useTheme();
  const portal = usePortalApi();
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardInset();
  const back = useBack("/professions");
  const p = t("professions");
  const evi = useMemo(
    () => apiProp ?? createEviApi({ baseUrl: portal.portalBaseUrl, getToken: portal.getAccessToken, refreshToken: portal.refreshAccessToken }),
    [apiProp, portal.portalBaseUrl, portal.getAccessToken, portal.refreshAccessToken],
  );
  const chat = useEviConversation({
    strings: p,
    ask: (history) => evi.ask(history, lang),
    initialFailure: null,
  });
  // RN 0.88: тип ScrollView - компонент, не экземпляр (см. ui/Screen.tsx), поэтому ссылка описана тем, что нужно экрану.
  const logRef = useRef<{ scrollToEnd: (options?: { animated?: boolean }) => void } | null>(null);
  const action = chat.failure ? EVI_FAILURE_ACTION[chat.failure] : null;
  const closed = action === "restart" || action === "catalog";

  useEffect(() => {
    logRef.current?.scrollToEnd({ animated: true });
  }, [chat.messages, chat.pending, chat.failure]);

  const subtitle = chat.pending
    ? p["evi.typing"]
    : chat.progress
      ? format(p["evi.progress"], { step: String(chat.progress.step), total: String(chat.progress.total) })
      : p["evi.role"];

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? insets.top + 52 : 0}
      style={{ flex: 1, backgroundColor: tokens.bg, paddingBottom: keyboard > 0 ? keyboard + insets.bottom : 0 }}
      testID="evi-screen"
    >
      <SubHeader
        title={p["evi.name"]}
        subtitle={chat.intro ? null : subtitle}
        onBack={back}
        backLabel={p.backToGrid}
        testID="evi-title"
        right={
          chat.intro ? null : (
            <Pressable accessibilityRole="button" accessibilityLabel={p["evi.newChat"]} onPress={chat.restart} testID="evi-new-chat" hitSlop={4} style={{ width: MIN_TARGET, height: MIN_TARGET, alignItems: "center", justifyContent: "center" }}>
              <SquarePen size={22} strokeWidth={1.75} color={tokens.text} />
            </Pressable>
          )
        }
      />
      {chat.progress ? (
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ height: 3, backgroundColor: tokens.line }}>
          <View testID="evi-progress-fill" style={{ height: 3, width: `${Math.round((chat.progress.step / chat.progress.total) * 100)}%`, backgroundColor: tokens.accent }} />
        </View>
      ) : null}

      <ScrollView ref={logRef as RefObject<never>} accessibilityLabel={p["evi.logLabel"]} keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1, padding: 16, gap: 12 }} testID="evi-log">
        {chat.intro ? (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingVertical: 32 }} testID="evi-welcome">
            <Avatar size={96} />
            <Text variant="heading" accessibilityRole="header" style={{ textAlign: "center" }}>
              {p["evi.welcomeTitle"]}
            </Text>
            <Text variant="body" tone="text2" style={{ textAlign: "center" }} testID="evi-welcome-text">
              {p[chat.failure ? FAILURE_TEXT[chat.failure] : "evi.welcomeText"]}
            </Text>
          </View>
        ) : (
          chat.messages.map((message, index) => <Row key={`${chat.round}-${index}`} message={message} last={index === chat.messages.length - 1} strings={p} />)
        )}
        {chat.pending ? (
          <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-end" }}>
            <Avatar size={32} />
            <View accessibilityRole="progressbar" accessibilityLabel={p["evi.thinking"]} testID="evi-typing" style={{ paddingHorizontal: 16, paddingVertical: 14, borderRadius: 16, backgroundColor: tokens.surface, borderWidth: 1, borderColor: tokens.line }}>
              <Text variant="secondary" tone="text2">
                {"•••"}
              </Text>
            </View>
          </View>
        ) : null}
      </ScrollView>

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
              <Go label={p["evi.toCatalog"]} onPress={() => router.navigate("/professions")} testID="evi-catalog" />
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
    </KeyboardAvoidingView>
  );
}

function Avatar({ size }: { size: number }) {
  const { tokens } = useTheme();
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: size, height: size, borderRadius: size / 2, alignItems: "center", justifyContent: "center", backgroundColor: tokens.accentSoft }}>
      <Bot size={Math.round(size * 0.55)} strokeWidth={1.75} color={tokens.accent} />
    </View>
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

function Row({ message, last, strings }: { message: EviMessage; last: boolean; strings: Strings }) {
  const { tokens } = useTheme();
  if (message.role === "user") {
    return (
      <View style={{ alignSelf: "flex-end", maxWidth: "85%", paddingHorizontal: 14, paddingVertical: 10, borderRadius: 16, backgroundColor: tokens.accent }} testID="evi-bubble-mine">
        <Text variant="body" tone="onAccent">
          {message.text}
        </Text>
      </View>
    );
  }
  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-end" }}>
        <View style={{ width: 32 }}>{last ? <Avatar size={32} /> : null}</View>
        <View style={{ flex: 1, alignItems: "flex-start" }}>
          <View style={{ maxWidth: "92%", paddingHorizontal: 14, paddingVertical: 10, borderRadius: 16, backgroundColor: tokens.surface, borderWidth: 1, borderColor: tokens.line }} testID="evi-bubble">
            <Text variant="body">{message.text}</Text>
          </View>
        </View>
      </View>
      {message.results ? <Results results={message.results} strings={strings} /> : null}
    </View>
  );
}

/** Три профессии: номер, название-ссылка на карточку каталога, «чем занимается» из самой карточки и «почему» словами Эви. Процентов нет. */
function Results({ results, strings }: { results: readonly EviResult[]; strings: Strings }) {
  const { tokens } = useTheme();
  return (
    <View style={{ gap: 10 }} testID="evi-results">
      <Text variant="heading" accessibilityRole="header">
        {strings["evi.resultsTitle"]}
      </Text>
      {results.map((result, index) => (
        <Pressable
          key={result.cardId}
          accessibilityRole="link"
          accessibilityLabel={`${index + 1}. ${result.title}`}
          onPress={() => router.navigate({ pathname: "/professions/[cardId]", params: { cardId: result.cardId } })}
          testID={`evi-result-${result.cardKey}`}
          style={{ gap: 6, padding: 14, borderRadius: tokens.radiusCard, borderWidth: 1, borderColor: tokens.line, backgroundColor: tokens.surface }}
        >
          <Text variant="body" bold>
            {`${index + 1}. ${result.title}`}
          </Text>
          {result.summary ? (
            <Text variant="secondary" tone="text2">
              {result.summary}
            </Text>
          ) : null}
          <Text variant="secondary">{result.why}</Text>
        </Pressable>
      ))}
    </View>
  );
}
