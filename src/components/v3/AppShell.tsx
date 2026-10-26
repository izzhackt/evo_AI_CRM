"use client";

import { IntentPrefetchLink } from "@/components/IntentPrefetchLink";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from "react";

import type { AccountDeletionOpenCount } from "@/lib/account-deletion-contract";
import type { ActivePlatformActor } from "@/lib/platform-auth";
import { isStaffPreview, staffHasPermission, staffHomeRoute } from "@/lib/platform-access";
import type { StaffNotificationPage } from "@/lib/platform-staff-notifications-contract";
import { logoutStaffAction, selectStaffRolePreviewAction } from "@/lib/staff-auth-actions";
import { EvoLogo } from "@/components/platform/brand/EvoLogo";
import { Icon } from "@/components/icons";
import { cn } from "@/components/ui";
import { ChatFocusProvider, useChatFocusController } from "@/components/v3/ChatFocus";
import { StaffNotifications } from "@/components/v3/StaffNotifications";
import { StaleDeploymentNotice } from "@/components/v3/StaleDeploymentNotice";
import { TopLayerMenu } from "@/components/v3/board/TopLayerMenu";
import { isAiAgentChatRoute, isBoardRoute, isFillRoute } from "@/lib/v3/board-layout";
import {
  buildV3Navigation,
  type V3Navigation,
  type V3NavigationGroup,
  type V3NavigationLink,
  type V3NavigationLinkId,
} from "@/lib/v3/navigation";
import {
  GROUP_ICONS,
  LINK_ICONS,
  shellTabLabel,
  shellTabs,
  toggleMenuGroup,
  trapFocusIndex,
  type ShellTabs,
} from "@/lib/v3/shell-tabs";
import { roleTitle } from "@/lib/v3/wording";
import { onCreateTaskClick, PaletteButton, PaletteIconButton, ShellCommands } from "@/components/v3/palette/ShellCommands";

/*
 * Оболочка staff CRM — Э1.2 плана редизайна 25.09.2026
 * (docs/EVO_CRM_REDESIGN_PLAN_2026-09-25.md); единственная оболочка для всех
 * сотрудников с Э1.5 (решение владельца 27.09).
 *
 * - Компьютер: верхней панели нет. «Создать задачу», уведомления, просмотр
 *   роли и аккаунт — в боковом меню; прокручивается список разделов (у краёв
 *   списка, за которыми есть ещё пункты, — тень), аккаунт с «Выйти»
 *   закреплён внизу. Отделы открываются по одному. На досках до 1536 px —
 *   рейка 64 px. В чате «Поручить» ИИ-агента кнопка «На весь экран» прячет
 *   меню совсем (`ChatFocus.tsx`, решение владельца 26.10.2026).
 * - Телефон (<768 px): сверху одна строка с логотипом, снизу панель вкладок
 *   (`shellTabs`), «Ещё» открывает то же боковое меню листом с семантикой
 *   диалога. У листа те же строка сверху и панель вкладок внизу: на месте
 *   «Ещё» — «Закрыть», под тем же пальцем. Меню в DOM одно: уведомления, их
 *   опрос и число не удваиваются.
 * - Высоты строки и панели и отступ над заголовком страницы — переменные
 *   `--shell-*` в v3.css: страницы на высоту окна считают себя в тех же единицах.
 * Адреса, права и состав меню — только из `buildV3Navigation`.
 */

const RAIL_MEDIA = "(width >= 48rem) and (width < 96rem)";
const DESKTOP_MEDIA = "(width >= 48rem)";
const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";
const ITEM = `v3-choice flex min-h-11 min-w-0 items-center gap-3 rounded-nav px-3 py-2 t-body-compact text-fg-2 transition-colors hover:bg-surface-2 hover:text-fg ${FOCUS}`;
/**
 * Раздел верхнего уровня без подпунктов («Маркетинг», «Финансы»): та же строка,
 * что заголовок отдела («Продажи»), — подпись `t-label`, как у него, — но
 * ссылка, а не раскрытие: без стрелки и без пустой группы.
 */
