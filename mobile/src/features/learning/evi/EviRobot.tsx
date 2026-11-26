// Робот Эви (образец выбрал владелец 16.11.2026): белый шлем с объёмом, тёмное кольцо, визор и глаза-огоньки. Порт
// `src/components/portal/evi/EviRobot.tsx` веба и блока «Живой Эви» в portal.css: тот же рисунок (viewBox 160 x 130, координаты
// из веба без изменений), те же цвета (токены `evi*`, они уже в `tokens.generated.ts`, обе темы), те же лица и то же движение.
// Рисует только лицо, которое уже выбрали: выбирает его `EviMascot` (такт реплики - `useEviFace`).
//
// Мимика - глаза и рот: `idle` и `talk` - полумесяцы (у `talk` рот говорит), `happy` - купола и улыбка, `wow` - овалы и «о», `thinking` -
// полоски, `eureka` - звёздочки. Движение (контракт кабинета, «Исключения 17.11.2026»): пока робот на экране - покачивание (3,4 с) и
// моргание (4,6 с, у спокойного и говорящего лица); пока идёт настоящий запрос - глаза бегают (1,4 с), голова наклоняется (2,8 с),
// антенна мигает (1 с); на новую реплику - одна реакция настроения: радуется - подскок 700 мс, удивлён - «поп» 500 мс, придумал -
// прыжок 800 мс со звёздами (600 мс), вспышкой визора (700 мс) и антенной (4 x 500 мс). У старой реплики (`settled`) реакции нет;
// неподвижный (`still`: аватар в шапке, вход на «Профессиях») не двигается вовсе. При «уменьшить движение» робот стоит, лицо
// меняется мгновенно, «думает» читается по взгляду в сторону.
//
// Как нарисовано. Веб двигает группы одного SVG; здесь у каждой двигающейся части свой слой: `Animated.View` с `Svg` той же
// размерности, поэтому движение идёт на родном потоке (`useNativeDriver`), а сам рисунок не перерисовывается. Поворот и
// масштаб вокруг точки - сдвиг к ней, преобразование, сдвиг назад (в веб это `transform-box: fill-box` с `transform-origin`).
// Единицы сдвигов из CSS (`translateY(-7px)`) - единицы рисунка, не экрана, поэтому здесь они умножаются на `k` = размер / 160.
import type { EviMood } from "@web/lib/portal/evi";
import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { Animated, Easing, StyleSheet, View, type ViewStyle } from "react-native";
import Svg, { Defs, Ellipse, LinearGradient, Path, RadialGradient, Rect, Stop } from "react-native-svg";

import { useTheme, type Tokens } from "@/theme/ThemeProvider";
import { useReduceMotion } from "@/ui/useReduceMotion";

export type EviFace = EviMood | "idle";

/** Части лица, у каждой своя прозрачность (в вебе `data-face`). */
export type FacePart = "bowl" | "dome" | "oval" | "scan" | "star" | "smile" | "talk" | "o";
const FACE_PARTS_ALL: readonly FacePart[] = ["bowl", "dome", "oval", "scan", "star", "smile", "talk", "o"];

/** Какие части видны при каком лице (portal.css, `.pt-evi-mascot[data-mood=...]`). */
export const FACE_PARTS: Readonly<Record<EviFace, readonly FacePart[]>> = {
  idle: ["bowl"],
  talk: ["bowl", "talk"],
  happy: ["dome", "smile"],
  wow: ["oval", "o"],
  thinking: ["scan"],
  eureka: ["star", "o"],
};

export type RobotPlan = Readonly<{
  parts: readonly FacePart[];
  /** Где стоят глаза, когда не бегают (единицы рисунка): слушает - к полю ввода, думает - в сторону. */
  eyes: Readonly<{ x: number; y: number }>;
  bob: boolean;
  blink: boolean;
  /** Рот «говорит» и голова кивает. */
  talk: boolean;
  /** Глаза бегают, голова наклоняется, антенна мигает: идёт настоящий запрос. */
  scan: boolean;
  /** Одна реакция на новую реплику; «jump» (придумал) ведёт ещё звёзды, вспышку визора и четыре мигания антенны. */
  react: "hop" | "pop" | "jump" | null;
}>;

