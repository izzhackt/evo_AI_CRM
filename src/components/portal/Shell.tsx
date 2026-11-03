"use client";

import { useLinkStatus } from "next/link";
import { IntentPrefetchLink } from "@/components/IntentPrefetchLink";
import { usePathname } from "next/navigation";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type RefObject,
} from "react";

import { PortalNotificationUpdates } from "./PortalNotificationUpdates";
import { PortalStaleDeploymentNotice } from "./PortalStaleDeploymentNotice";
import { RailFooter } from "./RailFooter";

import { EvoLogo } from "@/components/platform/brand/EvoLogo";
import { EvoMark } from "@/components/platform/brand/EvoMark";
import { ThemeToggle } from "@/components/ThemeToggle";
import type { Locale } from "@/lib/i18n-data";
import {
  formatPortalString,
  getPortalStrings,
  type PortalStrings,
} from "@/lib/portal/i18n";
import { writePortalRailChoice } from "@/lib/portal/rail-choice";
import type { Theme } from "@/lib/theme";

/**
 * Портальный shell (PORT-2, дизайн-контракт
 * docs/design/portal/design-contract.md): слева рейл на всю высоту —
 * логотип и тема, разделы, язык и карточка студента («Выйти» — в «Профиле»);
 * на узком экране — полоса сверху (логотип, колокольчик, тема) и нижняя
 * панель вкладок. Стили — только pt-классы из src/app/(portal)/portal.css.
 *
 * Телефон (#1113): в панели первые PHONE_TAB_COUNT разделов уровня доступа и
 * «Ещё»; остальные разделы открывает лист «Ещё» над панелью. Ссылки в DOM
 * одни и те же для рейла и для телефона (по одной на раздел, в порядке рейла):
 * первый список — вкладки, второй — лист; на широком экране оба рисуются
 * подряд как обычный рейл, а «Ещё» скрыта.
 *
 * Движение (анимации кабинета студента, PLAN_CHANGES 02.10): страница в
 * `#portal-content` оборачивается в `display: contents`-обёртку с key=pathname —
 * узлы страницы создаются заново на каждой смене маршрута и проигрывают вход
 * (portal.css, раздел «Движение»); один индикатор активной вкладки переезжает
 * между пунктами по CSS-переменным, которые считает `useActiveTabIndicator`.
 *
 * Смоук-якоря production-прогона (scripts/release/evo-production-browser-smoke.mjs +
 * tests/production-browser-smoke.test.mjs): data-testid="student-portal-shell"
 * на корне и ровно один <nav aria-label="Разделы кабинета"> со ссылкой
 * href="/portal". Байт-в-байт; менять — только вместе со смоук-скриптом и его
 * контракт-тестом в одном PR (правило изоляции дизайн-контракта).
 */

/**
 * Уровень доступа из серверного actor.accessTier: единый authority для
 * главной, навигации и уведомлений.
 */
export type PortalAccessTier = "approved" | "assisted";

/**
 * Честная навигация: только реально существующие сегодня разделы
 * (Избранное — PORT-3b, Профиль — PORT-5a, Профессии/Английский — PORT-4c,
 * оба tier'а по дизайн-контракту).
 */
