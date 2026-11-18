/** Отступ экрана вокруг окна QR и внутренний отступ белой карточки (по 16 с каждой стороны). */
const SCREEN_PAD = 16;
const CARD_PAD = 16;

/**
 * Сторона QR в окне «На весь экран»: квадрат, всегда целиком внутри белой карточки
 * с равными полями (ширина экрана − два отступа экрана − два внутренних отступа).
 */
export function fullQrSize(windowWidth: number): number {
  return Math.max(0, Math.min(560, windowWidth - 2 * SCREEN_PAD - 2 * CARD_PAD));
}

export const FULL_QR_CARD_PAD = CARD_PAD;
