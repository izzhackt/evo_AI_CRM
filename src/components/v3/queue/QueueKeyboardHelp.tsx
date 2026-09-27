"use client";

import { Icon } from "@/components/icons";

import { KeyList } from "./KeyList";
import { PALETTE_KEY, PALETTE_MAC_KEY, QUEUE_KEYS, type KeyHint } from "./keyboard-keys";
import { useAnchoredPopover } from "./useAnchoredPopover";

/** Один на странице: `useQueueKeyboard` открывает его клавишей «?». */
export const QUEUE_HELP_ID = "queue-keyboard-help";

export type QueueKey = KeyHint;

/**
 * Сочетания клавиш очереди — в маленьком окне по кнопке «?», а не постоянным
 * текстом на странице (правило «Тихий интерфейс»). Свои клавиши страницы
 * (`extra`: Shift+Enter, x) — перед Ctrl+K, который работает везде (Э7).
 */
export function QueueKeyboardHelp({ extra = [] }: Readonly<{ extra?: readonly QueueKey[] }> = {}) {
  const { triggerId, triggerStyle, popoverStyle } = useAnchoredPopover("end");
  return (
    <>
      <button
        id={triggerId}
        type="button"
        popoverTarget={QUEUE_HELP_ID}
        style={triggerStyle}
        aria-label="Сочетания клавиш"
        title="Сочетания клавиш"
        className="hidden min-h-11 w-11 shrink-0 items-center justify-center rounded-ctl text-fg-3 hover:bg-surface-2 hover:text-fg md:inline-flex"
      >
        <Icon name="help-circle" size={20} />
      </button>
      <div
        id={QUEUE_HELP_ID}
        popover="auto"
        style={popoverStyle}
        role="dialog"
        aria-label="Сочетания клавиш"
        className="v3-anchored v3-anchored-end w-72 rounded-ctl border border-border bg-surface p-3 text-fg shadow-evo-lg"
      >
        <p className="t-item text-fg">Клавиши</p>
        <KeyList keys={[...QUEUE_KEYS, ...extra, PALETTE_KEY, PALETTE_MAC_KEY]} className="mt-2" />
      </div>
    </>
  );
}
