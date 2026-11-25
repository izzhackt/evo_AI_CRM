// Уход с теста: пока сервер не подтвердил ответы, экран не закрывается (веб: `installAssessmentExitGuard`, «Сохранить и
// выйти» уходит только после подтверждённого сохранения). Системная «назад», свайп и стрелка в шапке сначала досылают
// ответы и уходят сами, если сервер подтвердил; нет связи или нужна сверка после конфликта - экран остаётся, ответы на нём,
// студент видит строку «Сначала сохраним ответы…». Если всё сохранено, уход свободен и ничего не спрашивает.
//
// Чтобы сбой не запирал студента навсегда (ревью #1559), у защиты есть три выхода:
//  - «Выйти без сохранения» (`leaveAnyway`): плашка предлагает её после нескольких неудачных попыток подряд (и держит на экране
//    всё время сбоя, в том числе пока идёт очередной повтор), окно подтверждения рисует раннер; это настоящий отказ от
//    несохранённого: сессия помечается (`session.discard`), и закрытие экрана ничего не досылает;
//  - повторы по таймеру стоят, пока экран не на виду (другая вкладка, экран сверху), и возобновляются при возвращении;
//  - ответ, который приложение не смогло разобрать, повтором не лечится: сессия останавливает повторы и защита снимается.
// Выходы, которых защита не видит (меню ☰, вкладки: экран остаётся в памяти, сохранение стоит), плашка называет прямо:
// «ответы ещё не сохранены».
import { useNavigation, usePreventRemove } from "expo-router";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { BackHandler, Platform } from "react-native";

import type { AssessmentSession } from "@/features/learning/tests/assessment-session";
import { isBlocked } from "@/features/learning/tests/run-notice";
import { useFocusEffect } from "@/lib/focus";

/** Сколько ждать, прежде чем вернуть защиту, если уход не убрал экран (действие не дошло или другой перехватчик его остановил). */
export const LEAVING_RESET_MS = 800;

export function useLeaveGuard({ session, active, back }: { session: AssessmentSession; active: boolean; back: () => void }): { exitNotice: boolean; saveAndExit: () => void; leaveAnyway: () => void } {
  const navigation = useNavigation();
  const unsaved = useSyncExternalStore(session.subscribe, () => session.getState().unsaved);
  const blocked = useSyncExternalStore(session.subscribe, () => isBlocked(session.getState()));
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

  // Уход пошёл, а экран остался (действие не сняло его со стека): защита возвращается, иначе новые ответы остались бы без неё.
  // Отказ от сохранения (`session.discard`) этим таймером НЕ снимается: если экран закрывается медленно (JS занят дольше 0,8 с), поздний
  // сброс отправил бы ответы при закрытии вопреки окну «пропадут». Его снимает следующее действие студента (выбор, страница, «Завершить»,
  // «Повторить сохранение», «Сохранить и выйти»): оно значит, что экран остался. Если экран ушёл, он размонтирован и таймер снят.
  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(() => setLeaving(false), LEAVING_RESET_MS);
    return () => clearTimeout(timer);
  }, [leaving]);

  const disablePrevention = usePreventRemove(guarded, ({ repeat }) => {
    void settle(repeat);
  });

  // Свайп назад выключается только когда защита держит экран из-за сбоя (не подтверждено, нужна сверка или идут неудачные повторы
  // подряд): в обычную отправку (доли секунды после выбора) жест идёт через защиту, как «назад», сохраняет и уходит. Включается
  // и выключается один раз на всё время сбоя, а не на каждый повтор; почему он молчит, студенту говорит плашка («свайп назад
  // выключен»). Только iPhone: на Android `gestureEnabled` не действует (жест идёт через JS: общий обработчик навигации и защита).
  const gestureOff = active && blocked && !leaving;
  const gestureWasOff = useRef(false);
  useEffect(() => {
    if (Platform.OS !== "ios") return;
    if (gestureOff === gestureWasOff.current) return;
    gestureWasOff.current = gestureOff;
    navigation.setOptions({ gestureEnabled: !gestureOff });
  }, [navigation, gestureOff]);

  // Экран не на виду: повторов по таймеру нет (без связи запрос шёл бы каждые 3 с из фона); вернулись: неподтверждённое уходит сразу.
  useFocusEffect(
    useCallback(() => {
      session.setPaused(false);
      return () => session.setPaused(true);
    }, [session]),
  );

  const saveAndExit = useCallback(() => {
    void settle(() => {
      disablePrevention();
      back();
    });
  }, [settle, disablePrevention, back]);

  // Студент выбрал «Выйти без сохранения» в окне раннера. Защита снимается так же, как после сохранения, а неотправленное
  // отбрасывается по-настоящему: без пометки `discard` закрытие экрана (`dispose`) отправило бы его ещё раз, вопреки окну.
  const leaveAnyway = useCallback(() => {
    session.discard();
    setExitNotice(false);
    setLeaving(true);
    disablePrevention();
    back();
  }, [session, disablePrevention, back]);

  // Системная «назад» на Android, когда под тестом нет другого экрана (тест открыли из другого раздела): стек не снимает экран,
  // а переключает вкладку на «Главную», и тест оставался бы жить в памяти. Поэтому уход идёт тем же путём, что и «Сохранить и
  // выйти». Если под тестом есть экран (каталог тестов), «назад» снимает его сама и защита работает как обычно.
  const exitRef = useRef(saveAndExit);
  useEffect(() => {
    exitRef.current = saveAndExit;
  });
  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
        const below = (navigation.getState?.()?.routes.length ?? 2) > 1;
        if (below) return false;
        exitRef.current();
        return true;
      });
      return () => subscription.remove();
    }, [navigation]),
  );

  return { exitNotice, saveAndExit, leaveAnyway };
}
