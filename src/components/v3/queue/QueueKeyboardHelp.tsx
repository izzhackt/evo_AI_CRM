"use client";

import { Icon } from "@/components/icons";

import { useAnchoredPopover } from "./useAnchoredPopover";

/** Один на странице: `useQueueKeyboard` открывает его клавишей «?». */
export const QUEUE_HELP_ID = "queue-keyboard-help";

const KEYS: readonly (readonly [readonly string[], string])[] = [
  [["/"], "поиск"],
  [["↑", "↓"], "выбрать строку"],
  [["j", "k"], "то же"],
  [["Enter"], "открыть"],
  [["Esc"], "закрыть"],
];

/**
 * Сочетания клавиш очереди — в маленьком окне по кнопке «?», а не постоянным
 * текстом на странице (правило «Тихий интерфейс»).
 */
export function QueueKeyboardHelp() {
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
        aria-label="Сочетания клавиш"
        className="v3-anchored v3-anchored-end w-60 rounded-ctl border border-border bg-surface p-3 text-fg shadow-evo-lg"
      >
        <p className="t-item text-fg">Клавиши</p>
        <dl className="mt-2 grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-1.5">
          {KEYS.map(([keys, action]) => (
            <div key={keys.join("+")} className="contents">
              <dt className="flex gap-1 t-meta">
                {keys.map((key) => (
                  <kbd key={key} className="inline-flex min-w-6 justify-center rounded-nav border border-border bg-bg px-1.5 font-mono text-fg">{key}</kbd>
                ))}
              </dt>
              <dd className="t-body-compact text-fg-2">{action}</dd>
            </div>
          ))}
        </dl>
      </div>
    </>
  );
}