/** Что делает робот при этом лице: чистая функция, по ней же строятся проверки; весь CSS блока «Живой Эви» сведён сюда. */
export function robotPlan(face: EviFace, o: Readonly<{ listening: boolean; settled: boolean; still: boolean; reduceMotion: boolean }>): RobotPlan {
  const motion = !o.still && !o.reduceMotion;
  return {
    parts: FACE_PARTS[face],
    eyes: face === "thinking" ? { x: -4, y: -3 } : o.listening ? { x: 3, y: 4 } : { x: 0, y: 0 },
    bob: motion,
    blink: motion && (face === "idle" || face === "talk"),
    talk: motion && face === "talk",
    scan: motion && face === "thinking",
    react: motion && !o.settled ? (face === "happy" ? "hop" : face === "wow" ? "pop" : face === "eureka" ? "jump" : null) : null,
  };
}

/** Токен вида `rgb(255 255 255 / 0.55)` - в запятую-форму, которую react-native-svg разбирает на обеих платформах. */
export function svgColor(value: string): string {
  const match = /^rgb\(\s*(\d+)\s+(\d+)\s+(\d+)\s*\/\s*([\d.]+)\s*\)$/u.exec(value);
  return match ? `rgba(${match[1]}, ${match[2]}, ${match[3]}, ${match[4]})` : value;
}

// Рисунок: viewBox шлема 0..160 x 0..130, уши выходят за него на 4 единицы (в вебе `overflow: visible`), поэтому поле шире.
const BOX = { x: -6, w: 172, h: 130, helmet: 160 } as const;
const VIEW_BOX = `${BOX.x} 0 ${BOX.w} ${BOX.h}`;
/** Центр поля рисунка: от него считается сдвиг к точке поворота. */
const CENTER = { x: BOX.x + BOX.w / 2, y: BOX.h / 2 } as const;
// Точки поворота и масштаба (центры `fill-box` в вебе): голова - 50 % x 90 % своей рамки (x -4..164, y 4..126), веки, рот, звёзды.
const PIVOT = { head: [80, 113.8], lids: [80, 70.5], mouth: [80, 94.5], starLeft: [56, 68], starRight: [104, 68] } as const satisfies Record<string, readonly [number, number]>;

const EASE = Easing.bezier(0.25, 0.1, 0.25, 1);
const EASE_IN_OUT = Easing.bezier(0.42, 0, 0.58, 1);
const EASE_OUT = Easing.bezier(0, 0, 0.58, 1);
const FACE_EASE = Easing.bezier(0, 0, 0.2, 1);
const HOP_EASE = Easing.bezier(0.3, 1.5, 0.5, 1);
const POP_EASE = Easing.bezier(0.3, 1.6, 0.5, 1);
const JUMP_EASE = Easing.bezier(0.3, 1.3, 0.5, 1);
type Curve = (t: number) => number;
type Key = readonly [at: number, to: number];

const timing = (value: Animated.Value, to: number, duration: number, easing: Curve) => Animated.timing(value, { toValue: to, duration, easing, useNativeDriver: true });

/** Ключевые кадры CSS: значение идёт от `from` через кадры (доля времени, значение) к `end`; кривая действует на каждом участке. */
function track(value: Animated.Value, from: number, keys: readonly Key[], duration: number, easing: Curve, end = from): Animated.CompositeAnimation {
  value.setValue(from);
  let at = 0;
  return Animated.sequence(
    [...keys, [1, end] as const].map(([stop, to]) => {
      const step = timing(value, to, duration * (stop - at), easing);
      at = stop;
      return step;
    }),
  );
}

type Values = Readonly<{
  bob: Animated.Value;
  rot: Animated.Value;
  ty: Animated.Value;
  sc: Animated.Value;
  nub: Animated.Value;
  flash: Animated.Value;
  eyeX: Animated.Value;
  eyeY: Animated.Value;
  blink: Animated.Value;
  talk: Animated.Value;
  star: Animated.Value;
  faces: Readonly<Record<FacePart, Animated.Value>>;
}>;

