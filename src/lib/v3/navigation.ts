import {
  fixedRoleCan,
  fixedRoleCanAccessRoute,
  type FixedRole,
  type FixedRoleCapability,
  type FixedRoleRoute,
} from "../fixed-role-policy.ts";

export type V3NavigationLinkId =
  | "home"
  | "pipeline"
  | "sales-report"
  | "admissions-worklist"
  | "admissions-summary"
  | "inbox"
  | "calendar"
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
    links: [
      { id: "pipeline", href: "/v3/pipeline", route: "/v3/pipeline", label: "Воронка" },
      { id: "sales-report", href: "/v3/main?view=sales", route: "/v3/main", label: "Отчёт продаж" },
    ],
  },
  {
    id: "admissions",
    label: "Поступление",
    links: [
      { id: "admissions-worklist", href: "/v3/profile", route: "/v3/profile", label: "Рабочий список" },
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
  { id: "inbox", href: "/v3/inbox", route: "/v3/inbox", label: "Входящие" },
  { id: "calendar", href: "/v3/calendar", route: "/v3/calendar", label: "Календарь" },
  { id: "knowledge", href: "/v3/knowledge", route: "/v3/knowledge", label: "База знаний" },
];

function isSingleValue(query: NavigationQuery, name: string, value: string) {
  const values = query.getAll(name);
  return values.length === 1 && values[0] === value;
}

/** Presentation-only navigation. Server route guards remain the authority. */
export function buildV3Navigation(
  presentationRole: FixedRole,
  pathname: string,
  query: NavigationQuery,
) {
  const allowed = (link: V3NavigationLink) =>
    fixedRoleCanAccessRoute(presentationRole, link.route)
    && (!link.capability || fixedRoleCan(presentationRole, link.capability));
  const home = allowed(HOME) ? HOME : null;
  const settings = allowed(SETTINGS) ? SETTINGS : null;
  const common = COMMON.filter(allowed);
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
    candidate = isSingleValue(query, "section", "summary")
      && !query.has("case") && !query.has("id")
      && fixedRoleCan(presentationRole, "admissions.read")
      ? "admissions-summary"
      : "admissions-worklist";
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
    destinationKey: `${presentationRole}:${pathname}?${query.toString()}`,
  };
}

export type V3Navigation = ReturnType<typeof buildV3Navigation>;
