import {
  type FixedRoleCapability,
  type FixedRoleRoute,
} from "../fixed-role-policy.ts";
import type { ActivePlatformActor } from "../platform-auth.ts";
import { isStaffPreview, staffCan, staffCanAccessRoute, staffHasPermission, staffPresentationCan } from "../platform-access.ts";

export type V3NavigationLinkId =
  | "home"
  | "requests"
  | "pipeline"
  | "sales-report"
  | "admissions-pipeline"
  | "messages"
  | "admissions-worklist"
  | "evo-docs"
  | "admissions-summary"
  | "universities"
  | "inbox"
  | "calendar"
  | "tasks"
  | "team-chat"
  | "documents"
  | "reply-snippets"
  | "knowledge"
  | "settings";

export type V3NavigationLink = Readonly<{
  id: V3NavigationLinkId;
  href: string;
  label: string;
  route: FixedRoleRoute;
  capability?: FixedRoleCapability;
}>;

export type V3NavigationGroup = Readonly<{
  id: "sales" | "admissions";
  label: string;
  links: readonly V3NavigationLink[];
  active: boolean;
}>;

type NavigationQuery = Pick<URLSearchParams, "getAll" | "has" | "toString">;

const HOME: V3NavigationLink = {
  id: "home", href: "/v3/main", route: "/v3/main", label: "Главная",
};
const SETTINGS: V3NavigationLink = {
  id: "settings", href: "/v3/settings", route: "/v3/settings", label: "Настройки",
};
const GROUPS: readonly Omit<V3NavigationGroup, "active">[] = [
  {
    id: "sales",
    label: "Продажи",
    // Order follows plan §3: Заявки, WhatsApp (ex-«Inbox»), Воронка продаж,
    // Отчёт продаж. «Заявки» is the new unified intake queue (S1); its own
    // route already requires sales.read, so — unlike inbox below — it needs
    // no extra capability gate here. Inbox keeps its explicit sales.read
    // gate: this entry only decides whether inbox shows INSIDE the Продажи
    // group (its own route requires the broader messaging.read, shared with
    // non-Sales roles that see inbox in the common section instead, filtered
    // further down). Each label equals its page h1 and browser-tab section
    // (UX quick win 2, 2026-09-24); /v3/inbox lists only WAHA-backed
    // conversations, so it is named «WhatsApp».
    links: [
      { id: "requests", href: "/v3/requests", route: "/v3/requests", label: "Заявки" },
      { id: "inbox", href: "/v3/inbox", route: "/v3/inbox", label: "WhatsApp", capability: "sales.read" },
      { id: "pipeline", href: "/v3/pipeline", route: "/v3/pipeline", label: "Воронка продаж" },
      { id: "sales-report", href: "/v3/main?view=sales", route: "/v3/main", label: "Отчёт продаж" },
    ],
  },
  {
    id: "admissions",
    label: "Поступление",
    links: [
      // OTH-1: curator kanban board «Воронка поступления» — FIRST item of
      // this group (owner plan). Its own route already requires
      // admissions.read (fixed-role-policy.ts), which Sales lacks entirely,
      // so — like admissions-worklist/universities below — no extra
      // `capability` gate is needed here; staffCanAccessRoute already hides
      // it from Sales. Named «Воронка поступления» so an Admin, who sees both
      // groups, never meets two identical «Воронка» items (UX quick win 2,
      // 2026-09-24); the sales board is «Воронка продаж».
      { id: "admissions-pipeline", href: "/v3/admissions-pipeline", route: "/v3/admissions-pipeline", label: "Воронка поступления" },
      // OTH-5: per-case staff chat «Сообщения» — right after the board (owner
      // plan). Its own route already requires admissions.read, so no extra
      // `capability` gate is needed here either.
      { id: "messages", href: "/v3/messages", route: "/v3/messages", label: "Сообщения" },
      // Plan §3: «Рабочий список» renamed to «Студенты» (id kept for stability).
      { id: "admissions-worklist", href: "/v3/profile", route: "/v3/profile", label: "Студенты" },
      { id: "evo-docs", href: "/v3/profile?section=docs", route: "/v3/profile", label: "EVO Docs", capability: "admissions.read" },
      { id: "universities", href: "/v3/universities", route: "/v3/universities", label: "Университеты" },
      {
        id: "admissions-summary",
        href: "/v3/profile?section=summary#admissions-summary",
        route: "/v3/profile",
        label: "Сводка по направлениям",
        capability: "admissions.read",
      },
    ],
  },
];
const COMMON: readonly V3NavigationLink[] = [
  { id: "tasks", href: "/v3/tasks", route: "/v3/tasks", label: "Задачи" },
  { id: "team-chat", href: "/v3/team-chat", route: "/v3/team-chat", label: "Командный чат" },
  { id: "inbox", href: "/v3/inbox", route: "/v3/inbox", label: "WhatsApp" },
  { id: "calendar", href: "/v3/calendar", route: "/v3/calendar", label: "Календарь" },
  { id: "documents", href: "/v3/documents", route: "/v3/documents", label: "Документы" },
  { id: "reply-snippets", href: "/v3/reply-snippets", route: "/v3/reply-snippets", label: "Шаблоны ответов" },
  { id: "knowledge", href: "/v3/knowledge", route: "/v3/knowledge", label: "База знаний" },
];

