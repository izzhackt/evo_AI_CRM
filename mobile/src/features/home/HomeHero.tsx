// Шапка «Главной» (HomeHero.tsx и шапка CountryTimeline.tsx, веб #1412 и #1489): приветствие по имени, под ним
// «страна · набор» и отсчёт до ближайшей даты. Со страной это содержимое стоит на фото столицы в шапке пути
// (JourneySection), без страны - на тёмной плашке со знаком EVO (HomeHero). Дорожки десяти этапов EVO нет (10.11.2026):
// где студент, говорит строка шага под шапкой пути.
import { Image } from "expo-image";
import { useState } from "react";
import { Linking, Pressable, StyleSheet, View } from "react-native";
import Svg, { Defs, RadialGradient, Rect, Stop } from "react-native-svg";
import { homeDayMonth } from "@web/lib/portal/home-dates";
import { universityDateLabel } from "@web/lib/portal/universities";

import { countdownWhen, heroSub, type HomeCountdown } from "@/domain/home-model";
import { goStamped } from "@/features/portal/navigation";
import { creditLine } from "@/features/universities/parts";
import type { PhotoCreditView, PhotoUrls } from "@/features/universities/photos";
import { useLang } from "@/i18n/LangProvider";
import { sansFont } from "@/theme/fonts";
import { useTheme } from "@/theme/ThemeProvider";
import { MIN_TARGET } from "@/ui/CardParts";
import { EvoMark } from "@/ui/EvoMark";
import { Text } from "@/ui/Text";

/** Подложка под текстом на фото: на узкой шапке она ровная (`.pt-journey-head[data-hero] .pt-journey-photo::after`, ≤640 px). */
const PHOTO_SCRIM = "rgba(20,16,12,0.76)";

/** `rgb(255 255 255 / 0.05)` из токенов -> строка, понятная RN. */
function markColor(value: string): string {
  const match = /^rgb\((\d+)\s+(\d+)\s+(\d+)\s*\/\s*([\d.]+)\)$/.exec(value);
  return match ? `rgba(${match[1]},${match[2]},${match[3]},${match[4]})` : value;
}

export type HeroContentProps = Readonly<{
  displayName: string;
  /** Страна поступления («Малайзия»); `null` - не выбрана. */
  studyCountry: string | null;
  /** Подпись набора пути страны («Набор на сентябрь 2027 года»); `null` - пути нет. */
  intake: string | null;
  /** Ближайшая дата из «Ближайших дат»; `null` - в ближайшие 60 дней дат нет. */
  countdown: HomeCountdown | null;
  /** Содержимое лежит на фото: подпись и «дней до…» белые (приглушённый цвет шапки на фото не держит контраст). */
  onPhoto?: boolean;
}>;

