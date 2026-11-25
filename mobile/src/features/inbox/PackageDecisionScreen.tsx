// Решение по комплекту документов программы (веб: /portal/package-notifications/[notificationId]): решение EVO по
// отправленному комплекту (слово, время, замечание), какие материалы нужно исправить, состав комплекта с проверками, учтёнными
// в решении, и ссылка на программу. Состав читается тем же RPC, что и в вебе (`application_package_detail_v1`), и
// сравнивается с решением из уведомления (`packageReviewPresentation`): позднее решение и изменения после решения видны.
// «История решений» читается по раскрытию, как в вебе. Скачивание файлов строит экран программы (срез «Требования программы»):
// отсюда ведёт ссылка на него.
import { packageReviewPresentation } from "@web/components/portal/applicationPackages/presentation";
import { packageStrings, type PackageStrings } from "@web/components/portal/applicationPackages/strings";
import type { ApplicationDocumentCursor } from "@web/lib/portal/application-documents";
import type { ApplicationPackageDetail, ApplicationPackageReview } from "@web/lib/portal/application-packages";
import { router } from "expo-router";
import { ChevronDown, ChevronUp } from "lucide-react-native";
import { useRef, useState } from "react";
import { Linking, Pressable, View } from "react-native";

import { isNotificationId, readPackageReviewHistory } from "@/api/inbox-detail-api";
import { usePackageDetail, usePackageNotification } from "@/api/inbox-queries";
import { usePortalApi } from "@/api/PortalApi";
import { allDayDate } from "@/domain/presentation";
import { DetailFrame } from "@/features/inbox/DetailFrame";
import { DetailNotFound, FileEvidence, isNotFoundError, reviewWord, type ProgramDocumentStrings } from "@/features/inbox/DecisionParts";
import { bishkekTime } from "@/features/inbox/format";
import { go } from "@/features/portal/navigation";
import { preparationHref } from "@/features/preparations/routes";
import { useLang } from "@/i18n/LangProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { Button } from "@/ui/Button";
import { InlineAlert, LinkButton, MIN_TARGET } from "@/ui/CardParts";
import { Text } from "@/ui/Text";

/** Решение по комплекту: слово, время и замечание (веб PackageDecision). */
function PackageDecision({ review, strings, testID = "package-decision" }: { review: ApplicationPackageReview; strings: PackageStrings; testID?: string }) {
  return (
    <View style={{ gap: 4 }} testID={testID}>
      <Text variant="body" bold testID={`${testID}-word`}>
        {review.decision === "approved" ? strings.approved : strings.correction}
      </Text>
      <Text variant="caption" tone="text2">
        {strings.reviewedAt}: {bishkekTime(review.reviewedAt)}
      </Text>
      {review.reason ? (
        <Text variant="secondary" selectable testID={`${testID}-reason`}>
          {review.reason}
        </Text>
      ) : null}
    </View>
  );
}

/** Материалы, которые нужно исправить; без выбранных пунктов замечание относится ко всему составу (веб AffectedMaterials). */
function AffectedMaterials({ review, detail, strings }: { review: ApplicationPackageReview; detail: ApplicationPackageDetail; strings: PackageStrings }) {
  if (review.decision !== "correction_required") return null;
  if (review.affectedItemIds.length === 0) {
    return (
      <Text variant="secondary" tone="text2">
        {strings.general}
      </Text>
    );
  }
  return (
    <View style={{ gap: 4 }} testID="package-affected">
      <Text variant="body" bold>
        {strings.affected}
      </Text>
      {review.affectedItemIds.map((id) => (
        <Text key={id} variant="secondary">
          {itemLabel(detail, id, strings)}
        </Text>
      ))}
    </View>
  );
}

/** Проверка файла, учтённая в решении по комплекту (веб ReviewEvidence). */
function ReviewEvidence({ evidence, strings, docs }: { evidence: ApplicationPackageReview["documentReviews"][number]; strings: PackageStrings; docs: ProgramDocumentStrings }) {
  return (
    <View style={{ gap: 2 }}>
      <Text variant="caption" tone="text2">
        {strings.reviewEvidence}
      </Text>
      <Text variant="secondary">{evidence.review ? docs[`review.${evidence.review.decision}`] : strings.noReviews}</Text>
      {evidence.review ? (
        <Text variant="caption" tone="text2">
          {bishkekTime(evidence.review.reviewedAt)}
        </Text>
      ) : null}
      {evidence.review?.reason ? (
        <Text variant="secondary" selectable>
          {evidence.review.reason}
        </Text>
      ) : null}
      {evidence.reusedFromReview ? (
        <Text variant="caption" tone="text2">
          {strings.reuseSource}: {docs[`review.${evidence.reusedFromReview.decision}`]} · {bishkekTime(evidence.reusedFromReview.reviewedAt)}
        </Text>
      ) : null}
    </View>
  );
}

