// Жесты крупного просмотра как автомат без React и без нативных модулей (ZoomableScan.tsx лишь передаёт ему касания):
//  - два пальца: щипок вокруг пальцев; - один палец по приближенной странице: сдвиг в пределах рамки;
//  - один палец по целой странице: листание (влево - следующая) со следом за пальцем и возвратом;
//  - два быстрых касания: приближение к точке или возврат к целой странице.
// Точки касаний - в координатах рамки просмотра (от её угла): их считает ZoomableScan.tsx по `pageX/pageY` всех пальцев,
// поэтому палец может быть и вне рамки (на поле карточки): точка тогда с отрицательной координатой или больше размера рамки.
import { clampView, doubleTapView, FULL_VIEW, isWhole, pinchView, swipeStep, type Point, type Size, type ZoomView } from "@/features/documents/zoom-math";

export type Touch = Readonly<{ x: number; y: number }>;

/** Касание короче и неподвижнее этого - не жест, а «тап»; два тапа подряд - двойное касание. */
const TAP_MS = 300;
const TAP_SLOP = 10;
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_SLOP = 40;
/** След за пальцем при листании: страница едва заметно тянется, но не уезжает. */
const FOLLOW = 0.4;

export type ZoomHooks = Readonly<{
  /** Новый вид страницы. `animated`: плавно (отпускание, двойное касание); иначе следом за пальцами. */
  onView: (view: ZoomView, animated: boolean) => void;
  /** Лист на соседнюю страницу набора: -1 предыдущая, 1 следующая. */
  onStep: (step: -1 | 1) => void;
}>;

const distance = (a: Touch, b: Touch) => Math.hypot(a.x - b.x, a.y - b.y);
const middle = (a: Touch, b: Touch): Touch => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

export class ZoomController {
  private view: ZoomView = FULL_VIEW;
  private start: ZoomView = FULL_VIEW;
  private startTouches: readonly Touch[] = [];
  private last: readonly Touch[] = [];
  private count = 0;
  private startedAt = 0;
  private firstPoint: Touch = { x: 0, y: 0 };
  private moved = 0;
  private lastTap: Readonly<{ at: number; point: Touch }> | null = null;

  private onStep: (step: -1 | 1) => void;

  constructor(
    private content: Size,
    private frame: Size,
    private readonly hooks: ZoomHooks,
  ) {
    this.onStep = hooks.onStep;
  }

  /** Экран перерисовался - автомат остаётся (приближение не сбрасывается), лист по движению пальца идёт в актуальный обработчик. */
  setOnStep(handler: (step: -1 | 1) => void): void {
    this.onStep = handler;
  }

  /**
   * Рамка или страница стали другого размера (поворот, смена размера шрифта, окно): прежний сдвиг прижимается к новым
   * границам, и если вид изменился, о нём узнаёт экран, чтобы картинка и автомат не расходились. Тот же размер - ничего.
   */
  setBounds(content: Size, frame: Size): void {
    const same = content.width === this.content.width && content.height === this.content.height && frame.width === this.frame.width && frame.height === this.frame.height;
    if (same) return;
    this.content = content;
    this.frame = frame;
    this.start = clampView(this.start, content, frame);
    const next = clampView(this.view, content, frame);
    if (next.scale === this.view.scale && next.x === this.view.x && next.y === this.view.y) return;
    this.view = next;
    this.hooks.onView(next, false);
  }

  /** Нынешний вид (после жеста). */
  getView(): ZoomView {
    return this.view;
  }

  private center(point: Touch): Point {
    return { x: point.x - this.frame.width / 2, y: point.y - this.frame.height / 2 };
  }

  /** Новая точка отсчёта: палец добавился или ушёл - жест продолжается с нынешнего вида. */
  private rebase(touches: readonly Touch[]): void {
    this.count = touches.length;
    this.start = this.view;
    this.startTouches = touches;
    this.last = touches;
  }

  grant(touches: readonly Touch[], time: number): void {
    this.rebase(touches);
    this.startedAt = time;
    this.firstPoint = touches[0] ?? { x: 0, y: 0 };
    this.moved = 0;
  }

  move(touches: readonly Touch[]): void {
    if (touches.length === 0) return;
    if (touches.length !== this.count) {
      this.rebase(touches);
      // палец добавили или убрали: уже не «тап»
      this.moved = Math.max(this.moved, TAP_SLOP + 1);
    }
    this.last = touches;
    const [a, b] = touches;
    if (a && distance(a, this.firstPoint) > this.moved) this.moved = distance(a, this.firstPoint);
    if (a && b) {
      const [s0, s1] = this.startTouches;
      const startDistance = s0 && s1 ? distance(s0, s1) : 0;
      if (startDistance < 1) return;
      const next = pinchView(this.start, distance(a, b) / startDistance, this.center(middle(s0!, s1!)), this.center(middle(a, b)), this.content, this.frame);
      this.view = next;
      this.hooks.onView(next, false);
      return;
    }
    const s0 = this.startTouches[0];
    if (!a || !s0) return;
    const dx = a.x - s0.x;
    const dy = a.y - s0.y;
    if (!isWhole(this.start)) {
      const next = clampView({ scale: this.start.scale, x: this.start.x + dx, y: this.start.y + dy }, this.content, this.frame);
      this.view = next;
      this.hooks.onView(next, false);
    } else if (Math.abs(dx) > Math.abs(dy)) {
      this.hooks.onView({ scale: 1, x: dx * FOLLOW, y: 0 }, false);
    }
  }

  release(time: number): void {
    const first = this.last[0];
    const wasSingle = this.count === 1;
    const dx = first ? first.x - this.startTouches[0]!.x : 0;
    const dy = first ? first.y - this.startTouches[0]!.y : 0;
    const elapsed = Math.max(1, time - this.startedAt);
    const isTap = wasSingle && this.moved <= TAP_SLOP && elapsed <= TAP_MS;
    this.count = 0;
    if (isTap) {
      const previous = this.lastTap;
      if (previous && time - previous.at <= DOUBLE_TAP_MS && distance(previous.point, this.firstPoint) <= DOUBLE_TAP_SLOP) {
        this.lastTap = null;
        this.view = doubleTapView(this.view, this.center(this.firstPoint), this.content, this.frame);
        this.hooks.onView(this.view, true);
        return;
      }
      this.lastTap = { at: time, point: this.firstPoint };
      this.hooks.onView(this.view, true);
      return;
    }
    this.lastTap = null;
    if (wasSingle && isWhole(this.start)) {
      const step = swipeStep(dx, dy, dx / elapsed);
      this.view = FULL_VIEW;
      this.hooks.onView(FULL_VIEW, step === 0);
      if (step !== 0) this.onStep(step);
      return;
    }
    // щипок или сдвиг закончился: вернуть в допустимое, у «почти целой» страницы - целый вид
    const settled = clampView(this.view, this.content, this.frame);
    this.view = isWhole(settled) ? FULL_VIEW : settled;
    this.hooks.onView(this.view, true);
  }

  /** Касание отобрали (звонок, системный жест): вернуть вид, который был зафиксирован. */
  cancel(): void {
    this.count = 0;
    this.view = clampView(this.view, this.content, this.frame);
    this.hooks.onView(this.view, true);
  }
}
