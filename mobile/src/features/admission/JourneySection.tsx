// «Путь поступления» на «Главной» (CountryTimeline.tsx, веб #1412 и #1489): один блок со страной. Сверху шапка «Главной»
// на фото столицы (приветствие, «страна · набор», отсчёт, «Сменить страну»), под ней строка текущего шага «Шаг N из M ·
// дальше — …» с полосой шагов и «Все шаги»; шаги с пунктами и ссылками, «Важно знать» раскрываются здесь же. Тексты шагов
// приходят из src/content/timelines/*.json через общий разбор веба (набор bundled, работает без сети); здесь только вид.
import { Calendar, Check, ChevronDown, ExternalLink, Info } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AccessibilityInfo, Pressable, View, useWindowDimensions, type LayoutChangeEvent, type StyleProp, type ViewStyle } from "react-native";
import type { CountryChoiceSource } from "@web/lib/portal/country-choice";
import type { CountryTimelineView, TimelineStepProgress, TimelineViewStep } from "@web/lib/portal/country-timeline";
import { journeyStrip } from "@web/lib/portal/journey-strip";

import { usePortalApi } from "@/api/PortalApi";
import { useFolded, useOpenSteps } from "@/features/admission/useOpenSteps";
import { HeroCredit, HeroPhotoLayer, HeroWash } from "@/features/home/HomeHero";
import { CountryPicker } from "@/features/portal/CountryChoiceCard";
import { JourneyMeter } from "@/features/portal/JourneyMeter";
import { go, openLink } from "@/features/portal/navigation";
import type { PhotoCreditView, PhotoUrls } from "@/features/universities/photos";
import { useLang } from "@/i18n/LangProvider";
import { useTheme, type Tokens } from "@/theme/ThemeProvider";
import { MIN_TARGET, InlineAlert } from "@/ui/CardParts";
import { Turn } from "@/ui/motion";
import { Text } from "@/ui/Text";

const NODE = 32;
/** Низ шапки пути: веб `padding-bottom: 52px` у `.pt-journey-head[data-hero]` на узкой шапке, с фото столицы и без него. */
const HERO_BOTTOM = 52;
/** Круг с номером текущего шага и промежуток до названия (веб: `--pt-now-node` 36, `--pt-now-gap` 14). */
const NOW_NODE = 36;
const NOW_GAP = 14;