const SECTIONS = [
  // PORT-9c: «Главная» — отдельный маршрут; /portal остаётся «Моим
  // поступлением» (замороженные смоук-якоря: вход после логина, заголовок и
  // ссылка a[href="/portal"] в этом nav).
  { href: "/portal/home", key: "nav.home", tiers: ["approved", "assisted"] },
  { href: "/portal", key: "nav.overview", tiers: ["approved", "assisted"] },
  { href: "/portal/documents", key: "nav.documents", tiers: ["assisted"] },
  // 03.11.2026: «Оплата» снова пункт меню (слово пользователя): ссылки на
  // начисления на «Поступлении» больше нет.
  { href: "/portal/payments", key: "nav.payments", tiers: ["assisted"] },
  { href: "/portal/messages", key: "nav.messages", tiers: ["assisted"] },
  // 03.11.2026: рейл по группам, как в кабинете-образце пользователя: «Выбор»
  // (вузы, профессии) и «Учёба» (английский, CSCA, тесты). «Избранное» —
  // вкладка «Вузы» на «Моём поступлении», своего пункта нет.
  { href: "/portal/universities", key: "nav.universities", tiers: ["approved", "assisted"], group: "nav.groupChoice" },
  { href: "/portal/professions", key: "nav.professions", tiers: ["approved", "assisted"] },
  { href: "/portal/english", key: "nav.english", tiers: ["approved", "assisted"], group: "nav.groupPrep" },
  // S5.1: CSCA рядом с «Английским», навигация не перестраивается (решение по
  // умолчанию до ответа владельца, PLAN_CHANGES 16.10).
  { href: "/portal/csca", key: "nav.csca", tiers: ["approved", "assisted"] },
  { href: "/portal/tests", key: "nav.tests", tiers: ["approved", "assisted"] },
  { href: "/portal/profile", key: "nav.profile", tiers: ["approved", "assisted"] },
] as const satisfies readonly {
  href: string;
  key: keyof PortalStrings<"shell">;
  tiers: readonly PortalAccessTier[];
  /** Подпись группы над пунктом — только в рейле широкого экрана. */
  group?: keyof PortalStrings<"shell">;
}[];

/**
 * Сколько разделов нижняя панель телефона показывает до «Ещё»: подпись 12 px
 * в Golos («Поступление» ≈ 79 px) должна помещаться в колонку при четырёх
 * колонках уже от ~360 px; с двенадцатью колонками (#1113) 7–8 разделов
 * уходили за край экрана.
 */
const PHONE_TAB_COUNT = 3;

/** Раздел, который на широком экране ведёт карточка студента внизу рейла. */
const RAIL_ACCOUNT_HREF = "/portal/profile";

/**
 * Индикатор активной вкладки. Один элемент `.pt-nav-indicator` переезжает между
 * пунктами нижней панели телефона (по горизонтали) и рейла (по вертикали)
 * transform-переходом из portal.css; Shell только считает положение активного
 * пункта (offset-значения, на них не влияют transform нажатия) и кладёт его в
 * --pt-ind-x/-y/-w/-h на <nav>. data-indicator на <nav> включает индикатор и
 * прячет прежние статические планки ::before: до гидрации и без скрипта вкладка
 * отмечена ими, так что смена не мигает. Первая постановка, смена размера окна
 * и возврат с неотмеченного маршрута ставят индикатор мгновенно (snap), едет он
 * только при смене активного пункта.
 */
function useActiveTabIndicator(navRef: RefObject<HTMLElement | null>, pathname: string, sectionCount: number) {
  const placeRef = useRef<(snap: boolean) => void>(() => {});

  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const place = (snap: boolean) => {
      const wide = window.matchMedia("(min-width: 768px)").matches;
      // Телефон: вкладки панели или «Ещё»; ссылки листа скрыты и индикатору не
      // принадлежат. Широкий экран: рейл — все ссылки подряд.
      const target = nav.querySelector<HTMLElement>(
        wide
          ? 'li:not([data-rail-hidden]) > .pt-nav-link[aria-current="page"]'
          : '.pt-nav-bar .pt-nav-link[aria-current="page"], .pt-nav-more-toggle[data-current-inside]',
      );
      const instant = snap || nav.getAttribute("data-indicator") !== "ready";
      if (instant) nav.setAttribute("data-indicator-snap", "");
      if (target) {
        nav.style.setProperty("--pt-ind-x", String(target.offsetLeft));
        nav.style.setProperty("--pt-ind-y", String(target.offsetTop));
        nav.style.setProperty("--pt-ind-w", String(target.offsetWidth));
        nav.style.setProperty("--pt-ind-h", String(target.offsetHeight));
      }
      nav.setAttribute("data-indicator", target ? "ready" : "none");
      if (instant) {
        // Принудительный пересчёт стиля с transition: none, затем снимаем snap.
        void nav.offsetWidth;
        nav.removeAttribute("data-indicator-snap");
      }
    };
    placeRef.current = place;
    place(false);
  }, [navRef, pathname, sectionCount]);

  useEffect(() => {
    const nav = navRef.current;
    if (!nav || typeof ResizeObserver === "undefined") return;
    // Первое уведомление ResizeObserver приходит сразу после observe() и
    // отменило бы переход, начатый сменой маршрута: пропускаем его.
    let initial = true;
    const observer = new ResizeObserver(() => {
      if (initial) {
        initial = false;
        return;
      }
      placeRef.current(true);
    });
    observer.observe(nav);
    return () => observer.disconnect();
  }, [navRef]);
}

