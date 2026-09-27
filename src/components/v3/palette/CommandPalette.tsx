"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

import { Icon, type IconName } from "@/components/icons";
import type { ActivePlatformActor } from "@/lib/platform-auth";
import {
  PALETTE_MIN_QUERY,
  isPaletteShortcut,
  paletteDestinations,
  paletteMatches,
  paletteQuery,
  paletteSearchAccess,
  type PaletteGroupRead,
  type PaletteSearch,
} from "@/lib/v3/command-palette";
import { searchCommandPaletteAction } from "@/lib/v3/command-palette-actions";
import type { V3Navigation, V3NavigationLinkId } from "@/lib/v3/navigation";
import { NEXT_LINK_ICONS } from "@/lib/v3/shell-tabs";

import { openTaskComposer } from "../tasks/task-composer-context";
import { taskComposerAccess } from "../tasks/TaskComposerHost";
import { openKeyboardHelp } from "./KeyboardHelpDialog";

/** Пауза перед поиском: ввод не отправляет запрос на каждую букву. */
const SEARCH_DELAY_MS = 250;
const PALETTE_ID = "v3-command-palette";

type Option = Readonly<{
  key: string;
  label: string;
  meta: string | null;
  icon: IconName;
  /** Переход по адресу или «Создать задачу» (тот же диалог, что у меню). */
  target: Readonly<{ kind: "navigate"; href: string }> | Readonly<{ kind: "create-task" }>;
}>;
type Section = Readonly<{ key: string; label: string; options: readonly Option[] }>;
type Remote = Readonly<{ query: string; status: "loading" | "done" | "failed"; result: PaletteSearch | null }>;

let opener: (() => void) | null = null;

/** Открыть Ctrl+K кнопкой (оболочка нового облика, телефон — без клавиатуры). */
export function openCommandPalette(): boolean {
  if (!opener) return false;
  opener();
  return true;
}

/** Открыт ли другой модальный диалог (создание задачи, панель на телефоне): Ctrl+K его не перебивает. */
function otherModalOpen(): boolean {
  try {
    return [...document.querySelectorAll("dialog:modal")].some((dialog) => dialog.id !== PALETTE_ID);
  } catch { return false; }
}

function groupNote(group: PaletteGroupRead, noun: string): string | null {
  if (group.status === "unavailable") return `Не удалось найти ${noun}. Повторите поиск.`;
  if (group.status === "ready" && group.more) return `Показаны первые ${group.rows.length} — уточните запрос.`;
  return null;
}

/**
 * Ctrl+K / ⌘K (Э7): окно верхнего слоя с полем поиска. Разделы — только те,
 * что роль открывает (`buildV3Navigation`); «Создать задачу» — тот же диалог,
 * что у меню; студенты и лиды — существующими чтениями с паузы и от двух
 * символов, по тем же правам, что у страниц (`searchCommandPalette`).
 * ↑/↓ выбирают, Enter открывает, Esc закрывает и возвращает фокус туда, где
 * он был. Фокус не выходит из окна: `showModal` делает страницу инертной, а
 * Tab остаётся в поле.
 */
