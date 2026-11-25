// Переписка: реплики Эви слева (робот только у последней, как в уроке), ответы ученика справа, три профессии во всю ширину под
// репликой «Придумал!» (веб: `EviThread.tsx`). Пока ученик не ответил - экран приветствия: крупный робот, «Привет! Я Эви» и строка о том,
// что будет; если Эви недоступен с самого начала - эта строка говорит об этом. Пока Эви думает - облачко с тремя бегущими точками и
// «думающий» робот. Сбой - строка системы над полем ввода (её рисует экран), робот при сбое спокоен, а не улыбается.
// Прокрутка: новая реплика Эви открывается с начала, чтобы «Придумал!» и первая профессия были видны первыми; всё остальное (ответ ученика,
// «печатает», сбой, вернувшийся разговор) - к концу. Вернувшийся из памяти кабинета разговор открывается на последней реплике.
import { useCallback, useLayoutEffect, useRef } from "react";
import { ScrollView, View } from "react-native";

import { eviSpeakMs, type EviFailure, type EviResult } from "@web/lib/portal/evi";
import type { EviMessage } from "@web/lib/portal/evi-conversation";

import { EviMascot } from "@/features/learning/evi/EviMascot";
import { EviResults } from "@/features/learning/evi/EviResults";
import { TypingDots } from "@/features/learning/evi/TypingDots";
import type { PortalStrings } from "@/i18n";
import { sansFont } from "@/theme/fonts";
import { useTheme } from "@/theme/ThemeProvider";
import { Text } from "@/ui/Text";

type Strings = PortalStrings<"professions">;

export const FAILURE_TEXT: Readonly<Record<EviFailure, "evi.unavailable" | "evi.limit" | "evi.busy" | "evi.invalid" | "evi.error">> = {
  consent: "evi.unavailable",
  unavailable: "evi.unavailable",
  limit: "evi.limit",
  busy: "evi.busy",
  invalid: "evi.invalid",
  error: "evi.error",
};

/** Отступ сверху у реплики, открытой с начала (веб: `row.offsetTop - 12`). */
export const ALIGN_MARGIN = 12;
const ROBOT_SLOT = 56;

/** RN 0.88: тип ScrollView - компонент, не экземпляр (см. ui/Screen.tsx), поэтому ссылка описана тем, что нужно экрану. */
type LogHandle = { scrollTo: (options: { y: number; animated?: boolean }) => void; scrollToEnd: (options?: { animated?: boolean }) => void };

export function EviThread({ strings, messages, round, intro, pending, failure, listening, poke, onOpenResult }: Readonly<{
  strings: Strings;
  messages: readonly EviMessage[];
  /** Номер разговора: после «Нового чата» строки монтируются заново. */
  round: number;
  /** Ученик ещё не ответил: вместо реплики-приветствия - экран приветствия. */
  intro: boolean;
  pending: boolean;
  failure: EviFailure | null;
  listening: boolean;
  /** Счётчик выбранных вариантов: робот у реплики коротко радуется каждому выбору. */
  poke: number;
  onOpenResult: (result: EviResult) => void;
}>) {
  const { tokens } = useTheme();
  const logRef = useRef<LogHandle | null>(null);
  const lastAssistant = messages.findLastIndex((message) => message.role === "assistant");
  const last = messages[messages.length - 1];
  // Свежая реплика Эви, на которую ученик смотрит: ни «печатает», ни сбоя после неё нет.
  const opensAtStart = last?.role === "assistant" && last.fresh === true && !pending && failure === null;

  // Реплика, которую надо открыть с начала, и где стоит её строка (замер приходит позже отрисовки: до него прокручивать некуда).
  // Строка названа ключом `номер разговора-номер реплики`, как её ключ в списке: замер строки из прошлого разговора (после «Нового
  // чата» номера реплик начинаются снова) к новой реплике не подходит и в прокрутку не попадает.
  const wanted = useRef<string | null>(null);
  const measured = useRef<{ key: string; y: number } | null>(null);
  const alignToStart = useCallback(() => {
    const target = wanted.current;
    const row = measured.current;
    if (target === null || row === null || row.key !== target) return;
    wanted.current = null;
    logRef.current?.scrollTo({ y: Math.max(0, row.y - ALIGN_MARGIN), animated: true });
  }, []);
  const onSpeakingLayout = useCallback(
    (key: string, y: number) => {
      measured.current = { key, y };
      alignToStart();
    },
    [alignToStart],
  );

  useLayoutEffect(() => {
    if (intro) return;
    if (opensAtStart && lastAssistant >= 0) {
      wanted.current = `${round}-${lastAssistant}`;
      alignToStart();
      return;
    }
    wanted.current = null;
    logRef.current?.scrollToEnd({ animated: true });
    // `last` меняется с каждой новой репликой; остальное - те же три сигнала, что у веба (номер разговора меняется только вместе с ними).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [last, pending, failure, intro]);

  // Разговор из памяти открывается на последней реплике, как на вебе (там при монтировании scrollTop = scrollHeight): первый замер
  // содержимого прокручивает к концу без анимации, до замера прокручивать нечего.
  const pinToEnd = useRef(!intro);
  const pinLogToEnd = useCallback((_width: number, height: number) => {
    if (!pinToEnd.current || height <= 0) return;
    pinToEnd.current = false;
    logRef.current?.scrollToEnd({ animated: false });
  }, []);

  const greeting = messages[0];
  return (
    <ScrollView
      ref={logRef as never}
      accessibilityLabel={strings["evi.logLabel"]}
      keyboardShouldPersistTaps="handled"
      onContentSizeChange={pinLogToEnd}
      contentContainerStyle={{ flexGrow: 1, padding: 16, gap: 12 }}
      testID="evi-log"
    >
      {intro && greeting ? (
        <View key={`${round}-welcome`} testID="evi-welcome" style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 32 }}>
          <View style={{ marginBottom: 8 }}>
            {failure ? (
              <EviMascot mood="idle" size={104} testID="evi-mascot" />
            ) : (
              <EviMascot mood={greeting.mood ?? "happy"} listening={listening} speakMs={greeting.fresh ? eviSpeakMs(greeting.text) : undefined} size={104} testID="evi-mascot" />
            )}
          </View>
          <Text variant="title" accessibilityRole="header" style={{ textAlign: "center", fontFamily: sansFont("bold"), letterSpacing: -0.02 * tokens.sizeTitle, lineHeight: tokens.sizeTitle * 1.15 }}>
            {strings["evi.welcomeTitle"]}
          </Text>
          <Text variant="body" tone="text2" style={{ textAlign: "center", maxWidth: 360 }} testID="evi-welcome-text">
            {strings[failure ? FAILURE_TEXT[failure] : "evi.welcomeText"]}
          </Text>
        </View>
      ) : (
        messages.map((message, index) => {
          const key = `${round}-${index}`;
          if (message.role === "user") return <UserBubble key={key} text={message.text} />;
          const speaking = index === lastAssistant && !pending;
          const fresh = index === messages.length - 1 && message.fresh === true;
          return (
            <AssistantRow
              key={key}
              message={message}
              strings={strings}
              speaking={speaking}
              mood={failure ? "idle" : (message.mood ?? "talk")}
              speakMs={fresh ? eviSpeakMs(message.text) : undefined}
              listening={listening}
              poke={poke}
              onLayoutY={speaking ? (y) => onSpeakingLayout(key, y) : undefined}
              onOpenResult={onOpenResult}
            />
          );
        })
      )}
      {pending ? (
        <View style={{ flexDirection: "row", gap: 10, alignItems: "flex-start" }}>
          <View style={{ width: ROBOT_SLOT }}>
            <EviMascot mood="thinking" hopOnMount size={ROBOT_SLOT} testID="evi-mascot-typing" />
          </View>
          <View
            accessibilityRole="progressbar"
            accessibilityLabel={strings["evi.thinking"]}
            testID="evi-typing"
            style={{ marginTop: 6, minHeight: 46, paddingHorizontal: 20, justifyContent: "center", borderRadius: 20, backgroundColor: tokens.eviBubble, borderWidth: 1, borderColor: tokens.line }}
          >
            <TypingDots size={8} gap={6} />
          </View>
        </View>
      ) : null}
    </ScrollView>
  );
}

