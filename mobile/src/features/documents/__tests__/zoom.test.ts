import { ZoomController, type Touch } from "@/features/documents/zoom-controller";
import {
  clampView,
  doubleTapView,
  DOUBLE_TAP_SCALE,
  fitContain,
  FULL_VIEW,
  isWhole,
  MAX_SCALE,
  maxOffset,
  pinchView,
  swipeStep,
  SWIPE_DISTANCE,
  type ZoomView,
} from "@/features/documents/zoom-math";

const FRAME = { width: 300, height: 400 };
const CONTENT = { width: 240, height: 340 };
/** Где страница стоит на экране: сдвиг + масштаб от центра (точка страницы p -> x + p * scale). */
const screenOf = (view: ZoomView, page: { x: number; y: number }) => ({ x: view.x + page.x * view.scale, y: view.y + page.y * view.scale });

describe("вписать страницу в рамку", () => {
  it("ширина ограничивает альбомную страницу, высота - книжную", () => {
    expect(fitContain(1.4, { width: 300, height: 400 })).toEqual({ width: 300, height: 300 / 1.4 });
    const portrait = fitContain(0.7, { width: 300, height: 400 });
    expect(portrait.height).toBe(400);
    expect(portrait.width).toBeCloseTo(280, 5);
  });
  it("пропорции неизвестны или рамка пустая - не ломается", () => {
    expect(fitContain(Number.NaN, { width: 100, height: 100 })).toEqual({ width: 100, height: 100 });
    expect(fitContain(0, { width: 100, height: 50 })).toEqual({ width: 50, height: 50 });
    expect(fitContain(1.5, { width: 0, height: 100 })).toEqual({ width: 0, height: 0 });
    expect(fitContain(1.5, { width: -5, height: 100 })).toEqual({ width: 0, height: 0 });
  });
});

describe("границы сдвига", () => {
  it("целая страница в рамке не двигается; приближенная - на половину выступа", () => {
    expect(maxOffset(CONTENT, FRAME, 1)).toEqual({ x: 0, y: 0 });
    expect(maxOffset(CONTENT, FRAME, 2)).toEqual({ x: (240 * 2 - 300) / 2, y: (340 * 2 - 400) / 2 });
  });
  it("clampView: масштаб от 1 до MAX_SCALE, страница не уезжает за край, мусор не проходит", () => {
    expect(clampView({ scale: 0.3, x: 50, y: 50 }, CONTENT, FRAME)).toEqual(FULL_VIEW);
    expect(clampView({ scale: 99, x: 0, y: 0 }, CONTENT, FRAME).scale).toBe(MAX_SCALE);
    const limit = maxOffset(CONTENT, FRAME, 2);
    expect(clampView({ scale: 2, x: 9999, y: -9999 }, CONTENT, FRAME)).toEqual({ scale: 2, x: limit.x, y: -limit.y });
    expect(clampView({ scale: Number.NaN, x: Number.NaN, y: Number.POSITIVE_INFINITY }, CONTENT, FRAME)).toEqual({ scale: 1, x: 0, y: 0 });
  });
});

describe("щипок", () => {
  const big = { width: 1000, height: 1000 };
  it("точка страницы под серединой пальцев остаётся под ними (масштаб идёт вокруг пальцев)", () => {
    const startMid = { x: 40, y: -30 };
    const view = pinchView(FULL_VIEW, 2, startMid, startMid, big, big);
    expect(view.scale).toBe(2);
    expect(screenOf(view, startMid)).toEqual(startMid);
    // пальцы сдвинулись вместе: страница едет за ними
    const mid = { x: 60, y: -10 };
    const moved = pinchView(FULL_VIEW, 2, startMid, mid, big, big);
    expect(screenOf(moved, startMid)).toEqual(mid);
  });
  it("от уже приближенного вида: прежняя точка под пальцами тоже держится", () => {
    const start: ZoomView = { scale: 1.5, x: -20, y: 10 };
    const startMid = { x: 10, y: 10 };
    const page = { x: (startMid.x - start.x) / start.scale, y: (startMid.y - start.y) / start.scale };
    const view = pinchView(start, 1.6, startMid, startMid, big, big);
    expect(view.scale).toBeCloseTo(2.4, 10);
    expect(screenOf(view, page).x).toBeCloseTo(startMid.x, 8);
    expect(screenOf(view, page).y).toBeCloseTo(startMid.y, 8);
  });
  it("не больше MAX_SCALE и не меньше целой страницы; странное отношение не ломает вид", () => {
    expect(pinchView(FULL_VIEW, 100, { x: 0, y: 0 }, { x: 0, y: 0 }, big, big).scale).toBe(MAX_SCALE);
    expect(pinchView({ scale: 2, x: 0, y: 0 }, 0.1, { x: 0, y: 0 }, { x: 0, y: 0 }, big, big)).toEqual(FULL_VIEW);
    expect(pinchView(FULL_VIEW, Number.NaN, { x: 0, y: 0 }, { x: 0, y: 0 }, big, big)).toEqual(FULL_VIEW);
  });
  it("у края рамки сдвиг ограничен", () => {
    const view = pinchView(FULL_VIEW, 2, { x: 140, y: 190 }, { x: 140, y: 190 }, CONTENT, FRAME);
    const limit = maxOffset(CONTENT, FRAME, 2);
    expect(Math.abs(view.x)).toBeLessThanOrEqual(limit.x);
    expect(Math.abs(view.y)).toBeLessThanOrEqual(limit.y);
  });
});

