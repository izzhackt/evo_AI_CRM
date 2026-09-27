"use client";

import type { ButtonHTMLAttributes, MouseEvent } from "react";

import { Icon } from "@/components/icons";
import type { ActivePlatformActor } from "@/lib/platform-auth";
import type { V3Navigation } from "@/lib/v3/navigation";

import { openTaskComposer } from "../tasks/task-composer-context";
import { TaskComposerHost } from "../tasks/TaskComposerHost";
import { CommandPalette, openCommandPalette } from "./CommandPalette";
import { KeyboardHelpDialog } from "./KeyboardHelpDialog";

/**
 * Общие окна оболочки (Э7), одни в обоих обликах: диалог «Новая задача» для
 * «Создать задачу» и Ctrl+K, сам Ctrl+K и окно «?». Все три — в верхнем
 * слое и в DOM один раз.
 */
export function ShellCommands({ actor, navigation }: Readonly<{ actor: ActivePlatformActor; navigation: V3Navigation }>) {
  return (
    <>
      <TaskComposerHost actor={actor} />
      <CommandPalette actor={actor} navigation={navigation} />
      <KeyboardHelpDialog />
    </>
  );
}

/**
 * «Создать задачу» оболочки остаётся ссылкой на `/v3/tasks?create=staff`
 * (новая вкладка и страница без скрипта — прежний путь), а обычное нажатие
 * открывает тот же диалог на месте, с контекстом страницы. Нет диалога
 * оболочки — прежний переход с новым намерением открыть диалог.
 */
export function onCreateTaskClick(
  event: MouseEvent<HTMLAnchorElement>,
  fallback: () => void,
  returnFocus: HTMLElement | null = null,
  before: () => void = () => {},
): void {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  before();
  if (!openTaskComposer(undefined, returnFocus)) fallback();
}

/**
 * Кнопка Ctrl+K для мыши и телефона: тот же поиск, что по клавишам. В
 * верхней панели прежнего облика — «Поиск» рядом с «Создать задачу»; в меню
 * нового облика — строка «Поиск» с подсказкой клавиш (`menu`), в рейке —
 * только значок.
 */
export function PaletteButton({ className, label = false, shortcutClassName = null, labelClassName, hint }: Readonly<{
  className: string;
  label?: boolean;
  /** Подсказка «Ctrl K» справа (классы видимости) — в строке меню на компьютере; null — без неё. */
  shortcutClassName?: string | null;
  labelClassName?: string;
  /** Подсказка рейки (подпись при наведении и фокусе). */
  hint?: Pick<ButtonHTMLAttributes<HTMLButtonElement>, "onPointerEnter" | "onPointerLeave" | "onFocus" | "onBlur">;
}>) {
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      aria-label="Поиск и переход"
      title="Поиск и переход · Ctrl+K"
      onClick={() => openCommandPalette()}
      className={className}
      data-testid="v3-palette-trigger"
      {...hint}
    >
      <Icon name="search" size={18} className="shrink-0" />
      {label ? <span className={labelClassName ?? "hidden sm:inline"}>Поиск</span> : null}
      {shortcutClassName !== null ? <kbd aria-hidden="true" className={`ms-auto rounded-nav border border-border bg-bg px-1.5 font-mono t-meta text-fg-2 ${shortcutClassName}`}>Ctrl K</kbd> : null}
    </button>
  );
}