/** Приветствие (единственный заголовок «Главной»), «страна · набор» и отсчёт до ближайшей даты. */
export function HeroContent({ displayName, studyCountry, intake, countdown, onPhoto = false }: HeroContentProps) {
  const { lang, t, format } = useLang();
  const { tokens } = useTheme();
  const home = t("home");
  const sub = heroSub({ studyCountry, intake, home });
  const when = countdown ? countdownWhen(countdown, lang, home) : null;
  const soft = onPhoto ? tokens.heroInk : tokens.heroMuted;
  // Число дней - главное в отсчёте (веб, 19.11.2026): вдвое крупнее прежнего; на узкой шапке 1.375 размера заголовка.
  // «Сегодня», «Завтра» и «Просрочено» стоят на месте числа и мельче (`data-word`).
  const bigSize = when?.word ? tokens.sizeTitle : tokens.sizeDisplay * 1.375;

  return (
    <View style={{ gap: 14 }}>
      <View style={{ gap: 8 }}>
        {/* Заголовок «Главной»: display, вес 700, трекинг -0.02em, интерлиньяж 1.15 (`.pt-home-hero-title`). */}
        <Text
          variant="display"
          maxFontSizeMultiplier={1.2}
          accessibilityRole="header"
          style={{ color: tokens.heroInk, fontFamily: sansFont("bold"), lineHeight: tokens.sizeDisplay * 1.15, letterSpacing: -0.02 * tokens.sizeDisplay }}
        >
          {format(home.greeting, { name: displayName })}
        </Text>
        {sub ? (
          <Text variant="secondary" testID="hero-sub" style={{ color: soft, fontFamily: sansFont("medium") }}>
            {sub}
          </Text>
        ) : null}
      </View>
      {countdown && when ? (
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={format(home.heroCountdownAria, {
            when: when.word ? `${when.big} ${when.word}` : when.big,
            title: countdown.title,
            date: universityDateLabel(countdown.day, lang),
          })}
          onPress={() => goStamped(countdown.href)}
          testID="hero-countdown"
          style={({ pressed }) => ({
            minHeight: MIN_TARGET,
            flexDirection: "row",
            alignItems: "baseline",
            gap: 10,
            paddingTop: 14,
            borderTopWidth: 1,
            borderTopColor: tokens.heroLine,
            opacity: pressed ? 0.8 : 1,
          })}
        >
          <View
            testID="hero-countdown-big"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={countdown.overdue ? { paddingHorizontal: 12, paddingVertical: 4, borderRadius: tokens.radiusItem, backgroundColor: tokens.brandRed } : undefined}
          >
            <Text
              style={{
                color: tokens.heroInk,
                fontFamily: sansFont("bold"),
                fontSize: bigSize,
                lineHeight: when.word ? bigSize * 1.2 : bigSize,
                fontVariant: ["tabular-nums"],
                letterSpacing: -0.03 * bigSize,
              }}
            >
              {when.big}
            </Text>
          </View>
          <View style={{ flex: 1, gap: 2 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <Text variant="secondary" style={{ color: soft, fontFamily: sansFont("medium") }}>
              {when.word ? format(home.heroCountdownLine, { word: when.word, date: homeDayMonth(countdown.day, lang) }) : homeDayMonth(countdown.day, lang)}
            </Text>
            <Text variant="secondary" numberOfLines={1} style={{ color: tokens.heroInk, fontFamily: sansFont("medium") }}>
              {countdown.title}
            </Text>
          </View>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * Красные пятна на графитовой плашке (`--pt-hero-wash`): два эллиптических радиальных градиента, как в веб-CSS
 *   radial-gradient(55% 150% at 100% 0%, rgb(215 2 23 / 0.38), transparent 70%),
 *   radial-gradient(45% 120% at 0% 100%, rgb(215 2 23 / 0.16), transparent 72%).
 * Рисует react-native-svg (он уже в сборке): viewBox 100x100 растянут на плашку (`preserveAspectRatio="none"`), поэтому
 * радиусы в процентах ширины и высоты те же, что у CSS.
 */
export function HeroWash() {
  const { tokens } = useTheme();
  return (
    <Svg
      width="100%"
      height="100%"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={StyleSheet.absoluteFill}
      testID="hero-wash"
    >
      <Defs>
        <RadialGradient id="heroWashA" cx={100} cy={0} rx={55} ry={150} gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor={tokens.brandRed} stopOpacity={0.38} />
          <Stop offset="0.7" stopColor={tokens.brandRed} stopOpacity={0} />
        </RadialGradient>
        <RadialGradient id="heroWashB" cx={0} cy={100} rx={45} ry={120} gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor={tokens.brandRed} stopOpacity={0.16} />
          <Stop offset="0.72" stopColor={tokens.brandRed} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Rect x={0} y={0} width={100} height={100} fill="url(#heroWashA)" />
      <Rect x={0} y={0} width={100} height={100} fill="url(#heroWashB)" />
    </Svg>
  );
}

/** Шапка «Главной» без выбранной страны: тёмная плашка с красными пятнами и знаком EVO (HomeHero, веб). */
export function HomeHero(props: Omit<HeroContentProps, "onPhoto">) {
  const { tokens, scheme } = useTheme();
  return (
    <View
      testID="home-hero"
      style={{
        overflow: "hidden",
        borderTopWidth: 3,
        borderTopColor: tokens.brandRed,
        borderRadius: tokens.radiusCard,
        backgroundColor: tokens.heroBg,
        boxShadow: scheme === "dark" ? undefined : tokens.shadowCard,
      }}
    >
      <HeroWash />
      <View pointerEvents="none" testID="hero-mark" style={{ position: "absolute", top: -36, right: -40 }}>
        <EvoMark size={300} color={markColor(tokens.heroMark)} />
      </View>
      <View style={{ paddingHorizontal: 20, paddingTop: 22, paddingBottom: 18 }}>
        <HeroContent {...props} />
      </View>
    </View>
  );
}

/**
 * Фото столицы на всю шапку под ровной тёмной подложкой. Копия нужной ширины, при отказе оригинал, при отказе обоих
 * `onFailed`: шапка остаётся тёмной плашкой, «©» не к чему (PlaceImage веба убирает картинку так же).
 */
export function HeroPhotoLayer({ urls, onFailed }: { urls: PhotoUrls; onFailed: () => void }) {
  const [stage, setStage] = useState<"sized" | "original">("sized");
  const uri = stage === "sized" ? (urls.sized ?? urls.original) : urls.original;
  return (
    <>
      <Image
        source={{ uri }}
        testID="hero-photo"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        contentFit="cover"
        transition={150}
        onError={() => (stage === "sized" && urls.sized ? setStage("original") : onFailed())}
        style={StyleSheet.absoluteFill}
      />
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: PHOTO_SCRIM }]} />
    </>
  );
}

/** «©» в нижнем углу шапки: автор, источник и лицензия по нажатию (PhotoRights, веб; сверху справа стоит отсчёт). */
export function HeroCredit({ credit }: { credit: PhotoCreditView }) {
  const { t, m } = useLang();
  const strings = t("universities");
  const [shown, setShown] = useState(false);
  return (
    <View style={{ position: "absolute", right: 2, bottom: 6, alignItems: "flex-end", maxWidth: "92%" }} pointerEvents="box-none">
      {shown ? (
        <Pressable
          accessibilityRole="link"
          onPress={() => void Linking.openURL(credit.sourceUrl).catch(() => undefined)}
          testID="hero-credit-text"
          style={{ marginRight: 8, maxWidth: 260, minHeight: MIN_TARGET, justifyContent: "center", paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8, backgroundColor: "rgba(20,16,12,0.86)" }}
        >
          <Text variant="caption" style={{ color: "#ffffff", textDecorationLine: "underline" }}>
            {creditLine(credit, strings)}
          </Text>
        </Pressable>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={shown ? m("uni.creditHide") : strings.photoRights}
        accessibilityState={{ expanded: shown }}
        onPress={() => setShown((value) => !value)}
        testID="hero-credit"
        style={{ width: MIN_TARGET, height: MIN_TARGET, alignItems: "center", justifyContent: "center" }}
      >
        <View style={{ width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: shown ? "rgba(20,16,12,0.86)" : "rgba(20,16,12,0.55)" }}>
          <Text variant="secondary" style={{ color: "#ffffff", lineHeight: 16 }}>
            ©
          </Text>
        </View>
      </Pressable>
    </View>
  );
}