describe("двойное касание", () => {
  it("целая страница приближается к точке касания и держит её под пальцем", () => {
    const big = { width: 2000, height: 2000 };
    const at = { x: 30, y: -20 };
    const view = doubleTapView(FULL_VIEW, at, big, big);
    expect(view.scale).toBe(DOUBLE_TAP_SCALE);
    expect(screenOf(view, at)).toEqual(at);
  });
  it("приближенная страница возвращается целой; почти целая считается целой", () => {
    expect(doubleTapView({ scale: 2.5, x: 10, y: 10 }, { x: 0, y: 0 }, CONTENT, FRAME)).toEqual(FULL_VIEW);
    expect(doubleTapView({ scale: 1.01, x: 0, y: 0 }, { x: 0, y: 0 }, CONTENT, FRAME).scale).toBe(DOUBLE_TAP_SCALE);
    expect(isWhole({ scale: 1.01, x: 0, y: 0 })).toBe(true);
    expect(isWhole({ scale: 1.2, x: 0, y: 0 })).toBe(false);
  });
});

describe("листание жестом", () => {
  it("палец влево - следующая страница, вправо - предыдущая; дальше порога или быстро", () => {
    expect(swipeStep(-SWIPE_DISTANCE - 1, 3, -0.1)).toBe(1);
    expect(swipeStep(SWIPE_DISTANCE + 1, -3, 0.1)).toBe(-1);
    expect(swipeStep(-25, 2, -0.8)).toBe(1);
  });
  it("короткий медленный сдвиг, вертикальное движение и быстрый микросдвиг не листают", () => {
    expect(swipeStep(-20, 0, -0.1)).toBe(0);
    expect(swipeStep(-120, 110, -0.9)).toBe(0);
    expect(swipeStep(-4, 0, -2)).toBe(0);
    expect(swipeStep(0, 0, 0)).toBe(0);
  });
});

