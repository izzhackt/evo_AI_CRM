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
  | "admissions-worklist"
  | "evo-docs"
  | "universities"
  | "calendar"
  | "tasks"
  | "inbox"
  | "messages"
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

// «Сегодня» (Э3, 26.09.2026): стартовая страница каждой роли — очередь того,
// что пора сделать; id и адрес прежние.
const HOME: V3NavigationLink = {
  id: "home", href: "/v3/main", route: "/v3/main", label: "Сегодня",
};
const SETTINGS: V3NavigationLink = {
  id: "settings", href: "/v3/settings", route: "/v3/settings", label: "Настройки",
};
// «Заявки» — первый пункт «Продаж» (решение владельца 28.09.2026; до него —
// «Общее», Э6): входящие обращения разбирают здесь раньше, чем лид встаёт на
// доску. Кроме обращений с сайта и WhatsApp там же «Анкеты платформы»
// (решение — отдел сопровождения, 177) и консультации из кабинета студента
// (`lead.read`, 197), поэтому правило D ниже этот пункт не скрывает: его видит
// каждый, кому открыт маршрут, и у ролей поступления тоже.
const REQUESTS: V3NavigationLink = {
  id: "requests", href: "/v3/requests", route: "/v3/requests", label: "Заявки",
};
const GROUPS: readonly Omit<V3NavigationGroup, "active">[] = [
  {
    id: "sales",
    label: "Продажи",
    // Э6 (27.09.2026): у каждого раздела одно место для всех ролей, роль
    // только скрывает пункты. «Заявки» — первыми (решение владельца
    // 28.09.2026). WhatsApp — сразу после доски (решение владельца
    // 27.09.2026: WhatsApp продажников, куда приходят лиды; в обоих отделах
    // доска, затем переписка отдела); его маршрут — `messaging.read`, и с
    // 06.10.2026 пункт виден каждому, кому открыт маршрут (решение владельца
    // 06.10.2026: «нет, все могут» — отвечают из CRM все сотрудники; правило D
    // ниже скрывает у ролей без работы продаж только «Воронку продаж»). Each
    // label equals its page h1 and browser-tab section (UX quick win 2,
    // 2026-09-24).
    links: [
      REQUESTS,
      { id: "pipeline", href: "/v3/pipeline", route: "/v3/pipeline", label: "Воронка продаж" },
      { id: "inbox", href: "/v3/inbox", route: "/v3/inbox", label: "WhatsApp" },
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
      // «Переписка» по делу через кабинет студента — с теми, кто уже студент
      // или клиент (решение владельца 27.09.2026), сразу после доски, как
      // «Сообщения» OTH-5. Маршрут — `admissions.read`: у продаж его нет.
      // Короткое имя — решение владельца 28.09.2026: «Переписка со
      // студентами» вставала в меню 260 px в две строки.
      { id: "messages", href: "/v3/messages", route: "/v3/messages", label: "Переписка" },
      // Plan §3: «Рабочий список» renamed to «Студенты» (id kept for stability).
      { id: "admissions-worklist", href: "/v3/profile", route: "/v3/profile", label: "Студенты" },
      { id: "evo-docs", href: "/v3/profile?section=docs", route: "/v3/profile", label: "EVO Docs", capability: "admissions.read" },
      { id: "universities", href: "/v3/universities", route: "/v3/universities", label: "Университеты" },
      // «Сводка по направлениям» removed 2026-09-24: its counts are the facets
      // of «Студенты» now; `/v3/profile?section=summary` resolves to that page.
    ],
  },
];
// «Общее» — разделы обоих отделов, одно место у всех ролей (Э6, 27.09.2026).
// «Заявок» здесь нет с 28.09.2026 — они первыми в «Продажах» (решение
// владельца). Переписки здесь тоже нет: WhatsApp — в «Продажах», «Переписка» —
// в «Поступлении» (решение владельца 27.09.2026 вместо одного пункта
// «Переписки» Э5).
const COMMON: readonly V3NavigationLink[] = [
  { id: "tasks", href: "/v3/tasks", route: "/v3/tasks", label: "Задачи" },
  { id: "team-chat", href: "/v3/team-chat", route: "/v3/team-chat", label: "Командный чат" },
  { id: "calendar", href: "/v3/calendar", route: "/v3/calendar", label: "Календарь" },
  { id: "documents", href: "/v3/documents", route: "/v3/documents", label: "Документы" },
  { id: "reply-snippets", href: "/v3/reply-snippets", route: "/v3/reply-snippets", label: "Шаблоны ответов" },
  { id: "knowledge", href: "/v3/knowledge", route: "/v3/knowledge", label: "База знаний" },
];

function isSingleValue(query: NavigationQuery, name: string, value: string) {
  const values = query.getAll(name);
  return values.length === 1 && values[0] === value;
}

/**
 * Карточка лида (`/v3/profile?id=…` без дела): лид живёт на «Воронке
 * продаж», а не в «Студентах» (аудит 26.09). Дело (`?case=`) и EVO Docs
 * остаются своими разделами.
 */
function isLeadProfile(query: NavigationQuery): boolean {
  const ids = query.getAll("id");
  return ids.length === 1 && ids[0] !== "" && !query.has("case");
}

const ALL_LINKS: readonly V3NavigationLink[] = [HOME, ...GROUPS.flatMap((group) => group.links), ...COMMON, SETTINGS];

