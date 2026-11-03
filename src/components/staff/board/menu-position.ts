/**
 * Где встать всплывающему меню в top layer. Меню живёт в верхнем слое
 * (popover API) и позиционируется `position: fixed` относительно окна, поэтому
 * его не обрезают колонка доски или прокручиваемая рейка меню.
 *
 * Чистая функция без DOM: те же правила использует статический рендер досок,
 * чтобы снимок открытого меню показывал настоящую раскладку.
 */
export type MenuPlacement = "bottom-end" | "right-start";

type Box = Readonly<{ top: number; left: number; right: number; bottom: number }>;
type Size = Readonly<{ width: number; height: number }>;

export type MenuPosition = Readonly<{ top: number; left: number; maxHeight: number }>;

const GAP = 4;
const SIDE_GAP = 8;
const MARGIN = 8;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

export function placeMenu(trigger: Box, menu: Size, viewport: Size, placement: MenuPlacement): MenuPosition {
  const maxHeight = Math.max(0, viewport.height - MARGIN * 2);
  const height = Math.min(menu.height, maxHeight);
  const lastTop = viewport.height - MARGIN - height;
  const lastLeft = viewport.width - MARGIN - menu.width;

  if (placement === "right-start") {
    const right = trigger.right + SIDE_GAP;
    const left = right + menu.width <= viewport.width - MARGIN ? right : trigger.left - SIDE_GAP - menu.width;
    return { top: clamp(trigger.top, MARGIN, lastTop), left: clamp(left, MARGIN, lastLeft), maxHeight };
  }

  const below = trigger.bottom + GAP;
  const above = trigger.top - GAP - height;
  const top = below + height <= viewport.height - MARGIN ? below : above >= MARGIN ? above : clamp(below, MARGIN, lastTop);
  return { top, left: clamp(trigger.right - menu.width, MARGIN, lastLeft), maxHeight };
}