describe("ZoomController: жесты", () => {
  function setup(content = { width: 1000, height: 1000 }, frame = { width: 1000, height: 1000 }) {
    const views: { view: ZoomView; animated: boolean }[] = [];
    const steps: (-1 | 1)[] = [];
    const controller = new ZoomController(content, frame, { onView: (view, animated) => views.push({ view, animated }), onStep: (step) => steps.push(step) });
    return { controller, views, steps, last: () => views[views.length - 1]! };
  }
  const T = (x: number, y: number): Touch => ({ x, y });

  it("щипок: два пальца раздвинулись вдвое - масштаб 2 без анимации, после отпускания вид остаётся", () => {
    const { controller, last } = setup();
    controller.grant([T(450, 500), T(550, 500)], 0);
    controller.move([T(400, 500), T(600, 500)]);
    expect(last().view.scale).toBe(2);
    expect(last().animated).toBe(false);
    controller.release(300);
    expect(controller.getView().scale).toBe(2);
    expect(last().animated).toBe(true);
  });

  it("щипок до целой страницы возвращает точный целый вид (без остаточного сдвига)", () => {
    const { controller } = setup(CONTENT, FRAME);
    controller.grant([T(100, 200), T(200, 200)], 0);
    controller.move([T(50, 200), T(250, 200)]);
    controller.move([T(100, 200), T(200, 200)]);
    controller.release(400);
    expect(controller.getView()).toEqual(FULL_VIEW);
  });

  it("палец по приближенной странице двигает её в пределах рамки", () => {
    const { controller, last } = setup(CONTENT, FRAME);
    controller.grant([T(100, 200), T(200, 200)], 0);
    controller.move([T(50, 200), T(250, 200)]);
    controller.release(300);
    const zoomed = controller.getView();
    expect(zoomed.scale).toBeCloseTo(2, 5);
    controller.grant([T(150, 200)], 1000);
    controller.move([T(170, 190)]);
    expect(last().view.x).toBeCloseTo(zoomed.x + 20, 5);
    expect(last().view.y).toBeCloseTo(zoomed.y - 10, 5);
    controller.move([T(9999, -9999)]);
    const limit = maxOffset(CONTENT, FRAME, zoomed.scale);
    expect(last().view.x).toBe(limit.x);
    expect(last().view.y).toBe(-limit.y);
    controller.release(1500);
    expect(controller.getView().scale).toBeCloseTo(2, 5);
  });

  it("палец убрали посреди щипка: оставшийся продолжает двигать страницу с нынешнего вида, без скачка", () => {
    const { controller, last } = setup();
    controller.grant([T(450, 500), T(550, 500)], 0);
    controller.move([T(400, 500), T(600, 500)]);
    const before = last().view;
    controller.move([T(600, 500)]);
    // один палец без смещения: вид тот же
    expect(last().view.scale).toBe(before.scale);
    expect(last().view.x).toBeCloseTo(before.x, 8);
    controller.move([T(620, 500)]);
    expect(last().view.x).toBeCloseTo(before.x + 20, 8);
    controller.release(400);
    expect(controller.getView().scale).toBe(2);
  });

  it("целая страница: движение пальца влево листает вперёд, вид возвращается целым", () => {
    const { controller, steps, views, last } = setup(CONTENT, FRAME);
    controller.grant([T(250, 200)], 0);
    controller.move([T(200, 205)]);
    // страница тянется следом за пальцем, но слабее
    expect(last().view.scale).toBe(1);
    expect(last().view.x).toBeLessThan(0);
    expect(last().view.x).toBeGreaterThan(-50);
    controller.move([T(150, 205)]);
    controller.release(200);
    expect(steps).toEqual([1]);
    expect(views[views.length - 1]).toEqual({ view: FULL_VIEW, animated: false });
    expect(controller.getView()).toEqual(FULL_VIEW);
  });

  it("целая страница: вправо - назад; короткий сдвиг - остаётся на месте с плавным возвратом", () => {
    const back = setup(CONTENT, FRAME);
    back.controller.grant([T(50, 200)], 0);
    back.controller.move([T(160, 200)]);
    back.controller.release(300);
    expect(back.steps).toEqual([-1]);
    const stay = setup(CONTENT, FRAME);
    stay.controller.grant([T(150, 200)], 0);
    stay.controller.move([T(130, 200)]);
    stay.controller.release(800);
    expect(stay.steps).toEqual([]);
    expect(stay.last()).toEqual({ view: FULL_VIEW, animated: true });
  });

  it("вертикальное движение по целой странице не листает и страницу не тянет", () => {
    const { controller, steps, views } = setup(CONTENT, FRAME);
    controller.grant([T(150, 100)], 0);
    controller.move([T(155, 300)]);
    controller.release(400);
    expect(steps).toEqual([]);
    expect(views.filter((v) => v.view.x !== 0)).toEqual([]);
  });

  it("двойное касание приближает к точке, повторное возвращает целую страницу; одиночное ничего не делает", () => {
    const { controller, last, steps } = setup();
    controller.grant([T(600, 500)], 0);
    controller.release(80);
    expect(controller.getView()).toEqual(FULL_VIEW);
    controller.grant([T(600, 500)], 150);
    controller.release(220);
    expect(controller.getView().scale).toBe(DOUBLE_TAP_SCALE);
    expect(last().animated).toBe(true);
    // точка касания (100, 0 от центра) осталась под пальцем
    expect(screenOf(controller.getView(), { x: 100, y: 0 })).toEqual({ x: 100, y: 0 });
    controller.grant([T(500, 500)], 1000);
    controller.release(1060);
    controller.grant([T(500, 500)], 1100);
    controller.release(1160);
    expect(controller.getView()).toEqual(FULL_VIEW);
    expect(steps).toEqual([]);
  });

  it("два касания далеко друг от друга или с долгой паузой - не двойное касание", () => {
    const far = setup();
    far.controller.grant([T(100, 100)], 0);
    far.controller.release(50);
    far.controller.grant([T(700, 700)], 120);
    far.controller.release(170);
    expect(far.controller.getView()).toEqual(FULL_VIEW);
    const slow = setup();
    slow.controller.grant([T(500, 500)], 0);
    slow.controller.release(50);
    slow.controller.grant([T(500, 500)], 900);
    slow.controller.release(950);
    expect(slow.controller.getView()).toEqual(FULL_VIEW);
  });

  it("долгое нажатие - не тап: двойного касания из него не выходит", () => {
    const { controller } = setup();
    controller.grant([T(500, 500)], 0);
    controller.release(900);
    controller.grant([T(500, 500)], 1000);
    controller.release(1060);
    expect(controller.getView()).toEqual(FULL_VIEW);
  });

  it("жест отобрали: вид остаётся допустимым", () => {
    const { controller, last } = setup(CONTENT, FRAME);
    controller.grant([T(100, 200), T(200, 200)], 0);
    controller.move([T(50, 200), T(250, 200)]);
    controller.cancel();
    expect(last().animated).toBe(true);
    expect(last().view.scale).toBeCloseTo(2, 5);
    expect(Math.abs(last().view.x)).toBeLessThanOrEqual(maxOffset(CONTENT, FRAME, 2).x);
  });

  it("пустые касания не ломают автомат; обработчик листания можно сменить", () => {
    const { controller, steps } = setup(CONTENT, FRAME);
    controller.grant([T(250, 200)], 0);
    controller.move([]);
    const later: number[] = [];
    controller.setOnStep((step) => later.push(step));
    controller.move([T(150, 200)]);
    controller.release(150);
    expect(steps).toEqual([]);
    expect(later).toEqual([1]);
  });
});
