// Поступление (portal/page.tsx + OverviewView.tsx, веб #1412): сводка, задача EVO или
// анкета на рассмотрении, весь «Путь поступления» и вкладки «Вузы»/«Программы».
// Обращение к куратору (case-help) и незавершённые отправки пакетов — срезы M3 и M2.
import { useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { GraduationCap, Landmark } from "lucide-react-native";
import { useCallback, useState } from "react";
import { Pressable, View } from "react-native";
import type { CatalogPreparation } from "@web/lib/portal/catalog-preparations";
import { selectStudentJourney } from "@web/lib/portal/student-journey";

import { evoActionDueLabel, evoActionStatusLabel, evoActionTone } from "@/domain/presentation";
import { usePortalApi } from "@/api/PortalApi";
import { loadErrorKey, useCountryChoice, useFavorites, useOverview, usePreparations, useRefetchOnFocus } from "@/api/queries";
import { JourneySection } from "@/features/admission/JourneySection";
import { nearestIntakeText } from "@/features/home/HomeCards";
import { CountryChoiceCard } from "@/features/portal/CountryChoiceCard";
import { go } from "@/features/portal/navigation";
import { loadOf } from "@/features/portal/load";
import { useLang } from "@/i18n/LangProvider";
import { TAB_BAR_CLEARANCE } from "@/shell/TabBar";
import { useTheme } from "@/theme/ThemeProvider";
import { Button } from "@/ui/Button";
import { CardSkeleton, EmptyBlock, InlineAlert, MIN_TARGET } from "@/ui/CardParts";
import { Card, Screen } from "@/ui/Screen";
import { Segmented } from "@/ui/Segmented";
import { Text } from "@/ui/Text";


type Tab = "universities" | "programs";

function Tile({ icon: Icon, value, label, onPress, testID }: { icon: typeof Landmark; value: number; label: string; onPress: () => void; testID: string }) {
  const { tokens, scheme } = useTheme();
  const { m, format } = useLang();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={format(m("admission.countLabel"), { label, count: String(value) })}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => ({
        flex: 1,
        minHeight: 64,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        padding: 12,
        borderRadius: tokens.radiusCard,
        borderWidth: 1,
        borderColor: tokens.line,
        backgroundColor: tokens.surface,
        boxShadow: scheme === "dark" ? undefined : tokens.shadowCard,
        transform: [{ scale: pressed ? tokens.pressScale : 1 }],
      })}
    >
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: tokens.accentSoft, alignItems: "center", justifyContent: "center" }}>
        <Icon size={20} strokeWidth={1.75} color={tokens.accent} />
      </View>
      <View style={{ flex: 1 }}>
        <Text variant="title" maxFontSizeMultiplier={1.2} style={{ fontSize: 22, lineHeight: 26 }}>
          {value}
        </Text>
        <Text variant="caption" tone="text2">
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

function ProgramRow({ item }: { item: CatalogPreparation }) {
  const { t } = useLang();
  const preparations = t("preparations");
  const program = item.content.programs.find((entry) => entry.id === item.programId);
  const intake = program?.intakes.find((entry) => entry.id === item.intakeId);
  const status = preparations[`status.${item.applicationStatus}`];
  return (
    <View style={{ gap: 2, paddingVertical: 8, minHeight: MIN_TARGET }} testID={`program-${item.applicationId}`}>
      <Text variant="caption" tone="text2">
        {item.content.name}
      </Text>
      <Text variant="body" bold>
        {program?.title ?? item.content.name}
      </Text>
      {intake ? (
        <Text variant="secondary" tone="text2">
          {intake.label}
        </Text>
      ) : null}
      <Text variant="secondary">{status}</Text>
      {item.deadlineStateAtSelection === "needs_confirmation" ? (
        <Text variant="caption" tone="text2">
          {preparations.savedDeadline}
        </Text>
      ) : null}
    </View>
  );
}

