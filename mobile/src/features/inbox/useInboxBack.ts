// Стрелка «назад» на экранах «Входящих» (лента «Что нового», беседа). Подпись говорит о том, куда стрелка ведёт на самом деле.
// Веб: стрелка - ссылка на список чатов (`backToList`, «Все чаты»), потому что страница там всегда внутри списка. В приложении
// на ленту и в беседу входят и снаружи (колокольчик и «Главная», кнопка «Написать EVO»): списка под ними нет, и «назад» возвращает
// на то место, откуда студент пришёл. «Все чаты» остаётся, только когда под экраном в стеке лежит именно список; иначе слово
// нейтральное («Назад»: `back` из словаря веба `apply`).
import { useNavigation, useRouter } from "expo-router";

import { INBOX_ROOT } from "@/shell/inbox-stack";
import { useLang } from "@/i18n/LangProvider";

export function useInboxBack(): Readonly<{ label: string; onPress: () => void }> {
  const router = useRouter();
  const navigation = useNavigation();
  const { t } = useLang();
  const state = navigation.getState();
  const below = state && state.index > 0 ? state.routes[state.index - 1] : undefined;
  return {
    label: below?.name === INBOX_ROOT ? t("messages").backToList : t("apply").back,
    onPress: () => (router.canGoBack() ? router.back() : router.navigate("/messages")),
  };
}
