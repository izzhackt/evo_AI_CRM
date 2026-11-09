import { router, type Href } from "expo-router";
import { Linking } from "react-native";

import { linkTarget } from "@/domain/presentation";

/** Перейти на вкладку приложения. */
export function go(route: string, params?: Record<string, string>): void {
  router.navigate((params ? { pathname: route, params } : route) as Href);
}

/** Ссылка контента: вкладка приложения или браузер. Неизвестная ссылка не открывается. */
export function openLink(href: string): void {
  const target = linkTarget(href);
  if (!target) return;
  if (target.kind === "route") go(target.route);
  else void Linking.openURL(target.url).catch(() => undefined);
}
