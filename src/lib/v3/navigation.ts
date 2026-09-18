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
  | "admissions-worklist"
  | "evo-docs"
  | "admissions-summary"
  | "universities"
  | "inbox"
  | "calendar"
  | "tasks"
  | "team-chat"
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
    // Order follows plan §3: Заявки, Inbox, Воронка, Отчёт продаж. «Заявки»
    // is the new unified intake queue (S1); its own route already requires
    // sales.read, so — unlike inbox below — it needs no extra capability
    // gate here. Inbox keeps its explicit sales.read gate: this entry only
    // decides whether inbox shows INSIDE the Продажи group (its own route
    // requires the broader messaging.read, shared with non-Sales roles that
    // see inbox in the common section instead, filtered further down).
    links: [
      { id: "requests", href: "/v3/requests", route: "/v3/requests", label: "Заявки" },
      { id: "inbox", href: "/v3/inbox", route: "/v3/inbox", label: "Клиентские сообщения", capability: "sales.read" },
      { id: "pipeline", href: "/v3/pipeline", route: "/v3/pipeline", label: "Воронка" },
      { id: "sales-report", href: "/v3/main?view=sales", route: "/v3/main", label: "Отчёт продаж" },
    ],
  },
  {
    id: "admissions",
    label: "Поступление",
    links: [
      { id: "admissions-worklist", href: "/v3/profile", route: "/v3/profile", label: "Рабочий список" },
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
  { id: "inbox", href: "/v3/inbox", route: "/v3/inbox", label: "Клиентские сообщения" },
  { id: "calendar", href: "/v3/calendar", route: "/v3/calendar", label: "Календарь" },
  { id: "knowledge", href: "/v3/knowledge", route: "/v3/knowledge", label: "База знаний" },
];

function isSingleValue(query: NavigationQuery, name: string, value: string) {
  const values = query.getAll(name);
  return values.length === 1 && values[0] === value;
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
    // Used as a React key: new destinations open their active section, while
    // collapsing a disclosure on the current destination stays user-controlled.
    destinationKey: `${actor.presentationRole ?? "actual"}:${actor.platformAccessVersion}:${pathname}?${query.toString()}`,
  };
}

export type V3Navigation = ReturnType<typeof buildV3Navigation>;
