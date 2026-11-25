// Уход с теста: пока сервер не подтвердил ответы, экран не закрывается (веб: `installAssessmentExitGuard`, «Сохранить и
// выйти» уходит только после подтверждённого сохранения). Системная «назад», свайп и стрелка в шапке сначала досылают
// ответы и уходят сами, если сервер подтвердил; нет связи или нужна сверка после конфликта - экран остаётся, ответы на нём,
// студент видит строку «Сначала сохраним ответы…». Если всё сохранено, уход свободен и ничего не спрашивает.
import { useNavigation, usePreventRemove } from "expo-router";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import type { AssessmentSession } from "@/features/learning/tests/assessment-session";

export function useLeaveGuard({ session, active, back }: { session: AssessmentSession; active: boolean; back: () => void }): { exitNotice: boolean; saveAndExit: () => void } {
  const navigation = useNavigation();
  const unsaved = useSyncExternalStore(session.subscribe, () => session.getState().unsaved);
  const [leaving, setLeaving] = useState(false);
  const [exitNotice, setExitNotice] = useState(false);
  const settling = useRef(false);
  const guarded = active && unsaved && !leaving;

  // Всё сохранено: строка «сначала сохраним» больше не нужна (состояние подправляется при отрисовке, не в эффекте).
  if (!unsaved && exitNotice) setExitNotice(false);

  // Один уход за раз: второе нажатие «назад», пока идёт отправка, не должно закрыть ещё один экран.
  const settle = useCallback(
    async (proceed: () => void) => {
      if (settling.current) return;
      settling.current = true;
      try {
        if (await session.saveForExit()) {
          setExitNotice(false);
          setLeaving(true); // защита снимается в том же обработчике, где продолжается уход (правило usePreventRemove)
          proceed();
        } else {
          setExitNotice(true);
        }
      } finally {
        settling.current = false;
      }
    },
    [session],
  );

  const disablePrevention = usePreventRemove(guarded, ({ repeat }) => {
    void settle(repeat);
  });
  // Пока есть несохранённое, жест «назад» закрыт: он всё равно не дал бы уйти, но показывал бы полустёртый экран.
  useEffect(() => {
    navigation.setOptions({ gestureEnabled: !guarded });
  }, [navigation, guarded]);

  const saveAndExit = useCallback(() => {
    void settle(() => {
      disablePrevention();
      back();
    });
  }, [settle, disablePrevention, back]);

  return { exitNotice, saveAndExit };
}