function StepPanel({ step }: { step: TimelineViewStep }) {
  const { t } = useLang();
  const { tokens } = useTheme();
  const timeline = t("timeline");
  return (
    <View style={{ gap: 12, paddingTop: 8 }}>
      {step.note ? (
        <Text variant="secondary" tone="text2">
          {step.note}
        </Text>
      ) : null}
      {step.items.length > 0 ? (
        <View style={{ gap: 8 }}>
          <Text variant="caption" tone="text2" bold accessibilityRole="header">
            {timeline.checklist}
          </Text>
          {step.items.map((item) => (
            <View key={item.id} testID={`item-${item.id}`} style={{ flexDirection: "row", gap: 10, alignItems: "flex-start" }}>
              <View
                style={{ borderWidth: 1, borderColor: item.who === "student" ? tokens.controlEdge : tokens.line, borderRadius: tokens.radiusChip, paddingHorizontal: 8, paddingVertical: 2, backgroundColor: tokens.surface }}
              >
                <Text variant="caption" bold={item.who === "student"} tone={item.who === "student" ? "text" : "text2"}>
                  {item.whoLabel}
                </Text>
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                {item.appliesTo ? (
                  <Text variant="caption" tone="text2">
                    {item.appliesTo}
                  </Text>
                ) : null}
                <Text variant="secondary">{item.text}</Text>
                {item.note ? (
                  <Text variant="caption" tone="text2">
                    {item.note}
                  </Text>
                ) : null}
              </View>
            </View>
          ))}
        </View>
      ) : null}
      {step.links.map((link) => (
        <Pressable
          key={link.id}
          accessibilityRole="link"
          accessibilityLabel={link.external ? `${link.label} (${timeline.external})` : link.label}
          accessibilityHint={link.external ? timeline.external : undefined}
          onPress={() => openLink(link.href)}
          style={{ minHeight: MIN_TARGET, flexDirection: "row", alignItems: "center", gap: 6 }}
          testID={`link-${link.id}`}
        >
          <Text variant="secondary" tone="accent" bold style={{ flexShrink: 1 }}>
            {link.label}
          </Text>
          {link.external ? <ExternalLink size={16} strokeWidth={1.75} color={tokens.accent} /> : null}
        </Pressable>
      ))}
      <View style={{ gap: 4, padding: 12, borderRadius: tokens.radiusItem, backgroundColor: tokens.bg }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Check size={16} strokeWidth={1.75} color={tokens.ok} />
          <Text variant="caption" bold accessibilityRole="header">
            {timeline.doneWhen}
          </Text>
        </View>
        <Text variant="secondary">{step.doneWhen}</Text>
      </View>
    </View>
  );
}

/** Фото шапки: адреса копий (`geographyPhotoUrls`) и подпись автора по «©». */
export type JourneyPhoto = Readonly<{ urls: PhotoUrls; credit: PhotoCreditView }>;

/** Шапка «Главной» (приветствие, «страна · набор», отсчёт): `onPhoto` - лежит ли она на фото (тогда подпись белая). */
export type HeroRender = (onPhoto: boolean) => ReactNode;

/** Где что стоит на экране: по этим отступам «строка шага» прокручивает экран к текущему шагу (веб `jumpToCurrent`). */
type Layouts = { body: number; list: number; now: number; steps: Record<string, number> };

/**
 * Состояние блока пути (CountryTimeline.tsx, веб): свёрнутость, раскрытые шаги, выбор страны, «Пройдено» и фото, которое
 * не загрузилось. Блок на «Главной» состоит из нескольких блоков списка экрана - шапка, закреплённая строка шага, шаги
 * (JourneyHead, JourneyNow, JourneyBody), - поэтому состояние живёт здесь, а не в одном компоненте.
 *
 * `scrollTo` - прокрутка экрана (у «Главной» её ScrollView): строка шага раскрывает путь и текущий шаг и прокручивает к
 * нему так, чтобы он встал под закреплённой строкой (веб: `scrollIntoView` с отступом по высоте строки и 12 px).
 */
export function useJourney({
  view,
  progress,
  stage = null,
  initiallyUnfolded = false,
  unfoldStamp = "",
  scrollTo,
}: {
  view: CountryTimelineView | null;
  progress: Readonly<Record<string, TimelineStepProgress>> | null;
  /** Этап дела (`operational_stage`): `completed` и `closed` - «Поступление завершено», как у `journeyStrip`. */
  stage?: string | null;
  /** Переход «Весь путь» с «Главной»: путь раскрыт. */
  initiallyUnfolded?: boolean;
  /** Метка запроса «раскрыть» (`at` ссылки): новая метка раскрывает путь снова, даже если студент его свернул. */
  unfoldStamp?: string;
  scrollTo?: (y: number) => void;
}) {
  const { userKey } = usePortalApi();
  const { open, toggle } = useOpenSteps(view, userKey);
  // Путь на «Главной» свёрнут у всех до шапки (веб, 18.11.2026: `useFolded(true)`); выбор студента помнится.
  const { folded, setFolded } = useFolded(true, userKey);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [showDone, setShowDone] = useState(false);
  // Высота строки шага: от неё зависит, закреплять ли её (`rowPinned`), поэтому это состояние, а не только запись в `layouts`.
  const [nowHeight, setNowHeight] = useState(0);
  // Фото, которое не загрузилось: шапка остаётся тёмной плашкой, «©» не к чему.
  const [failedPhoto, setFailedPhoto] = useState<string | null>(null);
  const layouts = useRef<Layouts>({ body: 0, list: 0, now: 0, steps: {} });
  const pendingJump = useRef<string | null>(null);

  useEffect(() => {
    if (initiallyUnfolded) setFolded(false);
  }, [initiallyUnfolded, unfoldStamp, setFolded]);

  // Строка под шапкой: текущий шаг или «Поступление завершено». Тот же счёт, что у веба и iPhone (`journeyStrip`): номер -
  // `order` шага, всего - все шаги, «дальше» пропускает шаги «по желанию». Нет прогресса (дела нет) - строки нет.
  const strip = view ? journeyStrip(view.steps, progress, stage) : null;
  const currentStep = view?.steps.find((step) => progress?.[step.id] === "current") ?? null;
  // Держится ли строка у верха, пока прокручиваются шаги (`rowPinned`): решает и порядок блоков списка, и то, под чем встаёт шаг.
  const { height: viewportHeight } = useWindowDimensions();
  const pinned = rowPinned({ hasStrip: strip !== null, folded, rowHeight: nowHeight, viewportHeight });

  const scrollToStep = useCallback(
    (id: string) => {
      const at = layouts.current;
      const step = at.steps[id];
      if (!scrollTo || step === undefined) return;
      // Шаг встаёт под закреплённой строкой: её высота и 12 px запаса. Строка не держится (высокий шрифт, строка выше 40% окна) -
      // под ней ничего нет, остаются только 12 px запаса.
      scrollTo(Math.max(0, at.body + at.list + step - (pinned ? at.now : 0) - 12));
    },
    [scrollTo, pinned],
  );

  const jumpToCurrent = () => {
    if (!currentStep) return;
    const id = currentStep.id;
    if (folded) setFolded(false);
    if (!open.has(id)) toggle(id);
    if (!scrollTo) return;
    // Путь уже на экране - прокрутка сразу; иначе после того, как шаг получит место (`onStepLayout`).
    if (!folded && layouts.current.steps[id] !== undefined) scrollToStep(id);
    else pendingJump.current = id;
  };

  return {
    view,
    progress,
    strip,
    currentStep,
    open,
    toggle,
    folded,
    setFolded,
    pickerOpen,
    setPickerOpen,
    showDone,
    setShowDone,
    failedPhoto,
    setFailedPhoto,
    jumpToCurrent,
    nowHeight,
    pinned,
    onNowLayout: (height: number) => {
      layouts.current.now = height;
      // Доли пикселя при пересчёте раскладки не считаются изменением: иначе строка могла бы мигать закреплением.
      setNowHeight((previous) => (Math.abs(previous - height) < 0.5 ? previous : height));
    },
    onBodyLayout: (y: number) => {
      layouts.current.body = y;
    },
    onListLayout: (y: number) => {
      layouts.current.list = y;
    },
    onStepLayout: (id: string, y: number) => {
      layouts.current.steps[id] = y;
      if (pendingJump.current === id) {
        pendingJump.current = null;
        // Положение блоков друг в друге доходит отдельными событиями: прокрутка - кадром позже.
        requestAnimationFrame(() => scrollToStep(id));
      }
    },
  };
}

export type Journey = ReturnType<typeof useJourney>;

// ---- Оболочка карточки из нескольких блоков ----------------------------------------------------------------------

/** Место блока в карточке пути: единственный, верхний, средний, нижний. */
export type Edge = "only" | "first" | "middle" | "last";

/**
 * Карточка пути на веб - одна `.pt-card`. Здесь она сложена из блоков списка экрана (закреплённой может быть только
 * прямая часть списка), поэтому каждый блок рисует свою часть рамки: боковые линии у всех, верх и скругление у первого,
 * низ и скругление у последнего. Тень карточки у каждого блока та же.
 */
export function cardEdge(tokens: Tokens, scheme: "light" | "dark", edge: Edge): ViewStyle {
  const top = edge === "only" || edge === "first";
  const bottom = edge === "only" || edge === "last";
  const radius = tokens.radiusCard;
  return {
    backgroundColor: tokens.surface,
    borderColor: tokens.line,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderTopWidth: top ? 1 : 0,
    borderBottomWidth: bottom ? 1 : 0,
    borderTopLeftRadius: top ? radius : 0,
    borderTopRightRadius: top ? radius : 0,
    borderBottomLeftRadius: bottom ? radius : 0,
    borderBottomRightRadius: bottom ? radius : 0,
    boxShadow: scheme === "dark" ? undefined : tokens.shadowCard,
  };
}

/** Какие блоки есть сейчас: шапка всегда, строка шага при прогрессе, шаги у раскрытого пути. */
export function journeyEdges(journey: Pick<Journey, "strip" | "folded">): Readonly<{ head: Edge; now: Edge; body: Edge }> {
  const hasNow = journey.strip !== null;
  const hasBody = !journey.folded;
  return { head: hasNow || hasBody ? "first" : "only", now: hasBody ? "middle" : "last", body: "last" };
}

/**
 * Какую долю высоты окна строка шага может занимать, оставаясь закреплённой. При крупном шрифте системы (iPhone, Dynamic Type
 * «Accessibility») строка выше 40% окна: закреплённая, она закрывала бы почти половину и мешала читать карточки под ней. Берётся
 * высота окна, а не прокрутки (она на панель вкладок меньше): в пользу закрепления, граница не точна до пункта.
 */
export const PIN_MAX_SHARE = 0.4;

/**
 * Запас под строкой шага (pt), когда нулевой блок `JourneyEnd` стоит сразу за ней (путь свёрнут или строка высокая). React Native
 * (`ScrollViewStickyHeader`) отпускает закреплённый блок, только если `nextHeaderLayoutY - layoutHeight >= layoutY`. Блок за
 * строкой стоит ровно у её нижнего края, обе стороны РАВНЫ, и результат решают округления float32 (на реальном телефоне
 * y=356.190491, высота 117.333336, блок 473.523804: левая часть меньше правой на 2e-5, строка оставалась на экране навсегда и
 * закрывала карточки). Два пункта запаса делают неравенство строгим с большим зазором, а строка успевает закрепиться на те же
 * два пункта прокрутки, то есть уезжает вместе с содержимым. Меньший запас не годится: на стенде ревьюера (Yoga и настоящий
 * ScrollView, 1000 раскладок) при 0,05 pt застревает 316 раскладок, при 0,2 pt - 145, при 2 pt ни одной. Видимой щели запас не
 * оставляет: блок `JourneyEnd` тянет следующий за ним блок обратно на `-ROW_SLACK` (`HomeScreen.tsx`).
 */
export const ROW_SLACK = 2;

/**
 * Держится ли строка шага у верха экрана, пока прокручиваются раскрытые шаги (веб: `position: sticky` у `.pt-journey-now` внутри
 * карточки пути). Строка закреплена ВСЕГДА (в списке экрана она закреплённый блок и при свёрнутом пути): если закрепление
 * включать и выключать, блок пересоздаётся при каждом «Свернуть» и «Все шаги» (полоса шагов растёт заново, стрелка не
 * поворачивается, кнопка с фокусом читалки пропадает). От этого правила зависит только место нулевого блока `JourneyEnd`:
 * за шагами (строка держится на всё их протяжение) или сразу за строкой (почти не держится, `ROW_SLACK`).
 *
 * - Путь свёрнут - нет: шагов под строкой нет, карточка пути кончается ею же (у веба закреплять негде).
 * - Строка занимает больше `PIN_MAX_SHARE` окна - нет (крупный шрифт).
 * - Строки нет - нет.
 * - Высота строки или окна ещё неизвестна (0) - да, пока путь раскрыт: до первой раскладки решать нечем, а ошибка стоит одного
 *   кадра без видимого эффекта (закрепление заметно только при прокрутке), блоки при этом лишь переставляются, не пересоздаются.
 */
export function rowPinned(input: Readonly<{ hasStrip: boolean; folded: boolean; rowHeight: number; viewportHeight: number }>): boolean {
  if (!input.hasStrip || input.folded) return false;
  if (!(input.rowHeight > 0) || !(input.viewportHeight > 0)) return true;
  return input.rowHeight <= input.viewportHeight * PIN_MAX_SHARE;
}

/** «Все шаги» / «Свернуть»: весь путь сворачивается в строку текущего шага (веб, 08.11.2026). */
function FoldButton({ journey, onHero }: { journey: Journey; onHero: boolean }) {
  const { tokens } = useTheme();
  const { t } = useLang();
  const timeline = t("timeline");
  const { folded, setFolded } = journey;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded: !folded }}
      accessibilityLabel={folded ? timeline.showSteps : timeline.hideSteps}
      onPress={() => setFolded(!folded)}
      testID="journey-fold"
      style={({ pressed }) => ({
        minHeight: MIN_TARGET,
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingLeft: onHero ? 14 : 10,
        paddingRight: onHero ? 10 : 6,
        borderRadius: tokens.radiusControl,
        borderWidth: onHero ? 1 : 0,
        borderColor: tokens.heroInk,
        opacity: pressed ? 0.8 : 1,
      })}
    >
      <Text variant="secondary" bold style={{ color: onHero ? tokens.heroInk : tokens.text }}>
        {folded ? timeline.showSteps : timeline.hideSteps}
      </Text>
      <Turn turned={!folded}>
        <ChevronDown size={18} strokeWidth={1.75} color={onHero ? tokens.heroInk : tokens.text2} />
      </Turn>
    </Pressable>
  );
}

