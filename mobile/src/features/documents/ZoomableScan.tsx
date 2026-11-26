// Страница крупного просмотра: рамка (серый «стол»), в которой страницу можно приблизить щипком или двойным касанием,
// подвигать пальцем и перелистнуть движением по целой странице. Жесты разбирает ZoomController (zoom-controller.ts, обычные
// тесты); здесь - касания из системы ответов RN (`onResponder*`, без новых нативных зависимостей) и перенос вида в Animated
// (нативный драйвер).
// Поверхность жестов - вся карточка просмотра, а не рамка (`useZoomSurface`): палец, севший на поле карточки, шапку или
// подпись, начинает щипок так же, как палец на странице; страница лишь подключает к карточке свой разбор. Всё, что в карточке
// не кнопка, касаний не принимает (`pointerEvents` "none" и "box-none"), поэтому цель такого касания - сама карточка, а не
// рамка или подпись, и `locationX/Y` у всех пальцев отсчитываются от неё.
// Точки считаются по `pageX/pageY` (общие для всех пальцев) минус начало рамки: начало = страница касания минус его место
// в карточке (`locationX/Y`) плюс место рамки в карточке (`onLayout`). Касание, от которого считается начало, - то, что село
// на цель события (`targetTouches` на iOS, где при двух пальцах разом первым в списке может оказаться палец с другой целью).
// Автомат один на всё время показа страницы: перерисовка родителя (опрос, смена темы, обновление токена) приближение не
// сбрасывает; смена размеров только прижимает вид к новым границам.
import { useEffect, useState } from "react";
import { AccessibilityInfo, Animated, Easing, View, type GestureResponderEvent, type LayoutChangeEvent, type ViewProps } from "react-native";

import { ScanPage } from "@/features/documents/GuideImages";
import { ZoomController, type Touch } from "@/features/documents/zoom-controller";
import type { Point, Size, ZoomView } from "@/features/documents/zoom-math";
import { useTheme } from "@/theme/ThemeProvider";

const ANIMATION_MS = 160;

type NativeTouch = GestureResponderEvent["nativeEvent"];
/** `targetTouches`: пальцы, севшие на цель этого события. Система кладёт их в событие (iOS); в типах RN их нет. */
type NativeWithTargets = NativeTouch & { targetTouches?: readonly NativeTouch[] };

/**
 * Касание, с которого начался жест: палец, севший на цель события. Нет `targetTouches` (Android: цель одна на весь жест,
 * `locationX/Y` у всех пальцев от неё; тесты) - первый из изменившихся.
 */
function triggerTouch(event: GestureResponderEvent): NativeTouch | undefined {
  const native = event.nativeEvent as NativeWithTargets;
  return native.targetTouches?.[0] ?? native.changedTouches?.[0] ?? native.touches[0];
}

/** Начало рамки на экране: страница касания, с которого начался жест, минус его место в карточке плюс место рамки в ней. */
function frameOrigin(event: GestureResponderEvent, frameAt: Point): Point | null {
  const first = triggerTouch(event);
  if (!first || typeof first.pageX !== "number" || typeof first.pageY !== "number") return null;
  return { x: first.pageX - first.locationX + frameAt.x, y: first.pageY - first.locationY + frameAt.y };
}

/** Все пальцы в координатах рамки; без страниц касания (тесты, странная платформа) - как есть, `locationX/Y`. */
function touchesOf(event: GestureResponderEvent, origin: Point | null): Touch[] {
  return event.nativeEvent.touches.map((touch) =>
    origin && typeof touch.pageX === "number" && typeof touch.pageY === "number" ? { x: touch.pageX - origin.x, y: touch.pageY - origin.y } : { x: touch.locationX, y: touch.locationY },
  );
}
const timeOf = (event: GestureResponderEvent): number => (typeof event.nativeEvent.timestamp === "number" ? event.nativeEvent.timestamp : Date.now());

/** Значения Animated страницы и прежняя анимация: следом за пальцами - сразу, после жеста - плавно (если не включено «Уменьшение движения»). */
class ScanAnimator {
  readonly scale = new Animated.Value(1);
  readonly x = new Animated.Value(0);
  readonly y = new Animated.Value(0);
  private running: Animated.CompositeAnimation | null = null;
  private calm = false;

  setCalm(on: boolean): void {
    this.calm = on;
  }

  stop(): void {
    this.running?.stop();
    this.running = null;
  }

  /** Встать на вид без анимации. */
  jump(view: ZoomView): void {
    this.stop();
    this.scale.setValue(view.scale);
    this.x.setValue(view.x);
    this.y.setValue(view.y);
  }

  apply(view: ZoomView, animated: boolean): void {
    if (!animated || this.calm) {
      this.jump(view);
      return;
    }
    this.stop();
    const timing = (value: Animated.Value, toValue: number) => Animated.timing(value, { toValue, duration: ANIMATION_MS, easing: Easing.out(Easing.cubic), useNativeDriver: true });
    this.running = Animated.parallel([timing(this.scale, view.scale), timing(this.x, view.x), timing(this.y, view.y)]);
    this.running.start();
  }
}

/** Разбор касаний, который страница отдаёт карточке: события ответчика приходят сюда. */
export type ZoomGestures = Readonly<{
  grant: (event: GestureResponderEvent) => void;
  /** Палец добавился, пошёл или ушёл: все пальцы с их нынешними точками. */
  move: (event: GestureResponderEvent) => void;
  release: (event: GestureResponderEvent) => void;
  terminate: () => void;
}>;

/** Касания одной страницы: свой автомат, анимация и начало рамки (общее для всех пальцев жеста). */
class ScanGestures implements ZoomGestures {
  private origin: Point | null = null;
  private frameAt: Point = { x: 0, y: 0 };

