// Главная: единственный домашний экран (#1355, веб HomeView.tsx на /portal; отдельного
// «Поступления» больше нет). Порядок на телефоне: шапка с этапом дела, выбор страны (пока страны нет),
// согласие на ИИ (assisted), затем блоки из domain/home-model.ts: задача EVO, «Что сделать сейчас»
// (у approved одна «Ваша анкета»), путь страны, «Написать EVO» (assisted), даты, «Что нового»
// (assisted), CSCA (Китай), «Мой список» (вкладки «Вузы» и «Мои программы») и весь «Путь поступления».
import { useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { View } from "react-native";
import { cscaHomeCardVisible, selectCscaHomeCard } from "@web/lib/portal/csca-home-card";
import { selectStudentJourney } from "@web/lib/portal/student-journey";
import { isStudyCountryCode, studyCountryName } from "@web/lib/study-countries";

import { HOME_FAVORITES_LIMIT, collectHomeDates, homeParams, homeSlots, homeToday, latestNews, showCountryChoice, type HomeListTab } from "@/domain/home-model";
import { usePortalApi } from "@/api/PortalApi";
import { useCountryChoice, useCscaHome, useFavorites, useNotifications, useOverview, useRefetchOnFocus } from "@/api/queries";
import { JourneySection } from "@/features/admission/JourneySection";
import { ApplicationCard, CaseCard, CscaCard, DatesCard, EvoTaskCard, JourneyCard, NewsCard, WriteEvoCard } from "@/features/home/HomeCards";
import { HomeHero } from "@/features/home/HomeHero";
import { HomeList } from "@/features/home/HomeList";
import { CountryChoiceCard } from "@/features/portal/CountryChoiceCard";
import { AiConsentHomeCard } from "@/features/profile/AiConsent";
import { loadOf } from "@/features/portal/load";
import { useLang } from "@/i18n/LangProvider";
import { CardSkeleton } from "@/ui/CardParts";
import { Card, Screen, type ScrollTarget } from "@/ui/Screen";

export function HomeScreen() {
  const { lang, m, t } = useLang();
  const { tier, displayName, userKey } = usePortalApi();
  const client = useQueryClient();
  const assisted = tier === "assisted";
  useRefetchOnFocus();
  const overview = useOverview();
  const news = useNotifications();
  const favorites = useFavorites();
  const homeItems = favorites.data?.items.slice(0, HOME_FAVORITES_LIMIT) ?? null;
  const choice = useCountryChoice();
  const choiceData = choice.data ?? null;
  const cscaVisible = cscaHomeCardVisible(choiceData);
  const csca = useCscaHome(cscaVisible);
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
  // Каждый запрос «раскрыть путь» (ссылка с новой меткой `at` или кнопка) - новая метка для JourneySection.
  const [unfoldStamp, setUnfoldStamp] = useState(params.openPath ? params.stamp : "");
  const scroller = useRef<ScrollTarget>(null);
  const offsets = useRef<Partial<Record<"list" | "fullPath", number>>>({});
  const scrollTo = useCallback((slot: "list" | "fullPath") => {
    const y = offsets.current[slot];
    if (y !== undefined) scroller.current?.scrollTo({ y: Math.max(0, y), animated: true });
  }, []);
  const [pending, setPending] = useState<"list" | "fullPath" | null>(params.listTab ? "list" : params.openPath ? "fullPath" : null);
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
      setPending("fullPath");
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
  const country = choiceData?.country ?? null;
  const studyCountry = country !== null && isStudyCountryCode(country) ? studyCountryName(country, lang) : null;
  const cscaCard = selectCscaHomeCard({ choice: choiceData, home: csca.data ?? null, locale: lang, cscaStrings: t("csca"), homeStrings: home });
  const evoAction = overview.data?.evoAction ?? null;
  const slots = homeSlots({ tier, hasJourney: journey.view !== null, hasCscaCard: cscaCard !== null, hasEvoTask: evoAction !== null });
  const choiceLoad = loadOf(choice, m);

  const dates = collectHomeDates({ overview: overview.data ?? null, favorites: homeItems, admission, home, now });
  const newsView = news.data ? latestNews(news.data) : null;

  const openPath = () => {
    setPathOpen(true);
    setUnfoldStamp(`tap-${Date.now()}`);
    if (offsets.current.fullPath !== undefined) scrollTo("fullPath");
    else setPending("fullPath");
  };
  // Блок встаёт на место после раскладки: прокрутка к нему, когда его высота известна.
  const placed = (slot: "list" | "fullPath") => (y: number) => {
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
        return assisted ? <CaseCard overview={overview.data ?? null} load={loadOf(overview, m)} /> : <ApplicationCard />;
      case "path":
        return journey.view ? <JourneyCard view={journey.view} progress={journey.progress} onOpenPath={openPath} /> : null;
      case "write":
        return <WriteEvoCard />;
      case "dates":
        return <DatesCard items={dates} today={homeToday(now)} />;
      case "news":
        return <NewsCard news={newsView} load={loadOf(news, m)} />;
      case "csca":
        return cscaCard ? <CscaCard view={cscaCard} /> : null;
      case "list":
        return <HomeList tab={listTab} onTabChange={setListTab} now={now} />;
      case "fullPath":
        return journey.view ? (
          <JourneySection view={journey.view} progress={journey.progress} source={choiceData?.source ?? null} readFailed={false} assisted={assisted} initiallyUnfolded={pathOpen} unfoldStamp={unfoldStamp} />
        ) : null;
    }
  };

  return (
    <Screen topInset={false} tabBar onRefresh={() => void refresh()} refreshing={refreshing} scrollRef={scroller}>
      <View style={{ gap: 16 }} testID="home-screen">
        <HomeHero displayName={displayName} studyCountry={studyCountry} stage={assisted ? (overview.data?.operationalStage ?? null) : null} />
        {assisted ? <AiConsentHomeCard /> : null}
        {showCountryChoice(journey.view !== null) ? (
          choiceLoad?.state === "loading" ? (
            <Card>
              <CardSkeleton label={`${t("timeline").chooseTitle}. ${m("state.loading")}`} lines={3} />
            </Card>
          ) : (
            <CountryChoiceCard readFailed={choiceLoad?.state === "error"} readFailedMessage={choiceLoad?.state === "error" ? choiceLoad.message : ""} />
          )
        ) : null}
        {slots.map((id) => (
          <View
            key={id}
            testID={`slot-${id}`}
            onLayout={id === "list" || id === "fullPath" ? (event) => placed(id)(event.nativeEvent.layout.y + 16) : undefined}
          >
            {slot(id)}
          </View>
        ))}
      </View>
    </Screen>
  );
}