export function CommandPalette({ actor, navigation }: Readonly<{ actor: ActivePlatformActor; navigation: V3Navigation }>) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [remote, setRemote] = useState<Remote | null>(null);
  const sequence = useRef(0);

  function hide(restoreFocus = true) {
    sequence.current += 1;
    setOpen(false);
    dialogRef.current?.close();
    const target = returnTo.current;
    if (restoreFocus && target?.isConnected) target.focus();
  }

  useEffect(() => {
    const show = () => {
      const focused = document.activeElement;
      returnTo.current = focused instanceof HTMLElement && focused !== document.body ? focused : null;
      setQuery("");
      setActive(0);
      setRemote(null);
      setOpen(true);
    };
    const listener = (event: globalThis.KeyboardEvent) => {
      if (!isPaletteShortcut(event)) return;
      if (dialogRef.current?.open) {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
        return;
      }
      if (otherModalOpen()) return;
      event.preventDefault();
      show();
    };
    document.addEventListener("keydown", listener);
    opener = show;
    return () => {
      document.removeEventListener("keydown", listener);
      if (opener === show) opener = null;
    };
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;
    if (!dialog.open) dialog.showModal();
    inputRef.current?.focus();
  }, [open]);

  // Поиск студентов и лидов — с паузы и от двух символов; ответ прежнего запроса не показывается.
  // Роли без обеих групп сервер не спрашивают (сервер всё равно проверит права сам).
  const searchable = paletteSearchAccess(actor);
  const searchQuery = searchable.students || searchable.leads ? paletteQuery(query) : null;
  const placeholder = searchable.students && searchable.leads ? "Раздел, студент или лид"
    : searchable.students ? "Раздел или студент" : searchable.leads ? "Раздел или лид" : "Раздел или действие";
  useEffect(() => {
    if (!open || searchQuery === null) return;
    const current = ++sequence.current;
    const timer = window.setTimeout(() => {
      setRemote({ query: searchQuery, status: "loading", result: null });
      void searchCommandPaletteAction(searchQuery).then((result) => {
        if (sequence.current === current) setRemote({ query: searchQuery, status: "done", result });
      }).catch(() => {
        if (sequence.current === current) setRemote({ query: searchQuery, status: "failed", result: null });
      });
    }, SEARCH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [open, searchQuery]);

  const composer = taskComposerAccess(actor);
  const trimmed = query.trim();
  const destinations = paletteDestinations(navigation)
    .filter((destination) => paletteMatches(trimmed, destination.label, destination.group))
    .map((destination): Option => ({
      key: `nav:${destination.id}`,
      label: destination.label,
      meta: destination.group || null,
      icon: NEXT_LINK_ICONS[destination.id as V3NavigationLinkId] ?? "arrow-right",
      target: { kind: "navigate", href: destination.href },
    }));
  const actions: Option[] = (composer.staff || composer.case) && paletteMatches(trimmed, "Создать задачу", "Новая задача")
    ? [{
      key: "action:create-task",
      label: "Создать задачу",
      meta: null,
      icon: "plus",
      target: { kind: "create-task" },
    }]
    : [];
  const result = remote && searchQuery !== null && remote.query === searchQuery ? remote.result : null;
  const people = (group: PaletteGroupRead | undefined, kind: "student" | "lead"): Option[] => (group?.rows ?? []).map((row) => ({
    key: `${kind}:${row.id}`,
    label: row.label,
    meta: row.meta ?? (kind === "lead" ? "Лид" : "Дело студента"),
    icon: kind === "lead" ? "funnel" : "users",
    target: { kind: "navigate", href: row.href },
  }));
  // Разделы — сразу, люди — после паузы: пришедшие результаты встают ниже и не сдвигают выбранную строку.
  const sections: Section[] = [
    { key: "actions", label: "Действия", options: actions },
    { key: "destinations", label: "Разделы", options: destinations },
    { key: "students", label: "Студенты", options: people(result?.students, "student") },
    { key: "leads", label: "Лиды", options: people(result?.leads, "lead") },
  ].filter((section) => section.options.length > 0);
  const options = sections.flatMap((section) => section.options);
  const activeIndex = options.length ? Math.min(active, options.length - 1) : -1;
  const activeOption = activeIndex >= 0 ? options[activeIndex] : null;
  const optionId = (option: Option) => `${listId}-${option.key.replace(/[^A-Za-z0-9_-]/gu, "_")}`;

  const searching = searchQuery !== null && (remote === null || remote.query !== searchQuery || remote.status === "loading");
  const notes = result ? [groupNote(result.students, "студентов"), groupNote(result.leads, "лидов")].filter(Boolean) : [];
  const whom = searchable.students && searchable.leads ? "Студентов и лидов" : searchable.students ? "Студентов" : "Лидов";
  const status = (searchable.students || searchable.leads) && trimmed.length > 0 && trimmed.length < PALETTE_MIN_QUERY
    ? `${whom} ищем от двух символов.`
    : searching ? "Ищем…"
    : remote?.status === "failed" && remote.query === searchQuery ? "Поиск не удался. Повторите."
    : options.length === 0 ? "Ничего не найдено."
    : notes.join(" ") || null;

  function activate(option: Option) {
    if (option.target.kind === "create-task") {
      // Сначала окно закрывается и фокус возвращается: диалог задачи вернёт его туда же.
      hide();
      openTaskComposer();
      return;
    }
    hide(false);
    router.push(option.target.href);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!options.length) return;
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((activeIndex + step + options.length) % options.length);
      return;
    }
    if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      if (!activeOption) return;
      event.preventDefault();
      activate(activeOption);
      return;
    }
    // Фокус остаётся в поле: единственный элемент для Tab в окне — оно само.
    if (event.key === "Tab") {
      event.preventDefault();
      inputRef.current?.focus();
    }
  }

  useEffect(() => {
    if (!activeOption) return;
    document.getElementById(optionId(activeOption))?.scrollIntoView({ block: "nearest" });
  });

  return (
    <dialog
      ref={dialogRef}
      id={PALETTE_ID}
      aria-labelledby={titleId}
      data-testid="v3-command-palette"
      onCancel={(event) => { event.preventDefault(); hide(); }}
      onClose={() => { if (open) setOpen(false); }}
      onClick={(event) => { if (event.target === event.currentTarget) hide(); }}
      className="v3-palette mx-auto mt-[12dvh] mb-auto w-[min(40rem,calc(100vw-2rem))] max-w-none rounded-card border border-border bg-surface p-0 text-fg shadow-evo-lg backdrop:bg-black/35"
    >
      {open ? <div className="flex max-h-[70dvh] flex-col" onKeyDown={onKeyDown}>
        <h2 id={titleId} className="sr-only">Поиск и переход</h2>
        <div className="v3-palette-field flex items-center gap-2 border-b border-border px-4">
          <Icon name="search" size={18} className="shrink-0 text-fg-3" />
          <input
            ref={inputRef}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={activeOption ? optionId(activeOption) : undefined}
            aria-label={placeholder}
            placeholder={placeholder}
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="go"
            maxLength={200}
            value={query}
            onChange={(event) => { setQuery(event.target.value); setActive(0); }}
            // Фокус поля — линией под строкой поиска (v3.css), а не рамкой, которая резала бы края окна.
            className="v3-palette-input h-14 min-w-0 flex-1 bg-transparent t-body text-fg outline-none placeholder:text-fg-3"
            data-testid="v3-command-palette-input"
          />
          <button type="button" onClick={() => hide()} className="inline-flex min-h-11 shrink-0 items-center rounded-ctl px-2 t-meta text-fg-2 hover:bg-surface-2 hover:text-fg">
            {/* На телефоне клавиатуры нет — кнопка называет действие словом. */}
            <span className="md:hidden">Закрыть</span>
            <kbd className="hidden font-mono md:inline">Esc</kbd><span className="sr-only max-md:hidden"> — закрыть</span>
          </button>
        </div>
        <div id={listId} role="listbox" aria-label="Результаты" className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2" data-testid="v3-command-palette-results">
          {sections.map((section) => (
            <div key={section.key} role="group" aria-labelledby={`${listId}-${section.key}`} className="py-1" data-palette-group={section.key}>
              <p id={`${listId}-${section.key}`} role="presentation" className="px-3 py-1.5 t-caption text-fg-3">{section.label}</p>
              {section.options.map((option) => {
                const selected = option === activeOption;
                return (
                  <div
                    key={option.key}
                    id={optionId(option)}
                    role="option"
                    aria-selected={selected}
                    data-palette-option={option.key}
                    onPointerMove={() => { const index = options.indexOf(option); if (index !== activeIndex) setActive(index); }}
                    // Нажатие не уводит фокус из поля: выбор — по отпусканию.
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => activate(option)}
                    className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-nav px-3 py-1.5 ${selected ? "bg-surface-2 text-fg" : "text-fg-2"}`}
                  >
                    <Icon name={option.icon} size={18} className="shrink-0 text-fg-3" />
                    <span className="min-w-0 flex-1 truncate t-item text-fg">{option.label}</span>
                    {option.meta ? <span className="max-w-[45%] shrink-0 truncate t-meta text-fg-2">{option.meta}</span> : null}
                    {selected ? <Icon name="arrow-right" size={16} className="shrink-0 text-fg-3" /> : null}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border px-4 py-2">
          <p role="status" aria-live="polite" className="min-w-0 flex-1 t-meta text-fg-2" data-testid="v3-command-palette-status">{status}</p>
          <button type="button" onClick={() => { hide(); openKeyboardHelp(); }} className="hidden min-h-11 items-center gap-1.5 rounded-ctl px-2 t-meta text-fg-2 hover:bg-surface-2 hover:text-fg md:inline-flex">
            <kbd className="inline-flex min-w-6 justify-center rounded-nav border border-border bg-bg px-1.5 font-mono text-fg">?</kbd>
            Все клавиши
          </button>
        </div>
      </div> : null}
    </dialog>
  );
}
