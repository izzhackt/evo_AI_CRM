// Движение кабинета (веб, решение владельца 02.10 и «Главная» 18.11.2026): только transform и opacity, всё один раз,
// без зацикливания; значения - токены движения из portal.css (`rise`, `stagger`, `motion*`, `easeOut`). Идёт на
// нативном потоке (Animated, useNativeDriver). При включённом в системе «Уменьшить движение» (веб:
// `prefers-reduced-motion`) всё выключено явно: блоки стоят на месте сразу, без анимации.
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { AccessibilityInfo, Animated, Easing, Pressable, type LayoutChangeEvent, type PressableProps, type StyleProp, type ViewStyle } from "react-native";

import { useTheme } from "@/theme/ThemeProvider";

// ---- «Уменьшить движение» ------------------------------------------------------------------------------------------

let reduced = false;
const listeners = new Set<() => void>();
let primed = false;

function setReduced(value: boolean): void {
  if (reduced === value) return;
  reduced = value;
  for (const listener of listeners) listener();
}

/**
 * Читает системную настройку один раз и следит за её сменой. Вызывается при старте приложения (корневой макет), поэтому
 * к первому показу «Главной» значение уже известно; пока оно не пришло, движение включено.
 */
export function primeReducedMotion(): void {
  if (primed) return;
  primed = true;
  void AccessibilityInfo.isReduceMotionEnabled().then(setReduced, () => undefined);
  AccessibilityInfo.addEventListener("reduceMotionChanged", setReduced);
}

const subscribe = (listener: () => void) => {
  primeReducedMotion();
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

/** Включено ли в системе «Уменьшить движение». */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, () => reduced, () => false);
}

/** Для тестов: поставить настройку без обращения к системе. */
export function setReducedMotionForTests(value: boolean): void {
  primed = true;
  setReduced(value);
}

/** `cubic-bezier(0.22, 1, 0.36, 1)` из токенов -> кривая Animated. */
export function bezierOf(token: string): (value: number) => number {
  const numbers = /^cubic-bezier\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)$/.exec(token);
  if (!numbers) return Easing.out(Easing.cubic);
  return Easing.bezier(Number(numbers[1]), Number(numbers[2]), Number(numbers[3]), Number(numbers[4]));
}

// ---- Вход блока ----------------------------------------------------------------------------------------------------

/**
 * Вход блока (`pt-enter`): прозрачность 0 -> 1 и подъём на `rise` px за `motionBase` по `easeOut`; блоки одного экрана
 * входят по очереди с шагом `stagger` мс (`index` - место в порядке чтения). До своей очереди блок скрыт (веб:
 * `animation-fill-mode: backwards`), после входа у него нет ни прозрачности, ни сдвига.
 */
export function Enter({ index = 0, children, style, testID, onLayout }: { index?: number; children: ReactNode; style?: StyleProp<ViewStyle>; testID?: string; onLayout?: (event: LayoutChangeEvent) => void }) {
  const { tokens } = useTheme();
  const motionless = useReducedMotion();
  const [progress] = useState(() => new Animated.Value(motionless ? 1 : 0));
  useEffect(() => {
    if (motionless) {
      progress.setValue(1);
      return undefined;
    }
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: tokens.motionBase,
      delay: tokens.stagger * index,
      easing: bezierOf(tokens.easeOut),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [index, motionless, progress, tokens.easeOut, tokens.motionBase, tokens.stagger]);
  return (
    <Animated.View testID={testID} onLayout={onLayout} style={[style, { opacity: progress, transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [tokens.rise, 0] }) }] }]}>
      {children}
    </Animated.View>
  );
}

// ---- Рост полосы ---------------------------------------------------------------------------------------------------

/**
 * Полоса вырастает из нуля слева направо один раз (`pt-fill-grow`): scaleX 0 -> 1 за `motionSlow` по `easeOut` после
 * `stagger * 2` мс. Ширина не анимируется.
 */
export function GrowX({ children, style, testID }: { children: ReactNode; style?: StyleProp<ViewStyle>; testID?: string }) {
  const { tokens } = useTheme();
  const motionless = useReducedMotion();
  const [progress] = useState(() => new Animated.Value(motionless ? 1 : 0));
  useEffect(() => {
    if (motionless) {
      progress.setValue(1);
      return undefined;
    }
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: tokens.motionSlow,
      delay: tokens.stagger * 2,
      easing: bezierOf(tokens.easeOut),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [motionless, progress, tokens.easeOut, tokens.motionSlow, tokens.stagger]);
  return (
    <Animated.View testID={testID} style={[style, { transformOrigin: "left center", transform: [{ scaleX: progress }] }]}>
      {children}
    </Animated.View>
  );
}

// ---- Поворот значка ------------------------------------------------------------------------------------------------

/** Плавный поворот значка «Все шаги» (веб: `transition: transform motion-fast ease-out`): 0 - вниз, 180 - вверх. */
export function Turn({ turned, children, testID }: { turned: boolean; children: ReactNode; testID?: string }) {
  const { tokens } = useTheme();
  const motionless = useReducedMotion();
  const [angle] = useState(() => new Animated.Value(turned ? 1 : 0));
  useEffect(() => {
    if (motionless) {
      angle.setValue(turned ? 1 : 0);
      return undefined;
    }
    const animation = Animated.timing(angle, { toValue: turned ? 1 : 0, duration: tokens.motionFast, easing: bezierOf(tokens.easeOut), useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [angle, motionless, tokens.easeOut, tokens.motionFast, turned]);
  return (
    <Animated.View testID={testID} style={{ transform: [{ rotate: angle.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "180deg"] }) }] }}>
      {children}
    </Animated.View>
  );
}

// ---- Нажатие -------------------------------------------------------------------------------------------------------

/**
 * Карточка «садится» при нажатии (`:active { transform: scale(var(--pt-press-scale)) }` с переходом `motionPress`).
 * Обычный Pressable, у которого масштаб идёт плавно, а не рывком.
 */
export function PressableScale({ children, style, ...rest }: Omit<PressableProps, "style" | "children"> & { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { tokens } = useTheme();
  const motionless = useReducedMotion();
  const [scale] = useState(() => new Animated.Value(1));
  const to = (value: number) => {
    if (motionless) {
      scale.setValue(value);
      return;
    }
    Animated.timing(scale, { toValue: value, duration: tokens.motionPress, easing: bezierOf(tokens.easeOut), useNativeDriver: true }).start();
  };
  return (
    <Pressable {...rest} onPressIn={(event) => { to(tokens.pressScale); rest.onPressIn?.(event); }} onPressOut={(event) => { to(1); rest.onPressOut?.(event); }} style={style}>
      <Animated.View style={{ transform: [{ scale }] }}>{children}</Animated.View>
    </Pressable>
  );
}