function openSource(url: string): void {
  if (/^https:\/\//i.test(url)) void Linking.openURL(url).catch(() => undefined);
}

/** Состав комплекта: программа, решение из уведомления, изменения после него и материалы (веб PackageDetail, студент, чтение). */
function PackageDetailView({ detail, frozenReview, strings }: { detail: ApplicationPackageDetail; frozenReview: ApplicationPackageReview; strings: PackageStrings }) {
  const { t } = useLang();
  const { tokens } = useTheme();
  const docs = t("programDocuments");
  const { review, newerReview, items, warnings } = packageReviewPresentation(detail, frozenReview);
  return (
    <View style={{ gap: 12 }} testID="package-detail">
      <Text variant="body" bold accessibilityRole="header">
        {strings.version} {detail.package.packageVersion}
      </Text>
      <Text variant="body">
        {detail.program.programTitle} · {detail.program.intakeLabel}
      </Text>
      {detail.package.origin === "evo_starter" ? (
        <View style={{ gap: 4 }}>
          <Text variant="secondary" tone="text2">
            {strings.starter}
          </Text>
          <Text variant="secondary" tone="text2">
            {strings.starterHelp}
          </Text>
        </View>
      ) : null}
      {!detail.package.isCurrentRequirements ? (
        <Text variant="secondary" tone="text2">
          {strings.older}
        </Text>
      ) : null}
      <Text variant="caption" tone="text2">
        {strings.submittedAt}: {bishkekTime(detail.package.submittedAt)}
      </Text>
      <Text variant="secondary" tone="text2">
        {strings.historical}
      </Text>
      {review ? <AffectedMaterials review={review} detail={detail} strings={strings} /> : null}
      {newerReview ? (
        <View style={{ gap: 8 }} testID="package-newer">
          <Text variant="body" bold accessibilityRole="header">
            {strings.newerDecision}
          </Text>
          <PackageDecision review={newerReview} strings={strings} testID="package-newer-decision" />
          <AffectedMaterials review={newerReview} detail={detail} strings={strings} />
        </View>
      ) : null}
      {warnings.length > 0 ? (
        <View style={{ gap: 4 }} testID="package-warnings">
          <Text variant="body" bold accessibilityRole="header">
            {strings.currentWarnings}
          </Text>
          {warnings.map((warning) => (
            <Text key={`${warning.requirementItemId}:${warning.reason}`} variant="secondary">
              {itemLabel(detail, warning.requirementItemId, strings)}: {warning.reason === "review_changed" ? strings.reviewChanged : strings.fileUnavailable}
            </Text>
          ))}
        </View>
      ) : null}
      {items.map(({ item, evidence, currentReview }) => {
        const due = item.definition.deadline;
        return (
          <View key={item.packageItemId} testID={`package-item-${item.requirementItemId}`} style={{ gap: 6, paddingTop: 12, borderTopWidth: 1, borderTopColor: tokens.line }}>
            <Text variant="body" bold>
              {item.definition.label}
            </Text>
            <Text variant="caption" tone="text2">
              {item.definition.groupLabel} · {item.definition.required ? strings.required : strings.optionalLabel}
            </Text>
            {item.definition.instructions ? (
              <Text variant="secondary" selectable>
                {item.definition.instructions}
              </Text>
            ) : null}
            {due ? (
              <View style={{ gap: 2 }}>
                <Text variant="secondary" tone="text2">
                  {strings.deadline}: {allDayDate(due.date) ?? due.date}
                  {due.time ? ` ${due.time}` : ""}
                  {due.timezone ? ` (${due.timezone})` : ""}
                </Text>
                {due.sourceUrl ? <LinkButton label={strings.deadlineSource} onPress={() => openSource(due.sourceUrl!)} /> : null}
              </View>
            ) : null}
            <FileEvidence file={item.submission.file} />
            {evidence ? <ReviewEvidence evidence={evidence} strings={strings} docs={docs} /> : null}
            <View style={{ gap: 2 }}>
              <Text variant="caption" tone="text2">
                {strings.currentFileReview}
              </Text>
              <Text variant="secondary">{reviewWord(currentReview, docs)}</Text>
              {currentReview ? (
                <Text variant="caption" tone="text2">
                  {bishkekTime(currentReview.reviewedAt)}
                </Text>
              ) : null}
              {currentReview?.reason ? (
                <Text variant="secondary" selectable>
                  {currentReview.reason}
                </Text>
              ) : null}
            </View>
          </View>
        );
      })}
      <PackageReviewHistory detail={detail} strings={strings} />
    </View>
  );
}

/** Подпись материала по требованию: из состава комплекта, а не идентификатором (веб ReviewHistory). */
function itemLabel(detail: ApplicationPackageDetail, requirementItemId: string, strings: PackageStrings): string {
  return detail.items.find((item) => item.requirementItemId === requirementItemId)?.definition.label ?? strings.document;
}

/** «История решений»: все решения по этому комплекту, новые первыми; читается при первом раскрытии (веб ReviewHistory). */
function PackageReviewHistory({ detail, strings }: { detail: ApplicationPackageDetail; strings: PackageStrings }) {
  const { t } = useLang();
  const { tokens } = useTheme();
  const { transport, studentCaseId } = usePortalApi();
  const docs = t("programDocuments");
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<readonly ApplicationPackageReview[]>([]);
  const [cursor, setCursor] = useState<ApplicationDocumentCursor | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const lock = useRef(false);
  const Chevron = open ? ChevronUp : ChevronDown;

  const load = async (reset: boolean) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setFailed(false);
    try {
      const history = await readPackageReviewHistory(transport, { studentCaseId, applicationId: detail.applicationId }, detail.package.packageId, reset ? null : cursor);
      setRows((old) => (reset ? [...history.reviews] : [...old, ...history.reviews.filter((row) => !old.some((value) => value.packageReviewId === row.packageReviewId))]));
      setCursor(history.nextCursor);
      setLoaded(true);
    } catch {
      setFailed(true);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };

  const toggle = () => {
    setOpen(!open);
    if (!open && !loaded) void load(true);
  };

  return (
    <View style={{ gap: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: tokens.line }} testID="package-history">
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={toggle} testID="package-history-toggle" style={{ minHeight: MIN_TARGET, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <Text variant="body" bold style={{ flex: 1 }}>
          {strings.reviewHistory}
        </Text>
        <Chevron size={20} strokeWidth={1.75} color={tokens.text2} />
      </Pressable>
      {open ? (
        <View style={{ gap: 12 }}>
          {rows.map((row) => (
            <View key={row.packageReviewId} testID={`package-history-${row.packageReviewId}`} style={{ gap: 8, paddingTop: 12, borderTopWidth: 1, borderTopColor: tokens.line }}>
              <PackageDecision review={row} strings={strings} testID={`package-history-decision-${row.packageReviewId}`} />
              <AffectedMaterials review={row} detail={detail} strings={strings} />
              {row.documentReviews.map((evidence) => (
                <View key={evidence.requirementItemId} style={{ gap: 2 }}>
                  <Text variant="body" bold>
                    {itemLabel(detail, evidence.requirementItemId, strings)}
                  </Text>
                  <ReviewEvidence evidence={evidence} strings={strings} docs={docs} />
                </View>
              ))}
            </View>
          ))}
          {loaded && rows.length === 0 ? (
            <Text variant="secondary" tone="text2">
              {strings.noReviews}
            </Text>
          ) : null}
          {busy ? (
            <Text variant="secondary" tone="text2" accessibilityLiveRegion="polite">
              {strings.loading}
            </Text>
          ) : null}
          {failed ? (
            <Text variant="secondary" tone="error" accessibilityRole="alert" testID="package-history-error">
              {strings.unavailable}
            </Text>
          ) : null}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 16 }}>
            <LinkButton label={strings.refresh} onPress={() => void load(true)} testID="package-history-refresh" />
            {cursor ? <LinkButton label={strings.more} onPress={() => void load(false)} testID="package-history-more" /> : null}
          </View>
        </View>
      ) : null}
    </View>
  );
}

export function PackageDecisionScreen({ notificationId }: { notificationId: string }) {
  const { lang, m } = useLang();
  const strings = packageStrings(lang);
  const valid = isNotificationId(notificationId);
  const query = usePackageNotification(notificationId);
  const notification = query.data;
  const detail = usePackageDetail(notification ? { applicationId: notification.applicationId, packageId: notification.packageId } : null);
  const refresh = () => {
    void query.refetch();
    if (notification) void detail.refetch();
  };

  return (
    <DetailFrame title={strings.notificationTitle} backLabel={strings.backNotifications} testID="package-decision-screen">
      <View style={{ alignItems: "flex-start" }}>
        <LinkButton label={strings.backNotifications} onPress={() => go("/messages/updates")} testID="decision-all" />
      </View>
      {notification ? (
        <View style={{ gap: 16 }}>
          <PackageDecision review={notification.review} strings={strings} />
          {detail.data ? (
            <PackageDetailView detail={detail.data} frozenReview={notification.review} strings={strings} />
          ) : detail.status === "error" ? (
            <InlineAlert message={strings.unavailable} retryLabel={strings.refresh} onRetry={() => void detail.refetch()} testID="package-detail-error" />
          ) : (
            <Text variant="secondary" tone="text2" accessibilityLiveRegion="polite">
              {strings.loading}
            </Text>
          )}
          <View style={{ alignItems: "flex-start", gap: 8 }}>
            <LinkButton label={strings.openProgram} onPress={() => router.navigate(preparationHref(notification.applicationId))} testID="decision-open-program" />
            <Button variant="ghost" label={strings.refresh} onPress={refresh} testID="package-refresh" />
          </View>
        </View>
      ) : !valid || isNotFoundError(query.error) ? (
        <DetailNotFound />
      ) : query.status === "error" ? (
        <InlineAlert message={strings.unavailable} retryLabel={strings.refresh} onRetry={() => void query.refetch()} testID="package-decision-error" />
      ) : (
        <Text variant="secondary" tone="text2" accessibilityLiveRegion="polite">
          {m("state.loading")}
        </Text>
      )}
    </DetailFrame>
  );
}
