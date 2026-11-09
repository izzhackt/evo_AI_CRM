// Главная: один домашний экран (#1355). Порядок на телефоне: шапка с этапом дела,
// выбор страны (пока страны нет), «Что сделать сейчас», путь страны, «Мои вузы», даты,
// «Что нового» (assisted), CSCA (Китай). Правила порядка: domain/home-model.ts.
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { View } from "react-native";
import { cscaHomeCardVisible, selectCscaHomeCard } from "@web/lib/portal/csca-home-card";
import { selectStudentJourney } from "@web/lib/portal/student-journey";
import { isStudyCountryCode, studyCountryName } from "@web/lib/study-countries";

import { HOME_FAVORITES_LIMIT, collectHomeDates, homeSlots, homeToday, latestNews, showCountryChoice } from "@/domain/home-model";
import { usePortalApi } from "@/api/PortalApi";
import { useCountryChoice, useCscaHome, useFavorites, useNotifications, useOverview } from "@/api/queries";
import { ApplicationCard, CaseCard, CscaCard, DatesCard, FavoritesCard, JourneyCard, NewsCard } from "@/features/home/HomeCards";
import { HomeHero } from "@/features/home/HomeHero";
import { CountryChoiceCard } from "@/features/portal/CountryChoiceCard";
import { loadOf } from "@/features/portal/load";
import { useLang } from "@/i18n/LangProvider";
import { TAB_BAR_CLEARANCE } from "@/shell/TabBar";
import { Card, Screen } from "@/ui/Screen";
import { CardSkeleton } from "@/ui/CardParts";

export function HomeScreen() {
  const { lang, m, t } = useLang();
  const { tier, displayName, userKey } = usePortalApi();
  const client = useQueryClient();
  const assisted = tier === "assisted";
  const overview = useOverview();
  const news = useNotifications();
  const favorites = useFavorites(HOME_FAVORITES_LIMIT);
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

  const now = new Date();
  const home = t("home");
  const admission = t("admission");

  // Прогресс по этапу дела: только у assisted и только когда обзор прочитан.
  const stage = !assisted ? null : overview.data !== undefined ? (overview.data?.operationalStage ?? null) : undefined;
  const journey = selectStudentJourney({ country: choiceData?.country ?? null, stage, locale: lang, now });
  const country = choiceData?.country ?? null;
  const studyCountry = country !== null && isStudyCountryCode(country) ? studyCountryName(country, lang) : null;
  const cscaCard = selectCscaHomeCard({ choice: choiceData, home: csca.data ?? null, locale: lang, cscaStrings: t("csca"), homeStrings: home });
  const slots = homeSlots({ tier, hasJourney: journey.view !== null, hasCscaCard: cscaCard !== null });
  const choiceLoad = loadOf(choice, m);

  const dates = collectHomeDates({ overview: overview.data ?? null, favorites: favorites.data?.items ?? null, admission, home, now });
  const newsView = news.data ? latestNews(news.data) : null;

  const slot = (id: (typeof slots)[number]) => {
    switch (id) {
      case "case":
        return assisted ? <CaseCard overview={overview.data ?? null} load={loadOf(overview, m)} /> : <ApplicationCard />;
      case "path":
        return journey.view ? <JourneyCard view={journey.view} progress={journey.progress} /> : null;
      case "universities":
        return <FavoritesCard items={favorites.data?.items ?? []} total={favorites.data?.total ?? 0} load={loadOf(favorites, m)} now={now} />;
      case "dates":
        return <DatesCard items={dates} today={homeToday(now)} />;
      case "news":
        return <NewsCard news={newsView} load={loadOf(news, m)} />;
      case "csca":
        return cscaCard ? <CscaCard view={cscaCard} /> : null;
    }
  };

  return (
    <Screen topInset={false} bottomInset={TAB_BAR_CLEARANCE} onRefresh={() => void refresh()} refreshing={refreshing}>
      <View style={{ gap: 16 }} testID="home-screen">
        <HomeHero displayName={displayName} studyCountry={studyCountry} stage={assisted ? (overview.data?.operationalStage ?? null) : null} />
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
          <View key={id} testID={`slot-${id}`}>
            {slot(id)}
          </View>
        ))}
      </View>
    </Screen>
  );
}
