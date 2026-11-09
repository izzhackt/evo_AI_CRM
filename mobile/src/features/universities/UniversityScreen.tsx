// Страница вуза: путь, фото с подписью, сердечко, обзор, сайт, «Стоимость» (если есть опубликованные
// строки), «Программы вуза» с наборами и кнопка «Добавить в мои программы».
// Программы по #1357: описание программ вуза живёт здесь (каталог), а выбранные студентом программы -
// ОДНО место, «Мои программы» (Поступление); это название везде одно.
// Веб: src/app/(portal)/portal/universities/[id]/page.tsx, components/portal/universities/Detail.tsx.
import { useLocalSearchParams } from "expo-router";
import { Linking, View } from "react-native";
import { useMemo } from "react";

import type { UniversityIntake, UniversityProgram } from "@web/lib/platform-university-catalog";
import { universityUuid } from "@web/lib/platform-university-catalog";
import { isPlatformApplicationCountryCode } from "@web/lib/platform-application-contract";
import { localizedText } from "@web/lib/portal/university-index";
import { universityDateLabel, universityIntakeStatusKey, universityLevelKey, universityMonthLabel } from "@web/lib/portal/universities";

import { usePortalApi } from "@/api/PortalApi";
import { loadErrorKey } from "@/api/queries";
import { go } from "@/features/portal/navigation";
import { useLang } from "@/i18n/LangProvider";
import { rpcErrorKey } from "@/lib/rpc";
import { TAB_BAR_CLEARANCE } from "@/shell/TabBar";
import { useTheme } from "@/theme/ThemeProvider";
import { Button } from "@/ui/Button";
import { CardSkeleton, InlineAlert } from "@/ui/CardParts";
import { Card, Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";

import { UniversityNotFoundError } from "./api";
import { buildCostView } from "./costs-view";
import { useFavoriteState } from "./FavoritesContext";
import { useSelectProgram, useUniversityDetail } from "./hooks";
import { NotFoundBlock } from "./NotFoundBlock";
import { FavoriteHeart, PathRow, PhotoCredit, RemotePhoto, universityUrls, usePhotoPixels } from "./parts";
import { universityPhotoCredit } from "./photos";
import type { StudentUniversityDetail } from "@web/lib/portal/university-index";
import type { UniversityStrings } from "./model";

function ExternalLink({ url, label }: { url: string; label: string }) {
  return (
    <Text variant="secondary" tone="accent" bold accessibilityRole="link" onPress={() => void Linking.openURL(url).catch(() => undefined)} style={{ paddingVertical: 8 }}>
      {label}
    </Text>
  );
}

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
    <Screen topInset={false} bottomInset={TAB_BAR_CLEARANCE} onRefresh={() => void detail.refetch()} refreshing={detail.isRefetching}>
      <View style={{ gap: 16 }}>
        {detail.error instanceof UniversityNotFoundError ? (
          <NotFoundBlock />
        ) : detail.data ? (
          <DetailView detail={detail.data} strings={strings} />
        ) : detail.isError ? (
          <InlineAlert message={m(loadErrorKey(detail.error) === "error.load" ? "uni.unavailable" : loadErrorKey(detail.error))} retryLabel={m("gate.retry")} onRetry={() => void detail.refetch()} testID="detail-error" />
        ) : (
          <CardSkeleton label={m("state.loading")} lines={4} testID="detail-loading" />
        )}
      </View>
    </Screen>
  );
}

function DetailView({ detail, strings }: { detail: StudentUniversityDetail; strings: UniversityStrings }) {
  const { lang, m } = useLang();
  const favorites = useFavoriteState();
  const pixels = usePhotoPixels();
  const now = useMemo(() => new Date(), []);
  const { canSelectPrograms, studentCaseId } = usePortalApi();
  const { university, country, city, costs } = detail;
  const listKnown = detail.preparations?.studentCaseId === studentCaseId;
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

      <View style={{ gap: 12 }}>
        <Text variant="heading" accessibilityRole="header">
          {m("uni.programsHeading")}
        </Text>
        {listKnown && !canSelectPrograms ? (
          <Text variant="caption" tone="text2">
            {m("programs.caseIneligible")}
          </Text>
        ) : null}
        {content.programs.map((program) => (
          <ProgramCard key={program.id} program={program} detail={detail} strings={strings} now={now} />
        ))}
      </View>
      <ExternalLink url={content.sourceUrl} label={strings.cardSource} />
    </>
  );
}

