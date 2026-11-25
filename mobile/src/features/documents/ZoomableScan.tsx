// Рамка крупного просмотра: страница, которую можно приблизить щипком или двойным касанием, подвигать пальцем и перелистнуть
// движением по целой странице. Жесты разбирает ZoomController (zoom-controller.ts, обычные тесты); здесь - только касания
// из системы ответов RN (`onResponder*`, без новых нативных зависимостей) и перенос вида в Animated (нативный драйвер).
// Дети рамки не принимают касаний (`pointerEvents="none"`), поэтому касание, с которого начался жест, попадает в саму рамку.
// Точки считаются по `pageX/pageY` (общие для всех пальцев) минус начало рамки, а не по `locationX/Y`: у пальца, севшего
// не на рамку (поле карточки, подпись), `locationX/Y` отсчитывается от его собственной цели, и щипок смешал бы системы координат.
// Автомат один на всё время показа страницы: перерисовка родителя (опрос, смена темы, обновление токена) приближение не
// сбрасывает; смена размеров только прижимает вид к новым границам.
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, View, type GestureResponderEvent } from "react-native";

import { ScanPage } from "@/features/documents/GuideImages";
import { ZoomController, type Touch } from "@/features/documents/zoom-controller";
import type { Point, Size, ZoomView } from "@/features/documents/zoom-math";
import { useTheme } from "@/theme/ThemeProvider";

const ANIMATION_MS = 160;

/** Начало рамки на экране: страница касания, с которого начался жест, минус его положение в самой рамке. */
function frameOrigin(event: GestureResponderEvent): Point | null {
  const native = event.nativeEvent;
  const first = native.changedTouches?.[0] ?? native.touches[0];
  if (!first || typeof first.pageX !== "number" || typeof first.pageY !== "number") return null;
  return { x: first.pageX - first.locationX, y: first.pageY - first.locationY };
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

type Props = Readonly<{
  uri: string;
  placeholderUri: string | null;
  /** Страница, вписанная в рамку при масштабе 1. Пропорции неизвестны (`exact` ложно) - место, куда картинка вписывается сама. */
  content: Size;
  /** Пропорции страницы известны: страница стоит листом точного размера, с тенью. */
  exact: boolean;
  /** Рамка (серый «стол»): по её краям страница обрезается при приближении. */
  frame: Size;
  label: string;
  onFailed: () => void;
  /** Лист по движению пальца: -1 предыдущая, 1 следующая страница. */
  onStep: (step: -1 | 1) => void;
  /** Рамка просмотра (на неё приходят касания). */
  testID: string;
  /** Сама картинка страницы. */
  imageTestID: string;
}>;

export function ZoomableScan({ uri, placeholderUri, content, exact, frame, label, onFailed, onStep, testID, imageTestID }: Props) {
  const { tokens } = useTheme();
  const [animator] = useState(() => new ScanAnimator());
  const [controller] = useState(() => new ZoomController(content, frame, { onView: (view, animated) => animator.apply(view, animated), onStep: () => undefined }));
  const origin = useRef<Point | null>(null);
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

  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="image"
      accessibilityLabel={label}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderTerminationRequest={() => false}
      onResponderGrant={(event) => {
        origin.current = frameOrigin(event);
        // новый жест застаёт прежнюю анимацию на полпути: встаём сразу на вид, который она везла
        animator.jump(controller.getView());
        controller.grant(touchesOf(event, origin.current), timeOf(event));
      }}
      onResponderStart={(event) => controller.move(touchesOf(event, origin.current))}
      onResponderMove={(event) => controller.move(touchesOf(event, origin.current))}
      onResponderEnd={(event) => controller.move(touchesOf(event, origin.current))}
      onResponderRelease={(event) => controller.release(timeOf(event))}
      onResponderTerminate={() => controller.cancel()}
      style={{ width: frame.width, height: frame.height, borderRadius: tokens.radiusCard, backgroundColor: tokens.bg, overflow: "hidden", alignItems: "center", justifyContent: "center" }}
    >
      <Animated.View testID={`${testID}-page`} pointerEvents="none" style={{ width: content.width, height: content.height, transform: [{ translateX: animator.x }, { translateY: animator.y }, { scale: animator.scale }] }}>
        <ScanPage uri={uri} placeholderUri={placeholderUri} size={exact ? content : null} box={content} onFailed={onFailed} testID={imageTestID} />
      </Animated.View>
    </View>
  );
}
