// Стрелка «назад» на экранах «Входящих» (лента «Что нового», беседа). Подпись говорит о том, куда стрелка ведёт на самом деле.
// Веб: стрелка - ссылка на список чатов (`backToList`, «Все чаты»), потому что страница там всегда внутри списка. В приложении
// на ленту и в беседу входят и снаружи (колокольчик и «Главная», кнопка «Написать EVO»): списка под ними нет, и «назад» возвращает
// на то место, откуда студент пришёл. «Все чаты» остаётся, только когда под экраном в стеке лежит именно список; иначе слово
// нейтральное («Назад»: `back` из словаря веба `apply`).
//
// Что лежит под экраном, читается из состояния стека ЭТОГО кадра (`useNavigationState`), а не вызовом `navigation.getState()` в теле
// хука (QA#3, N3: на устройстве подпись всегда была «Назад»). Причина двойная, и по отдельности её не видно:
// - в expo-router 58 `navigation.getState()` отдаёт состояние прошлой отрисовки: оно обновляется уже после неё. В кадре, где экран
//   кладут поверх списка, он ещё видит `[index]` и не видит самого себя; со второго кадра состояние верное;
// - приложение собирается с компилятором React (`experiments.reactCompiler`): он запоминает результат `navigation.getState()` по
//   объекту `navigation`, который у экрана один на всю его жизнь. Первое, устаревшее, чтение остаётся навсегда.
// В тестах Jest компилятора нет, второй кадр успевал поправить подпись, и тесты на подменённом `getState()` это не замечали.
// Состояние из контекста навигатора приходит в тот же кадр, что и сам экран, и подписывает хук на его изменения.
import { useRoute, useRouter } from "expo-router";
import { useNavigationState } from "expo-router/react-navigation";

import { INBOX_ROOT } from "@/shell/inbox-stack";
import { useLang } from "@/i18n/LangProvider";

export function useInboxBack(): Readonly<{ label: string; onPress: () => void }> {
  const router = useRouter();
  const { key } = useRoute();
  const { t } = useLang();
  // Имя экрана, лежащего в стеке прямо под этим; `undefined`, если этот экран - основание стека.
  const below = useNavigationState((state) => {
    const at = state.routes.findIndex((route) => route.key === key);
    return at > 0 ? state.routes[at - 1]?.name : undefined;
  });
  return {
    label: below === INBOX_ROOT ? t("messages").backToList : t("apply").back,
    onPress: () => (router.canGoBack() ? router.back() : router.navigate("/messages")),
  };
}