function NavigationLabel({ label, opening }: { label: string; opening: string }) {
  const { pending } = useLinkStatus();
  return (
    <>
      <span className="pt-nav-label">{label}</span>
      <span aria-hidden="true" className="pt-nav-pending">{pending ? "…" : ""}</span>
      <span className="pt-sr-only" role="status">{pending ? opening : ""}</span>
    </>
  );
}

function SectionIcon({ section }: { section: (typeof SECTIONS)[number]["key"] }) {
  const paths: Record<(typeof SECTIONS)[number]["key"], string> = {
    // Главная: дом.
    "nav.home": "M3.5 9.5 10 3.5l6.5 6M5.5 8.2V16h9V8.2M8.5 16v-4h3v4",
    // Поступление: флажок у цели маршрута.
    "nav.overview": "M5 17V3.5M5 3.5h9.5l-2 3.5 2 3.5H5",
    // Документы: лист с загнутым углом.
    "nav.documents": "M6 2.5h5.5L15 6v11.5H6zM11.5 2.5V6H15M8.2 9.5h3.6M8.2 12.5h3.6",
    // Оплата: карта.
    "nav.payments": "M3 5.5h14v9H3zM3 8.5h14M6 12h3",
    // Входящие (переписка и «Что нового»): пузырь диалога.
    "nav.messages": "M3.5 4.5h13v8.5h-7.2L6 16v-3H3.5zM6.8 7.5h6.4M6.8 10h4.4",
    // Университеты: здание с колоннами.
    "nav.universities": "M3 8l7-4.5L17 8M4.5 8v7M8 8v7M12 8v7M15.5 8v7M3 15h14",
    // Профессии: компас — исследование направлений.
    "nav.professions": "M10 17.5a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15zM12.8 7.2l-1.6 4-4 1.6 1.6-4z",
    // Английский: открытая книга.
    "nav.english": "M10 5.2C8.8 4.2 7 3.7 4.6 3.7c-.6 0-1.1 0-1.6.1v11.4c.5-.1 1-.1 1.6-.1 2.4 0 4.2.5 5.4 1.5 1.2-1 3-1.5 5.4-1.5.6 0 1.1 0 1.6.1V3.8c-.5-.1-1-.1-1.6-.1-2.4 0-4.2.5-5.4 1.5zM10 5.2v11.4",
    // CSCA: оси и кривая графика.
    "nav.csca": "M4 3.5v12.5h12.5M6.5 13.5c1.6-.2 2.6-1.4 3.5-3.6.9-2.3 2.2-4.4 5-4.9",
    // Тесты: планшет с отметкой.
    "nav.tests": "M6.5 3.5h7a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1zM8 3.5V2.8h4v.7M7.7 10.2l1.6 1.6 3-3.3",
    // Профиль: человек.
    "nav.profile": "M10 9.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM4 16.5c.7-2.9 3-4.5 6-4.5s5.3 1.6 6 4.5",
  };
  return (
    <svg
      className="pt-nav-icon"
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
    >
      <path d={paths[section]} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg
      className="pt-nav-icon"
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
    >
      <path d="M4.5 10h.01M10 10h.01M15.5 10h.01" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}

export function Shell({
  children,
  displayName,
  accessTier,
  locale,
  theme,
  release = null,
  studyCountry = null,
  railCollapsed = false,
}: {
  children: React.ReactNode;
  displayName: string;
  accessTier: PortalAccessTier;
  locale: Locale;
  theme: Theme;
  /** Ревизия сервера при отрисовке: по ней опрос узнаёт устаревшую сборку. */
  release?: string | null;
  /** Страна поступления для подписи в карточке внизу рейла; `null` — без неё. */
  studyCountry?: string | null;
  /** Рейл свёрнут до значков (cookie `portal_rail`, читает layout). */
  railCollapsed?: boolean;
}) {
  const pathname = usePathname();
  const strings = getPortalStrings("shell", locale);
  const sections = SECTIONS.filter((section) =>
    (section.tiers as readonly PortalAccessTier[]).includes(accessTier));
  const tabSections = sections.slice(0, PHONE_TAB_COUNT);
  const moreSections = sections.slice(PHONE_TAB_COUNT);

  const isActive = (section: (typeof SECTIONS)[number]) =>
    pathname === section.href
    || (section.href !== "/portal" && pathname.startsWith(`${section.href}/`));
  const currentInMore = moreSections.some(isActive);

  // Лист «Ещё» принадлежит одному адресу: любая смена адреса — тап по разделу,
  // «Назад», «Вперёд» — закрывает его, и возврат на тот же адрес его не
  // открывает (Shell живёт в общем layout, состояние переживает навигацию).
  // Сброс при смене адреса делается прямо в рендере, без эффекта: лист не
  // успевает мигнуть открытым.
  const sheetId = useId();
  const [openAt, setOpenAt] = useState<string | null>(null);
  if (openAt !== null && openAt !== pathname) setOpenAt(null);
  const moreOpen = openAt === pathname;
  const navRef = useRef<HTMLElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const [unread, setUnread] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState(railCollapsed);
  const toggleRail = () => {
    writePortalRailChoice(!collapsed);
    setCollapsed(!collapsed);
  };
  useActiveTabIndicator(navRef, pathname, sections.length);

  // Лист не диалог: страница под ним доступна. Закрывают его Escape (фокус
  // возвращается на «Ещё»), касание вне панели и уход фокуса с панели.
  useEffect(() => {
    if (!moreOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpenAt(null);
      toggleRef.current?.focus();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && navRef.current?.contains(event.target)) return;
      setOpenAt(null);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [moreOpen]);

  const closeWhenFocusLeaves = (event: FocusEvent<HTMLElement>) => {
    const next = event.relatedTarget;
    if (moreOpen && next instanceof Node && !event.currentTarget.contains(next)) setOpenAt(null);
  };

  const renderSection = (section: (typeof SECTIONS)[number]) => {
    const label = strings[section.key];
    const active = isActive(section);
    // Непрочитанное — числом у «Входящих» в рейле (колокольчик остался на телефоне).
    const count = section.href === "/portal/messages" && unread !== null && unread > 0 ? unread : null;
    const item = (
      // «Профиль» на широком экране открывает карточка студента внизу рейла
      // (RailFooter), поэтому пункт виден только в листе «Ещё» на телефоне.
      <li key={section.href} data-rail-hidden={section.href === RAIL_ACCOUNT_HREF ? "" : undefined}>
        <IntentPrefetchLink
          href={section.href}
          aria-current={active ? "page" : undefined}
          className="pt-nav-link"
          // Свёрнутый рейл: подпись скрыта визуально, подсказка — по наведению.
          title={collapsed ? label : undefined}
          onClick={() => setOpenAt(null)}
        >
          <SectionIcon section={section.key} />
          <NavigationLabel
            label={label}
            opening={formatPortalString(strings.openingSection, { label })}
          />
          {count === null ? null : (
            <>
              <span className="pt-nav-badge" aria-hidden="true">{count > 99 ? "99+" : count}</span>
              <span className="pt-sr-only">{formatPortalString(strings.notificationsUnread, { count: String(count) })}</span>
            </>
          )}
        </IntentPrefetchLink>
      </li>
    );
    if (!("group" in section)) return item;
    // Подпись группы — визуальная: смысл пунктов ясен из их имён.
    return [
      <li key={`${section.href}-group`} className="pt-nav-group" aria-hidden="true">{strings[section.group]}</li>,
      item,
    ];
  };

  return (
    <div className="pt-shell" data-testid="student-portal-shell" data-rail={collapsed ? "collapsed" : undefined}>
      <a href="#portal-content" className="pt-skip-link">
        {strings.skipToContent}
      </a>

      <div className="pt-body">
        {/* Рейл (03.11.2026, по образцу кабинета пользователя): колонка на всю
            высоту — логотип и кнопка «Свернуть меню» сверху, разделы по
            группам, внизу язык, тема и карточка студента; свёрнутый — только
            значки. На телефоне обёртки нет (display: contents): шапка
            становится полосой сверху (логотип, колокольчик, тема), разделы —
            нижней панелью. */}
        <div className="pt-rail">
          <header className="pt-topbar">
            <IntentPrefetchLink href="/portal" aria-label={strings.home} className="pt-topbar-logo">
              <EvoLogo width={112} className="pt-logo-full" />
              <EvoMark size={32} tone="mono" className="pt-logo-mark" />
            </IntentPrefetchLink>
            <div className="pt-topbar-actions">
              {/* Опрос живёт всегда; колокольчик виден только на телефоне, в рейле — число у «Входящих». */}
              {accessTier === "assisted" ? (
                <PortalNotificationUpdates locale={locale} release={release} onUnreadChange={setUnread} />
              ) : null}
              {/* Тема — на виду (решение владельца 02.10): здесь на телефоне, внизу рейла на широком экране. */}
              <span className="pt-topbar-theme"><ThemeToggle locale={locale} initialTheme={theme} /></span>
              <button
                type="button"
                className="pt-rail-toggle"
                aria-expanded={!collapsed}
                aria-label={collapsed ? strings["rail.expand"] : strings["rail.collapse"]}
                title={collapsed ? strings["rail.expand"] : strings["rail.collapse"]}
                onClick={toggleRail}
              >
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <rect x="3" y="3.5" width="14" height="13" rx="2.5" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M7.5 3.5v13" stroke="currentColor" strokeWidth="1.5" />
                </svg>
              </button>
            </div>
          </header>
          {/* Смоук-якорь: aria-label не локализуется до совместного PR со смоук-скриптом. */}
          <nav
            ref={navRef}
            aria-label="Разделы кабинета"
            className="pt-nav"
            onBlur={closeWhenFocusLeaves}
          >
            <ul
              className="pt-nav-list pt-nav-bar"
              style={{ "--pt-tab-count": tabSections.length } as CSSProperties}
            >
              {tabSections.map(renderSection)}
              {moreSections.length > 0 ? (
                <li className="pt-nav-more-item">
                  <button
                    ref={toggleRef}
                    type="button"
                    className="pt-nav-more-toggle"
                    aria-expanded={moreOpen}
                    aria-controls={sheetId}
                    data-current-inside={currentInMore ? "" : undefined}
                    onClick={() => setOpenAt(moreOpen ? null : pathname)}
                  >
                    <MoreIcon />
                    <span className="pt-nav-label">{strings["nav.more"]}</span>
                  </button>
                </li>
              ) : null}
            </ul>
            {moreSections.length > 0 ? (
              <ul
                id={sheetId}
                className="pt-nav-list pt-nav-sheet"
                data-open={moreOpen ? "" : undefined}
              >
                {moreSections.map(renderSection)}
              </ul>
            ) : null}
            <span aria-hidden="true" className="pt-nav-indicator" />
          </nav>
          {/* Широкий экран: язык и карточка студента внизу рейла; на телефоне их нет. */}
          <RailFooter
            displayName={displayName}
            studyCountry={studyCountry}
            locale={locale}
            theme={theme}
            current={pathname === RAIL_ACCOUNT_HREF}
          />
        </div>

        {/*
          Существующие экраны продолжают жить в v3-мире без изменений до своих
          slice'ов — v3-world здесь сознательно, это не staff-shell.
        */}
        <div id="portal-content" tabIndex={-1} className="pt-content v3-world">
          {/* key=pathname: вход содержимого на каждой смене маршрута (portal.css, «Движение»). */}
          <div key={pathname} className="pt-route">
            {children}
          </div>
        </div>
      </div>
      <PortalStaleDeploymentNotice strings={strings} />
    </div>
  );
}