  constructor(
    private readonly controller: ZoomController,
    private readonly animator: ScanAnimator,
  ) {}

  /** Где рамка стоит в карточке (`onLayout`): без этого точки рамки считались бы от угла карточки. */
  setFrameAt(at: Point): void {
    this.frameAt = at;
  }

  grant = (event: GestureResponderEvent): void => {
    this.origin = frameOrigin(event, this.frameAt);
    // новый жест застаёт прежнюю анимацию на полпути: встаём сразу на вид, который она везла
    this.animator.jump(this.controller.getView());
    this.controller.grant(touchesOf(event, this.origin), timeOf(event));
  };

  move = (event: GestureResponderEvent): void => this.controller.move(touchesOf(event, this.origin));
  release = (event: GestureResponderEvent): void => this.controller.release(timeOf(event));
  terminate = (): void => this.controller.cancel();
}

/**
 * Поверхность жестов карточки: один ответчик на всю карточку. Пока страница на экране, она подключает свой разбор
 * (`connect`); страницы нет (схема вместо неё) - карточка касаний не берёт, и схема прокручивается как обычно. Кнопки карточки
 * (закрыть, «‹ ›») забирают свои касания сами: они глубже, и система спрашивает их первыми.
 * `onMoveShouldSetResponder` нет намеренно: палец, севший на кнопку, не должен уходить из-под неё в жест при малейшем сдвиге.
 */
class ZoomSurface {
  private target: ZoomGestures | null = null;

  readonly connect = (next: ZoomGestures | null): void => {
    this.target = next;
  };

  /** Обработчики ответчика для корня карточки. */
  readonly props = {
    onStartShouldSetResponder: () => this.target !== null,
    onResponderTerminationRequest: () => false,
    onResponderGrant: (event: GestureResponderEvent) => this.target?.grant(event),
    onResponderStart: (event: GestureResponderEvent) => this.target?.move(event),
    onResponderMove: (event: GestureResponderEvent) => this.target?.move(event),
    onResponderEnd: (event: GestureResponderEvent) => this.target?.move(event),
    onResponderRelease: (event: GestureResponderEvent) => this.target?.release(event),
    onResponderTerminate: () => this.target?.terminate(),
  } satisfies ViewProps;
}

export type { ZoomSurface };

export function useZoomSurface(): ZoomSurface {
  const [surface] = useState(() => new ZoomSurface());
  return surface;
}

type Props = Readonly<{
  uri: string;
  placeholderUri: string | null;
  /** Страница, вписанная в рамку при масштабе 1. Пропорции неизвестны (`exact` ложно) - место, куда картинка вписывается сама. */
  content: Size;
  /** Пропорции страницы известны: страница стоит листом точного размера, с тенью. */
  exact: boolean;
  /** Рамка (серый «стол»): по её краям страница обрезается при приближении; страница стоит в ней по центру. */
  frame: Size;
  label: string;
  onFailed: () => void;
  /** Лист по движению пальца: -1 предыдущая, 1 следующая страница. */
  onStep: (step: -1 | 1) => void;
  /** Подключить разбор касаний этой страницы к карточке (`useZoomSurface().connect`); отключается, когда страница уходит. */
  connect: (gestures: ZoomGestures | null) => void;
  /** Рамка просмотра. */
  testID: string;
  /** Сама картинка страницы. */
  imageTestID: string;
}>;

export function ZoomableScan({ uri, placeholderUri, content, exact, frame, label, onFailed, onStep, connect, testID, imageTestID }: Props) {
  const { tokens } = useTheme();
  const [animator] = useState(() => new ScanAnimator());
  const [controller] = useState(() => new ZoomController(content, frame, { onView: (view, animated) => animator.apply(view, animated), onStep: () => undefined }));
  const [gestures] = useState(() => new ScanGestures(controller, animator));
  const { width: contentWidth, height: contentHeight } = content;
  const { width: frameWidth, height: frameHeight } = frame;

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((on) => {
        if (alive) animator.setCalm(on);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      animator.stop();
    };
  }, [animator]);

  // Страница на экране - её разбор принимает касания карточки; ушла - карточка касаний не берёт.
  useEffect(() => {
    connect(gestures);
    return () => connect(null);
  }, [connect, gestures]);

  // Лист по движению пальца идёт в обработчик родителя последнего рендера, а не первого.
  useEffect(() => {
    controller.setOnStep(onStep);
  }, [controller, onStep]);
  // Размеры сменились (поворот, шрифт, окно) - вид прижимается к новым границам, картинка встаёт на вид автомата.
  // Зависимости - числа, а не объекты: родитель собирает размеры заново на каждую перерисовку.
  useEffect(() => {
    controller.setBounds({ width: contentWidth, height: contentHeight }, { width: frameWidth, height: frameHeight });
    animator.jump(controller.getView());
  }, [controller, animator, contentWidth, contentHeight, frameWidth, frameHeight]);

  const onLayout = (event: LayoutChangeEvent) => gestures.setFrameAt({ x: event.nativeEvent.layout.x, y: event.nativeEvent.layout.y });

  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="image"
      accessibilityLabel={label}
      pointerEvents="none"
      onLayout={onLayout}
      style={{ width: frame.width, height: frame.height, borderRadius: tokens.radiusCard, backgroundColor: tokens.bg, overflow: "hidden", alignItems: "center", justifyContent: "center" }}
    >
      <Animated.View testID={`${testID}-page`} pointerEvents="none" style={{ width: content.width, height: content.height, transform: [{ translateX: animator.x }, { translateY: animator.y }, { scale: animator.scale }] }}>
        <ScanPage uri={uri} placeholderUri={placeholderUri} size={exact ? content : null} box={content} onFailed={onFailed} testID={imageTestID} />
      </Animated.View>
    </View>
  );
}