const SECTION_ITEM = ITEM.replace("t-body-compact", "t-label");
/** Нейтральная кнопка оболочки: красным остаётся только главное действие страницы. */
const SHELL_BUTTON = `v3-raised inline-flex min-h-11 min-w-0 items-center justify-center gap-2 rounded-ctl border border-control-edge bg-surface px-3 t-label text-fg-2 transition-colors hover:bg-surface-2 hover:text-fg ${FOCUS}`;
/** Ctrl+K для мыши и телефона — строка меню «Поиск» (Э7), как пункт, без рамки. */
const SEARCH_ROW = `flex min-h-11 w-full min-w-0 items-center gap-3 rounded-nav px-3 py-2 t-body-compact text-fg-2 transition-colors hover:bg-surface-2 hover:text-fg ${FOCUS}`;
/** Тихая кнопка без рамки и тени: «Выйти» не спорит с «Создать задачу». */
const QUIET_BUTTON = `inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-ctl px-3 t-label text-fg-2 transition-colors hover:bg-surface-2 hover:text-fg ${FOCUS}`;
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
/**
 * Вкладка нижней панели: иконка в «пилюле» и подпись в одну строку. Колонки
 * панели не уже своей подписи (`minmax(auto, 1fr)`), поэтому подпись не
 * переносится внутри слова, а ряд иконок у всех вкладок один.
 */
const TAB = `group flex h-full min-h-11 min-w-[44px] flex-col items-center justify-center gap-0.5 transition-colors hover:text-fg ${FOCUS} focus-visible:outline-offset-[-2px]`;
/** «Пилюля» в px, как иконка и подпись: при крупном корневом шрифте растёт высота панели, а не пилюля. */
const TAB_PILL = "flex h-[24px] w-full max-w-[48px] shrink-0 items-center justify-center rounded-full transition-colors";
const TAB_LABEL = "t-caption whitespace-nowrap";

type RailHint = Readonly<{ label: string; top: number }>;
type HintHandlers = Readonly<{
  onPointerEnter?: (event: PointerEvent<HTMLElement>) => void;
  onPointerLeave?: () => void;
  onFocus?: (event: FocusEvent<HTMLElement>) => void;
  onBlur?: () => void;
}>;
type Hint = (label: string) => HintHandlers;
type ScrollEdges = Readonly<{ above: boolean; below: boolean }>;

/** Число у пункта меню (то же начертание, что у непрочитанных уведомлений); `name` — для чтения с экрана. */
type MenuBadge = Readonly<{ count: number; name: string }>;

function MenuLink({
  link,
  activeId,
  section = false,
  rail = false,
  hint = {},
  badge = null,
  onNavigate,
}: {
  link: V3NavigationLink;
  activeId: V3NavigationLinkId | null;
  /** Раздел верхнего уровня: подпись как у заголовка отдела. */
  section?: boolean;
  rail?: boolean;
  hint?: HintHandlers;
  badge?: MenuBadge | null;
  onNavigate: () => void;
}) {
  return (
    <IntentPrefetchLink
      href={link.href}
      aria-current={activeId === link.id ? "page" : undefined}
      aria-label={badge ? `${link.label}: ${badge.name}` : undefined}
      onNavigate={onNavigate}
      className={cn(section ? SECTION_ITEM : ITEM, rail && "md:max-2xl:justify-center md:max-2xl:px-0")}
      {...hint}
    >
      {badge ? (
        <span className="relative inline-flex shrink-0">
          <Icon name={LINK_ICONS[link.id]} size={20} className="shrink-0" />
          <span
            aria-hidden="true"
            data-testid="v3-shell-badge"
            className="t-caption absolute -end-2 -top-2 min-w-5 rounded-full bg-fg px-1 text-center tabular-nums text-surface"
          >
            {badge.count > 99 ? "99+" : badge.count}
          </span>
        </span>
      ) : (
        <Icon name={LINK_ICONS[link.id]} size={20} className="shrink-0" />
      )}
      <span className={cn("min-w-0", rail && "md:max-2xl:sr-only")}>{link.label}</span>
    </IntentPrefetchLink>
  );
}

