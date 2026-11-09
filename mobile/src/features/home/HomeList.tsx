// «Мой список» на «Главной» (HomeList.tsx, веб #1355): вкладки «Вузы» и «Мои программы» с числом
// и полные списки под ними. Числа стоят прямо во вкладках: прежних плиток «Поступления» нет.
// Чтения общие с «Главной» (избранное читается один раз), сбой одного списка не трогает второй.
import { GraduationCap, Landmark } from "lucide-react-native";
import { Pressable, View } from "react-native";
import type { CatalogPreparation } from "@web/lib/portal/catalog-preparations";

import type { HomeListTab } from "@/domain/home-model";
import { usePortalApi } from "@/api/PortalApi";
import { loadErrorKey, useFavorites, usePreparations } from "@/api/queries";
import { nearestIntakeText } from "@/features/home/HomeCards";
import { go } from "@/features/portal/navigation";
import { useLang } from "@/i18n/LangProvider";
import { Button } from "@/ui/Button";
import { CardHead, CardSkeleton, EmptyBlock, InlineAlert, MIN_TARGET } from "@/ui/CardParts";
import { Card } from "@/ui/Screen";
import { Segmented } from "@/ui/Segmented";
import { Text } from "@/ui/Text";

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

export function HomeList({ tab, onTabChange, now }: { tab: HomeListTab; onTabChange: (tab: HomeListTab) => void; now: Date }) {
  const { lang, m, t } = useLang();
  const { canSelectPrograms } = usePortalApi();
  const favorites = useFavorites();
  const preparations = usePreparations();
  const home = t("home");
  const admission = t("admission");
  const favoritesStrings = t("favorites");
  const universities = t("universities");
  const preparationStrings = t("preparations");
  const favoritesCount = favorites.data?.total ?? null;
  const programsCount = preparations.data?.length ?? null;

  return (
    <Card>
      <CardHead title={home.listHeading} />
      <Segmented<HomeListTab>
        value={tab}
        onChange={onTabChange}
        testIDPrefix="tab"
        options={[
          { value: "universities", label: favoritesCount !== null ? `${admission["tab.universities"]} ${favoritesCount}` : admission["tab.universities"] },
          { value: "programs", label: programsCount !== null ? `${m("programs.mine")} ${programsCount}` : m("programs.mine") },
        ]}
      />
      {tab === "universities" ? (
        favorites.data === undefined ? (
          favorites.status === "error" ? (
            <InlineAlert message={m(loadErrorKey(favorites.error))} retryLabel={m("gate.retry")} onRetry={() => void favorites.refetch()} testID="favorites-error" />
          ) : (
            <CardSkeleton label={`${favoritesStrings.title}. ${m("state.loading")}`} />
          )
        ) : favorites.data.items.length === 0 ? (
          <EmptyBlock
            icon={Landmark}
            title={favoritesStrings.emptyTitle}
            body={favoritesStrings.emptyBody}
            action={<Button variant="ghost" label={favoritesStrings.emptyAction} onPress={() => go("/universities")} testID="favorites-open-catalog" />}
          />
        ) : (
          <View accessibilityRole="list">
            {favorites.data.items.map((item) => (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                onPress={() => go(`/universities/${item.id}`)}
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
        )
      ) : preparations.data === undefined ? (
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
  );
}
