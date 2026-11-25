// Страница вуза: путь, фото с подписью, сердечко, обзор, сайт, «Стоимость» (если есть опубликованные
// строки), «Программы вуза» (подбор, окно программы, кнопка «Добавить в мои программы» - ProgramSection.tsx).
// Программы по #1357: описание программ вуза живёт здесь (каталог), а выбранные студентом программы -
// ОДНО место, «Мои программы» (вкладка «Мой список» на Главной); это название везде одно.
// Веб: src/app/(portal)/portal/universities/[id]/page.tsx, components/portal/universities/Detail.tsx.
import { useLocalSearchParams } from "expo-router";
import { View } from "react-native";
import { useMemo } from "react";

import { universityUuid } from "@web/lib/platform-university-catalog";
import { localizedText } from "@web/lib/portal/university-index";

import { usePortalApi } from "@/api/PortalApi";
import { loadErrorKey } from "@/api/queries";
import { go, WRITE_EVO_ROUTE } from "@/features/portal/navigation";
import { useLang } from "@/i18n/LangProvider";
import { Button } from "@/ui/Button";
import { CardSkeleton, InlineAlert } from "@/ui/CardParts";
import { Card, Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";

import { UniversityNotFoundError } from "./api";
import { buildCostView } from "./costs-view";
import { ExternalLink } from "./ExternalLink";
import { useFavoriteState } from "./FavoritesContext";
import { useUniversityDetail } from "./hooks";
import { NotFoundBlock } from "./NotFoundBlock";
import { FavoriteHeart, PathRow, PhotoCredit, RemotePhoto, universityUrls, usePhotoPixels } from "./parts";
import { universityPhotoCredit } from "./photos";
import { ProgramSection } from "./ProgramSection";
import type { StudentUniversityDetail } from "@web/lib/portal/university-index";
import type { UniversityStrings } from "./model";

export function UniversityScreen() {
  const { id: raw } = useLocalSearchParams<{ id: string }>();
  const id = universityUuid(String(raw ?? ""));
  if (id === null) return <NotFoundBlock />;
  return <UniversityBody id={id} />;
}

function UniversityBody({ id }: { id: string }) {
  const { t, m } = useLang();
  const strings = t("universities");
  const detail = useUniversityDetail(id);
  return (
    <Screen topInset={false} tabBar onRefresh={() => void detail.refetch()} refreshing={detail.isRefetching}>
      <View style={{ gap: 16 }}>
        {detail.error instanceof UniversityNotFoundError ? (
          <NotFoundBlock />
        ) : detail.data ? (
          <DetailView detail={detail.data} strings={strings} onRefresh={() => void detail.refetch()} />
        ) : detail.isError ? (
          <InlineAlert message={m(loadErrorKey(detail.error) === "error.load" ? "uni.unavailable" : loadErrorKey(detail.error))} retryLabel={m("gate.retry")} onRetry={() => void detail.refetch()} testID="detail-error" />
        ) : (
          <CardSkeleton label={m("state.loading")} lines={4} testID="detail-loading" />
        )}
      </View>
    </Screen>
  );
}

function DetailView({ detail, strings, onRefresh }: { detail: StudentUniversityDetail; strings: UniversityStrings; onRefresh: () => void }) {
  const { lang, t } = useLang();
  const favorites = useFavoriteState();
  const pixels = usePhotoPixels();
  const now = useMemo(() => new Date(), []);
  const { tier } = usePortalApi();
  const { university, country, city, costs } = detail;
  const content = university.content;
  const cost = costs ? buildCostView(costs, content.programs, strings, lang) : null;
  const favored = favorites.isFavored(university.id) ?? detail.favored;
  const crumbs = [localizedText(country.name, lang), ...(city ? [localizedText(city.name, lang)] : [])];
  return (
    <>
      <PathRow crumbs={[...crumbs, content.name]} strings={strings} />
      <View style={{ gap: 8 }}>
        <RemotePhoto urls={universityUrls(content.photoKey, pixels)} height={190} label={content.name} strings={strings} />
        <PhotoCredit credit={universityPhotoCredit(content.photoKey)} universityName={content.name} strings={strings} />
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 4 }}>
          <Text variant="title" accessibilityRole="header" style={{ flex: 1 }}>
            {content.name}
          </Text>
          <FavoriteHeart favored={favored} name={content.name} onToggle={() => favorites.toggle(university.id, !favored)} strings={strings} />
        </View>
        <Text variant="secondary" tone="text2">
          {strings.detailLead}
        </Text>
      </View>
      <Text variant="body">{content.overview}</Text>
      <ExternalLink url={content.websiteUrl} label={strings.website} />
      {/* #1356: у клиента с сопровождением один вход к команде - чат «Входящих»; студенту без сопровождения чата нет. */}
      {tier === "assisted" ? <Button variant="ghost" label={t("home").writeAction} onPress={() => go(WRITE_EVO_ROUTE)} testID="university-write-evo" /> : null}

      {cost ? (
        <Card>
          <Text variant="heading" accessibilityRole="header">
            {strings.costsHeading}
          </Text>
          {cost.groups.map((group) => (
            <View key={group.title} style={{ gap: 8 }} testID="cost-group">
              <Text variant="caption" tone="text2" bold>
                {group.title}
              </Text>
              {group.rows.map((row) => (
                <View key={row.id} style={{ gap: 2 }} accessible accessibilityLabel={`${row.label}. ${row.amount} ${row.period}${row.usd ? `. ${row.usd}` : ""}`}>
                  <Text variant="body" bold>
                    {row.label}
                  </Text>
                  {row.details ? (
                    <Text variant="caption" tone="text2">
                      {row.details}
                    </Text>
                  ) : null}
                  <Text variant="secondary">
                    <Text variant="data">{row.amount}</Text>
                    <Text variant="secondary" tone="text2">
                      {" "}
                      {row.period}
                    </Text>
                  </Text>
                  {row.usd ? (
                    <Text variant="secondary" tone="text2">
                      {row.usd}
                    </Text>
                  ) : null}
                </View>
              ))}
            </View>
          ))}
          {cost.notes.map((note) => (
            <Text key={note} variant="caption" tone="text2">
              {note}
            </Text>
          ))}
          {cost.officialUrls.map((url, index) => (
            <ExternalLink key={url} url={url} label={cost.officialUrls.length === 1 ? strings.costSourceOfficial : `${strings.costSourceOfficial}, ${index + 1}`} />
          ))}
        </Card>
      ) : null}

      <ProgramSection detail={detail} strings={strings} now={now} onRefresh={onRefresh} />
      <ExternalLink url={content.sourceUrl} label={strings.cardSource} />
    </>
  );
}