function MenuGroup({
  group,
  open,
  flat,
  onToggle,
  activeId,
  rail,
  hint,
  onNavigate,
}: {
  group: V3NavigationGroup;
  open: boolean;
  /** Лист «Ещё» на телефоне: пункты отдела всегда на виду, под подписью отдела, без раскрытия. */
  flat: boolean;
  onToggle: () => void;
  activeId: V3NavigationLinkId | null;
  rail: boolean;
  hint: Hint;
  onNavigate: () => void;
}) {
  const contentId = useId();
  const icon = GROUP_ICONS[group.id];

  if (flat) {
    return (
      <li>
        <p id={contentId} className="t-caption px-3 pb-1 pt-3 text-fg-3">{group.label}</p>
        <ul aria-labelledby={contentId}>
          {group.links.map((link) => (
            <li key={link.id}>
              <MenuLink link={link} activeId={activeId} onNavigate={onNavigate} />
            </li>
          ))}
        </ul>
      </li>
    );
  }

  return (
    <li>
      {/* Выбранным выглядит сам раздел внутри группы; заголовок группы только темнее. */}
      <button
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={onToggle}
        className={cn(
          `flex min-h-11 w-full items-center gap-3 rounded-nav px-3 py-2 text-start t-label transition-colors hover:bg-surface-2 hover:text-fg ${FOCUS}`,
          group.active ? "text-fg" : "text-fg-2",
          rail && "md:max-2xl:hidden",
        )}
      >
        <Icon name={icon} size={20} className="shrink-0" />
        <span className="min-w-0 flex-1">{group.label}</span>
        <Icon name="chevron-right" size={16} className={cn("shrink-0 transition-transform motion-reduce:transition-none", open && "rotate-90")} />
      </button>
      {/* В рейке пункты группы открываются списком в верхнем слое справа от иконки. */}
      {rail ? (
        <TopLayerMenu
          label={group.label}
          placement="right-start"
          trigger={<Icon name={icon} size={20} className="shrink-0" />}
          triggerClassName={cn(
            `hidden min-h-11 w-full items-center justify-center rounded-nav transition-colors md:max-2xl:flex ${FOCUS}`,
            group.active ? "bg-accent-weak text-accent-text" : "text-fg-2 hover:bg-surface-2 hover:text-fg",
          )}
          triggerProps={hint(group.label)}
          menuClassName="w-60 rounded-ctl border border-border bg-surface p-1 shadow-evo-lg"
        >
          {(close) => (
            <>
              <p className="t-caption px-3 pb-1 pt-2 text-fg-3">{group.label}</p>
              <ul className="space-y-0.5">
                {group.links.map((link) => (
                  <li key={link.id}>
                    <MenuLink
                      link={link}
                      activeId={activeId}
                      onNavigate={() => {
                        close();
                        onNavigate();
                      }}
                    />
                  </li>
                ))}
              </ul>
            </>
          )}
        </TopLayerMenu>
      ) : null}
      <ul id={contentId} hidden={!open} className={cn("ms-3 border-s border-border ps-1", rail && "md:max-2xl:hidden")}>
        {group.links.map((link) => (
          <li key={link.id}>
            <MenuLink link={link} activeId={activeId} onNavigate={onNavigate} />
          </li>
        ))}
      </ul>
    </li>
  );
}

/**
 * Список разделов. Ключ — место назначения: при переходе раскрывается текущий
 * отдел. Отделы открываются по одному (`toggleMenuGroup`). Строки по 44 px
 * без зазоров между ними, между «Отделами» и «Общим» — одна волосяная линия
 * с малым отступом (Э6): у Admin на 1280×800 в окне почти весь список, а
 * остаток обозначен затуханием у нижнего края (v3.css, `data-more-below`).
 */