function isSingleValue(query: NavigationQuery, name: string, value: string) {
  const values = query.getAll(name);
  return values.length === 1 && values[0] === value;
}

const ALL_LINKS: readonly V3NavigationLink[] = [HOME, ...GROUPS.flatMap((group) => group.links), ...COMMON, SETTINGS];

/**
 * Раздел для вкладки браузера у страниц, чей пункт меню зависит от адреса
 * (`/v3/main`, `/v3/profile`): подпись пункта, который `buildV3Navigation`
 * подсвечивает по тем же правилам. Права не читаются — вкладка только
 * называет раздел, доступ решает страница. Шаблон «<Раздел> — EVO CRM» задан
 * в `(v3)/layout.tsx`.
 */
export function v3SectionTitle(
  pathname: string,
  searchParams: Readonly<Record<string, string | readonly string[] | undefined>> = {},
): string | undefined {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(searchParams)) {
    for (const one of typeof value === "string" ? [value] : value ?? []) query.append(name, one);
  }
  const id: V3NavigationLinkId | undefined = pathname === "/v3/main"
    ? isSingleValue(query, "view", "sales") ? "sales-report" : "home"
    : pathname === "/v3/profile"
      ? isSingleValue(query, "section", "docs") ? "evo-docs"
        : isSingleValue(query, "section", "summary") && !query.has("case") && !query.has("id")
          ? "admissions-summary"
          : "admissions-worklist"
      : pathname.startsWith("/v3/universities/")
        ? "universities"
        : ALL_LINKS.find((link) => link.route === pathname)?.id;
  return ALL_LINKS.find((link) => link.id === id)?.label;
}

/** Presentation-only navigation. Server route guards remain the authority. */
export function buildV3Navigation(
  actor: ActivePlatformActor,
  pathname: string,
  query: NavigationQuery,
) {
  const allowed = (link: V3NavigationLink) =>
    staffCanAccessRoute(actor, link.route)
    && (link.id !== "sales-report"
      || (isStaffPreview(actor) ? staffPresentationCan(actor, "sales.read") : staffCan(actor, "sales.report.read")))
    && (link.id !== "evo-docs" || isStaffPreview(actor) || staffHasPermission(actor, "profile.read.full"))
    && (!link.capability || staffPresentationCan(actor, link.capability));
  const home = allowed(HOME) ? HOME : null;
  const settings = allowed(SETTINGS) ? SETTINGS : null;
  const common = COMMON.filter((link) => allowed(link)
    && (!staffCanAccessRoute(actor, "/v3/knowledge") || (link.id !== "documents" && link.id !== "reply-snippets"))
    && (link.id !== "inbox" || !staffPresentationCan(actor, "sales.read")));
  const visibleGroups = GROUPS.map((group) => ({
    ...group,
    links: group.links.filter(allowed),
  })).filter((group) => group.links.length > 0);
  const links = [
    ...(home ? [home] : []),
    ...visibleGroups.flatMap((group) => group.links),
    ...common,
    ...(settings ? [settings] : []),
  ];

  let candidate: V3NavigationLinkId | undefined;
  if (pathname === "/v3/main") {
    candidate = isSingleValue(query, "view", "sales") ? "sales-report" : "home";
  } else if (pathname === "/v3/profile") {
    // Explicit targets (including malformed/empty ones) render a profile or
    // its error state, never the directory summary. Match the page contract.
    candidate = isSingleValue(query, "section", "docs") && links.some(link => link.id === "evo-docs")
      ? "evo-docs"
      : isSingleValue(query, "section", "summary")
      && !query.has("case") && !query.has("id")
      && staffPresentationCan(actor, "admissions.read")
      ? "admissions-summary"
      : "admissions-worklist";
  } else if (pathname.startsWith("/v3/universities/")) {
    candidate = "universities";
  } else {
    candidate = links.find((link) => link.route === pathname)?.id;
  }
  const activeId = links.find((link) => link.id === candidate)?.id ?? null;
  const groups: V3NavigationGroup[] = visibleGroups.map((group) => ({
    ...group,
    active: group.links.some((link) => link.id === activeId),
  }));

  return {
    home,
    groups,
    common,
    settings,
    activeId,
    // Client transitions within one authorized destination preserve disclosures;
    // changing destinations or access context still opens the active section.
    destinationKey: JSON.stringify([
      actor.presentationRole ?? "actual",
      actor.platformAccessVersion,
      activeId ? ["destination", activeId] : ["path", pathname],
    ]),
  };
}

export type V3Navigation = ReturnType<typeof buildV3Navigation>;
