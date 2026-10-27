"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useTransition, type ButtonHTMLAttributes } from "react";

import { setNextUiAction } from "@/lib/ui-next-actions";
import { cn } from "@/components/ui";

/**
 * Переключатель «Новый вид» в меню аккаунта оболочки — только настоящему администратору (layout `(v3)` передаёт
 * его, когда `canUseNextUi`). Это строка-переключатель (`role="switch"`), а не примитив набора: она стоит в
 * оболочке и должна работать и тогда, когда токены нового вида ещё не включены. Нажатие пишет cookie
 * действием `setNextUiAction`, которое возвращает на эту же страницу, и она перерисовывается.
 */
export function NextUiToggle({
  enabled,
  rail = false,
  hint = {},
}: Readonly<{
  enabled: boolean;
  /** Рейка 64 px у досок: только переключатель, подпись — для читалки. */
  rail?: boolean;
  /** Подсказка рейки: те же обработчики, что у соседних кнопок оболочки. */
  hint?: Pick<ButtonHTMLAttributes<HTMLButtonElement>, "onPointerEnter" | "onPointerLeave" | "onFocus" | "onBlur">;
}>) {
  const pathname = usePathname();
  const query = useSearchParams().toString();
  const [pending, start] = useTransition();
  const returnTo = query ? `${pathname}?${query}` : pathname;

  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      disabled={pending}
      data-testid="next-ui-toggle"
      onClick={() => start(() => setNextUiAction(!enabled, returnTo))}
      className={cn(
        "flex min-h-11 w-full min-w-0 items-center gap-3 rounded-nav px-3 t-body-compact text-fg-2 transition-colors hover:bg-surface-2 hover:text-fg disabled:cursor-wait disabled:text-fg-3",
        rail && "md:max-2xl:justify-center md:max-2xl:px-0",
      )}
      {...hint}
    >
      <span
        aria-hidden="true"
        className={cn(
          "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors motion-reduce:transition-none",
          enabled ? "border-fg bg-fg" : "border-control-edge bg-surface-3",
        )}
      >
        <span className={cn("block size-5 rounded-full bg-surface shadow-evo transition-transform motion-reduce:transition-none", enabled ? "translate-x-5" : "translate-x-0.5")} />
      </span>
      <span className={cn("min-w-0 truncate", rail && "md:max-2xl:sr-only")}>Новый вид</span>
    </button>
  );
}