function ProgramCard({ program, detail, strings, now }: { program: UniversityProgram; detail: StudentUniversityDetail; strings: UniversityStrings; now: Date }) {
  const { lang } = useLang();
  return (
    <Card>
      <Text variant="caption" tone="text2" bold>
        {strings[universityLevelKey(program.level)]}
      </Text>
      <Text variant="heading">{program.title}</Text>
      {program.duration ? (
        <Text variant="secondary">
          <Text variant="secondary" tone="text2">
            {strings.duration}:{" "}
          </Text>
          {program.duration}
        </Text>
      ) : null}
      {program.language ? (
        <Text variant="secondary">
          <Text variant="secondary" tone="text2">
            {strings.teachingLanguage}:{" "}
          </Text>
          {program.language}
        </Text>
      ) : null}
      {program.summary ? <Text variant="secondary">{program.summary}</Text> : null}
      <ExternalLink url={program.sourceUrl} label={strings.programPage} />
      {program.intakes.map((intake, index) => (
        <IntakeBlock key={intake.id ?? index} intake={intake} program={program} detail={detail} strings={strings} now={now} lang={lang} />
      ))}
    </Card>
  );
}

function IntakeBlock({ intake, program, detail, strings, now, lang }: { intake: UniversityIntake; program: UniversityProgram; detail: StudentUniversityDetail; strings: UniversityStrings; now: Date; lang: "ru" | "ky" }) {
  const { tokens } = useTheme();
  const { m, t } = useLang();
  const { canSelectPrograms, studentCaseId } = usePortalApi();
  const select = useSelectProgram();
  const start = intake.startDate ? universityDateLabel(intake.startDate, lang) : intake.startMonth ? universityMonthLabel(intake.startMonth, lang) : null;
  const deadline = intake.applicationDeadline
    ? `${universityDateLabel(intake.applicationDeadline, lang)}${intake.deadlineTime ? `, ${intake.deadlineTime} (${intake.timezone})` : ""}`
    : null;
  const statusKey = universityIntakeStatusKey(intake, now);
  const uncertain = !["open", "announced"].includes(intake.status) || !intake.applicationDeadline || !intake.timezone || statusKey === "intakeStatus.needsConfirmation";
  // Подготовки читаются в том же вызове; чужое дело или нечитаемый список: честно «не знаем».
  const bindings = detail.preparations?.studentCaseId === studentCaseId ? detail.preparations.items : null;
  const existing = bindings?.find((item) => item.institutionId === detail.university.id && item.programId === program.id && item.intakeId === intake.id) ?? null;
  // Причина отказа та же, что в вебе (SelectionAction): текст берётся из его словаря «preparations».
  const blocked = !intake.id
    ? "identityMissing"
    : !isPlatformApplicationCountryCode(detail.university.content.country)
      ? "unsupportedCountry"
      : intake.status === "closed"
        ? "closedIntake"
        : null;

  let action: React.ReactNode = null;
  if (existing || select.isSuccess) {
    action = <Button variant="ghost" label={m("programs.openMine")} onPress={() => go("/overview")} testID="program-open-mine" />;
  } else if (bindings !== null && !canSelectPrograms) {
    action = null; // одно объяснение стоит ниже, на каждом наборе оно не повторяется
  } else if (blocked) {
    action = (
      <Text variant="caption" tone="text2">
        {t("preparations")[blocked]}
      </Text>
    );
  } else if (bindings === null) {
    action = null;
  } else {
    action = (
      <View style={{ gap: 8 }}>
        <Text variant="caption" tone="text2">
          {m("programs.hint")}
          {uncertain ? ` ${m("programs.confirmDeadline")}` : ""}
        </Text>
        <Button
          label={select.isPending ? m("programs.adding") : m("programs.add")}
          busy={select.isPending}
          onPress={() =>
            select.mutate({ studentCaseId, institutionId: detail.university.id, programId: program.id, intakeId: intake.id as string, publicationVersion: detail.university.version })
          }
          testID="program-add"
        />
        {select.isError ? (
          <Text variant="caption" tone="error" accessibilityRole="alert">
            {select.error && rpcErrorKey(select.error) !== "error.generic" ? m(rpcErrorKey(select.error)) : m("programs.error")}
          </Text>
        ) : null}
      </View>
    );
  }
  return (
    <View style={{ gap: 4, paddingTop: 12, borderTopWidth: 1, borderTopColor: tokens.line }}>
      <Text variant="body" bold>
        {intake.label}
      </Text>
      <Text variant="secondary" tone="text2">
        {strings[statusKey]}
      </Text>
      {start ? (
        <Text variant="secondary">
          <Text variant="secondary" tone="text2">
            {strings.intakeStart}:{" "}
          </Text>
          {start}
        </Text>
      ) : null}
      {deadline ? (
        <Text variant="secondary">
          <Text variant="secondary" tone="text2">
            {strings.intakeDeadline}:{" "}
          </Text>
          {deadline}
        </Text>
      ) : null}
      {intake.note ? (
        <Text variant="caption" tone="text2">
          {intake.note}
        </Text>
      ) : null}
      <ExternalLink url={intake.sourceUrl} label={strings.intakeSource} />
      {action}
    </View>
  );
}
