"use client";

import { useEffect, useRef, useState } from "react";

import { EVI_LIMITS, type EviActionResult, type EviFailure, type EviMood, type EviProgress, type EviResult, type EviTurn } from "@/lib/portal/evi";
import type { PortalStrings } from "@/lib/portal/i18n";

type Strings = PortalStrings<"professions">;
/** `fresh` — реплика только что пришла: робот на неё реагирует. На сервер не уходит. */
export type EviMessage = Readonly<{
  role: "user" | "assistant";
  text: string;
  mood?: EviMood;
  results?: readonly EviResult[] | null;
  /** «Вопрос N из M» — только если его прислала модель. */
  progress?: EviProgress | null;
  fresh?: true;
}>;
/** `go` — вариант, который ведёт дальше (красная кнопка); варианты модели его не ставят. */
export type EviOptions = Readonly<{ options: readonly string[]; multi: boolean; go?: string }>;
export type EviAsk = (history: EviTurn[]) => Promise<EviActionResult>;

/**
 * Состояние разговора с Эви. Ничего не хранится: разговор живёт, пока открыта страница. «Новый чат» поднимает номер
 * разговора (`round`): ответ или повтор, пришедшие для старого разговора, отбрасываются, а строки переписки получают
 * новые ключи — робот на приветствии реагирует заново. Одновременно идёт не больше одного запроса. Пока серверного
 * действия нет (`ask`), отправка честно говорит «Эви сейчас недоступен».
 */
export function useEviConversation({ strings, ask, initialMessages, initialOptions, initialFailure }: Readonly<{
  strings: Strings;
  ask?: EviAsk;
  initialMessages?: readonly EviMessage[];
  initialOptions?: EviOptions;
  initialFailure: EviFailure | null;
}>) {
  const greeting: readonly EviMessage[] = [{ role: "assistant", text: strings["evi.greeting"], mood: "happy", fresh: true }];
  const greetingOptions: EviOptions = { options: [strings["evi.start"], strings["evi.how"]], multi: false, go: strings["evi.start"] };
  const [messages, setMessages] = useState<readonly EviMessage[]>(initialMessages ?? greeting);
  const [options, setOptions] = useState<EviOptions>(initialOptions ?? greetingOptions);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [failure, setFailure] = useState<EviFailure | null>(initialFailure);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<number | null>(null);
  const [round, setRound] = useState(0);
  const epochRef = useRef(0);
  const busyRef = useRef<number | null>(null);
  const messagesRef = useRef(messages);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  function settle() {
    busyRef.current = null;
    setBusy(null);
  }

  async function run(call: EviAsk, turns: EviTurn[], mine: number) {
    try {
      const result = await call(turns);
      if (epochRef.current !== mine) return;
      settle();
      if (!result.ok) { setFailure(result.reason); return; }
      const { message, mood, options: next, multi, results, progress } = result.answer;
      setMessages((current) => [...current, { role: "assistant", text: message, mood, results, progress, fresh: true }]);
      setOptions({ options: next, multi });
    } catch {
      if (epochRef.current !== mine) return;
      settle();
      setFailure("error");
    }
  }

  function request(history: readonly EviMessage[]) {
    if (!ask) { setFailure("unavailable"); return; }
    if (busyRef.current !== null) return;
    const mine = epochRef.current;
    busyRef.current = mine;
    setBusy(mine);
    void run(ask, history.map((message) => ({ role: message.role, content: message.text })), mine);
  }

  function send(text: string) {
    const value = text.trim().slice(0, EVI_LIMITS.maxUserChars);
    if (!value || busyRef.current !== null) return;
    const next = [...messages, { role: "user" as const, text: value }];
    setMessages(next);
    setOptions({ options: [], multi: false });
    setPicked(new Set());
    setFailure(null);
    setDraft("");
    request(next);
  }

  /** Повторить последний вопрос. `from` — номер разговора, для которого нажали (после «Разрешить»): устарел — ничего. */
  function retry(from?: number) {
    if ((from !== undefined && from !== epochRef.current) || busyRef.current !== null) return;
    setFailure(null);
    request(messagesRef.current);
  }

  function restart() {
    epochRef.current += 1;
    settle();
    setRound((current) => current + 1);
    setMessages(greeting);
    setOptions(greetingOptions);
    setPicked(new Set());
    setFailure(null);
    setDraft("");
  }

  function toggle(option: string) {
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(option)) next.delete(option); else next.add(option);
      return next;
    });
  }

  return {
    messages, options, picked, failure, draft, round, setDraft, send, retry, restart, toggle,
    pending: busy !== null,
    intro: !messages.some((message) => message.role === "user"),
    /** Прогресс последней реплики Эви; у итога и у реплик без него — null. */
    progress: messages.findLast((message) => message.role === "assistant")?.progress ?? null,
    canRetry: messages[messages.length - 1]?.role === "user",
  };
}
