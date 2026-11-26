// Карточка «Не удалось обновить уведомления» + «Повторить» (веб: `.pt-notification-error` в PortalNotificationUpdates): тихая
// карточка под верхней полосой, показывается, пока последний опрос не удался. Кнопка опрашивает сразу.
// Стоит В ПОТОКЕ раскладки кабинета между верхней полосой и вкладками (`(app)/_layout.tsx`), а не поверх содержимого: пока карточка
// есть, экраны ниже сдвигаются вниз, и ничто под ней не прячется. Веб держит её поверх страницы (`position: fixed`), но страница
// там листается самим браузером; в приложении экраны сами прокручиваются к своим блокам (блок сбоя теста «Повторить сохранение»
// встаёт наверху прокрутки, ровно под плавающей карточкой, и нажатия попадали в карточку: QA#2, D4). Тот же сбой API даёт обе
// карточки сразу, поэтому в потоке они не мешают друг другу.
// Пока на виду карточка «Вышла новая версия» (features/app/UpdatePrompt), эту не показываем: веб в такой момент останавливает опросы
// и прячет её (`failed && !stale`), а обе карточки у верха экрана легли бы друг на друга. Уступает только пока та ВИДНА
// (`update-prompt-visibility.ts`): после «Позже» обновление остаётся скачанным, но карточки обновления уже нет, и сбой опроса
// надо показывать (у веба «Позже» нет). Сбой отрисовки прячет карточку, а не роняет оболочку.
import { Component, useEffect, type ReactNode } from "react";
import { View } from "react-native";

import { usePortalPollFailure } from "@/api/PortalPoll";
import { useLang } from "@/i18n/LangProvider";
import { reportTopNoticeHeight } from "@/shell/top-chrome";
import { useUpdatePromptVisible } from "@/shell/update-prompt-visibility";
import { useTheme } from "@/theme/ThemeProvider";
import { announce } from "@/ui/a11y";
import { LinkButton } from "@/ui/CardParts";
import { Text } from "@/ui/Text";

/** Сбой чтения состояния обновлений не должен стоить студенту приложения: при любой ошибке отрисовки карточки просто нет. */
class NoticeBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function PollFailureCard() {
  const { failed, retry } = usePortalPollFailure();
  const { shell } = useLang();
  const { tokens } = useTheme();
  const promptVisible = useUpdatePromptVisible();
  const visible = failed && !promptVisible;
  // Веб: `role="alert"` читается сам. В React Native iPhone `accessibilityRole="alert"` ничего не говорит, поэтому карточку, когда она
  // появилась, озвучивает `announce` (повторные сбои подряд карточку не пересоздают и не повторяют сообщение).
  useEffect(() => {
    if (visible) announce(shell.notificationsFailed);
  }, [visible, shell.notificationsFailed]);
  // Карточка в потоке сдвигает экраны вниз: беседе и Эви эту высоту нужно знать для смещения клавиатуры (`shell/top-chrome.ts`).
  useEffect(() => {
    if (!visible) reportTopNoticeHeight(0);
  }, [visible]);
  useEffect(() => () => reportTopNoticeHeight(0), []);
  if (!visible) return null;
  return (
    <View onLayout={(event) => reportTopNoticeHeight(event.nativeEvent.layout.height)} testID="poll-failure-anchor" style={{ paddingHorizontal: 16, paddingBottom: 8, backgroundColor: tokens.bg }}>
      <View
        accessibilityRole="alert"
        testID="poll-failure"
        style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 4, paddingLeft: 12, paddingRight: 8, borderRadius: tokens.radiusControl, borderWidth: 1, borderColor: tokens.line, backgroundColor: tokens.surface }}
      >
        <Text variant="caption" style={{ flex: 1 }}>
          {shell.notificationsFailed}
        </Text>
        <LinkButton label={shell.notificationsRetry} onPress={retry} testID="poll-failure-retry" />
      </View>
    </View>
  );
}

export function PollFailureNotice() {
  return (
    <NoticeBoundary>
      <PollFailureCard />
    </NoticeBoundary>
  );
}
