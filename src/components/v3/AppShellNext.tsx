"use client";

import Link from "next/link";
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

import type { ActivePlatformActor } from "@/lib/platform-auth";
import { isStaffPreview, staffHasPermission, staffHomeRoute } from "@/lib/platform-access";
import type { StaffNotificationPage } from "@/lib/platform-staff-notifications-contract";
import { logoutStaffAction, selectStaffRolePreviewAction } from "@/lib/staff-auth-actions";
import { EvoLogo } from "@/components/platform/brand/EvoLogo";
import { Icon } from "@/components/icons";
import { cn } from "@/components/ui";
import { StaffNotifications } from "@/components/v3/StaffNotifications";
import { TopLayerMenu } from "@/components/v3/board/TopLayerMenu";
import { isBoardRoute } from "@/lib/v3/board-layout";
import {
  buildV3Navigation,
  type V3Navigation,
  type V3NavigationGroup,
  type V3NavigationLink,
  type V3NavigationLinkId,
} from "@/lib/v3/navigation";
import {
  NEXT_GROUP_ICONS,
  NEXT_LINK_ICONS,
  shellTabLabel,
  shellTabs,
  toggleMenuGroup,
  trapFocusIndex,
  type ShellTabs,
} from "@/lib/v3/shell-tabs";
import { roleTitle } from "@/lib/v3/wording";

/*
 * Оболочка нового облика — Э1.2 плана редизайна 25.09.2026
 * (docs/EVO_CRM_REDESIGN_PLAN_2026-09-25.md). Временное сосуществование:
 * рендерится только при `data-look="next"` (Admin с включённым
 * предпросмотром, в том числе в просмотре роли); прежняя оболочка в
 * AppShell.tsx не меняется. После решения владельца (Э1.5) этот файл
 * становится AppShell или удаляется (izzhackt/evo_AI_CRM#1061).
 *
 * - Компьютер: верхней панели нет. «Создать задачу», уведомления, просмотр
 *   роли и аккаунт — в боковом меню; прокручивается список разделов (у краёв
 *   списка, за которыми есть ещё пункты, — тень), аккаунт с «Выйти»
 *   закреплён внизу. Отделы открываются по одному. На досках до 1536 px —
 *   рейка 64 px.
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
const ITEM = `v3-choice flex min-h-11 min-w-0 items-center gap-3 rounded-nav px-3 py-2 text-sm leading-5 text-fg-2 transition-colors hover:bg-surface-2 hover:text-fg ${FOCUS}`;
/** Нейтральная кнопка оболочки: красным остаётся только главное действие страницы. */
const SHELL_BUTTON = `v3-raised inline-flex min-h-11 min-w-0 items-center justify-center gap-2 rounded-ctl border border-control-edge bg-surface px-3 text-sm font-medium text-fg-2 transition-colors hover:bg-surface-2 hover:text-fg ${FOCUS}`;
/** Тихая кнопка без рамки и тени: «Выйти» не спорит с «Создать задачу». */
const QUIET_BUTTON = `inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-ctl px-3 text-sm font-medium text-fg-2 transition-colors hover:bg-surface-2 hover:text-fg ${FOCUS}`;
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

function MenuLink({
  link,
  activeId,
  rail = false,
  hint = {},
  onNavigate,
}: {
  link: V3NavigationLink;
  activeId: V3NavigationLinkId | null;
  rail?: boolean;
  hint?: HintHandlers;
  onNavigate: () => void;
}) {
  return (
    <Link
      href={link.href}
      aria-current={activeId === link.id ? "page" : undefined}
      onNavigate={onNavigate}
      className={cn(ITEM, rail && "md:max-2xl:justify-center md:max-2xl:px-0")}
      {...hint}
    >
      <Icon name={NEXT_LINK_ICONS[link.id]} size={20} className="shrink-0" />
      <span className={cn("min-w-0", rail && "md:max-2xl:sr-only")}>{link.label}</span>
    </Link>
  );
}

