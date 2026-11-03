import { useEffect, useId, useRef, useState } from "react";

/**
 * Вопрос перед необратимым действием в панели («Удалить…?», «Архивировать шаблон?»): нажатая кнопка исчезает, а Radix в панели
 * увёл бы фокус в её начало. Поэтому фокус идёт на кнопку подтверждения (читалка зачитывает вопрос как её описание, `questionId`),
 * а «Отмена» возвращает его на кнопку, с которой вопрос начался (как `NextAgentSwitches`).
 */
export function useConfirmStep() {
  const [asking, setAsking] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const confirm = useRef<HTMLButtonElement>(null);
  const questionId = useId();
  const moveTo = useRef<"confirm" | "trigger" | null>(null);
  useEffect(() => {
    const target = moveTo.current === "confirm" ? confirm.current : moveTo.current === "trigger" ? trigger.current : null;
    moveTo.current = null;
    target?.focus();
  }, [asking]);
  return {
    asking, questionId, trigger, confirm,
    ask(on: boolean) { moveTo.current = on ? "confirm" : "trigger"; setAsking(on); },
  };
}
