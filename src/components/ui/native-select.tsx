import * as React from "react";
import { ChevronDownIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Выбор из списка для форм с серверными действиями: настоящий `<select>` (значение уходит в `FormData` как есть),
 * вид поля `Input` — 44 px, граница `--control-edge`, 16 px. Radix `Select` (`ui/select`) — для выбора, который
 * обрабатывает клиентский код; здесь форма отправляется на сервер, и скрытый дубль Radix был бы лишним.
 */
function NativeSelect({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <div className="relative min-w-0" data-slot="native-select-wrapper">
      <select
        data-slot="native-select"
        className={cn(
          "h-11 w-full min-w-0 appearance-none rounded-ctl border border-input bg-surface pr-9 pl-3 text-base text-fg transition-[border-color,background-color] duration-150 ease-out hover:bg-surface-2 disabled:cursor-not-allowed disabled:border-border disabled:bg-surface-2 disabled:text-fg-3 aria-invalid:border-danger motion-reduce:transition-none",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDownIcon className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-fg-3" aria-hidden="true" />
    </div>
  );
}

export { NativeSelect };
