// Масштаб и сдвиг страницы в крупном просмотре «Примера»: чистая математика без React и нативных модулей
// (жесты и анимация - в ZoomableScan.tsx). Координаты точек отсчитываются от ЦЕНТРА рамки просмотра.
// Вид страницы: `scale` и сдвиг `x`, `y` её центра от центра рамки (в пикселях рамки).

export type Size = Readonly<{ width: number; height: number }>;
export type Point = Readonly<{ x: number; y: number }>;
export type ZoomView = Readonly<{ scale: number; x: number; y: number }>;

export const FULL_VIEW: ZoomView = Object.freeze({ scale: 1, x: 0, y: 0 });
export const MAX_SCALE = 4;
export const DOUBLE_TAP_SCALE = 2.5;
/** Ниже этого масштаба страница считается «целой»: жест пальцем листает, а не двигает. */
export const WHOLE_EPSILON = 0.02;
/** Сдвиг пальца по горизонтали, с которого он листает страницу (pt), и быстрый взмах (pt/мс). */
export const SWIPE_DISTANCE = 56;
export const SWIPE_VELOCITY = 0.5;

const clamp = (value: number, low: number, high: number): number => Math.min(Math.max(value, low), high);

/** «Вписать»: самый большой размер с пропорциями `aspect` (ширина / высота), который помещается в рамку. */
export function fitContain(aspect: number, box: Size): Size {
  const ratio = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const width = Math.max(0, box.width);
  const height = Math.max(0, box.height);
  if (width === 0 || height === 0) return { width: 0, height: 0 };
  const byWidth = { width, height: width / ratio };
  return byWidth.height <= height ? byWidth : { width: height * ratio, height };
}

/** Насколько страницу можно сдвинуть при масштабе `scale`: пока она не больше рамки по оси, сдвига нет. */
export function maxOffset(content: Size, frame: Size, scale: number): Point {
  return {
    x: Math.max(0, (content.width * scale - frame.width) / 2),
    y: Math.max(0, (content.height * scale - frame.height) / 2),
  };
}

/** Привести вид к допустимому: масштаб от 1 до MAX_SCALE, страница не уезжает от краёв рамки. */
export function clampView(view: ZoomView, content: Size, frame: Size): ZoomView {
  const scale = clamp(Number.isFinite(view.scale) ? view.scale : 1, 1, MAX_SCALE);
  const limit = maxOffset(content, frame, scale);
  const finite = (value: number) => (Number.isFinite(value) ? value : 0);
  return { scale, x: clamp(finite(view.x), -limit.x, limit.x), y: clamp(finite(view.y), -limit.y, limit.y) };
}

/**
 * Щипок. Пальцы раздвинулись в `ratio` раз относительно начала жеста; точка страницы, что была под серединой пальцев в
 * начале (`startMid`), остаётся под текущей серединой (`mid`) - масштаб идёт вокруг пальцев, а не вокруг центра.
 */
export function pinchView(start: ZoomView, ratio: number, startMid: Point, mid: Point, content: Size, frame: Size): ZoomView {
  const scale = clamp(start.scale * (Number.isFinite(ratio) && ratio > 0 ? ratio : 1), 1, MAX_SCALE);
  // точка страницы под начальной серединой, в координатах страницы без масштаба (от её центра)
  const anchor = { x: (startMid.x - start.x) / start.scale, y: (startMid.y - start.y) / start.scale };
  return clampView({ scale, x: mid.x - anchor.x * scale, y: mid.y - anchor.y * scale }, content, frame);
}

/** Двойное касание: целая страница приближается к точке касания, приближенная возвращается целой. */
export function doubleTapView(current: ZoomView, at: Point, content: Size, frame: Size): ZoomView {
  if (current.scale > 1 + WHOLE_EPSILON) return FULL_VIEW;
  return clampView({ scale: DOUBLE_TAP_SCALE, x: at.x * (1 - DOUBLE_TAP_SCALE), y: at.y * (1 - DOUBLE_TAP_SCALE) }, content, frame);
}

/** Страница целиком (масштаб 1): палец листает, а не двигает картинку. */
export function isWhole(view: ZoomView): boolean {
  return view.scale <= 1 + WHOLE_EPSILON;
}

/**
 * Что значит отпущенный горизонтальный жест над целой страницей: -1 - предыдущая, 1 - следующая, 0 - остаться.
 * Палец влево (dx < 0) - следующая, как в галерее. Вертикальный жест не листает.
 */
export function swipeStep(dx: number, dy: number, velocityX: number): -1 | 0 | 1 {
  if (Math.abs(dx) <= Math.abs(dy) * 1.2) return 0;
  const far = Math.abs(dx) >= SWIPE_DISTANCE;
  const fast = Math.abs(velocityX) >= SWIPE_VELOCITY && Math.abs(dx) >= SWIPE_DISTANCE / 3;
  if (!far && !fast) return 0;
  return dx < 0 ? 1 : -1;
}
