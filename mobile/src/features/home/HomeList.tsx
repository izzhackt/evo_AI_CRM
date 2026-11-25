// «Мой список» на «Главной» (HomeList.tsx, веб #1355): вкладки «Вузы» и «Мои программы» с числом
// и полные списки под ними. Числа стоят прямо во вкладках: прежних плиток «Поступления» нет.
// Чтения общие с «Главной» (избранное читается один раз), сбой одного списка не трогает второй.
import { GraduationCap, Landmark } from "lucide-react-native";
import { useState } from "react";
import { PixelRatio, Pressable, ScrollView, View, useWindowDimensions } from "react-native";
import type { CatalogPreparation } from "@web/lib/portal/catalog-preparations";
import type { PublishedUniversity } from "@web/lib/platform-university-catalog";
import { universityCountryLabel } from "@web/lib/portal/universities";

import { HOME_FAVORITES_LIMIT, type HomeListTab } from "@/domain/home-model";
import { usePortalApi } from "@/api/PortalApi";
import { loadErrorKey, useFavorites, usePreparations } from "@/api/queries";
import { nearestIntakeText } from "@/features/home/HomeCards";
import { go } from "@/features/portal/navigation";
import { RemotePhoto, universityUrls } from "@/features/universities/parts";
import { useLang } from "@/i18n/LangProvider";
import { Button } from "@/ui/Button";
import { CardHead, CardSkeleton, EmptyBlock, InlineAlert, MIN_TARGET } from "@/ui/CardParts";
import { Card } from "@/ui/Screen";
import { Enter, PressableScale } from "@/ui/motion";
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

/**
 * Лента вбок (веб, 18.11.2026: на телефоне вузы - лента, карточка на 78% ширины, край следующей виден). Лента доходит
 * до краёв карточки «Мой список»: поля карточки по 16, поэтому лента тянется на них и держит свой отступ.
 */
const STRIP_SHARE = 0.78;
const STRIP_GAP = 12;
const STRIP_MAX_CARD = 320;
/** Фото карточки одной высоты при любой ширине: `aspect-ratio: 16 / 10`. */
const FAV_PHOTO_RATIO = 10 / 16;
/** Сколько первых карточек ленты входят по очереди. */
const FAV_ENTER_LIMIT = 6;

/** Ширина карточки ленты: доля ширины списка (экран без полей по 16), не шире предела (на планшете лента остаётся лентой). */
export function stripCardWidth(windowWidth: number): number {
  return Math.min(STRIP_MAX_CARD, Math.round((windowWidth - 32) * STRIP_SHARE));
}

/** Первая буква заглавная: «подача до 1 мая» -> «Подача до 1 мая» (веб `::first-letter`). */
const capitalized = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

/**
 * Карточка избранного вуза (перенесено из #1423, Айвар; как HomeFavorites на вебе): фото кампуса из нашего бакета,
 * название, «город · страна» и ближайший срок подачи или старт тем же текстом, что у карточек каталога. Нет фото - серая
 * подложка без надписи. Вся карточка - переход на вуз.
 */
function FavoriteCard({ item, width, now, index }: { item: PublishedUniversity; width: number; now: Date; index: number }) {
  const { lang, t } = useLang();
  const universities = t("universities");
  const country = universityCountryLabel(item.content.country, lang);
  const card = (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={item.content.name}
      onPress={() => go(`/universities/${item.id}`)}
      testID={`fav-${item.id}`}
      style={{ width, minHeight: MIN_TARGET }}
    >
      <View style={{ gap: 4 }}>
        <RemotePhoto
          urls={universityUrls(item.content.photoKey, Math.round(width * PixelRatio.get()))}
          height={Math.round(width * FAV_PHOTO_RATIO)}
          label={item.content.name}
          strings={universities}
          quiet
          testID={`fav-photo-${item.id}`}
        />
        <Text variant="body" bold style={{ marginTop: 4 }}>
          {item.content.name}
        </Text>
        <Text variant="caption" tone="text2">
          {item.content.city ? `${item.content.city} · ${country}` : country}
        </Text>
        <Text variant="caption" bold testID={`fav-intake-${item.id}`}>
          {capitalized(nearestIntakeText(item, lang, now, universities))}
        </Text>
      </View>
    </PressableScale>
  );
  // Первые шесть карточек входят по очереди (веб: `.pt-home-fav-grid > :nth-child(-n + 6)`).
  return index < FAV_ENTER_LIMIT ? <Enter index={index}>{card}</Enter> : card;
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
  const [allFavorites, setAllFavorites] = useState(false);
  const { width } = useWindowDimensions();
  const cardWidth = stripCardWidth(width);
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
          <>
            {allFavorites ? (
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
            ) : (
              <ScrollView
                horizontal
                accessibilityRole="list"
                showsHorizontalScrollIndicator={false}
                decelerationRate="fast"
                snapToInterval={cardWidth + STRIP_GAP}
                snapToAlignment="start"
                testID="home-favorites"
                style={{ marginHorizontal: -16 }}
                contentContainerStyle={{ gap: STRIP_GAP, paddingHorizontal: 16, paddingVertical: 6 }}
              >
                {favorites.data.items.slice(0, HOME_FAVORITES_LIMIT).map((item, index) => (
                  <FavoriteCard key={item.id} item={item} width={cardWidth} now={now} index={index} />
                ))}
              </ScrollView>
            )}
            {/* Полный список (с ближайшим набором) только если вузов больше, чем карточек. */}
            {!allFavorites && favorites.data.items.length > HOME_FAVORITES_LIMIT ? (
              <Button variant="ghost" label={home.favoritesAll} onPress={() => setAllFavorites(true)} testID="favorites-all" />
            ) : null}
          </>
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
