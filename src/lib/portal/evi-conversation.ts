import { useEffect, useRef, useState } from "react";

import { EVI_LIMITS, type EviActionResult, type EviFailure, type EviMood, type EviProgress, type EviResult, type EviTurn } from "./evi.ts";
import type { PortalStrings } from "./i18n.ts";
import { eviSnapshot, restoredEviFailure, type EviMemory, type EviSnapshot } from "./evi-memory.ts";

export type { EviMemory, EviSnapshot } from "./evi-memory.ts";

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
 * Общий для веба и приложения (чистый React без DOM: приложение берёт его через @web). Состояние разговора с Эви. В браузере
 * ничего не хранится: разговор живёт, пока открыт кабинет (`memory` веба) или экран (приложение). «Новый чат» поднимает номер
 * разговора (`round`): ответ или повтор, пришедшие для старого разговора, отбрасываются, а строки переписки получают
 * новые ключи — робот на приветствии реагирует заново. Одновременно идёт не больше одного запроса. Пока серверного
 * действия нет (`ask`), отправка честно говорит «Эви сейчас недоступен».
 */
export function useEviConversation({ strings, ask, memory, initialMessages, initialOptions, initialFailure }: Readonly<{
  strings: Strings;
  ask?: EviAsk;
  memory?: EviMemory | null;
  initialMessages?: readonly EviMessage[];
  initialOptions?: EviOptions;
  initialFailure: EviFailure | null;
}>) {
  const greeting: readonly EviMessage[] = [{ role: "assistant", text: strings["evi.greeting"], mood: "happy", fresh: true }];
  const greetingOptions: EviOptions = { options: [strings["evi.start"], strings["evi.how"]], multi: false, go: strings["evi.start"] };
  // Разговор, начатый до перехода на другую страницу кабинета. Читается один раз: при первой загрузке страницы память пуста.
  const [restored] = useState<EviSnapshot | null>(() => memory?.load() ?? null);
  const [messages, setMessages] = useState<readonly EviMessage[]>(restored?.messages ?? initialMessages ?? greeting);
  const [options, setOptions] = useState<EviOptions>(restored?.options ?? initialOptions ?? greetingOptions);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [failure, setFailure] = useState<EviFailure | null>(restoredEviFailure(restored, initialFailure));
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<number | null>(null);
  const [round, setRound] = useState(0);
  const [pokes, setPokes] = useState(0);
  const epochRef = useRef(0);
  const busyRef = useRef<number | null>(null);
  const messagesRef = useRef(messages);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Каждый шаг разговора и сбой кладутся в память кабинета; «Новый чат» (только приветствие) её очищает.
  useEffect(() => {
    memory?.save(eviSnapshot(messages, options, failure));
  }, [memory, messages, options, failure]);

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

  /** Повторить последний вопрос после сбоя. */
  function retry() {
    if (busyRef.current !== null) return;
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

  /** Выбор варианта: робот коротко радуется (`pokes` растёт только при выборе, не при снятии). */
  function toggle(option: string) {
    const adding = !picked.has(option);
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(option)) next.delete(option); else next.add(option);
      return next;
    });
    if (adding) setPokes((current) => current + 1);
  }

  return {
    messages, options, picked, failure, draft, round, pokes, setDraft, send, retry, restart, toggle,
    pending: busy !== null,
    intro: !messages.some((message) => message.role === "user"),
    /** Прогресс последней реплики Эви; у итога и у реплик без него — null. */
    progress: messages.findLast((message) => message.role === "assistant")?.progress ?? null,
    canRetry: messages[messages.length - 1]?.role === "user",
  };
}