/**
 * Раздел для вкладки браузера у страниц, чей пункт меню зависит от адреса
 * (`/v3/main`, `/v3/profile`): подпись пункта, который `buildV3Navigation`
 * подсвечивает по тем же правилам. Права не читаются — вкладка только
 * называет раздел, доступ решает страница. Шаблон «<Раздел> — EVO CRM» задан
 * в `(v3)/layout.tsx`. Исключение — карточка лида: вкладка называет саму
 * запись, «Лид», а в меню подсвечена «Воронка продаж».
 */
export function v3SectionTitle(
  pathname: string,
  searchParams: Readonly<Record<string, string | readonly string[] | undefined>> = {},
): string | undefined {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(searchParams)) {
    for (const one of typeof value === "string" ? [value] : value ?? []) query.append(name, one);
  }
  if (pathname === "/v3/profile" && !isSingleValue(query, "section", "docs") && isLeadProfile(query)) return "Лид";
  const id: V3NavigationLinkId | undefined = pathname === "/v3/main"
    ? isSingleValue(query, "view", "sales") ? "sales-report" : "home"
    : pathname === "/v3/profile"
      ? isSingleValue(query, "section", "docs") ? "evo-docs" : "admissions-worklist"
      : pathname.startsWith("/v3/universities/")
        ? "universities"
        : ALL_LINKS.find((link) => link.route === pathname)?.id;
  return ALL_LINKS.find((link) => link.id === id)?.label;
}

/**
 * Работа продаж в меню — у того, кто ведёт лиды или читает отчёт продаж
 * (решение владельца D, 26.09.2026). `lead.read` у ролей поступления
 * открывает куратору лид его дела (контакты и данные продажи в деле) и
 * поэтому остаётся в `sales.read`, но разделом продаж не делает. Просмотр
 * роли — по её `sales.read`, как раньше.
 */
function salesWorkspace(actor: ActivePlatformActor): boolean {
  return isStaffPreview(actor)
    ? staffPresentationCan(actor, "sales.read")
    : staffHasPermission(actor, "lead.sales.workflow.manage") || staffHasPermission(actor, "sales.register.read");
}

/** Presentation-only navigation. Server route guards remain the authority. */
export function buildV3Navigation(
  actor: ActivePlatformActor,
  pathname: string,
  query: NavigationQuery,
) {
  // «Отчёт продаж» — записи отчёта или (Э3, 26.09.2026) раздел «Динамика по
  // дням» для роли, которая читает лиды без записей: графики и воронка ушли
  // сюда с прежней Главной, где она их видела. Просмотр роли — по sales.read.
  const allowed = (link: V3NavigationLink) =>
    staffCanAccessRoute(actor, link.route)
    && (link.id !== "sales-report"
      || staffPresentationCan(actor, "sales.read") || (!isStaffPreview(actor) && staffCan(actor, "sales.report.read")))
    && (link.id !== "evo-docs" || isStaffPreview(actor) || staffHasPermission(actor, "profile.read.full"))
    && (!link.capability || staffPresentationCan(actor, link.capability));
  const home = allowed(HOME) ? HOME : null;
  const settings = allowed(SETTINGS) ? SETTINGS : null;
  // Без работы продаж (D) «Воронка продаж» в «Продажах» скрыта. Остаются
  // пункты со своим правилом: «Заявки» — у всех, кому открыт их маршрут (разбор
  // анкет и консультаций — работа и отдела сопровождения; решение владельца
  // 28.09.2026 перенесло пункт из «Общего», права не меняло), «Отчёт продаж» по
  // правилу выше: читатель лидов без записей отчёта видит там «Динамику по
  // дням» (Э3, #1067) — и WhatsApp: решение владельца 06.10.2026 («нет, все
  // могут») заменило прежнее 27.09.2026, по которому у ролей поступления пункта
  // не было, хотя маршрут им открыт. Пункт виден тому, кому открыт маршрут
  // (`communication.read.full`); какие диалоги он увидит и в какие сможет
  // ответить, решает база (миграция 261), не меню. Роль только скрывает
  // пункты и никогда их не переносит (Э6).
  const sales = salesWorkspace(actor);
  const inGroup = (group: (typeof GROUPS)[number], link: V3NavigationLink) =>
    group.id !== "sales" || sales || link.id === "requests" || link.id === "inbox" || link.id === "sales-report";
  const visibleGroups = GROUPS.map((group) => ({
    ...group,
    links: group.links.filter((link) => allowed(link) && inGroup(group, link)),
  })).filter((group) => group.links.length > 0);
  // «Документы» и «Шаблоны ответов» у того, кому открыта «База знаний», —
  // внутри неё: пункт скрыт, а не задвоен.
  const common = COMMON.filter((link) => allowed(link)
    && (!staffCanAccessRoute(actor, "/v3/knowledge") || (link.id !== "documents" && link.id !== "reply-snippets")));
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
    // The former summary address (`?section=summary`) is the same «Студенты»
    // page since 2026-09-24; only EVO Docs is a separate destination here.
    candidate = isSingleValue(query, "section", "docs") && links.some(link => link.id === "evo-docs")
      ? "evo-docs"
      : isLeadProfile(query) && links.some(link => link.id === "pipeline")
        ? "pipeline"
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
