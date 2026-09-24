"use client";

import { useEffect, useId, type CSSProperties } from "react";

export type AnchoredPopover = Readonly<{
  popoverId: string;
  /** id кнопки-якоря: по нему окно встаёт на место без anchor positioning. */
  triggerId: string;
  anchorName: string;
  triggerStyle: CSSProperties;
  popoverStyle: CSSProperties;
}>;

/**
 * Всплывающее окно (popover API) у своей кнопки. В браузере с CSS anchor
 * positioning место задаёт `.v3-anchored` в v3.css по имени якоря; без него
 * (старые Safari и Firefox) окно при открытии ставится под кнопку здесь, с
 * переворотом вверх и сдвигом внутрь окна у края экрана. Второе окно у той
 * же кнопки (например, «Причина переноса» у «⋯») передаёт её якорь в `anchor`.
 */
export function useAnchoredPopover(
  align: "start" | "end" = "start",
  anchor: Readonly<{ triggerId: string; anchorName: string }> | null = null,
): AnchoredPopover {
  const reactId = useId();
  const safe = reactId.replace(/[^a-zA-Z0-9_-]/gu, "");
  const popoverId = `queue-popover-${safe}`;
  const triggerId = anchor?.triggerId ?? `queue-trigger-${safe}`;
  const anchorName = anchor?.anchorName ?? `--queue-anchor-${safe}`;

  useEffect(() => {
    const popover = document.getElementById(popoverId);
    if (!popover || (typeof CSS !== "undefined" && CSS.supports("anchor-name: --queue-probe"))) return;
    const place = (event: Event) => {
      const trigger = document.getElementById(triggerId);
      if (!trigger || (event as ToggleEvent).newState !== "open") return;
      const rect = trigger.getBoundingClientRect();
      const width = popover.offsetWidth;
      const height = popover.offsetHeight;
      const left = Math.min(Math.max(8, align === "end" ? rect.right - width : rect.left), window.innerWidth - width - 8);
      const below = rect.bottom + 4;
      const top = below + height > window.innerHeight - 8 ? Math.max(8, rect.top - height - 4) : below;
      popover.style.inset = "auto";
      popover.style.margin = "0";
      popover.style.left = `${left}px`;
      popover.style.top = `${top}px`;
    };
    popover.addEventListener("toggle", place);
    return () => popover.removeEventListener("toggle", place);
  }, [align, popoverId, triggerId]);

  return {
    popoverId,
    triggerId,
    anchorName,
    triggerStyle: { anchorName } as CSSProperties,
    popoverStyle: { positionAnchor: anchorName } as CSSProperties,
  };
}
