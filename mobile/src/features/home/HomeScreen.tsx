// Главная: единственный домашний экран (#1355, веб HomeView.tsx на /portal; отдельного «Поступления» больше нет).
// Веб #1489 (18-20.11.2026): сверху одна шапка на фото столицы страны - приветствие, «страна · набор», отсчёт до ближайшей
// даты, строка текущего шага «Шаг N из M · дальше — …» (закрепляется при прокрутке пути) и весь «Путь поступления»
// (JourneyHead, JourneyNow, JourneyBody); пока страны нет - тёмная плашка и выбор страны. Под ней блоки из
// domain/home-model.ts: задача EVO, «Что сделать сейчас» (у approved «Ваша анкета»), «Мой список» (вузы лентой и «Мои
// программы»), даты (дела, программы, избранное, CSCA), «Что нового» (assisted), CSCA (Китай); блоки входят по очереди.
// Всё это - прямые блоки списка ScrollView: так строку шага закрепляет сам ScrollView (stickyHeaderIndices).
import { useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { useCallback, useRef, useState, type ReactElement } from "react";
import { View, type LayoutChangeEvent } from "react-native";
import { cscaAvailableFor, cscaHomeDates, selectCscaHomeCard } from "@web/lib/portal/csca-home-card";
import { selectStudentJourney } from "@web/lib/portal/student-journey";
import { isStudyCountryCode, studyCountryName } from "@web/lib/study-countries";

import { HOME_FAVORITES_LIMIT, collectHomeDates, homeCountdown, homeParams, homeSlots, homeToday, latestNews, showCountryChoice, type HomeListTab, type HomeSlotId } from "@/domain/home-model";
import { usePortalApi } from "@/api/PortalApi";
import { useCountryChoice, useCscaHome, useFavorites, useHomeApplication, useNotifications, useOverview, usePreparations, useRefetchOnFocus } from "@/api/queries";
import { JourneyBody, JourneyEnd, JourneyHead, JourneyNow, journeyEdges, useJourney } from "@/features/admission/JourneySection";
import { ApplicationCard, CaseCard, CscaCard, DatesCard, EvoTaskCard, NewsCard } from "@/features/home/HomeCards";
import { capitalGeographyPhoto } from "@/features/home/capital-photo";
import { HeroContent, HomeHero } from "@/features/home/HomeHero";
import { HomeList } from "@/features/home/HomeList";
import { CountryChoiceCard } from "@/features/portal/CountryChoiceCard";
import { loadOf } from "@/features/portal/load";
import { useUniversityIndex } from "@/features/universities/hooks";
import { geographyUrls, usePhotoPixels } from "@/features/universities/parts";
import { geographyPhotoCredit } from "@/features/universities/photos";
import { useLang } from "@/i18n/LangProvider";
import { CardSkeleton } from "@/ui/CardParts";
import { Enter } from "@/ui/motion";
import { Card, Screen, type ScrollTarget } from "@/ui/Screen";

/** Промежуток между блоками экрана, как между карточками остальных экранов приложения. */
const BLOCK_GAP = 16;

/**
 * Порядок входа блоков (веб, 18.11.2026): дело, даты, список, новости, CSCA - с шагом `stagger`; по слоту, а не по месту
 * на экране, как в CSS. Задача команды EVO стоит вне колонок и не входит.
 */
const SLOT_ENTER: Readonly<Record<HomeSlotId, number | null>> = { evo: null, case: 0, dates: 1, list: 2, news: 3, csca: 4 };

export function HomeScreen() {
  const { lang, m, t } = useLang();
  const { tier, displayName, userKey } = usePortalApi();
  const client = useQueryClient();
  const assisted = tier === "assisted";
  useRefetchOnFocus();
  const overview = useOverview();
  const news = useNotifications();
  const favorites = useFavorites();
  // Те же чтения, что у «Моего списка» (один запрос на ключ): сроки своих программ идут в «Ближайшие даты».
  const preparations = usePreparations();
  const application = useHomeApplication();
  const homeItems = favorites.data?.items.slice(0, HOME_FAVORITES_LIMIT) ?? null;
  const choice = useCountryChoice();
  const choiceData = choice.data ?? null;
  const cscaVisible = cscaAvailableFor(choiceData);
  const csca = useCscaHome(cscaVisible);
  // Индекс каталога грузится в начале сессии (UniversityIndexWarmup): здесь он только читается ради фото столицы.
  const { index } = useUniversityIndex();
  const photoPixels = usePhotoPixels();
  const [refreshing, setRefreshing] = useState(false);
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await client.refetchQueries({ queryKey: ["portal", userKey], type: "active" });
    } finally {
      setRefreshing(false);
    }
  }, [client, userKey]);

  // Вкладка «Мой список» и раскрытый путь: из ссылок (`?list=programs`, `?path=open`, в том числе из старого /overview)
  // и из нажатий на самом экране.
  const params = homeParams(useLocalSearchParams<{ list?: string; path?: string; at?: string }>());
  const [listTab, setListTab] = useState<HomeListTab>(params.listTab ?? "universities");
  const [pathOpen, setPathOpen] = useState(params.openPath);
  // Каждый запрос «раскрыть путь» (ссылка с новой меткой `at`) - новая метка для JourneySection.
  const [unfoldStamp, setUnfoldStamp] = useState(params.openPath ? params.stamp : "");
  const scroller = useRef<ScrollTarget>(null);
  const offsets = useRef<Partial<Record<"list" | "path", number>>>({});
  const scrollToY = useCallback((y: number) => scroller.current?.scrollTo({ y: Math.max(0, y), animated: true }), []);
  const scrollTo = useCallback(
    (slot: "list" | "path") => {
      const y = offsets.current[slot];
      if (y !== undefined) scrollToY(y);
    },
    [scrollToY],
  );
  const [pending, setPending] = useState<"list" | "path" | null>(params.listTab ? "list" : params.openPath ? "path" : null);
  // Новая ссылка на уже открытую «Главную» (смена параметров или метки `at`): состояние подстраивается прямо при
  // рендере, без эффекта (react-hooks/set-state-in-effect).
  const linkKey = `${params.listTab ?? ""}|${params.openPath}|${params.stamp}`;
  const [seenLink, setSeenLink] = useState(linkKey);
  if (seenLink !== linkKey) {
    setSeenLink(linkKey);
    if (params.listTab) {
      setListTab(params.listTab);
      setPending("list");
    } else if (params.openPath) {
      setPathOpen(true);
      setUnfoldStamp(params.stamp);
      setPending("path");
    }
  }

  const now = new Date();
  const home = t("home");
  const admission = t("admission");

  // Прогресс по этапу дела: только у assisted и только когда обзор прочитан.
  const stage = !assisted ? null : overview.data !== undefined ? (overview.data?.operationalStage ?? null) : undefined;
  const journey = selectStudentJourney({
    country: choiceData?.country ?? null, stage, boardStage: assisted ? (overview.data?.boardStage ?? null) : null, locale: lang, now,
  });
  const journeyState = useJourney({
    view: journey.view,
    progress: journey.progress,
    stage: assisted ? (overview.data?.operationalStage ?? null) : null,
    initiallyUnfolded: pathOpen,
    unfoldStamp,
    scrollTo: scrollToY,
  });
  const country = choiceData?.country ?? null;
  const studyCountry = country !== null && isStudyCountryCode(country) ? studyCountryName(country, lang) : null;
  const cscaCard = selectCscaHomeCard({ choice: choiceData, home: csca.data ?? null, locale: lang, cscaStrings: t("csca"), homeStrings: home });
  const evoAction = overview.data?.evoAction ?? null;
  const slots = homeSlots({ tier, hasJourney: journey.view !== null, hasCsca: cscaVisible, hasEvoTask: assisted && evoAction !== null });
  const choiceLoad = loadOf(choice, m);

  const dated = collectHomeDates({
    overview: overview.data ?? null,
    favorites: homeItems,
    preparations: preparations.data ?? null,
    csca: cscaHomeDates({ choice: choiceData, home: csca.data ?? null, homeStrings: home }),
    admission,
    home,
    now,
  });
  const countdown = homeCountdown({ overview: overview.data ?? null, dated, now, admission });
  const newsView = news.data ? latestNews(news.data) : null;
  // Фото столицы выбранной страны: нет индекса, столицы или фото - шапка на тёмной плашке.
  const capital = capitalGeographyPhoto(index, country);
  const capitalUrls = capital ? geographyUrls(capital, photoPixels) : null;
  const photo = capital && capitalUrls ? { urls: capitalUrls, credit: geographyPhotoCredit(capital) } : null;
  const heroProps = { displayName, studyCountry, intake: journey.view?.intake.label ?? null, countdown };

  // Блок встаёт на место после раскладки: прокрутка к нему, когда его место известно (y - от верха содержимого).
  const placed = (slot: "list" | "path") => (y: number) => {
    offsets.current[slot] = y;
    if (pending === slot) {
      setPending(null);
      scrollTo(slot);
    }
  };

  const slot = (id: (typeof slots)[number]) => {
    switch (id) {
      case "evo":
        return evoAction ? <EvoTaskCard action={evoAction} /> : null;
      case "case":
        return assisted ? <CaseCard overview={overview.data ?? null} load={loadOf(overview, m)} now={now} /> : <ApplicationCard application={application.data ?? null} now={now} />;
      case "dates":
        return <DatesCard items={dated} today={homeToday(now)} />;
      case "news":
        return <NewsCard news={newsView} load={loadOf(news, m)} now={now} />;
      case "csca":
        return cscaCard ? <CscaCard view={cscaCard} /> : null;
      case "list":
        return <HomeList tab={listTab} onTabChange={setListTab} now={now} />;
    }
  };

  // Блоки списка экрана: шапка пути (или тёмная плашка), строка шага, шаги, выбор страны, блоки под ними. Закрепляются строка
  // шага и нулевой блок сразу за путём: он выталкивает строку, когда карточка пути кончается.
  const blocks: ReactElement[] = [];
  const sticky: number[] = [];
  if (journey.view) {
    const edges = journeyEdges(journeyState);
    blocks.push(
      <View key="journey-head" testID="home-screen" onLayout={(event) => placed("path")(event.nativeEvent.layout.y)}>
        <JourneyHead
          journey={journeyState}
          edge={edges.head}
          source={choiceData?.source ?? null}
          readFailed={false}
          hero={(onPhoto) => <HeroContent {...heroProps} onPhoto={onPhoto} />}
          photo={photo}
        />
      </View>,
    );
    if (journeyState.strip) {
      sticky.push(blocks.length);
      blocks.push(<JourneyNow key="journey-now" journey={journeyState} edge={edges.now} />);
    }
    if (!journeyState.folded) blocks.push(<JourneyBody key="journey-body" journey={journeyState} edge={edges.body} assisted={assisted} />);
    if (journeyState.strip) {
      sticky.push(blocks.length);
      blocks.push(<JourneyEnd key="journey-end" />);
    }
  } else {
    blocks.push(
      <View key="home-hero" testID="home-screen">
        <HomeHero {...heroProps} />
      </View>,
    );
  }
  if (showCountryChoice(journey.view !== null)) {
    blocks.push(
      <View key="country-choice" style={{ marginTop: BLOCK_GAP }}>
        {choiceLoad?.state === "loading" ? (
          <Card>
            <CardSkeleton label={`${t("timeline").chooseTitle}. ${m("state.loading")}`} lines={3} />
          </Card>
        ) : (
          <CountryChoiceCard readFailed={choiceLoad?.state === "error"} readFailedMessage={choiceLoad?.state === "error" ? choiceLoad.message : ""} />
        )}
      </View>,
    );
  }
  for (const id of slots) {
    const enter = SLOT_ENTER[id];
    const onLayout = id === "list" ? (event: LayoutChangeEvent) => placed("list")(event.nativeEvent.layout.y) : undefined;
    // Задача команды EVO стоит вне колонок веба и не входит по очереди; остальные блоки входят с шагом `stagger`.
    blocks.push(
      enter === null ? (
        <View key={id} testID={`slot-${id}`} style={{ marginTop: BLOCK_GAP }} onLayout={onLayout}>
          {slot(id)}
        </View>
      ) : (
        <Enter key={id} testID={`slot-${id}`} index={enter} style={{ marginTop: BLOCK_GAP }} onLayout={onLayout}>
          {slot(id)}
        </Enter>
      ),
    );
  }

  return (
    <Screen topInset={false} tabBar onRefresh={() => void refresh()} refreshing={refreshing} scrollRef={scroller} stickyHeaderIndices={sticky}>
      {blocks}
    </Screen>
  );
}
