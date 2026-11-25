// Рамка крупного просмотра: страница, которую можно приблизить щипком или двойным касанием, подвигать пальцем и перелистнуть
// движением по целой странице. Жесты разбирает ZoomController (zoom-controller.ts, обычные тесты); здесь - только касания
// из системы ответов RN (`onResponder*`, без новых нативных зависимостей) и перенос вида в Animated (нативный драйвер).
// Дети рамки не принимают касаний (`pointerEvents="none"`), поэтому `locationX/Y` - от рамки.
import { useEffect, useMemo, useState } from "react";
import { AccessibilityInfo, Animated, Easing, View, type GestureResponderEvent } from "react-native";

import { ScanPage } from "@/features/documents/GuideImages";
import { ZoomController, type Touch } from "@/features/documents/zoom-controller";
import type { Size, ZoomView } from "@/features/documents/zoom-math";
import { useTheme } from "@/theme/ThemeProvider";

const ANIMATION_MS = 160;

function touchesOf(event: GestureResponderEvent): Touch[] {
  return event.nativeEvent.touches.map((touch) => ({ x: touch.locationX, y: touch.locationY }));
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

  const controller = useMemo(() => new ZoomController(content, frame, { onView: (view, animated) => animator.apply(view, animated), onStep: () => undefined }), [content, frame, animator]);
  // Лист по движению пальца идёт в обработчик родителя последнего рендера, а не первого.
  useEffect(() => {
    controller.setOnStep(onStep);
  }, [controller, onStep]);

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
        // новый жест застаёт прежнюю анимацию на полпути: встаём сразу на вид, который она везла
        animator.jump(controller.getView());
        controller.grant(touchesOf(event), timeOf(event));
      }}
      onResponderStart={(event) => controller.move(touchesOf(event))}
      onResponderMove={(event) => controller.move(touchesOf(event))}
      onResponderEnd={(event) => controller.move(touchesOf(event))}
      onResponderRelease={(event) => controller.release(timeOf(event))}
      onResponderTerminate={() => controller.cancel()}
      style={{ width: frame.width, height: frame.height, borderRadius: tokens.radiusCard, backgroundColor: tokens.bg, overflow: "hidden", alignItems: "center", justifyContent: "center" }}
    >
      <Animated.View pointerEvents="none" style={{ width: content.width, height: content.height, transform: [{ translateX: animator.x }, { translateY: animator.y }, { scale: animator.scale }] }}>
        <ScanPage uri={uri} placeholderUri={placeholderUri} size={exact ? content : null} box={content} onFailed={onFailed} testID={imageTestID} />
      </Animated.View>
    </View>
  );
}
