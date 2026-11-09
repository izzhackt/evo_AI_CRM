// Чат с командой EVO: Telegram-подобная лента, поле ввода всегда над клавиатурой.
// Образец: MessagesThread.tsx (веб #1412). Вложений в веб-чате нет (только подпись
// документа в сообщении команды), поэтому и здесь только текст.
import { useRouter } from "expo-router";
import { ArrowLeft, ArrowUp, MessagesSquare } from "lucide-react-native";
import { useMemo, useState } from "react";
import { FlatList, KeyboardAvoidingView, Platform, Pressable, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { loadErrorKey } from "@/api/queries";
import { PORTAL_CASE_MESSAGE_BODY_LIMIT, type OutboxItem, type PortalCaseMessage } from "@/domain/inbox-model";
import { dayKey, dayLabel, timeLabel } from "@/features/inbox/format";
import { useChatThread } from "@/features/inbox/useChatThread";
import { useLang } from "@/i18n/LangProvider";
import { sansFont } from "@/theme/fonts";
import { useTheme } from "@/theme/ThemeProvider";
import { EmptyBlock, InlineAlert, LinkButton, MIN_TARGET } from "@/ui/CardParts";
import { Text } from "@/ui/Text";

type Entry =
  | { kind: "day"; key: string; label: string }
  | { kind: "message"; key: string; message: PortalCaseMessage }
  | { kind: "outbox"; key: string; item: OutboxItem };

/** Записи по возрастанию времени с разделителями дней; очередь отправки в конце. */
export function buildEntries(messages: readonly PortalCaseMessage[], outbox: readonly OutboxItem[], lang: "ru" | "ky", todayLabel: string, now: string = new Date().toISOString()): Entry[] {
  const out: Entry[] = [];
  const today = dayKey(now);
  let previous: string | null = null;
  const stamped = [
    ...messages.map((message) => ({ at: message.createdAt, entry: { kind: "message", key: `m-${message.sequenceId}`, message } as Entry })),
    ...outbox.map((item) => ({ at: item.createdAt, entry: { kind: "outbox", key: `o-${item.requestId}`, item } as Entry })),
  ];
  for (const { at, entry } of stamped) {
    const day = dayKey(at);
    if (day !== previous) {
      out.push({ kind: "day", key: `d-${day}`, label: day === today ? todayLabel : dayLabel(at, lang) });
      previous = day;
    }
    out.push(entry);
  }
  return out;
}

function Bubble({ mine, children, failed = false }: { mine: boolean; children: React.ReactNode; failed?: boolean }) {
  const { tokens } = useTheme();
  return (
    <View style={{ alignItems: mine ? "flex-end" : "flex-start", paddingHorizontal: 12, paddingVertical: 3 }}>
      <View
        style={{
          maxWidth: "84%",
          paddingHorizontal: 12,
          paddingVertical: 8,
          borderRadius: 16,
          borderBottomRightRadius: mine ? 4 : 16,
          borderBottomLeftRadius: mine ? 16 : 4,
          backgroundColor: mine ? tokens.accent : tokens.surface,
          borderWidth: mine && !failed ? 0 : 1,
          borderColor: failed ? tokens.error : tokens.line,
          gap: 2,
        }}
      >
        {children}
      </View>
    </View>
  );
}

export function ChatScreen() {
  const { lang, m, t, format } = useLang();
  const { tokens } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const strings = t("messages");
  const thread = useChatThread();
  const [draft, setDraft] = useState("");
  const entries = useMemo(
    () => buildEntries(thread.messages, thread.outbox, lang, strings.dayToday).reverse(),
    [thread.messages, thread.outbox, lang, strings.dayToday],
  );
  const trimmed = draft.trim();
  const canSend = trimmed.length >= 1;

  const submit = () => {
    if (thread.send(draft)) setDraft("");
  };

  const back = () => (router.canGoBack() ? router.back() : router.navigate("/messages"));

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={Platform.OS === "ios" ? insets.top + 52 : 0}
      style={{ flex: 1, backgroundColor: tokens.bg }}
      testID="chat-screen"
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 4, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: tokens.line }}>
        <Pressable accessibilityRole="button" accessibilityLabel={strings.backToList} onPress={back} testID="chat-back" hitSlop={4} style={{ width: MIN_TARGET, height: MIN_TARGET, alignItems: "center", justifyContent: "center" }}>
          <ArrowLeft size={22} strokeWidth={1.75} color={tokens.text} />
        </Pressable>
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: tokens.accent, alignItems: "center", justifyContent: "center" }}>
          <Text variant="caption" tone="onAccent" bold>
            EVO
          </Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="body" bold accessibilityRole="header" numberOfLines={1}>
            {strings.chatTitle}
          </Text>
          <Text variant="caption" tone="text2" numberOfLines={1}>
            {strings.chatSubline}
          </Text>
        </View>
      </View>

      {thread.awaitState === "awaiting_student" ? (
        <View accessibilityRole="alert" style={{ padding: 10, backgroundColor: tokens.accentSoft }} testID="chat-awaiting">
          <Text variant="secondary">{strings.awaitingYou}</Text>
        </View>
      ) : null}

      <View style={{ flex: 1 }}>
        {thread.query.data === undefined && thread.query.status === "error" ? (
          <View style={{ padding: 16 }}>
            <InlineAlert message={`${strings.unavailable}`} retryLabel={m("gate.retry")} onRetry={() => void thread.query.refetch()} testID="chat-error" />
          </View>
        ) : thread.query.data === undefined ? (
          <View style={{ padding: 16 }}>
            <Text variant="secondary" tone="text2" accessibilityLiveRegion="polite">
              {m("state.loading")}
            </Text>
          </View>
        ) : entries.length === 0 ? (
          <View style={{ padding: 16 }}>
            <EmptyBlock icon={MessagesSquare} title={strings.emptyTitle} body={strings.emptyBody} />
          </View>
        ) : (
          <FlatList
            testID="chat-list"
            inverted
            data={entries}
            keyExtractor={(e) => e.key}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            contentContainerStyle={{ paddingVertical: 8 }}
            ListFooterComponent={
              thread.hasEarlier ? (
                <View style={{ alignItems: "center", paddingVertical: 8 }}>
                  <LinkButton label={thread.earlierBusy ? strings.loadingEarlier : strings.loadEarlier} onPress={() => void thread.loadEarlier()} testID="chat-earlier" />
                  {thread.earlierFailed ? (
                    <Text variant="caption" tone="error" accessibilityRole="alert">
                      {strings.loadEarlierError}
                    </Text>
                  ) : null}
                </View>
              ) : undefined
            }
            renderItem={({ item }) => {
              if (item.kind === "day") {
                return (
                  <View style={{ alignItems: "center", paddingVertical: 8 }}>
                    <Text variant="caption" tone="text2" bold>
                      {item.label}
                    </Text>
                  </View>
                );
              }
              if (item.kind === "outbox") {
                const failed = item.item.status === "failed";
                return (
                  <View testID={`outbox-${item.item.status}`}>
                    <Bubble mine failed={failed}>
                      <Text variant="body" tone={failed ? "text" : "onAccent"}>
                        {item.item.body}
                      </Text>
                      <Text variant="caption" tone={failed ? "error" : "onAccent"} style={{ alignSelf: "flex-end" }}>
                        {failed ? m("inbox.failedLabel") : strings.sending}
                      </Text>
                    </Bubble>
                    {failed ? (
                      <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 16, paddingHorizontal: 12 }}>
                        <LinkButton label={strings.retry} onPress={() => thread.retry(item.item.requestId)} testID="chat-retry" />
                        <LinkButton label={m("inbox.discard")} onPress={() => thread.discard(item.item.requestId)} testID="chat-discard" />
                      </View>
                    ) : null}
                  </View>
                );
              }
              const message = item.message;
              return (
                <Bubble mine={message.mine}>
                  {message.mine ? null : (
                    <Text variant="caption" tone="accent" bold>
                      {message.authorName}
                    </Text>
                  )}
                  {message.quotedBodyPreview !== null ? (
                    <Text variant="caption" tone={message.mine ? "onAccent" : "text2"}>
                      {format(strings.quotedPrefix, { preview: message.quotedBodyPreview })}
                    </Text>
                  ) : null}
                  {message.body !== "" ? (
                    <Text variant="body" tone={message.mine ? "onAccent" : "text"} selectable>
                      {message.body}
                    </Text>
                  ) : null}
                  {message.attachmentKind === "document" ? (
                    <Text variant="secondary" tone={message.mine ? "onAccent" : "text2"}>
                      {format(strings.attachmentDocument, { label: message.attachmentLabel ?? "—" })}
                    </Text>
                  ) : null}
                  <Text variant="caption" tone={message.mine ? "onAccent" : "text2"} style={{ alignSelf: "flex-end" }}>
                    {timeLabel(message.createdAt, lang)}
                  </Text>
                </Bubble>
              );
            }}
          />
        )}
      </View>

      {thread.query.isError && thread.query.data !== undefined ? (
        <View style={{ paddingHorizontal: 12 }}>
          <InlineAlert message={m(loadErrorKey(thread.query.error))} retryLabel={strings.retry} onRetry={() => void thread.query.refetch()} testID="chat-refresh-error" />
        </View>
      ) : null}
      {thread.sendErrorKey ? (
        <View style={{ paddingHorizontal: 12 }} accessibilityRole="alert">
          <Text variant="caption" tone="error" testID="chat-send-error">
            {strings.sendError}
          </Text>
        </View>
      ) : null}

      <View
        style={{
          flexDirection: "row",
          alignItems: "flex-end",
          gap: 8,
          paddingHorizontal: 12,
          paddingTop: 8,
          paddingBottom: Math.max(insets.bottom, 8),
          borderTopWidth: 1,
          borderTopColor: tokens.line,
          backgroundColor: tokens.bg,
        }}
      >
        <TextInput
          testID="chat-input"
          accessibilityLabel={strings.composerLabel}
          accessibilityHint={strings.limitHint}
          placeholder={strings.composerPlaceholder}
          placeholderTextColor={tokens.text2}
          value={draft}
          onChangeText={setDraft}
          multiline
          maxLength={PORTAL_CASE_MESSAGE_BODY_LIMIT}
          style={{
            flex: 1,
            minHeight: 44,
            maxHeight: 120,
            paddingHorizontal: 14,
            paddingTop: 11,
            paddingBottom: 11,
            borderRadius: 22,
            borderWidth: 1,
            borderColor: tokens.controlEdge,
            backgroundColor: tokens.surface,
            color: tokens.text,
            fontFamily: sansFont(),
            fontSize: tokens.sizeBody,
          }}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={m("inbox.sendLabel")}
          accessibilityState={{ disabled: !canSend }}
          disabled={!canSend}
          onPress={submit}
          testID="chat-send"
          style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: tokens.accent, opacity: canSend ? 1 : 0.5, alignItems: "center", justifyContent: "center" }}
        >
          <ArrowUp size={22} strokeWidth={2} color={tokens.onAccent} />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}
