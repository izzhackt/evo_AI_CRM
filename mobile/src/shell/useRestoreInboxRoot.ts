// Когда студент уходит с вкладки «Входящие», стек без списка в основании (вход снаружи, см. `inbox-stack.ts`) приводится к списку:
// следующее открытие вкладки показывает «Входящие», а не ленту, решение или беседу, с которых начался прошлый заход. Обычный стек
// (список внизу) не трогается: вкладка помнит, где студент остановился. Беседа с черновиком или неотправленным сообщением тоже остаётся:
// сброс закрыл бы её и унёс набранное (`unsent-chat.ts`). Вызывается из раскладки стека «Входящих».
import { useQueryClient } from "@tanstack/react-query";
import { useNavigation, useRoute } from "expo-router";
import { useEffect } from "react";

import { inboxStackOf, inboxToListActions, lacksInboxRoot } from "@/shell/inbox-stack";
import { hasUnsentChat } from "@/shell/unsent-chat";

export function useRestoreInboxRoot(): void {
  const navigation = useNavigation();
  const route = useRoute();
  const session = useQueryClient();
  useEffect(
    () =>
      navigation.addListener("blur" as never, (() => {
        const tab = navigation.getState()?.routes.find((entry: { key: string }) => entry.key === route.key);
        const stack = inboxStackOf(tab);
        if (!lacksInboxRoot(stack) || hasUnsentChat(session)) return;
        for (const action of inboxToListActions(stack)) navigation.dispatch(action as never);
      }) as never),
    [navigation, route.key, session],
  );
}
