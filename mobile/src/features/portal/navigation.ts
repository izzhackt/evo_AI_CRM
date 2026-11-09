import { router, type Href } from "expo-router";
import { Linking } from "react-native";

import { linkTarget } from "@/domain/presentation";

/** Единственный вход к команде EVO (#1356): беседа во «Входящих» (веб WRITE_EVO_HREF = /portal/messages?view=chat). */
export const WRITE_EVO_ROUTE = "/messages/chat";

/** Анкета вошедшего студента, только чтение (веб /apply/status): экран статуса M7 внутри кабинета. */
export const APPLICATION_ROUTE = "/application";

/** Перейти на вкладку приложения. */
export function go(route: string, params?: Record<string, string>): void {
  router.navigate((params ? { pathname: route, params } : route) as Href);
}

/** Ссылка контента: вкладка приложения или браузер. Неизвестная ссылка не открывается. */
export function openLink(href: string): void {
  const target = linkTarget(href);
  if (!target) return;
  // Метка `at` делает повторную ссылку новой для открытой «Главной» (раскрыть путь снова после сворачивания).
  if (target.kind === "route") go(target.route.includes("?") ? `${target.route}&at=${Date.now()}` : target.route);
  else void Linking.openURL(target.url).catch(() => undefined);
}