function MenuGroup({
  group,
  open,
  onToggle,
  activeId,
  rail,
  hint,
  onNavigate,
}: {
  group: V3NavigationGroup;
  open: boolean;
  onToggle: () => void;
  activeId: V3NavigationLinkId | null;
  rail: boolean;
  hint: Hint;
  onNavigate: () => void;
}) {
  const contentId = useId();
  const icon = NEXT_GROUP_ICONS[group.id];

  return (
    <li>
      {/* Выбранным выглядит сам раздел внутри группы; заголовок группы только темнее. */}
      <button
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={onToggle}
        className={cn(
          `flex min-h-11 w-full items-center gap-3 rounded-nav px-3 py-2 text-start text-sm font-medium transition-colors hover:bg-surface-2 hover:text-fg ${FOCUS}`,
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
      <ul id={contentId} hidden={!open} className={cn("ms-3 mt-1 space-y-1 border-s border-border ps-1", rail && "md:max-2xl:hidden")}>
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
 * отдел. Отделы открываются по одному (`toggleMenuGroup`).
 */
function MenuLists({
  navigation,
  rail,
  hint,
  onNavigate,
}: {
  navigation: V3Navigation;
  rail: boolean;
  hint: Hint;
  onNavigate: () => void;
}) {
  const activeGroups = navigation.groups.filter((group) => group.active).map((group) => group.id);
  const [openGroups, setOpenGroups] = useState<readonly V3NavigationGroup["id"][]>(activeGroups);

  return (
    <>
      <ul aria-label="Навигация по разделам" className={cn("space-y-1 px-3 pb-4", rail && "md:max-2xl:px-2")}>
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
            onToggle={() => setOpenGroups((previous) => toggleMenuGroup(previous, group.id, activeGroups))}
            activeId={navigation.activeId}
            rail={rail}
            hint={hint}
            onNavigate={onNavigate}
          />
        ))}
      </ul>
      {navigation.common.length ? (
        <section aria-label="Общее" className={cn("mx-3 border-t border-border pb-4 pt-4", rail && "md:max-2xl:mx-2 md:max-2xl:pb-2 md:max-2xl:pt-2")}>
          <h2 className={cn("t-caption mb-2 px-3 text-fg-3", rail && "md:max-2xl:sr-only")}>Общее</h2>
          <ul className="space-y-1">
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
              <Link
                href={link.href}
                aria-current={activeId === link.id ? "page" : undefined}
                aria-label={label.name}
                onNavigate={onNavigate}
                data-shell-tab={link.id}
                className={`${TAB} text-fg-2 aria-[current=page]:text-fg`}
              >
                <span className={`${TAB_PILL} group-aria-[current=page]:bg-accent-weak`}>
                  <Icon name={NEXT_LINK_ICONS[link.id]} size={20} />
                </span>
                <span className={TAB_LABEL}>{label.text}</span>
              </Link>
            </li>
          );
        })}
        <li>{children}</li>
      </ul>
    </nav>
  );
}