function createValues(plan: RobotPlan, k: number): Values {
  const faces = Object.fromEntries(FACE_PARTS_ALL.map((part) => [part, new Animated.Value(plan.parts.includes(part) ? 1 : 0)])) as Record<FacePart, Animated.Value>;
  return {
    bob: new Animated.Value(0),
    rot: new Animated.Value(0),
    ty: new Animated.Value(0),
    sc: new Animated.Value(1),
    nub: new Animated.Value(1),
    flash: new Animated.Value(0),
    eyeX: new Animated.Value(plan.eyes.x * k),
    eyeY: new Animated.Value(plan.eyes.y * k),
    blink: new Animated.Value(1),
    talk: new Animated.Value(1),
    star: new Animated.Value(1),
    faces,
  };
}

/** Запуск и остановка: останов возвращает значения к покою, как конец CSS-анимации. */
function useRun(on: boolean, start: () => Animated.CompositeAnimation, rest: () => void, deps: readonly unknown[]) {
  useEffect(() => {
    if (!on) return;
    const animation = start();
    animation.start();
    return () => {
      animation.stop();
      rest();
    };
    // `start` и `rest` описаны вызывающим и зависят только от `deps`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, ...deps]);
}

export function EviRobot({ face, listening = false, settled = false, still = false, size = 72, testID }: Readonly<{
  face: EviFace;
  listening?: boolean;
  /** Лицо без разовой реакции (подскок, «поп», прыжок): реплика уже не новая. */
  settled?: boolean;
  /** Неподвижный робот: аватар в шапке чата и вход на «Профессиях»; живой - только робот у реплики. */
  still?: boolean;
  /** Ширина шлема, pt (в вебе 72 на компьютере, 56 в строке на телефоне, 104 на приветствии). */
  size?: number;
  testID?: string;
}>) {
  const { tokens } = useTheme();
  const reduceMotion = useReduceMotion();
  const k = size / BOX.helmet;
  const plan = robotPlan(face, { listening, settled, still, reduceMotion });
  const [values] = useState(() => createValues(plan, k));
  const v = values;
  const uid = useId().replace(/\W/gu, "");

  // Лицо: части сменяют друг друга за `motionFast`; при «уменьшить движение» - мгновенно.
  const partsKey = plan.parts.join(",");
  useEffect(() => {
    const fade = Animated.parallel(FACE_PARTS_ALL.map((part) => timing(v.faces[part], plan.parts.includes(part) ? 1 : 0, reduceMotion ? 0 : tokens.motionFast, FACE_EASE)));
    fade.start();
    return () => fade.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partsKey, reduceMotion, tokens.motionFast, v]);

  // Глаза: слушает - к полю ввода, думает - в сторону; когда они бегают (`scan`), положением ведёт бег.
  useEffect(() => {
    if (plan.scan) {
      v.eyeY.setValue(0);
      return;
    }
    const move = Animated.parallel([timing(v.eyeX, plan.eyes.x * k, reduceMotion ? 0 : tokens.motionBase, EASE_OUT), timing(v.eyeY, plan.eyes.y * k, reduceMotion ? 0 : tokens.motionBase, EASE_OUT)]);
    move.start();
    return () => move.stop();
  }, [plan.scan, plan.eyes.x, plan.eyes.y, k, reduceMotion, tokens.motionBase, v]);

  // Покачивание: 3,4 с, на 2,3 % высоты вверх и обратно.
  useRun(plan.bob, () => Animated.loop(Animated.sequence([timing(v.bob, 1, 1700, EASE_IN_OUT), timing(v.bob, 0, 1700, EASE_IN_OUT)])), () => v.bob.setValue(0), [v]);
  // Моргание: раз в 4,6 с веки сжимаются до 8 % и возвращаются (кадры 93 %, 96 %, 100 %).
  useRun(plan.blink, () => Animated.loop(Animated.sequence([Animated.delay(4278), timing(v.blink, 0.08, 138, EASE), timing(v.blink, 1, 184, EASE)])), () => v.blink.setValue(1), [v]);
  // Говорит: рот 170 мс туда-обратно, голова кивает на 2 градуса за 500 мс.
  useRun(
    plan.talk,
    () => {
      v.rot.setValue(-2);
      return Animated.parallel([
        Animated.loop(Animated.sequence([timing(v.talk, 0.3, 170, EASE_IN_OUT), timing(v.talk, 1, 170, EASE_IN_OUT)])),
        Animated.loop(Animated.sequence([timing(v.rot, 2, 500, EASE_IN_OUT), timing(v.rot, -2, 500, EASE_IN_OUT)])),
      ]);
    },
    () => {
      v.talk.setValue(1);
      v.rot.setValue(0);
    },
    [v],
  );
  // Думает: глаза бегают на 6 единиц (1,4 с), голова наклоняется (2,8 с), антенна мигает (1 с).
  useRun(
    plan.scan,
    () => {
      v.eyeX.setValue(-6 * k);
      v.rot.setValue(-4);
      return Animated.parallel([
        Animated.loop(Animated.sequence([timing(v.eyeX, 6 * k, 700, EASE_IN_OUT), timing(v.eyeX, -6 * k, 700, EASE_IN_OUT)])),
        Animated.loop(Animated.sequence([timing(v.rot, 3, 1400, EASE_IN_OUT), timing(v.rot, -4, 1400, EASE_IN_OUT)])),
        Animated.loop(Animated.sequence([timing(v.nub, 0.45, 500, EASE_IN_OUT), timing(v.nub, 1, 500, EASE_IN_OUT)])),
      ]);
    },
    () => {
      v.rot.setValue(0);
      v.nub.setValue(1);
    },
    [v, k],
  );
  // Одна реакция на новую реплику: подскок, «поп» или прыжок; у «придумал» ещё звёзды, вспышка визора и антенна.
  const react = plan.react;
  useRun(
    react !== null,
    () => {
      if (react === "hop") return Animated.parallel([track(v.ty, 0, [[0.35, -7 * k], [0.7, k]], 700, HOP_EASE), track(v.rot, 0, [[0.35, -4], [0.7, 2]], 700, HOP_EASE)]);
      if (react === "pop") return track(v.sc, 1, [[0.4, 1.08]], 500, POP_EASE);
      v.star.setValue(0);
      v.flash.setValue(0.55);
      return Animated.parallel([
        track(v.ty, 0, [[0.3, -12 * k], [0.65, 2 * k]], 800, JUMP_EASE),
        track(v.sc, 1, [[0.3, 1.04], [0.65, 1]], 800, JUMP_EASE),
        timing(v.star, 1, 600, POP_EASE),
        timing(v.flash, 0, 700, EASE_OUT),
        Animated.loop(Animated.sequence([timing(v.nub, 0.45, 250, EASE_IN_OUT), timing(v.nub, 1, 250, EASE_IN_OUT)]), { iterations: 4 }),
      ]);
    },
    () => {
      v.ty.setValue(0);
      v.rot.setValue(0);
      v.sc.setValue(1);
      v.star.setValue(1);
      v.flash.setValue(0);
      v.nub.setValue(1);
    },
    [react, v, k],
  );

  const height = (size * BOX.h) / BOX.helmet;
  // Производные узлы и стили считаются один раз на размер: перерисовка (слушает, лицо) не пересоздаёт связи с родным потоком.
  const s = useMemo(() => {
    const around = (pivot: readonly [number, number]) => ({ dx: (pivot[0] - CENTER.x) * k, dy: (pivot[1] - CENTER.y) * k });
    const head = around(PIVOT.head);
    const lids = around(PIVOT.lids);
    const mouth = around(PIVOT.mouth);
    const starDeg = v.star.interpolate({ inputRange: [0, 1], outputRange: ["-120deg", "0deg"] });
    const shown = (part: FacePart): Animated.WithAnimatedValue<ViewStyle> => ({ opacity: v.faces[part] });
    const star = (p: { dx: number; dy: number }): Animated.WithAnimatedValue<ViewStyle> => ({
      opacity: v.faces.star,
      transform: [{ translateX: p.dx }, { translateY: p.dy }, { scale: v.star }, { rotate: starDeg }, { translateX: -p.dx }, { translateY: -p.dy }],
    });
    return {
      float: { width: size, height, transform: [{ translateY: v.bob.interpolate({ inputRange: [0, 1], outputRange: [0, -0.023 * height] }) }] },
      box: { position: "absolute", left: BOX.x * k, top: 0, width: BOX.w * k, height: BOX.h * k } as const,
      head: [
        StyleSheet.absoluteFill,
        { transform: [{ translateY: Animated.add(v.ty, head.dy) }, { rotate: v.rot.interpolate({ inputRange: [-180, 180], outputRange: ["-180deg", "180deg"] }) }, { scale: v.sc }, { translateY: -head.dy }] },
      ] as Animated.WithAnimatedValue<ViewStyle>[],
      eyes: [StyleSheet.absoluteFill, { transform: [{ translateX: v.eyeX }, { translateY: v.eyeY }] }] as Animated.WithAnimatedValue<ViewStyle>[],
      nub: { opacity: v.nub },
      flash: { opacity: v.flash },
      bowl: [shown("bowl"), { transform: [{ translateY: lids.dy }, { scaleY: v.blink }, { translateY: -lids.dy }] }] as Animated.WithAnimatedValue<ViewStyle>[],
      dome: shown("dome"),
      oval: shown("oval"),
      scan: shown("scan"),
      starLeft: star(around(PIVOT.starLeft)),
      starRight: star(around(PIVOT.starRight)),
      smile: shown("smile"),
      talk: [shown("talk"), { transform: [{ translateY: mouth.dy }, { scaleY: v.talk }, { translateY: -mouth.dy }] }] as Animated.WithAnimatedValue<ViewStyle>[],
      o: shown("o"),
    };
  }, [v, k, size, height]);

  return (
    <View
      testID={testID ?? "evi-robot"}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: size, height }}
    >
      <Animated.View style={s.float}>
        <View style={s.box}>
          <Animated.View style={s.head}>
            <Layer style={s.nub}>
              <Defs>
                <LinearGradient id={`${uid}n`} x1="0%" y1="0%" x2="0%" y2="100%">
                  <Stop offset="0" stopColor={tokens.eviNubHi} />
                  <Stop offset="1" stopColor={tokens.eviNubLo} />
                </LinearGradient>
              </Defs>
              <Rect x={67} y={4} width={26} height={11} rx={5.5} fill={`url(#${uid}n)`} />
            </Layer>
            <Layer>
              <Body id={uid} tokens={tokens} />
            </Layer>
            <Layer style={s.flash}>
              <Rect x={16} y={18} width={128} height={100} rx={50} fill={tokens.eviFlash} />
            </Layer>
            <Animated.View style={s.eyes}>
              <Layer style={s.bowl}>
                <Path d="M41 63 H71 Q71 78 56 78 Q41 78 41 63 Z" fill={tokens.eviEye} />
                <Path d="M89 63 H119 Q119 78 104 78 Q89 78 89 63 Z" fill={tokens.eviEye} />
              </Layer>
              <Layer style={s.dome}>
                <Path d="M41 76 Q41 58 56 58 Q71 58 71 76 Q56 70 41 76 Z" fill={tokens.eviEye} />
                <Path d="M89 76 Q89 58 104 58 Q119 58 119 76 Q104 70 89 76 Z" fill={tokens.eviEye} />
              </Layer>
              <Layer style={s.oval}>
                <Ellipse cx={56} cy={67} rx={15} ry={10} fill={tokens.eviEye} />
                <Ellipse cx={104} cy={67} rx={15} ry={10} fill={tokens.eviEye} />
              </Layer>
              <Layer style={s.scan}>
                <Rect x={45} y={64} width={22} height={7} rx={3.5} fill={tokens.eviEye} />
                <Rect x={93} y={64} width={22} height={7} rx={3.5} fill={tokens.eviEye} />
              </Layer>
              <Layer style={s.starLeft}>
                <Path d="M56 55 Q58.2 65.8 69 68 Q58.2 70.2 56 81 Q53.8 70.2 43 68 Q53.8 65.8 56 55 Z" fill={tokens.eviEye} />
              </Layer>
              <Layer style={s.starRight}>
                <Path d="M104 55 Q106.2 65.8 117 68 Q106.2 70.2 104 81 Q101.8 70.2 91 68 Q101.8 65.8 104 55 Z" fill={tokens.eviEye} />
              </Layer>
            </Animated.View>
            <Layer style={s.smile}>
              <Path d="M72 95 Q80 100 88 95" fill="none" stroke={tokens.eviEye} strokeWidth={4} strokeLinecap="round" />
            </Layer>
            <Layer style={s.talk}>
              <Rect x={72} y={91} width={16} height={7} rx={3.5} fill={tokens.eviEye} />
            </Layer>
            <Layer style={s.o}>
              <Ellipse cx={80} cy={96} rx={6} ry={8} fill={tokens.eviEye} />
            </Layer>
          </Animated.View>
        </View>
      </Animated.View>
    </View>
  );
}

