import type { KeyHint } from "./keyboard-keys";

/** Строки «клавиша — действие» для окон «?» очереди и оболочки. */
export function KeyList({ keys, className = "" }: Readonly<{ keys: readonly KeyHint[]; className?: string }>) {
  return (
    <dl className={`grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-1.5 ${className}`}>
      {keys.map(([combo, action]) => (
        <div key={`${combo.join("+")}:${action}`} className="contents">
          <dt className="flex gap-1 t-meta">
            {combo.map((key) => (
              <kbd key={key} className="inline-flex min-w-6 justify-center rounded-nav border border-border bg-bg px-1.5 font-mono text-fg">{key}</kbd>
            ))}
          </dt>
          <dd className="t-body-compact text-fg-2">{action}</dd>
        </div>
      ))}
    </dl>
  );
}