export function AppShellNext({
  children,
  actor,
  initialNotifications,
}: {
  children: ReactNode;
  actor: ActivePlatformActor;
  initialNotifications: StaffNotificationPage | null;
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

  return (
    <div
      className="flex min-h-dvh flex-col md:flex-row"
      data-testid="v3-shell"
      data-shell-look="next"
      data-shell-layout={board ? "board" : "page"}
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

      {/* Телефон: одна компактная строка вместо прежних двух панелей. */}
      <div
        inert={sheetOpen}
        data-testid="v3-shell-topbar"
        className="flex h-[var(--shell-top)] shrink-0 items-center justify-between gap-3 border-b border-border bg-surface px-4 md:hidden"
      >
        <Link
          href={home}
          aria-label="EVO Admissions — начало работы"
          className={`inline-flex min-h-11 shrink-0 items-center rounded-nav ${FOCUS}`}
        >
          <EvoLogo width={88} />
        </Link>
        {previewRole !== null ? (
          <span className="t-caption min-w-0 truncate rounded-full bg-surface-2 px-3 py-1 text-fg-2">Просмотр: {previewRole}</span>
        ) : null}
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
          "z-30 flex-col bg-surface md:sticky md:top-0 md:flex md:h-dvh md:shrink-0 md:border-e md:border-border",
          rail ? "md:w-16 2xl:w-[260px]" : "md:w-[260px]",
          sheetOpen ? "flex max-md:fixed max-md:inset-0 max-md:z-50" : "hidden",
        )}
      >
        {/* Лист: та же строка, что сверху страницы, — лист открывается между строкой и панелью вкладок. */}
        {sheetOpen ? (
          <div className="flex h-[var(--shell-top)] shrink-0 items-center border-b border-border px-4 md:hidden">
            <h2 id={headingId} className="sr-only">Меню</h2>
            <Link
              href={home}
              aria-label="EVO Admissions — начало работы"
              onNavigate={closeAfterNavigation}
              className={`inline-flex min-h-11 shrink-0 items-center rounded-nav ${FOCUS}`}
            >
              <EvoLogo width={88} />
            </Link>
          </div>
        ) : null}

        <nav aria-label="Разделы" data-shell-menu-body="" className="flex min-h-0 flex-1 flex-col">
          {/* Строка логотипа по центру совпадает с заголовком страницы (`--shell-page-top` в v3.css). */}
          <div className={cn("hidden shrink-0 px-5 pb-4 pt-3.5 md:flex", rail && "md:max-2xl:hidden")}>
            <Link
              href={home}
              aria-label="EVO Admissions — начало работы"
              onNavigate={closeAfterNavigation}
              className={`inline-flex rounded-nav ${FOCUS} focus-visible:outline-offset-4`}
            >
              <EvoLogo width={112} />
            </Link>
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
                  <Icon name="arrow-left" size={18} className="shrink-0" />
                  <span className={cn("truncate", rail && "md:max-2xl:sr-only")}>Выйти из просмотра</span>
                </button>
              </form>
            </div>
          ) : null}

          {canCreateTask || !previewing ? (
            <div className={cn("flex shrink-0 items-center gap-2 px-3 pb-3 max-md:pt-3", rail && "md:max-2xl:flex-col md:max-2xl:px-2 md:max-2xl:pt-3")}>
              {canCreateTask ? (
                <Link
                  href="/v3/tasks?create=staff"
                  onClick={(event) => {
                    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                    event.preventDefault();
                    closeSheet(false);
                    router.push(`/v3/tasks?create=staff&open=${crypto.randomUUID()}`);
                  }}
                  className={cn(SHELL_BUTTON, "flex-1", rail && "md:max-2xl:w-11 md:max-2xl:flex-none md:max-2xl:px-0")}
                  {...hint("Создать задачу")}
                >
                  <Icon name="plus" size={18} className="shrink-0" />
                  <span className={cn("truncate", rail && "md:max-2xl:sr-only")}>Создать задачу</span>
                </Link>
              ) : null}
              {!previewing ? (
                <StaffNotifications initialPage={initialNotifications} variant="menu" onCountChange={setUnread} triggerProps={hint("Уведомления")} />
              ) : null}
            </div>
          ) : null}

          {/* Тень у края, за которым есть ещё пункты: список не обрывается молча. */}
          <div
            ref={scrollRef}
            data-shell-scroll=""
            data-more-above={edges.above ? "" : undefined}
            data-more-below={edges.below ? "" : undefined}
            className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-border pt-3", rail && "md:max-2xl:pt-2")}
          >
            <div ref={listRef}>
              <MenuLists key={navigation.destinationKey} navigation={navigation} rail={rail} hint={hint} onNavigate={closeAfterNavigation} />
            </div>
          </div>

          {/* Аккаунт закреплён внизу и виден всегда: прокручивается список выше. */}
          <div data-shell-account="" className="shrink-0 border-t border-border">
            <div className={cn("flex items-center gap-1 px-3 pt-2", rail && "md:max-2xl:flex-col md:max-2xl:px-2")}>
              {navigation.settings ? (
                <div className={cn("min-w-0 flex-1", rail && "md:max-2xl:w-full md:max-2xl:flex-none")}>
                  <MenuLink link={navigation.settings} activeId={navigation.activeId} rail={rail} hint={hint(navigation.settings.label)} onNavigate={closeAfterNavigation} />
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
          board && "md:flex md:h-dvh md:flex-col",
        )}
      >
        <div
          id={contentId}
          ref={contentRef}
          tabIndex={-1}
          data-shell-content=""
          className={cn("min-w-0 outline-none", board && "md:flex md:min-h-0 md:flex-1 md:flex-col md:overflow-y-auto")}
        >
          {children}
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
    </div>
  );
}
