"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, type MouseEvent, type ReactNode, type Ref } from "react";

import { Icon } from "@/components/icons";

import { modalOpen, openPopover, typingTarget } from "../queue/useQueueKeyboard";
import { SIDE_PANEL_WIDE_QUERY, sidePanelEscape, sidePanelFocusReturn, sidePanelReturnTarget } from "./side-panel";

/** Ссылка «Открыть …» шапки: запись целиком (дело, карточка лида, клиента). */
export type SidePanelOpenLink = Readonly<{ href: string; label: string; prefetch?: boolean }>;

/** Обычный щелчок: без клавиш-модификаторов, левой кнопкой (новая вкладка — по адресу). */
function plainClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

const OPEN_LINK = "inline-flex min-h-11 items-center gap-1.5 t-label text-fg-2 underline underline-offset-4 hover:text-fg";

/**
 * Первая Esc в поле панели: фокус уходит из поля на заголовок записи —
 * введённое остаётся, фокус — внутри панели, вторая Esc закрывает её.
 */
function leaveField(dialog: HTMLDialogElement | null) {
  dialog?.querySelector<HTMLElement>("[data-queue-heading]")?.focus({ preventScroll: true });
}

/**
 * Одна боковая панель записи на всех рабочих экранах (Э7): «Задачи»,
 * «Быстрый просмотр» «Студентов», «Нагрузка кураторов», «Заявки», «Отчёт
 * продаж» и панель лида «Воронки продаж». Открытая запись живёт в адресе
 * страницы (у каждой — свой прежний параметр: `?task=`, `?open=`,
 * `?coverage_curator=`, `?record=`, `?lead=`), поэтому Back и обновление
 * работают; `closeHref` — тот же адрес без неё.
 *
 * От 1280 px окна (`SIDE_PANEL_WIDE_QUERY`) — обычный `<dialog open>` второй
 * колонкой сетки (`SIDE_PANEL_SPLIT`, у доски — в ряд с колонками): список
 * виден и работает рядом. Уже — тот же `<dialog>` поднимается в модальный
 * режим (`showModal`): верхний слой, фон инертен; 768–1279 px — лист справа
 * шириной `--side-panel-width` с тем же крестиком в углу, на телефоне — во
 * весь экран с «← К …». Лист выезжает справа коротким движением (v3.css),
 * при `prefers-reduced-motion` — без него.
 *
 * Шапка одна у всех: заголовок записи `t-record-title` (получает фокус при
 * открытии — и по щелчку, и по адресу), строка контекста, «Открыть …»,
 * действия записи («⋯») и закрытие. От 768 px шапка закреплена: тело
 * прокручивается под ней, заголовок, «⋯» и крестик всегда видны; на телефоне
 * закреплена полоса «← К …». Esc — одно правило на любой ширине
 * (`sidePanelEscape`): в поле панели первая Esc выводит из поля, вторая
 * закрывает; поверх меню или окна Esc закрывает только их (и `cancel`
 * вложенного окна панель не закрывает). После закрытия фокус
 * возвращается на строку или карточку, которая была открыта (`returnTo`),
 * если человек не перевёл его сам.
 */
