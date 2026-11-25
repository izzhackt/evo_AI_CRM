// CSCA: главная раздела «Учёба» как на вебе (src/app/(portal)/portal/csca/page.tsx). Заголовок «CSCA» с полным названием
// экзамена и две вкладки: «Об экзамене» (первая и по умолчанию: обзор и календарь сессий, виден и без сети) и «Занятия»
// (следующий шаг, плитки, тесты на время, программа по модулям). Вкладка не запоминается (решение владельца D7, 25.11.2026):
// ссылка с `?view=lessons` открывает «Занятия», любая другая «Об экзамене». Внизу обеих вкладок слова о том, что задания
// написаны EVO, и ссылка на программу экзамена. Один чтение-запрос `learning_track_home_v1` на экран (общий с карточкой
// на «Главной»).
import { router, useLocalSearchParams } from "expo-router";
import { NotebookPen } from "lucide-react-native";
import { useCallback, useRef, useState } from "react";
import { Linking, View } from "react-native";

import { CSCA_OVERVIEW } from "@web/lib/portal/csca-overview";

import { loadErrorKey, useRefetchOnFocus } from "@/api/queries";
import { LessonsView } from "@/features/learning/csca/LessonsView";
import { OverviewSection } from "@/features/learning/csca/OverviewSection";
import { SessionPicker } from "@/features/learning/csca/SessionPicker";
import { useCscaHome } from "@/features/learning/queries";
import { useLang } from "@/i18n/LangProvider";
import { CardSkeleton, EmptyBlock, InlineAlert, LinkButton } from "@/ui/CardParts";
import { Card, Screen, type ScrollTarget } from "@/ui/Screen";
import { Segmented } from "@/ui/Segmented";
import { Text } from "@/ui/Text";

export type CscaTab = "about" | "lessons";

/** `?view=lessons` открывает «Занятия»; всё остальное (и отсутствие параметра) «Об экзамене» (веб: `page.tsx`). */
export function cscaTabFromParam(view: string | string[] | undefined): CscaTab {
  return (Array.isArray(view) ? view[0] : view) === "lessons" ? "lessons" : "about";
}

/** Куда прокрутить, чтобы блок сессий оказался у верха экрана: небольшой отступ оставляет заголовок блока дышать. */
export function sessionsScrollTarget(offsets: { root: number; about: number; sessions: number }): number {
  return Math.max(0, offsets.root + offsets.about + offsets.sessions - 8);
}

export function CscaHomeScreen() {
  const { m, t } = useLang();
  const c = t("csca");
  useRefetchOnFocus();
  const home = useCscaHome(true);
  const data = home.data;
  const track = data?.modules[0] ?? null;
  const params = useLocalSearchParams<{ view?: string | string[] }>();
  const view = Array.isArray(params.view) ? params.view[0] : params.view;
  const [tab, setTab] = useState<CscaTab>(cscaTabFromParam(view));
  // Новая ссылка на уже открытый раздел (`?view=` сменился): вкладка подстраивается прямо при отрисовке, без эффекта.
  const [seenView, setSeenView] = useState(view);
  if (seenView !== view) {
    setSeenView(view);
    setTab(cscaTabFromParam(view));
  }
  const pick = (next: CscaTab) => {
    setTab(next);
    // Параметр повторяет вкладку: следующая ссылка «К темам» из урока или теста тогда всегда меняет значение.
    router.setParams({ view: next });
  };

  // Прокрутка к календарю сессий: плитка «Ближайший экзамен» и ответ «Когда проходит экзамен?» ведут к нему, как якорь веба.
  const scroller = useRef<ScrollTarget>(null);
  const offsets = useRef({ root: 0, about: 0, sessions: null as number | null });
  const wantSessions = useRef(false);
  const scrollToSessions = useCallback(() => {
    const at = offsets.current;
    if (at.sessions === null) return;
    scroller.current?.scrollTo({ y: sessionsScrollTarget({ root: at.root, about: at.about, sessions: at.sessions }), animated: true });
  }, []);
  const onSessionsLayout = useCallback(
    (y: number) => {
      offsets.current.sessions = y;
      if (!wantSessions.current) return;
      wantSessions.current = false;
      // Родительские блоки сообщают свои места в том же кадре: прокрутка после них.
      setTimeout(scrollToSessions, 0);
    },
    [scrollToSessions],
  );
  const openSessions = () => {
    if (tab === "about") {
      scrollToSessions();
      return;
    }
    wantSessions.current = true;
    pick("about");
  };

  const sessionsShown = data !== undefined && track !== null && data.sessions.length > 0;
  const sessions =
    data && track && data.sessions.length > 0 ? (
      <SessionPicker home={data} testID="sessions-block" onLayoutY={onSessionsLayout} />
    ) : home.status === "pending" ? (
      <CardSkeleton label={m("state.loading")} lines={3} testID="sessions-skeleton" />
    ) : null;

  return (
    <Screen topInset={false} tabBar onRefresh={() => void home.refetch()} refreshing={home.isRefetching} scrollRef={scroller}>
      <View style={{ gap: 16 }} testID="csca-screen" onLayout={(event) => (offsets.current.root = event.nativeEvent.layout.y)}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "baseline", columnGap: 14, rowGap: 4 }}>
          <Text variant="display" accessibilityRole="header" testID="title-csca">
            {CSCA_OVERVIEW.exam.short}
          </Text>
          <Text variant="secondary" tone="text2" accessibilityLanguage="en">
            {CSCA_OVERVIEW.exam.nameEn}
          </Text>
        </View>
        <Segmented
          value={tab}
          onChange={pick}
          semantics="tabs"
          accessibilityLabel={c.tabsLabel}
          options={[
            { value: "about", label: c["tab.about"] },
            { value: "lessons", label: c["tab.lessons"] },
          ]}
          testIDPrefix="csca-tab"
        />
        {tab === "about" ? (
          <View testID="csca-about" onLayout={(event) => (offsets.current.about = event.nativeEvent.layout.y)}>
            <OverviewSection sessionsShown={sessionsShown} sessions={sessions} onOpenSessions={openSessions} />
          </View>
        ) : !data ? (
          home.status === "error" ? (
            <InlineAlert message={m(loadErrorKey(home.error))} retryLabel={m("gate.retry")} onRetry={() => void home.refetch()} testID="csca-error" />
          ) : (
            <CardSkeleton label={m("state.loading")} lines={4} testID="csca-skeleton" />
          )
        ) : !track ? (
          <Card>
            <EmptyBlock icon={NotebookPen} title={c.emptyTitle} body={c.emptyBody} />
          </Card>
        ) : (
          <LessonsView home={data} track={track} onOpenExam={openSessions} />
        )}
        <View style={{ gap: 4, marginTop: 8 }} testID="csca-footer">
          <Text variant="caption" tone="text2">
            {c.ownWork}
          </Text>
          {track ? <LinkButton label={c.syllabusLink} onPress={() => void Linking.openURL(track.metadata.syllabus_url).catch(() => undefined)} testID="syllabus-link" /> : null}
          <LinkButton label={m("learn.licensesOpen")} onPress={() => router.navigate("/csca/licenses")} testID="licenses-open" />
        </View>
      </View>
    </Screen>
  );
}
