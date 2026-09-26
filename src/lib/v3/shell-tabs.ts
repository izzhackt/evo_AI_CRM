import type { IconName } from "@/components/icons";

import type { V3Navigation, V3NavigationGroup, V3NavigationLink, V3NavigationLinkId } from "./navigation.ts";

/*
 * Оболочка нового облика (Э1.2 плана редизайна 25.09.2026) — временное
 * сосуществование до решения владельца (Э1.5, izzhackt/evo_AI_CRM#1061).
 * Здесь — чистые правила без DOM: иконки пунктов и места нижней панели
 * телефона. Состав меню, адреса и права решает `buildV3Navigation`: панель
 * только выбирает из того, что роль уже видит.
 */

/** Иконка у каждого пункта, из существующего набора; одна иконка — один смысл. */
export const NEXT_LINK_ICONS = {
  home: "grid",
  requests: "file-check",
  inbox: "phone",
  pipeline: "funnel",
  "sales-report": "bar-chart",
  "admissions-pipeline": "funnel",
  messages: "message-square",
  "admissions-worklist": "users",
  "evo-docs": "folder",
  universities: "building",
  calendar: "calendar",
  tasks: "check-square",
  "team-chat": "message-circle",
  documents: "book-open",
  "reply-snippets": "send",
  knowledge: "book-open",
  settings: "settings",
} as const satisfies Record<V3NavigationLinkId, IconName>;

export const NEXT_GROUP_ICONS = {
  sales: "wallet",
  admissions: "circle-check",
} as const satisfies Record<V3NavigationGroup["id"], IconName>;

/** Мест под разделы в нижней панели; пятое — всегда «Ещё». */
export const SHELL_TAB_SLOTS = 4;

/** Порядок из решения владельца 26.09.2026: Admin и поступление — дела и переписка, продажи — воронка и заявки. */
const ADMISSIONS_TABS: readonly V3NavigationLinkId[] = ["home", "admissions-worklist", "tasks", "messages"];
const SALES_TABS: readonly V3NavigationLinkId[] = ["home", "pipeline", "requests", "tasks"];

export type ShellTabs = Readonly<{
  /** Чей набор вкладок: по разделам, которые роль видит. */
  kind: "admissions" | "sales" | "other";
  links: readonly V3NavigationLink[];
  /** Открытый раздел не стоит во вкладках — он в «Ещё». */
  currentInMore: boolean;
}>;

type NavigationLists = Pick<V3Navigation, "home" | "groups" | "common" | "settings" | "activeId">;

/** Все пункты меню в порядке меню — ровно то, что роль видит. */
export function visibleNavigationLinks(navigation: NavigationLists): V3NavigationLink[] {
  return [
    ...(navigation.home ? [navigation.home] : []),
    ...navigation.groups.flatMap((group) => group.links),
    ...navigation.common,
    ...(navigation.settings ? [navigation.settings] : []),
  ];
}

/**
 * Вкладки нижней панели. Набор выбирается по видимым разделам: доска или
 * переписка поступления (право admissions.read) — набор поступления, иначе
 * воронка или заявки — набор продаж. Пункт, которого роль не видит, не
 * показывается; свободное место занимает следующий видимый раздел по порядку
 * меню (кроме «Настроек» — они в «Ещё»). Больше четырёх мест не бывает.
 */
export function shellTabs(navigation: NavigationLists): ShellTabs {
  const visible = visibleNavigationLinks(navigation);
  const byId = new Map(visible.map((link) => [link.id, link]));
  const kind = byId.has("messages") || byId.has("admissions-pipeline") ? "admissions"
    : byId.has("pipeline") || byId.has("requests") ? "sales"
    : "other";
  const preferred = kind === "admissions" ? ADMISSIONS_TABS : kind === "sales" ? SALES_TABS : [];
  const links = preferred.flatMap((id) => byId.get(id) ?? []);
  for (const link of visible) {
    if (links.length >= SHELL_TAB_SLOTS) break;
    if (link.id !== "settings" && !links.some((chosen) => chosen.id === link.id)) links.push(link);
  }
  const chosen = links.slice(0, SHELL_TAB_SLOTS);
  return {
    kind,
    links: chosen,
    currentInMore: navigation.activeId !== null && !chosen.some((link) => link.id === navigation.activeId),
  };
}

/**
 * Tab внутри листа «Ещё» (семантика диалога): фокус ходит по кругу и не
 * уходит на страницу под листом. `index` — где фокус сейчас (-1 — не на
 * элементе листа). Возвращает, куда его поставить; -1 — в листе некуда.
 */
export function trapFocusIndex(count: number, index: number, backwards: boolean): number {
  if (count <= 0) return -1;
  if (index < 0 || index >= count) return backwards ? count - 1 : 0;
  return (index + (backwards ? count - 1 : 1)) % count;
}
