"use client";

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";

import { Icon } from "@/components/icons";
import { caseMoneyWords } from "@/lib/v3/wording";

import { useAnchoredPopover } from "../queue/useAnchoredPopover";
import { CASE_MONEY_ROW_ACTION, type CaseMoneyPanelEntry } from "./case-money-view";

type Focus = "heading" | "return" | null;
type OpenState = Readonly<{ open: string | null; focus: Focus; target: string | null }>;
type CaseMoneyApi = Readonly<{ open: string | null; show: (id: string, opener: HTMLElement | null) => void; hide: () => void }>;

const CaseMoneyContext = createContext<CaseMoneyApi | null>(null);

const MENU_ITEM = "flex min-h-11 w-full items-center rounded-nav px-3 text-start t-label text-fg-2 hover:bg-surface-2 hover:text-fg";
const CLOSE = "inline-flex min-h-11 items-center gap-1.5 rounded-nav px-2 t-label text-fg-2 hover:bg-surface-2 hover:text-fg";

/**
 * «Договор и оплата» (Э8.3): белый лист со сводкой строками; редкое —
 * подготовка договора по шаблону, обязательства, стопы, дополнительные
 * операции и служебные сведения — панели, которые открывает «⋯» заголовка
 * (одна за раз, под сводкой). Панели рисует сервер (`CaseMoneyPanel`), здесь
 * только какая открыта. Адрес с якорем внутри панели (`#contract-workflow`
 * после операции договора, `#money-stops`) открывает её при загрузке и при
 * смене якоря; фокус — на заголовок панели, «Закрыть» возвращает его туда,
 * откуда панель открыли.
 *
 * `contractCaseId` — дело, чей раздел договора виден этому сотруднику: тогда
 * лист несёт прежний `data-testid="v3-profile-contract-workspace"` с id дела
 * (его ждёт видимым проверка выпуска `scripts/evo-production-browser-smoke.mjs`).
 */
export function CaseMoneySection({
  panels,
  contractCaseId,
  children,
}: Readonly<{
  panels: readonly CaseMoneyPanelEntry[];
  contractCaseId: string | null;
  children: ReactNode;
}>) {
  const headingId = useId();
  const sectionRef = useRef<HTMLElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const menu = useAnchoredPopover("end");
  const [state, setState] = useState<OpenState>({ open: null, focus: null, target: null });

  const show = useCallback((id: string, from: HTMLElement | null) => {
    opener.current = from;
    setState({ open: id, focus: "heading", target: null });
  }, []);
  const hide = useCallback(() => setState({ open: null, focus: "return", target: null }), []);
  const api = useMemo<CaseMoneyApi>(() => ({ open: state.open, show, hide }), [state.open, show, hide]);

  // Якорь адреса внутри панели открывает её: при загрузке и при смене якоря.
  useEffect(() => {
    const sync = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (!id) return;
      const panel = document.getElementById(id)?.closest<HTMLElement>("[data-money-panel]");
      if (!panel || !sectionRef.current?.contains(panel)) return;
      opener.current = null;
      setState({ open: panel.id, focus: "heading", target: id });
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  useEffect(() => {
    if (state.focus === "heading" && state.open) {
      const panel = document.getElementById(state.open);
      const target = state.target && state.target !== state.open ? document.getElementById(state.target) : null;
      // Ссылка панели на свёрнутый раздел («Создать версию шаблона») раскрывает его.
      const section = target instanceof HTMLDetailsElement ? target : null;
      if (section) section.open = true;
      (target ?? panel)?.scrollIntoView({ block: "start" });
      (section?.querySelector<HTMLElement>(":scope > summary") ?? panel?.querySelector<HTMLElement>("[data-money-panel-heading]"))
        ?.focus({ preventScroll: true });
    } else if (state.focus === "return") {
      const from = opener.current;
      const back = from && from.isConnected && from.getClientRects().length > 0 ? from : document.getElementById(menu.triggerId);
      back?.focus();
    }
  }, [state, menu.triggerId]);

  const closeMenu = () => document.getElementById(menu.popoverId)?.hidePopover();
  return (
    <section
      ref={sectionRef}
      aria-labelledby={headingId}
      data-case-money=""
      data-testid={contractCaseId ? "v3-profile-contract-workspace" : undefined}
      data-student-case-id={contractCaseId ?? undefined}
      className="@container min-w-0 rounded-card border border-border bg-surface"
    >
      <header className="flex min-h-12 items-center justify-between gap-3 border-b border-border py-1 ps-4 pe-1">
        <h2 id={headingId} className="t-section text-fg">{caseMoneyWords.title}</h2>
        {panels.length > 0 ? (
          <>
            <button
              id={menu.triggerId}
              type="button"
              popoverTarget={menu.popoverId}
              style={menu.triggerStyle}
              aria-label={caseMoneyWords.more}
              data-testid="v3-case-money-more"
              className="grid size-11 shrink-0 place-items-center rounded-nav text-fg-2 hover:bg-surface-2 hover:text-fg"
            >
              <Icon name="more-horizontal" size={20} />
            </button>
            <div
              id={menu.popoverId}
              popover="auto"
              style={menu.popoverStyle}
              role="group"
              aria-label={caseMoneyWords.more}
              className="v3-anchored v3-anchored-end w-80 max-w-[calc(100vw-2rem)] rounded-ctl border border-border bg-surface p-1 text-fg shadow-evo-lg"
            >
              {panels.map((panel) => (
                <button
                  key={panel.id}
                  type="button"
                  aria-pressed={state.open === panel.id}
                  className={MENU_ITEM}
                  onClick={() => { closeMenu(); show(panel.id, null); }}
                >
                  {panel.label}
                </button>
              ))}
            </div>
          </>
        ) : null}
      </header>
      <CaseMoneyContext.Provider value={api}>
        <div className="px-4 pb-4 pt-1">{children}</div>
      </CaseMoneyContext.Provider>
    </section>
  );
}

/**
 * Панель вкладки: открыта, только когда её выбрали в «⋯» или адрес указывает
 * внутрь неё. Вне листа (`CaseMoneySection`) открыта всегда — содержимое не
 * теряется. Заголовок получает фокус при открытии.
 */
export function CaseMoneyPanel({
  id,
  label,
  children,
}: Readonly<{ id: string; label: string; children: ReactNode }>) {
  const money = useContext(CaseMoneyContext);
  const shown = money === null || money.open === id;
  return (
    <section id={id} data-money-panel="" hidden={!shown} aria-labelledby={`${id}-title`} className="mt-4 scroll-mt-20 border-t border-border pt-1">
      <div className="flex min-h-12 items-center justify-between gap-3">
        <h3 id={`${id}-title`} tabIndex={-1} data-money-panel-heading="" className="t-section text-fg">{label}</h3>
        {money ? (
          <button type="button" onClick={money.hide} className={CLOSE}>
            <Icon name="x" size={18} />
            {caseMoneyWords.close}
          </button>
        ) : null}
      </div>
      <div className="pt-1">{children}</div>
    </section>
  );
}

/** Действие строки сводки, которое открывает свою панель («Стопы» у финансового стопа). */
export function CaseMoneyOpen({ panel, children }: Readonly<{ panel: string; children: ReactNode }>) {
  const money = useContext(CaseMoneyContext);
  if (money === null) return null;
  return (
    <button
      type="button"
      className={CASE_MONEY_ROW_ACTION}
      onClick={(event: MouseEvent<HTMLButtonElement>) => money.show(panel, event.currentTarget)}
    >
      {children}
    </button>
  );
}