function UserBubble({ text }: { text: string }) {
  const { tokens } = useTheme();
  return (
    <View style={{ alignSelf: "flex-end", maxWidth: "80%", paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20, backgroundColor: tokens.accent }} testID="evi-bubble-mine">
      <Text variant="secondary" tone="onAccent">
        {text}
      </Text>
    </View>
  );
}

function AssistantRow({ message, strings, speaking, mood, speakMs, listening, poke, onLayoutY, onOpenResult }: Readonly<{
  message: EviMessage;
  strings: Strings;
  /** Робот стоит у последней реплики Эви, пока она не ждёт нового ответа. */
  speaking: boolean;
  mood: Parameters<typeof EviMascot>[0]["mood"];
  speakMs: number | undefined;
  listening: boolean;
  poke: number;
  onLayoutY?: (y: number) => void;
  onOpenResult: (result: EviResult) => void;
}>) {
  const { tokens, scheme } = useTheme();
  return (
    <View testID="evi-row" style={{ gap: 12 }} onLayout={onLayoutY ? (event) => onLayoutY(event.nativeEvent.layout.y) : undefined}>
      <View style={{ flexDirection: "row", gap: 10, alignItems: "flex-start" }}>
        <View style={{ width: ROBOT_SLOT }}>{speaking ? <EviMascot mood={mood} listening={listening} speakMs={speakMs} poke={poke} size={ROBOT_SLOT} testID="evi-mascot" /> : null}</View>
        <View style={{ flex: 1, alignItems: "flex-start", marginTop: speaking ? 6 : 0 }}>
          <View
            testID="evi-bubble"
            style={{
              maxWidth: "100%",
              paddingHorizontal: 14,
              paddingVertical: 10,
              borderRadius: 20,
              backgroundColor: tokens.eviBubble,
              borderWidth: 1,
              borderColor: tokens.line,
              boxShadow: scheme === "dark" ? undefined : tokens.shadowCard,
            }}
          >
            {/* «Хвост» облачка смотрит на робота: только у реплики, рядом с которой он стоит. */}
            {speaking ? (
              <View
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                style={{ position: "absolute", top: 14, left: -7, width: 12, height: 12, borderBottomWidth: 1, borderLeftWidth: 1, borderColor: tokens.line, borderBottomLeftRadius: 3, backgroundColor: tokens.eviBubble, transform: [{ rotate: "45deg" }] }}
              />
            ) : null}
            <Text variant="secondary">{message.text}</Text>
          </View>
        </View>
      </View>
      {message.results ? <EviResults results={message.results} strings={strings} onOpen={onOpenResult} /> : null}
    </View>
  );
}