/** Слой рисунка: свой `Svg` той же размерности, чтобы части двигались независимо и совпадали по координатам. */
function Layer({ style, children }: { style?: Animated.WithAnimatedValue<ViewStyle> | Animated.WithAnimatedValue<ViewStyle>[]; children: ReactNode }) {
  return (
    <Animated.View style={[StyleSheet.absoluteFill, style]}>
      <Svg width="100%" height="100%" viewBox={VIEW_BOX}>
        {children}
      </Svg>
    </Animated.View>
  );
}

/** Неподвижное: глянец антенны, уши с дужками, шлем, кольцо, визор и блик (веб: `<g class="pt-evi-robot-head">` без глаз и рта). */
function Body({ id, tokens }: { id: string; tokens: Tokens }) {
  return (
    <>
      <Defs>
        <RadialGradient id={`${id}h`} cx="38%" cy="30%" r="80%">
          <Stop offset="0" stopColor={tokens.eviHelmetHi} />
          <Stop offset="0.55" stopColor={tokens.eviHelmet} />
          <Stop offset="0.85" stopColor={tokens.eviHelmetLo} />
          <Stop offset="1" stopColor={tokens.eviHelmetRim} />
        </RadialGradient>
        <RadialGradient id={`${id}v`} cx="50%" cy="55%" r="65%">
          <Stop offset="0" stopColor={tokens.eviVisorHi} />
          <Stop offset="0.7" stopColor={tokens.eviVisor} />
          <Stop offset="1" stopColor={tokens.eviVisorLo} />
        </RadialGradient>
      </Defs>
      <Rect x={72} y={5.5} width={11} height={3} rx={1.5} fill={svgColor(tokens.eviGloss)} />
      <Rect x={-4} y={51} width={16} height={38} rx={6} fill={tokens.eviEar} />
      <Rect x={-1.5} y={54} width={3} height={32} rx={1.5} fill={tokens.eviEarLine} />
      <Rect x={4} y={53} width={3.5} height={34} rx={1.75} fill={tokens.eviAccent} />
      <Rect x={148} y={51} width={16} height={38} rx={6} fill={tokens.eviEar} />
      <Rect x={158.5} y={54} width={3} height={32} rx={1.5} fill={tokens.eviEarLine} />
      <Rect x={152.5} y={53} width={3.5} height={34} rx={1.75} fill={tokens.eviAccent} />
      <Rect x={8} y={10} width={144} height={116} rx={58} fill={`url(#${id}h)`} />
      <Rect x={13} y={15} width={134} height={106} rx={53} fill={tokens.eviRing} />
      <Rect x={16} y={18} width={128} height={100} rx={50} fill={`url(#${id}v)`} />
      <Path d="M34 42 Q52 26 84 24" fill="none" stroke={svgColor(tokens.eviShine)} strokeWidth={7} strokeLinecap="round" />
    </>
  );
}