export function AdmissionScreen() {
  const { lang, m, t } = useLang();
  const { tokens } = useTheme();
  const params = useLocalSearchParams<{ path?: string }>();
  const { tier, userKey, canSelectPrograms } = usePortalApi();
  const client = useQueryClient();
  const assisted = tier === "assisted";
  useRefetchOnFocus();
  const overview = useOverview();
  const choice = useCountryChoice();
  const favorites = useFavorites();
  const preparations = usePreparations();
  const [tab, setTab] = useState<Tab>("universities");
  const [refreshing, setRefreshing] = useState(false);
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await client.refetchQueries({ queryKey: ["portal", userKey], type: "active" });
    } finally {
      setRefreshing(false);
    }
  }, [client, userKey]);

  const admission = t("admission");
  const timeline = t("timeline");
  const favoritesStrings = t("favorites");
  const universities = t("universities");
  const preparationStrings = t("preparations");
  const now = new Date();
  const choiceData = choice.data ?? null;

  const stage = !assisted ? null : overview.data !== undefined ? (overview.data?.operationalStage ?? null) : undefined;
  const journey = selectStudentJourney({ country: choiceData?.country ?? null, stage, locale: lang, now });
  const choiceLoad = loadOf(choice, m);
  const overviewFailed = assisted && overview.status === "error" && overview.data === undefined;
  const evoAction = overview.data?.evoAction ?? null;
  const evoDue = evoAction ? evoActionDueLabel(evoAction) : null;
  const favoritesCount = favorites.data?.total ?? null;
  const programsCount = preparations.data?.length ?? null;

  return (
    <Screen topInset={false} bottomInset={TAB_BAR_CLEARANCE} onRefresh={() => void refresh()} refreshing={refreshing}>
      <View style={{ gap: 16 }} testID="admission-screen">
        <Text variant="display" accessibilityRole="header" testID="title-overview">
          {admission.overviewTitle}
        </Text>

        {overviewFailed ? <InlineAlert message={m(loadErrorKey(overview.error))} retryLabel={m("gate.retry")} onRetry={() => void overview.refetch()} testID="overview-error" /> : null}

        {favoritesCount !== null || programsCount !== null ? (
          <View accessibilityRole="summary" accessibilityLabel={admission.tilesLabel} style={{ flexDirection: "row", gap: 12 }}>
            {favoritesCount !== null ? <Tile icon={Landmark} value={favoritesCount} label={admission["tile.favorites"]} onPress={() => setTab("universities")} testID="tile-favorites" /> : null}
            {programsCount !== null ? <Tile icon={GraduationCap} value={programsCount} label={m("programs.mine")} onPress={() => setTab("programs")} testID="tile-programs" /> : null}
          </View>
        ) : null}

        {!assisted ? (
          <Card>
            <Text variant="heading" accessibilityRole="header">
              {admission.pendingApplicationHeading}
            </Text>
            <Text variant="secondary" tone="text2">
              {admission.pendingManagerNotice}
            </Text>
            {/* TODO(M7): ссылка «Открыть анкету» на просмотр анкеты в приложении. */}
          </Card>
        ) : null}

        {assisted && evoAction ? (
          <Card>
            <Text variant="heading" accessibilityRole="header">
              {admission.evoHeading}
            </Text>
            <Text variant="body" bold testID="evo-title">
              {evoAction.title}
            </Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
              <View
                style={{
                  paddingHorizontal: 10,
                  paddingVertical: 3,
                  borderRadius: tokens.radiusChip,
                  backgroundColor: evoActionTone(evoAction) === "warn" ? tokens.accentSoft : tokens.skeleton,
                }}
              >
                <Text variant="caption" bold tone={evoActionTone(evoAction) === "warn" ? "error" : "text"}>
                  {evoActionStatusLabel(evoAction, admission)}
                </Text>
              </View>
              {evoDue ? (
                <Text variant="secondary" tone="text2">
                  {admission.dueTerm} {evoDue}
                </Text>
              ) : null}
            </View>
          </Card>
        ) : null}

        {journey.view ? (
          <JourneySection
            view={journey.view}
            progress={journey.progress}
            source={choiceData?.source ?? null}
            readFailed={false}
            assisted={assisted}
            initiallyUnfolded={params.path === "open"}
          />
        ) : choiceLoad?.state === "loading" ? (
          <Card>
            <CardSkeleton label={`${timeline.chooseTitle}. ${m("state.loading")}`} lines={3} />
          </Card>
        ) : (
          <CountryChoiceCard readFailed={choiceLoad?.state === "error"} readFailedMessage={choiceLoad?.state === "error" ? choiceLoad.message : ""} />
        )}

        <Segmented<Tab>
          value={tab}
          onChange={setTab}
          testIDPrefix="tab"
          options={[
            { value: "universities", label: favoritesCount !== null ? `${admission["tab.universities"]} ${favoritesCount}` : admission["tab.universities"] },
            { value: "programs", label: programsCount !== null ? `${m("programs.mine")} ${programsCount}` : m("programs.mine") },
          ]}
        />

        {tab === "universities" ? (
          <Card>
            {favorites.data === undefined ? (
              favorites.status === "error" ? (
                <InlineAlert message={m(loadErrorKey(favorites.error))} retryLabel={m("gate.retry")} onRetry={() => void favorites.refetch()} testID="favorites-error" />
              ) : (
                <CardSkeleton label={`${favoritesStrings.title}. ${m("state.loading")}`} />
              )
            ) : favorites.data.items.length === 0 ? (
              <EmptyBlock icon={Landmark} title={favoritesStrings.emptyTitle} body={favoritesStrings.emptyBody} action={<Button variant="ghost" label={favoritesStrings.emptyAction} onPress={() => go("/universities")} />} />
            ) : (
              <View accessibilityRole="list">
                {favorites.data.items.map((item) => (
                  <Pressable
                    key={item.id}
                    accessibilityRole="button"
                    onPress={() => go("/universities")} // TODO(M4): карточка вуза
                    testID={`fav-${item.id}`}
                    style={{ minHeight: MIN_TARGET, gap: 2, paddingVertical: 8 }}
                  >
                    <Text variant="body" bold>
                      {item.content.name}
                    </Text>
                    <Text variant="secondary" tone="text2">
                      {item.content.city ?? favoritesStrings.cityUnknown}
                    </Text>
                    <Text variant="caption" tone="text2">
                      {universities.nearestIntake}
                      {": "}
                      <Text variant="data">{nearestIntakeText(item, lang, now, universities)}</Text>
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}
          </Card>
        ) : (
          <Card>
            <Text variant="heading" accessibilityRole="header">
              {preparationStrings.title}
            </Text>
            {preparations.data === undefined ? (
              preparations.status === "error" ? (
                <InlineAlert message={m(loadErrorKey(preparations.error))} retryLabel={m("gate.retry")} onRetry={() => void preparations.refetch()} testID="programs-error" />
              ) : (
                <CardSkeleton label={`${preparationStrings.title}. ${m("state.loading")}`} />
              )
            ) : preparations.data.length === 0 ? (
              <EmptyBlock
                icon={GraduationCap}
                title={canSelectPrograms ? preparationStrings.empty : preparationStrings.emptyBrowse}
                action={<Button variant="ghost" label={preparationStrings.catalogBrowse} onPress={() => go("/universities")} />}
              />
            ) : (
              <View accessibilityRole="list">
                {preparations.data.map((item) => (
                  <ProgramRow key={item.applicationId} item={item} />
                ))}
              </View>
            )}
            {/* TODO(M2): «Открыть подготовку» и незавершённые отправки пакетов. */}
          </Card>
        )}
      </View>
    </Screen>
  );
}