// ---- Шапка ---------------------------------------------------------------------------------------------------------

/**
 * Шапка пути на «Главной» (веб `CountryTimeline` с проп `hero`): приветствие, «страна · набор» и отсчёт на фото столицы
 * (нет фото - тёмная плашка с красными пятнами), под ними «Сменить страну» и, пока нет строки текущего шага, «Все шаги»;
 * «©» с автором внизу; выбор страны раскрывается под шапкой. Заголовок пути для читалки - скрытый заголовок (веб: h2).
 */
export function JourneyHead({
  journey,
  edge,
  source,
  readFailed,
  hero,
  photo = null,
}: {
  journey: Journey;
  edge: Edge;
  source: CountryChoiceSource | null;
  readFailed: boolean;
  hero: HeroRender;
  /** Фото столицы выбранной страны; `null` - шапка на тёмной плашке. */
  photo?: JourneyPhoto | null;
}) {
  const { t, m, format } = useLang();
  const { tokens, scheme } = useTheme();
  const timeline = t("timeline");
  const view = journey.view;
  const { failedPhoto, setFailedPhoto, pickerOpen, setPickerOpen, strip } = journey;
  // После сохранения страны читалка называет новый заголовок пути (веб: фокус на заголовок блока, `headingRef.focus()`).
  // Пока заголовок прежний, ждём: выбор уже сохранён, а ответ ещё обновляет путь.
  const title = view ? (view.countryName ? format(timeline.headingCountry, { country: view.countryName }) : timeline.heading) : null;
  const announceFrom = useRef<string | null>(null);
  useEffect(() => {
    if (announceFrom.current === null || title === null || title === announceFrom.current) return;
    AccessibilityInfo.announceForAccessibility(title);
    announceFrom.current = null;
  }, [title]);
  if (!view || title === null) return null;
  const shownPhoto = photo !== null && failedPhoto !== photo.urls.original ? photo : null;
  // Откуда страна. На шапке подписи нет (19.11.2026): её говорит подсказка выбора страны, когда студент её открывает.
  const sourceNote = source === "application" ? timeline.sourceApplication : source === "case" ? timeline.sourceCase : null;
  const showExtras = readFailed || pickerOpen;

  return (
    <View testID="journey" style={[cardEdge(tokens, scheme, edge), { overflow: "hidden" }]}>
      <View testID="home-hero" style={{ overflow: "hidden", borderTopWidth: 3, borderTopColor: tokens.brandRed, backgroundColor: tokens.heroBg }}>
        {/* Красные пятна лежат под фото: пока оно грузится или не загрузилось, видна плашка. */}
        <HeroWash />
        {shownPhoto ? <HeroPhotoLayer key={shownPhoto.urls.original} urls={shownPhoto.urls} onFailed={() => setFailedPhoto(shownPhoto.urls.original)} /> : null}
        {/* Низ шапки 52 всегда, с фото и без (веб: `.pt-journey-head[data-hero]` на узкой шапке): фото приходит позже индекса каталога,
            и шапка не должна вырасти на 32 после первой отрисовки; под «©» и так нужно место. */}
        <View testID="hero-content" style={{ gap: 16, paddingHorizontal: 16, paddingTop: 22, paddingBottom: HERO_BOTTOM }}>
          {/* Приветствие первым, за ним заголовок пути (веб: h1 приветствия, затем скрытый h2). Заголовок лежит в левом нижнем
              углу блока приветствия: и по порядку в разметке, и по месту на экране он идёт после приветствия, отсчёта и «страны». */}
          <View>
            {hero(shownPhoto !== null)}
            <Text accessibilityRole="header" testID="journey-heading" style={{ position: "absolute", left: 0, bottom: 0, width: 1, height: 1, overflow: "hidden", color: "transparent" }}>
              {title}
            </Text>
          </View>
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
            {strip ? null : <FoldButton journey={journey} onHero />}
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: pickerOpen }}
              onPress={() => setPickerOpen(!pickerOpen)}
              testID="change-country"
              style={({ pressed }) => ({
                minHeight: MIN_TARGET,
                justifyContent: "center",
                paddingHorizontal: 14,
                borderRadius: tokens.radiusControl,
                borderWidth: 1,
                borderColor: tokens.heroInk,
                opacity: pressed ? 0.8 : 1,
              })}
            >
              <Text variant="secondary" bold style={{ color: tokens.heroInk }}>
                {timeline.changeCountry}
              </Text>
            </Pressable>
          </View>
        </View>
        {shownPhoto ? <HeroCredit credit={shownPhoto.credit} /> : null}
      </View>
      {showExtras ? (
        <View style={{ gap: 12, paddingHorizontal: 16, paddingTop: 16, paddingBottom: edge === "only" ? 20 : 0 }}>
          {readFailed ? <InlineAlert message={m("error.load")} /> : null}
          {pickerOpen ? <CountryPicker current={view.choice} source={source} lead={sourceNote ? `${sourceNote} ${timeline.changeLead}` : timeline.changeLead} onDone={() => { setPickerOpen(false); announceFrom.current = title; }} onCancel={() => setPickerOpen(false)} /> : null}
        </View>
      ) : null}
    </View>
  );
}