export function SidePanel({
  closeHref,
  onClose,
  backLabel,
  title,
  headingId: headingIdProp,
  headingRef,
  context,
  open,
  actions,
  returnTo,
  fill = false,
  testId = "queue-detail-panel",
  data,
  children,
}: Readonly<{
  /** Адрес страницы без открытой записи: закрытие и ссылка «Закрыть». */
  closeHref: string;
  /**
   * Закрыть без запроса к серверу (доска держит `?lead=` через
   * `history.pushState`). Без него закрытие — `router.push(closeHref)`.
   */
  onClose?: () => void;
  /** «К задачам» — подпись возврата на узком экране. */
  backLabel: string;
  /** Заголовок записи: имя, название задачи. Называет панель. */
  title: ReactNode;
  /** Свой id заголовка, если на него ссылается содержимое. */
  headingId?: string;
  headingRef?: Ref<HTMLHeadingElement>;
  /** Строка контекста под заголовком: кто, откуда, когда. */
  context?: ReactNode;
  /** «Открыть …» — запись целиком. */
  open?: SidePanelOpenLink | null;
  /** Действия записи рядом с заголовком («⋯»). */
  actions?: ReactNode;
  /** Селекторы строки (или карточки), куда вернуть фокус после закрытия; первый видимый. */
  returnTo?: string | readonly string[];
  /** Доска: рядом с колонками панель занимает высоту доски, а не липнет к окну. */
  fill?: boolean;
  testId?: string;
  /** `data-*` для проверок (`data-lead-id` доски). */
  data?: Readonly<Record<`data-${string}`, string>>;
  /** Тело панели; без него — только шапка (запись не найдена). */
  children?: ReactNode;
}>) {
  const router = useRouter();
  const ownHeadingId = useId();
  const headingId = headingIdProp ?? ownHeadingId;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<() => void>(() => undefined);
  const returnRef = useRef(returnTo);

  useEffect(() => {
    closeRef.current = onClose ?? (() => router.push(closeHref, { scroll: false }));
    returnRef.current = returnTo;
  });

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const media = window.matchMedia(SIDE_PANEL_WIDE_QUERY);
    const arrange = () => {
      const modal = !media.matches;
      if (dialog.open && modal === dialog.matches(":modal")) return;
      if (dialog.open) dialog.close();
      if (modal) dialog.showModal();
      else dialog.show();
    };
    arrange();
    document.getElementById(headingId)?.focus({ preventScroll: true });
    media.addEventListener("change", arrange);
    return () => media.removeEventListener("change", arrange);
  }, [headingId]);

  // Панель закрыта (или открыта другая запись): фокус, оставшийся без места
  // вместе с панелью, встаёт на строку, которая была открыта. Если человек
  // уже перевёл фокус сам — на строку списка, в меню — его не трогаем.
  useEffect(() => () => {
    if (sidePanelFocusReturn(document.activeElement, document.body)) sidePanelReturnTarget(document, returnRef.current)?.focus();
  }, []);

  // Рядом со списком (не модально) Esc — по `sidePanelEscape`, если поверх нет
  // меню или диалога: в поле панели — выйти из поля, иначе — закрыть; поле вне
  // панели не трогаем. Модальный лист ведёт его `cancel` по тому же правилу.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented || openPopover() || modalOpen()) return;
      const dialog = dialogRef.current;
      const inPanel = Boolean(dialog && event.target instanceof Node && dialog.contains(event.target));
      const step = sidePanelEscape(typingTarget(event.target), inPanel);
      if (step === "ignore") return;
      event.preventDefault();
      if (step === "leave-field") leaveField(dialog);
      else closeRef.current();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const closeClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!onClose || !plainClick(event)) return;
    event.preventDefault();
    onClose();
  };
  const wide = fill
    ? "xl:relative xl:h-full xl:max-h-none"
    : "xl:sticky xl:top-4 xl:h-auto xl:max-h-[calc(100dvh-2rem)]";

  return (
    <dialog
      ref={dialogRef}
      open
      aria-labelledby={headingId}
      data-testid={testId}
      data-side-panel=""
      {...data}
      onCancel={(event) => {
        // `cancel` окна поверх панели («Закрыть лид», «Завершить дело») React
        // доносит и сюда, по дереву компонентов: его Esc закрывает только то
        // окно — панель, её адрес и введённое остаются.
        if (event.target !== event.currentTarget) return;
        // Лист: то же правило Esc, что рядом со списком. Вторая Esc подряд без
        // действия человека приходит неотменяемой — браузер закрывает лист сам,
        // и адрес закрывается вместе с ним.
        const active = document.activeElement;
        const step = sidePanelEscape(typingTarget(active), event.currentTarget.contains(active));
        if (step === "leave-field" && event.cancelable) {
          event.preventDefault();
          leaveField(event.currentTarget);
          return;
        }
        event.preventDefault();
        closeRef.current();
      }}
      onClick={(event) => {
        // Щелчок по затемнению листа — мимо коробки диалога; по его полосе прокрутки — нет.
        const box = event.currentTarget.getBoundingClientRect();
        const outside = event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom;
        if (event.target === event.currentTarget && outside) closeRef.current();
      }}
      className={`fixed inset-0 z-50 m-0 hidden h-dvh max-h-none w-full max-w-none flex-col overflow-y-auto overscroll-contain border-0 bg-surface p-0 text-fg open:flex backdrop:bg-black/40 md:start-auto md:w-[var(--side-panel-width)] md:overflow-hidden md:border-s md:border-border md:shadow-evo-lg xl:inset-auto xl:z-auto xl:shrink-0 xl:rounded-card xl:border xl:shadow-none ${wide}`}
    >
      {/* Телефон: полоса «← К …» прилипает сверху (она и закрывает лист). От
          768 px — и на листе, и рядом со списком — та же ссылка стоит
          крестиком в углу закреплённой шапки. Одна ссылка закрытия на панель. */}
      <div className="sticky top-0 z-10 flex min-h-14 shrink-0 items-center border-b border-border bg-surface px-2 md:contents">
        <Link
          href={closeHref}
          scroll={false}
          // Закрытие без сервера (доска) адрес не предзагружает; у очередей — как раньше.
          prefetch={onClose ? false : undefined}
          onClick={closeClick}
          data-testid="queue-detail-close"
          className="inline-flex min-h-11 items-center gap-2 rounded-nav px-2 t-label text-fg-2 hover:bg-surface-2 hover:text-fg md:absolute md:end-2 md:top-2 md:z-10 md:w-11 md:justify-center md:px-0"
        >
          <Icon name="arrow-left" size={18} className="md:hidden" />
          <span className="md:hidden">{backLabel}</span>
          <span className="hidden md:block md:sr-only">Закрыть</span>
          <Icon name="x" size={20} className="hidden md:block" />
        </Link>
      </div>
      {/* От 768 px шапка не уезжает: прокручивается только тело под ней. */}
      <header className="flex shrink-0 items-start gap-1 border-b border-border py-3 ps-4 pe-2 md:pe-14" data-side-panel-header="">
        <div className="min-w-0 flex-1 space-y-1 pe-2 pt-1.5">
          <h2 ref={headingRef} id={headingId} tabIndex={-1} data-queue-heading="" className="t-record-title break-words text-fg">{title}</h2>
          {context ? <div className="t-body-compact text-fg-2" data-side-panel-context="">{context}</div> : null}
          {open ? (
            <Link href={open.href} prefetch={open.prefetch} className={OPEN_LINK} data-side-panel-open="">
              {open.label}
              <Icon name="arrow-right" size={16} />
            </Link>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center">{actions}</div> : null}
      </header>
      {children != null ? <div className="flex-1 p-4 md:min-h-0 md:overflow-y-auto md:overscroll-contain" data-side-panel-body="">{children}</div> : null}
    </dialog>
  );
}
