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

/** Во сколько раз системный шрифт может увеличить число и слово отсчёта: как приветствие шапки (`display`, 1.2). */
const BIG_MAX_SCALE = 1.2;
/**
 * Ширина, с которой подпись отсчёта («дней до 25 сент.» и дело) остаётся рядом с числом или словом; уже - переносится строкой
 * ниже. Красная плашка «Просрочено» (24, жирный, поля по 12) занимает около 160 pt из 335 pt ширины шапки на телефоне: рядом с ней
 * подписи оставалось бы около 170 pt, и название дела обрезалось бы на 18 знаках. Поэтому плашка стоит на своей строке, а дата и
 * дело идут под ней на всю ширину; число дней («24») и слова без плашки («Сегодня», «Завтра») остаются в одной строке с подписью.
 */
const COUNT_TEXT_BASIS = 180;
/** Приветствие занимает не больше двух строк: дальше шрифт ужимается (не мельче 60%, около 19 pt при 32), а слово не рвётся посреди. */
const GREETING_LINES = 2;
const GREETING_MIN_SCALE = 0.6;

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
  // «Сегодня», «Завтра» и «Просрочено» стоят на месте числа и мельче (`data-word`). У числа `when.word` - единица («дня», «дней»),
  // у слова он пуст: условие было перевёрнуто, слово «Просрочено» рисовалось в 44 pt и занимало три четверти строки, число - в 24.
  const bigIsWord = when !== null && !when.word;
  const bigSize = bigIsWord ? tokens.sizeTitle : tokens.sizeDisplay * 1.375;

  return (
    <View style={{ gap: 14 }}>
      <View style={{ gap: 8 }}>
        {/* Заголовок «Главной»: display, вес 700, трекинг -0.02em, интерлиньяж 1.15 (`.pt-home-hero-title`). */}
        {/* Два ряда, дальше шрифт ужимается: при крупном шрифте системы длинное слово («Сопровождаемый») не рвётся посреди. */}
        <Text
          variant="display"
          maxFontSizeMultiplier={1.2}
          numberOfLines={GREETING_LINES}
          adjustsFontSizeToFit
          minimumFontScale={GREETING_MIN_SCALE}
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
          // Строка переносится: при крупном шрифте системы и в кыргызском («Мөөнөтү өттү») подпись уходит под число, а не
          // сжимается в узкий столбец (веб: сетка `auto minmax(0, 1fr)` внутри шапки, текст там масштабируется масштабом страницы).
          style={({ pressed }) => ({
            minHeight: MIN_TARGET,
            flexDirection: "row",
            flexWrap: "wrap",
            alignItems: "baseline",
            columnGap: 10,
            rowGap: 2,
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
              // Крупное число (44) и слово («Просрочено», 24) растут вместе с шрифтом системы не больше, чем заголовок шапки:
              // читалка и так слышит всю фразу (метка плашки), а видимый ряд не должен выходить за ширину шапки.
              maxFontSizeMultiplier={BIG_MAX_SCALE}
              style={{
                color: tokens.heroInk,
                fontFamily: sansFont("bold"),
                fontSize: bigSize,
                // Слову (кириллица с выносными «р», «у», «д») нужен запас снизу, числу нет.
                lineHeight: bigIsWord ? bigSize * 1.2 : bigSize,
                fontVariant: ["tabular-nums"],
                letterSpacing: -0.03 * bigSize,
              }}
            >
              {when.big}
            </Text>
          </View>
          <View style={{ flexGrow: 1, flexShrink: 1, flexBasis: COUNT_TEXT_BASIS, minWidth: 0, gap: 2 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" testID="hero-countdown-text">
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

/**
 * «©» в нижнем углу шапки: автор, источник и лицензия по нажатию (PhotoRights, веб; сверху справа стоит отсчёт).
 *
 * Кнопка лежит в углу, в запасе под кнопками шапки (нижний отступ 52 pt). Подпись, раскрытая по нажатию, стоит в потоке шапки под
 * её кнопками, а не всплывает над «©» поверх них: шапка на время вырастает на высоту подписи, и подпись никогда не закрывает
 * «Сменить страну» и «Все шаги» (QA 25.11.2026: поверх них она ложилась). Компонент стоит последним в колонке содержимого шапки,
 * поэтому правый и нижний край колонки - край шапки.
 */
export function HeroCredit({ credit }: { credit: PhotoCreditView }) {
  const { t, m } = useLang();
  const strings = t("universities");
  const [shown, setShown] = useState(false);
  return (
    <>
      {shown ? (
        <Pressable
          accessibilityRole="link"
          onPress={() => void Linking.openURL(credit.sourceUrl).catch(() => undefined)}
          testID="hero-credit-text"
          // Правый край подписи на одной линии с кружком «©»: колонка содержимого отступает на 16, кружок - на 10.
          style={{ alignSelf: "flex-end", marginRight: -6, maxWidth: 260, minHeight: MIN_TARGET, justifyContent: "center", paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8, backgroundColor: "rgba(20,16,12,0.86)" }}
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
        style={{ position: "absolute", right: 2, bottom: 6, width: MIN_TARGET, height: MIN_TARGET, alignItems: "center", justifyContent: "center" }}
      >
        <View style={{ width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: shown ? "rgba(20,16,12,0.86)" : "rgba(20,16,12,0.55)" }}>
          <Text variant="secondary" style={{ color: "#ffffff", lineHeight: 16 }}>
            ©
          </Text>
        </View>
      </Pressable>
    </>
  );
}