// ---- Строка текущего шага (закрепляется) --------------------------------------------------------------------------

/**
 * Строка под шапкой (веб `.pt-journey-now`): круг с номером шага, название, «Шаг N из M · дальше — …», полоса шагов и
 * «Все шаги» в её конце; дело завершено или закрыто - «Поступление завершено» без полосы. Текущий шаг всегда на виду
 * при прокрутке пути (веб, 08.11.2026: `position: sticky`): в списке экрана это закреплённый блок, его толкает вверх
 * следующий закреплённый блок - `JourneyEnd`, стоящий сразу за путём, поэтому закрепление не выходит за карточку пути.
 * Закреплена всегда, пока она есть; держится ли у верха на время шагов, решает `rowPinned` (место блока `JourneyEnd`, `ROW_SLACK`).
 * Корневой элемент берёт `style` от списка (ScrollView переносит стиль на обёртку закреплённого блока).
 */
export function JourneyNow({ journey, edge, style }: { journey: Journey; edge: Edge; style?: StyleProp<ViewStyle> }) {
  const { t, format } = useLang();
  const { tokens, scheme } = useTheme();
  const timeline = t("timeline");
  const home = t("home");
  const { strip, progress, view } = journey;
  if (!strip || !view) return null;
  const stepText = strip.kind === "step" ? format(home.stripStep, { n: String(strip.n), total: String(strip.total) }) : null;
  const nextText = strip.kind === "step" && strip.nextTitle ? format(home.stripNext, { title: strip.nextTitle }) : null;
  const node = (content: ReactNode, complete = false) => (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: NOW_NODE, height: NOW_NODE, borderRadius: NOW_NODE / 2, alignItems: "center", justifyContent: "center", backgroundColor: complete ? tokens.ok : tokens.text }}
    >
      {content}
    </View>
  );

  return (
    <View
      testID="journey-now-row"
      accessibilityRole="summary"
      accessibilityLabel={timeline.whereNow}
      onLayout={(event: LayoutChangeEvent) => journey.onNowLayout(event.nativeEvent.layout.height)}
      style={[cardEdge(tokens, scheme, edge), { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8, borderBottomWidth: 1 }, style]}
    >
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        {strip.kind === "step" ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${strip.title}. ${stepText}${nextText ? `, ${nextText}` : ""}`}
            onPress={journey.jumpToCurrent}
            testID="journey-now"
            style={{ flex: 1, minHeight: MIN_TARGET, flexDirection: "row", alignItems: "center", gap: NOW_GAP }}
          >
            {node(
              <Text variant="body" bold style={{ color: tokens.surface, fontVariant: ["tabular-nums"] }}>
                {strip.n}
              </Text>,
            )}
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="body" bold testID="journey-title">
                {strip.title}
              </Text>
              <Text variant="secondary" tone="text2" testID="journey-sub">
                {stepText}
                {nextText ? ` · ${nextText}` : ""}
              </Text>
            </View>
          </Pressable>
        ) : (
          <View accessible testID="journey-complete" style={{ flex: 1, minHeight: MIN_TARGET, flexDirection: "row", alignItems: "center", gap: NOW_GAP }}>
            {node(<Check size={20} strokeWidth={2.25} color={tokens.surface} />, true)}
            <Text variant="body" bold style={{ flex: 1 }}>
              {home.stripDone}
            </Text>
          </View>
        )}
        {/* Без полосы (дело завершено или закрыто) «Все шаги» стоит в одной строке с «Поступление завершено». */}
        {progress === null ? <FoldButton journey={journey} onHero={false} /> : null}
      </View>
      {progress !== null ? (
        // Полоса шагов начинается под названием, «Все шаги» в её конце; где тесно, кнопка уходит строкой ниже.
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "flex-end", columnGap: 12, marginLeft: NOW_NODE + NOW_GAP }}>
          <View style={{ flexBasis: 128, flexGrow: 1, marginVertical: 12 }}>
            <JourneyMeter steps={view.steps} progress={progress} />
          </View>
          <FoldButton journey={journey} onHero={false} />
        </View>
      ) : null}
    </View>
  );
}

/**
 * Нулевой закреплённый блок сразу за путём: когда он доходит до верха экрана, он выталкивает строку шага, и закрепление
 * кончается вместе с карточкой пути (в вебе это границы родителя у `position: sticky`).
 */
export function JourneyEnd({ style }: { style?: StyleProp<ViewStyle> }) {
  return <View testID="journey-end" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[{ height: 0 }, style]} />;
}

// ---- Шаги ----------------------------------------------------------------------------------------------------------

/** Раскрытый путь: пояснение срока, «Пройдено», шаги с пунктами и ссылками, «Важно знать». */
export function JourneyBody({ journey, edge, assisted, style }: { journey: Journey; edge: Edge; assisted: boolean; style?: StyleProp<ViewStyle> }) {
  const { t, m, format } = useLang();
  const { tokens, scheme } = useTheme();
  const timeline = t("timeline");
  const { view, progress, strip, open, toggle, showDone, setShowDone } = journey;
  if (!view) return null;
  const total = view.steps.length;
  const progressOf = (id: string): TimelineStepProgress | null => progress?.[id] ?? null;
  const doneSteps = view.steps.filter((step) => progressOf(step.id) === "done");

  return (
    <View
      testID="journey-body"
      onLayout={(event: LayoutChangeEvent) => journey.onBodyLayout(event.nativeEvent.layout.y)}
      style={[cardEdge(tokens, scheme, edge), { gap: 4, paddingHorizontal: 16, paddingTop: strip ? 16 : 12, paddingBottom: 20 }, style]}
    >
      {/* В шапке-приветствии места под пояснение срока нет: оно открывается вместе с шагами (веб, 19.11.2026). */}
      {view.intake.note ? (
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 6, paddingBottom: 8 }}>
          <Calendar size={14} strokeWidth={1.75} color={tokens.text2} style={{ marginTop: 2 }} />
          <Text variant="caption" tone="text2" style={{ flex: 1 }} testID="journey-intake-note">
            {view.intake.note}
          </Text>
        </View>
      ) : null}
      {doneSteps.length > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: showDone }}
          onPress={() => setShowDone(!showDone)}
          testID="journey-done-toggle"
          style={{ minHeight: MIN_TARGET, flexDirection: "row", alignItems: "center", gap: 10 }}
        >
          <View style={{ width: NODE, height: NODE, borderRadius: NODE / 2, backgroundColor: tokens.ok, alignItems: "center", justifyContent: "center" }}>
            <Check size={18} strokeWidth={2.25} color={tokens.surface} />
          </View>
          <View style={{ flex: 1 }}>
            <Text variant="secondary" bold>
              {timeline.showDone}
            </Text>
            <Text variant="caption" tone="text2" numberOfLines={showDone ? undefined : 1}>
              {doneSteps.map((step) => step.title).join(" · ")}
            </Text>
          </View>
          <Turn turned={showDone}>
            <ChevronDown size={18} strokeWidth={1.75} color={tokens.text2} />
          </Turn>
        </Pressable>
      ) : null}
      <View
        accessibilityRole="list"
        accessibilityLabel={timeline.stepsLabel}
        onLayout={(event: LayoutChangeEvent) => journey.onListLayout(event.nativeEvent.layout.y)}
      >
        {view.steps.map((step, index) => {
          const state = progressOf(step.id);
          if (state === "done" && !showDone) return null;
          const expanded = open.has(step.id);
          const last = index === view.steps.length - 1;
          const stepLabel = format(timeline.stepOf, { n: String(step.order), total: String(total) });
          return (
            <View
              key={step.id}
              testID={`step-${step.id}`}
              onLayout={(event: LayoutChangeEvent) => journey.onStepLayout(step.id, event.nativeEvent.layout.y)}
              style={{ flexDirection: "row", gap: 10, paddingBottom: last ? 0 : 12 }}
            >
              <View style={{ alignItems: "center", width: NODE }}>
                <View
                  style={{
                    width: NODE,
                    height: NODE,
                    borderRadius: NODE / 2,
                    borderWidth: 1.5,
                    alignItems: "center",
                    justifyContent: "center",
                    borderColor: state === "done" ? tokens.ok : expanded || state === "current" ? tokens.text : tokens.controlEdge,
                    backgroundColor: state === "done" ? tokens.ok : expanded || state === "current" ? tokens.text : tokens.surface,
                  }}
                >
                  {state === "done" ? (
                    <Check size={18} strokeWidth={2.25} color={tokens.surface} />
                  ) : (
                    <Text variant="secondary" bold tone={expanded || state === "current" ? "onAccent" : "text"} style={{ color: expanded || state === "current" ? tokens.surface : tokens.text }}>
                      {step.order}
                    </Text>
                  )}
                </View>
                {last ? null : <View style={{ flex: 1, width: 2, marginTop: 4, backgroundColor: state === "done" ? tokens.ok : tokens.line }} />}
              </View>
              <View style={{ flex: 1 }}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded }}
                  accessibilityLabel={`${stepLabel} ${step.title}${state === "current" ? `. ${timeline.progressCurrent}` : state === "done" ? `. ${timeline.progressDone}` : state === "optional" ? `. ${timeline.progressOptional}` : ""}${step.timing ? `. ${timeline.period} ${step.timing}` : ""}`}
                  accessibilityHint={m("timeline.pathExpandedHint")}
                  onPress={() => toggle(step.id)}
                  testID={`step-toggle-${step.id}`}
                  style={{ minHeight: MIN_TARGET, gap: 2, justifyContent: "center" }}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <Text variant="body" bold style={{ flex: 1 }}>
                      {step.title}
                    </Text>
                    {state === "done" ? (
                      <Text variant="caption" tone="ok" bold>
                        {timeline.progressDone}
                      </Text>
                    ) : state === "optional" ? (
                      <Text variant="caption" tone="text2" bold testID={`step-optional-${step.id}`}>
                        {timeline.progressOptional}
                      </Text>
                    ) : null}
                    <Turn turned={expanded}>
                      <ChevronDown size={18} strokeWidth={1.75} color={tokens.text2} />
                    </Turn>
                  </View>
                  <Text variant="secondary" tone="text2">
                    {step.summary}
                  </Text>
                  {step.timing ? (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Calendar size={14} strokeWidth={1.75} color={tokens.text2} />
                      <Text variant="caption" tone="text2" style={{ flexShrink: 1 }}>
                        {step.timing}
                      </Text>
                    </View>
                  ) : null}
                </Pressable>
                {state === "current" && assisted && step.stageKeys.includes("documents") ? (
                  <Pressable accessibilityRole="link" onPress={() => go("/documents")} testID="journey-open-documents" style={{ minHeight: MIN_TARGET, justifyContent: "center" }}>
                    <Text variant="secondary" tone="accent" bold>
                      {timeline.openDocuments}
                    </Text>
                  </Pressable>
                ) : null}
                {expanded ? <StepPanel step={step} /> : null}
              </View>
            </View>
          );
        })}
      </View>
      <View style={{ gap: 6, marginTop: 8, padding: 12, borderRadius: tokens.radiusItem, backgroundColor: tokens.bg }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Info size={16} strokeWidth={1.75} color={tokens.text2} />
          <Text variant="caption" bold accessibilityRole="header">
            {timeline.notesLabel}
          </Text>
        </View>
        {view.disclaimers.map((text) => (
          <Text key={text} variant="caption" tone="text2">
            {text}
          </Text>
        ))}
      </View>
    </View>
  );
}

// ---- Блок целиком (без закрепления) -------------------------------------------------------------------------------

/**
 * Весь блок пути одним компонентом: шапка, строка шага и шаги друг под другом. «Главная» собирает те же части в список
 * экрана сама (чтобы строка закреплялась); этот вид - для мест, где закрепление не нужно, и для тестов частей.
 */
export function JourneySection({
  view,
  progress,
  source,
  readFailed,
  assisted,
  stage = null,
  hero,
  photo = null,
  initiallyUnfolded = false,
  unfoldStamp = "",
}: {
  view: CountryTimelineView;
  progress: Readonly<Record<string, TimelineStepProgress>> | null;
  source: CountryChoiceSource | null;
  readFailed: boolean;
  assisted: boolean;
  stage?: string | null;
  hero: HeroRender;
  photo?: JourneyPhoto | null;
  initiallyUnfolded?: boolean;
  unfoldStamp?: string;
}) {
  const journey = useJourney({ view, progress, stage, initiallyUnfolded, unfoldStamp });
  const edges = journeyEdges(journey);
  return (
    <View testID="journey-section">
      <JourneyHead journey={journey} edge={edges.head} source={source} readFailed={readFailed} hero={hero} photo={photo} />
      {journey.strip ? <JourneyNow journey={journey} edge={edges.now} /> : null}
      {journey.folded ? null : <JourneyBody journey={journey} edge={edges.body} assisted={assisted} />}
    </View>
  );
}