function MenuLists({
  navigation,
  rail,
  flat,
  hint,
  onNavigate,
}: {
  navigation: V3Navigation;
  rail: boolean;
  /** Лист «Ещё»: отделы не раскрываются по одному — в листе хватает места, а путь «Ещё → отдел → пункт» лишний. */
  flat: boolean;
  hint: Hint;
  onNavigate: () => void;
}) {
  const activeGroups = navigation.groups.filter((group) => group.active).map((group) => group.id);
  const [openGroups, setOpenGroups] = useState<readonly V3NavigationGroup["id"][]>(activeGroups);

  return (
    <>
      <ul aria-label="Навигация по разделам" className={cn("px-3 pb-2", rail && "md:max-2xl:px-2")}>
        {navigation.home ? (
          <li>
            <MenuLink link={navigation.home} activeId={navigation.activeId} rail={rail} hint={hint(navigation.home.label)} onNavigate={onNavigate} />
          </li>
        ) : null}
        {navigation.groups.map((group) => (
          <MenuGroup
            key={group.id}
            group={group}
            open={openGroups.includes(group.id)}
            flat={flat}
            onToggle={() => setOpenGroups((previous) => toggleMenuGroup(previous, group.id, activeGroups))}
            activeId={navigation.activeId}
            rail={rail}
            hint={hint}
            onNavigate={onNavigate}
          />
        ))}
        {/* «Маркетинг» и «Финансы» — на уровне заголовков отделов, одной ссылкой каждый. В листе
            «Ещё» заголовков отделов нет (подписи над пунктами), и строки раздела читались бы
            продолжением «Поступления»: волосяная линия, как перед «Общим», отделяет их. */}
        {navigation.sections.map((link, index) => (
          <li key={link.id} className={cn(flat && index === 0 && "mt-2 border-t border-border pt-2")}>
            <MenuLink link={link} activeId={navigation.activeId} section rail={rail} hint={hint(link.label)} onNavigate={onNavigate} />
          </li>
        ))}
      </ul>
      {navigation.common.length ? (
        <section aria-label="Общее" className={cn("mx-3 border-t border-border pb-2 pt-2", rail && "md:max-2xl:mx-2")}>
          <p aria-hidden="true" className={cn("t-caption mb-1 px-3 pt-1 text-fg-3", rail && "md:max-2xl:sr-only")}>Общее</p>
          <ul>
            {navigation.common.map((link) => (
              <li key={link.id}>
                <MenuLink link={link} activeId={navigation.activeId} rail={rail} hint={hint(link.label)} onNavigate={onNavigate} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

/**
 * Есть ли пункты за верхним и нижним краем прокручиваемого списка: список
 * меняет высоту при раскрытии отдела и при смене окна, поэтому края
 * пересчитываются и при прокрутке, и при изменении размеров.
 */
function useScrollEdges(scrollRef: RefObject<HTMLElement | null>, contentRef: RefObject<HTMLElement | null>): ScrollEdges {
  const [edges, setEdges] = useState<ScrollEdges>({ above: false, below: false });
  useEffect(() => {
    const scroller = scrollRef.current;
    const content = contentRef.current;
    if (!scroller || !content) return;
    const update = () => {
      const above = scroller.scrollTop > 1;
      const below = scroller.scrollTop + scroller.clientHeight < scroller.scrollHeight - 1;
      setEdges((previous) => (previous.above === above && previous.below === below ? previous : { above, below }));
    };
    update();
    scroller.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(scroller);
    observer.observe(content);
    return () => {
      scroller.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [scrollRef, contentRef]);
  return edges;
}

/**
 * Нижняя панель телефона. `page` — панель страницы; `sheet` — та же панель
 * внутри листа «Ещё» (в порядке фокуса диалога): вкладки те же, а на месте
 * «Ещё» — «Закрыть».
 */
function TabBar({
  variant,
  tabs,
  activeId,
  inert,
  onNavigate,
  children,
}: {
  variant: "page" | "sheet";
  tabs: ShellTabs;
  activeId: V3NavigationLinkId | null;
  inert?: boolean;
  onNavigate: () => void;
  children: ReactNode;
}) {
  return (
    <nav
      aria-label="Быстрые разделы"
      inert={inert}
      data-testid={variant === "page" ? "v3-shell-tabbar" : "v3-shell-sheet-tabbar"}
      className={cn(
        "border-t border-border bg-surface pb-[var(--shell-safe-bottom)] md:hidden",
        variant === "page" ? "fixed inset-x-0 bottom-0 z-40" : "shrink-0",
      )}
    >
      <ul
        className="grid h-[var(--shell-tabbar)]"
        style={{ gridTemplateColumns: `repeat(${tabs.links.length + 1}, minmax(auto, 1fr))` }}
      >
        {tabs.links.map((link) => {
          const label = shellTabLabel(link);
          return (
            <li key={link.id}>
              <IntentPrefetchLink
                href={link.href}
                aria-current={activeId === link.id ? "page" : undefined}
                aria-label={label.name}
                onNavigate={onNavigate}
                data-shell-tab={link.id}
                className={`${TAB} text-fg-2 aria-[current=page]:text-fg`}
              >
                <span className={`${TAB_PILL} group-aria-[current=page]:bg-accent-weak`}>
                  <Icon name={LINK_ICONS[link.id]} size={20} />
                </span>
                <span className={TAB_LABEL}>{label.text}</span>
              </IntentPrefetchLink>
            </li>
          );
        })}
        <li>{children}</li>
      </ul>
    </nav>
  );
}

export function AppShell({
  children,
  actor,
  initialNotifications,
  deletionRequests = null,
}: {
  children: ReactNode;
  actor: ActivePlatformActor;
  initialNotifications: StaffNotificationPage | null;
  /** Не выполненные запросы на удаление аккаунта: число у «Настроек» (только Admin; ревью 280, UI-F6). */
  deletionRequests?: AccountDeletionOpenCount | null;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const query = useSearchParams();
  const navigation = buildV3Navigation(actor, pathname, query);
  const tabs = shellTabs(navigation);
  const previewing = isStaffPreview(actor);
  const canCreateTask = !previewing && staffHasPermission(actor, "staff.task.create");
  const board = isBoardRoute(pathname);
  const rail = board;
  // Высота окна от 768 px: доски, переписка WhatsApp и «Поручить» ИИ-агента
  // (`isFillRoute`, аудит 26.09); рейка — только у досок.
  const fill = isFillRoute(pathname, query.get("tab"));
  // «На весь экран» в чате «Поручить»: меню прячется, пока выбрано и на экране есть кнопка, которая его возвращает.
  const chatFocus = useChatFocusController(isAiAgentChatRoute(pathname, query.get("tab")));
  const contentId = useId();
  const menuId = useId();
  const headingId = useId();
  const contentRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const returnFocus = useRef(false);
  const [unread, setUnread] = useState<string | undefined>(initialNotifications?.unreadCount);
  const [railHint, setRailHint] = useState<RailHint | null>(null);
  const edges = useScrollEdges(scrollRef, listRef);

  // Лист «Ещё» открыт для одного адреса: любой переход его закрывает, и
  // «Назад» на тот же адрес не открывает его снова.
  const address = `${pathname}?${query.toString()}`;
  const [sheetAt, setSheetAt] = useState<string | null>(null);
  if (sheetAt !== null && sheetAt !== address) setSheetAt(null);
  const sheetOpen = sheetAt !== null;
  const closeSheet = (focusMore: boolean) => {
    returnFocus.current = focusMore;
    setSheetAt(null);
  };
  const closeAfterNavigation = () => closeSheet(false);

  useEffect(() => {
    if (!sheetOpen) {
      if (returnFocus.current) {
        returnFocus.current = false;
        moreRef.current?.focus();
      }
      return;
    }
    // Диалог: фокус — на «Закрыть» (там же, где был «Ещё»), страница под
    // листом не прокручивается; окно стало шире телефона — лист закрывается,
    // меню снова боковое.
    closeRef.current?.focus();
    const root = document.documentElement;
    const overflow = root.style.overflow;
    root.style.overflow = "hidden";
    const desktop = window.matchMedia(DESKTOP_MEDIA);
    const onChange = () => {
      if (!desktop.matches) return;
      returnFocus.current = false;
      setSheetAt(null);
    };
    desktop.addEventListener("change", onChange);
    return () => {
      root.style.overflow = overflow;
      desktop.removeEventListener("change", onChange);
    };
  }, [sheetOpen]);

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!sheetOpen) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeSheet(true);
      return;
    }
    if (event.key !== "Tab" || !menuRef.current) return;
    const focusables = [...menuRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)]
      .filter((element) => element.getClientRects().length > 0);
    const next = trapFocusIndex(focusables.length, focusables.indexOf(document.activeElement as HTMLElement), event.shiftKey);
    if (next < 0) return;
    event.preventDefault();
    focusables[next].focus();
  };

  // Подпись иконки рейки при наведении и при фокусе клавиатуры: `position:
  // fixed`, поэтому прокручиваемый список её не обрезает; доступное имя у
  // пункта своё, подпись — только видимая копия.
  const showRailHint = (element: HTMLElement, label: string) => {
    if (!window.matchMedia(RAIL_MEDIA).matches) return;
    const rect = element.getBoundingClientRect();
    const top = rect.top + rect.height / 2;
    setRailHint((previous) => previous?.label === label && previous.top === top ? previous : { label, top });
  };
  const hint: Hint = (label) => rail ? {
    onPointerEnter: (event) => showRailHint(event.currentTarget, label),
    onPointerLeave: () => setRailHint(null),
    onFocus: (event) => showRailHint(event.currentTarget, label),
    onBlur: () => setRailHint(null),
  } : {};

  const { displayName, systemRole, presentationRole } = actor;
  const previewRole = presentationRole !== null ? roleTitle(presentationRole) : null;
  const accessLabel = previewRole !== null ? previewRole
    : systemRole === "admin" ? "Администратор"
    : [...new Set(actor.assignments.map((assignment) => assignment.label))].join(", ") || "Права ещё не назначены";
  const home = staffHomeRoute(actor);
  const unreadCount = unread && unread !== "0" ? unread : null;
  const settingsBadge: MenuBadge | null = deletionRequests && deletionRequests.open > 0
    ? {
      count: deletionRequests.open,
      name: `запросов на удаление аккаунта: ${deletionRequests.open}${deletionRequests.overdue > 0 ? `, просрочено: ${deletionRequests.overdue}` : ""}`,
    }
    : null;

  return (
    <div
      className="group/shell flex min-h-dvh flex-col md:flex-row"
      data-testid="v3-shell"
      data-shell-layout={board ? "board" : "page"}
      data-chat-focus={chatFocus.active ? "" : undefined}
      data-system-role={actor.systemRole}
      data-presentation-role={actor.presentationRole ?? "actual"}
    >
      <a
        href={`#${contentId}`}
        inert={sheetOpen}
        onClick={(event) => {
          event.preventDefault();
          contentRef.current?.focus();
        }}
        className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:left-2 focus-visible:top-2 focus-visible:z-50 focus-visible:inline-flex focus-visible:min-h-11 focus-visible:items-center focus-visible:rounded-ctl focus-visible:bg-fg focus-visible:px-4 focus-visible:py-2 focus-visible:text-sm focus-visible:font-medium focus-visible:text-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
      >
        К содержимому
      </a>

      {/* Телефон: одна компактная строка сверху. */}
      <div
        inert={sheetOpen}
        data-testid="v3-shell-topbar"
        className="flex h-[var(--shell-top)] shrink-0 items-center justify-between gap-3 border-b border-border bg-surface px-4 md:hidden"
      >
        <IntentPrefetchLink
          href={home}
          aria-label="EVO Admissions — начало работы"
          className={`inline-flex min-h-11 shrink-0 items-center rounded-nav ${FOCUS}`}
        >
          <EvoLogo width={88} />
        </IntentPrefetchLink>
        {previewRole !== null ? (
          <span className="t-caption min-w-0 truncate rounded-full bg-surface-2 px-3 py-1 text-fg-2">Просмотр: {previewRole}</span>
        ) : null}
        {/* Поиск по студентам и лидам нужен с телефона чаще, чем «Ещё → Поиск». */}
        <PaletteIconButton className={`ms-auto inline-flex size-11 shrink-0 items-center justify-center rounded-ctl text-fg-2 transition-colors hover:bg-surface-2 hover:text-fg ${FOCUS}`} />
      </div>

      {/* Боковое меню; на телефоне — лист «Ещё» (тот же DOM). */}
      <div
        ref={menuRef}
        id={menuId}
        data-shell-menu=""
        data-sheet-open={sheetOpen ? "" : undefined}
        role={sheetOpen ? "dialog" : undefined}
        aria-modal={sheetOpen ? true : undefined}
        aria-labelledby={sheetOpen ? headingId : undefined}
        onKeyDown={onMenuKeyDown}
        className={cn(
          "z-30 flex-col bg-surface md:sticky md:top-0 md:h-dvh md:shrink-0 md:border-e md:border-border",
          // Меню остаётся в DOM (уведомления и их опрос не пропадают); «На весь экран» только скрывает его от 768 px.
          chatFocus.active ? "md:hidden" : "md:flex",
          rail ? "md:w-16 2xl:w-[260px]" : "md:w-[260px]",
          sheetOpen ? "flex max-md:fixed max-md:inset-0 max-md:z-50" : "hidden",
        )}
      >
        {/* Лист: та же строка, что сверху страницы, — лист открывается между строкой и панелью вкладок. */}
        {sheetOpen ? (
          <div className="flex h-[var(--shell-top)] shrink-0 items-center border-b border-border px-4 md:hidden">
            <h2 id={headingId} className="sr-only">Меню</h2>
            <IntentPrefetchLink
              href={home}
              aria-label="EVO Admissions — начало работы"
              onNavigate={closeAfterNavigation}
              className={`inline-flex min-h-11 shrink-0 items-center rounded-nav ${FOCUS}`}
            >
              <EvoLogo width={88} />
            </IntentPrefetchLink>
          </div>
        ) : null}

        <nav aria-label="Разделы" data-shell-menu-body="" className="flex min-h-0 flex-1 flex-col">
          {/* Строка логотипа по центру совпадает с заголовком страницы (`--shell-page-top` в v3.css). */}
          <div className={cn("hidden shrink-0 px-5 pb-4 pt-3.5 md:flex", rail && "md:max-2xl:hidden")}>
            <IntentPrefetchLink
              href={home}
              aria-label="EVO Admissions — начало работы"
              onNavigate={closeAfterNavigation}
              className={`inline-flex rounded-nav ${FOCUS} focus-visible:outline-offset-4`}
            >
              <EvoLogo width={112} />
            </IntentPrefetchLink>
          </div>

          {previewRole !== null ? (
            <div
              data-testid="preview-active"
              className={cn(
                "mx-3 mb-3 mt-3 shrink-0 rounded-ctl border border-border bg-surface-2 p-3 md:mt-0",
                // Рейка: полоса во всю ширину 64 px — подпись роли помещается целиком.
                rail && "md:max-2xl:mx-0 md:max-2xl:mt-0 md:max-2xl:rounded-none md:max-2xl:border-x-0 md:max-2xl:border-t-0 md:max-2xl:px-0 md:max-2xl:py-2",
              )}
            >
              <p className={cn("t-caption text-fg-3", rail && "md:max-2xl:sr-only")}>Просмотр интерфейса роли</p>
              <p className={cn("t-item text-fg", rail && "md:max-2xl:hidden")}>{previewRole}</p>
              {/* Рейка: роль видна подписью, а не только подсказкой. */}
              {rail ? <p aria-hidden="true" className="t-caption hidden text-center text-fg md:max-2xl:block">{previewRole}</p> : null}
              <form action={selectStaffRolePreviewAction} className={cn("mt-2", rail && "md:max-2xl:flex md:max-2xl:justify-center")}>
                <button
                  type="submit"
                  name="role"
                  value="admin"
                  data-testid="preview-role-admin"
                  className={cn(SHELL_BUTTON, "w-full", rail && "md:max-2xl:w-11 md:max-2xl:px-0")}
                  {...hint("Выйти из просмотра")}
                >
                  {/* «×», а не «→]» выхода из аккаунта: в рейке внизу стоит «Выйти», и два одинаковых значка путали бы просмотр с выходом. */}
                  <Icon name="x" size={18} className="shrink-0" />
                  <span className={cn("truncate", rail && "md:max-2xl:sr-only")}>Выйти из просмотра</span>
                </button>
              </form>
            </div>
          ) : null}

          {canCreateTask || !previewing ? (
            <div className={cn("flex shrink-0 items-center gap-2 px-3 pb-3 max-md:pt-3", rail && "md:max-2xl:flex-col md:max-2xl:px-2 md:max-2xl:pt-3")}>
              {canCreateTask ? (
                <IntentPrefetchLink
                  href="/v3/tasks?create=staff"
                  // Э7: диалог «Новая задача» на месте, с контекстом страницы; из листа «Ещё» фокус потом — на «Ещё».
                  onClick={(event) => {
                    const returnFocus = sheetOpen ? moreRef.current : null;
                    onCreateTaskClick(event, () => router.push(`/v3/tasks?create=staff&open=${crypto.randomUUID()}`), returnFocus, () => closeSheet(false));
                  }}
                  className={cn(SHELL_BUTTON, "flex-1", rail && "md:max-2xl:w-11 md:max-2xl:flex-none md:max-2xl:px-0")}
                  {...hint("Создать задачу")}
                >
                  <Icon name="plus" size={18} className="shrink-0" />
                  <span className={cn("truncate", rail && "md:max-2xl:sr-only")}>Создать задачу</span>
                </IntentPrefetchLink>
              ) : null}
              {!previewing ? (
                <StaffNotifications initialPage={initialNotifications} onCountChange={setUnread} triggerProps={hint("Уведомления")} />
              ) : null}
            </div>
          ) : null}

          {/* Ctrl+K для мыши и телефона — строкой меню (Э7): кнопки рядом с
              «Создать задачу» сжали бы её подпись. */}
          <div className={cn("shrink-0 px-3 pb-2", rail && "md:max-2xl:px-2")}>
            <PaletteButton
              shortcutClassName={cn("hidden md:inline", rail && "md:max-2xl:hidden")}
              className={cn(SEARCH_ROW, rail && "md:max-2xl:justify-center md:max-2xl:px-0")}
              labelClassName={cn("min-w-0 flex-1 text-start", rail && "md:max-2xl:sr-only")}
              hint={hint("Поиск")}
            />
          </div>

          {/* Список — единственная прокручиваемая часть меню. У края, за которым
              есть ещё пункты, — знак: сверху тень внутрь, снизу затухание
              последних пунктов и тень над строкой аккаунта (v3.css). */}
          <div
            ref={scrollRef}
            data-shell-scroll=""
            data-more-above={edges.above ? "" : undefined}
            data-more-below={edges.below ? "" : undefined}
            className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-border pt-3", rail && "md:max-2xl:pt-2")}
          >
            <div ref={listRef}>
              <MenuLists key={navigation.destinationKey} navigation={navigation} rail={rail} flat={sheetOpen} hint={hint} onNavigate={closeAfterNavigation} />
            </div>
          </div>

          {/* Аккаунт закреплён внизу и виден всегда: прокручивается список выше. */}
          <div data-shell-account="" className="shrink-0 border-t border-border">
            <div className={cn("flex items-center gap-1 px-3 pt-2", rail && "md:max-2xl:flex-col md:max-2xl:px-2")}>
              {navigation.settings ? (
                <div className={cn("min-w-0 flex-1", rail && "md:max-2xl:w-full md:max-2xl:flex-none")}>
                  <MenuLink link={navigation.settings} activeId={navigation.activeId} rail={rail} hint={hint(navigation.settings.label)} badge={settingsBadge} onNavigate={closeAfterNavigation} />
                </div>
              ) : null}
              <form action={logoutStaffAction} className="shrink-0">
                <button
                  type="submit"
                  data-testid="staff-logout"
                  className={cn(QUIET_BUTTON, rail && "md:max-2xl:w-11 md:max-2xl:px-0")}
                  {...hint("Выйти")}
                >
                  <Icon name="log-out" size={18} className="shrink-0" />
                  <span className={cn(rail && "md:max-2xl:sr-only")}>Выйти</span>
                </button>
              </form>
            </div>
            {/* Имя и роль — во всю ширину строки (от края логотипа), каждая в одну строку; целиком — в подсказке. */}
            <p className={cn("min-w-0 px-5 pb-3 pt-1", rail && "md:max-2xl:sr-only")}>
              <span className="t-item block truncate text-fg" title={displayName}>{displayName}</span>
              <span
                className="t-meta mt-0.5 block truncate text-fg-3"
                title={accessLabel}
                data-testid="active-role"
                data-role={presentationRole ?? systemRole}
                data-system-role={systemRole}
              >
                {accessLabel}
              </span>
            </p>
          </div>
        </nav>

        {/* Лист: панель вкладок остаётся на месте; «Ещё» стало «Закрыть». */}
        {sheetOpen ? (
          <TabBar variant="sheet" tabs={tabs} activeId={navigation.activeId} onNavigate={closeAfterNavigation}>
            <button
              ref={closeRef}
              type="button"
              aria-label="Закрыть меню"
              data-shell-tab="close"
              onClick={() => closeSheet(true)}
              className={cn(TAB, "w-full text-fg")}
            >
              <span className={TAB_PILL}>
                <Icon name="x" size={20} />
              </span>
              <span className={TAB_LABEL}>Закрыть</span>
            </button>
          </TabBar>
        ) : null}

        {rail && railHint ? (
          <span
            aria-hidden="true"
            className="t-caption pointer-events-none fixed start-[4.5rem] z-50 hidden -translate-y-1/2 whitespace-nowrap rounded-nav bg-fg px-2 py-1 text-surface shadow-evo-lg md:max-2xl:block"
            style={{ top: railHint.top }}
          >
            {railHint.label}
          </span>
        ) : null}
      </div>

      {/* Container queries use the width remaining after the sidebar (260px, or the 64px rail on boards). */}
      <div
        inert={sheetOpen}
        className={cn(
          "@container min-w-0 flex-1 max-md:pb-[calc(var(--shell-tabbar)+var(--shell-safe-bottom))]",
          fill && "md:flex md:h-dvh md:flex-col",
        )}
      >
        <div
          id={contentId}
          ref={contentRef}
          tabIndex={-1}
          data-shell-content=""
          className={cn("min-w-0 outline-none", fill && "md:flex md:min-h-0 md:flex-1 md:flex-col md:overflow-y-auto")}
        >
          <ChatFocusProvider value={chatFocus.value}>{children}</ChatFocusProvider>
        </div>
      </div>

      {/* Телефон: нижняя панель вкладок — до четырёх разделов роли и «Ещё». */}
      <TabBar variant="page" tabs={tabs} activeId={navigation.activeId} inert={sheetOpen} onNavigate={closeAfterNavigation}>
        <button
          ref={moreRef}
          type="button"
          aria-haspopup="dialog"
          aria-expanded={sheetOpen}
          aria-controls={menuId}
          aria-label={unreadCount ? `Ещё: меню, непрочитанных уведомлений — ${unreadCount}` : "Ещё"}
          data-shell-tab="more"
          data-current-inside={tabs.currentInMore ? "" : undefined}
          onClick={() => setSheetAt(address)}
          className={cn(TAB, "w-full", tabs.currentInMore ? "text-fg" : "text-fg-2")}
        >
          <span className={cn(TAB_PILL, "relative", tabs.currentInMore && "bg-accent-weak")}>
            <Icon name="menu" size={20} />
            {unreadCount ? (
              <span aria-hidden="true" className="t-caption absolute -top-1 end-0 min-w-5 rounded-full bg-fg px-1 text-center tabular-nums text-surface">
                {BigInt(unreadCount) > BigInt(99) ? "99+" : unreadCount}
              </span>
            ) : null}
          </span>
          <span className={TAB_LABEL}>Ещё</span>
        </button>
      </TabBar>
      <ShellCommands actor={actor} navigation={navigation} />
      <StaleDeploymentNotice />
    </div>
  );
}
