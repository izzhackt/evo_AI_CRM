// Комплект подробно (студент): когда отправлен, решение EVO и какие материалы нужно исправить, состав с файлами и решениями по
// ним, что изменилось после решения, история решений. Веб: `PackageDetail.tsx` (без форм сотрудника).
import { packageReviewPresentation } from "@web/components/portal/applicationPackages/presentation";
import type { ApplicationDocumentCursor } from "@web/lib/portal/application-documents";
import type { ApplicationPackageDetail as Detail, ApplicationPackageReview, ApplicationPackageSummary } from "@web/lib/portal/application-packages";
import { useCallback, useEffect, useRef, useState } from "react";
import { View } from "react-native";

import { usePortalApi } from "@/api/PortalApi";
import { readPackageDetail, readPackageReviewHistory } from "@/api/preparations-packages";
import { Collapsible } from "@/features/preparations/Collapsible";
import { DeadlineBlock } from "@/features/preparations/DeadlineBlock";
import { usePreparation } from "@/features/preparations/context";
import { Block, FileFacts } from "@/features/preparations/ItemDocumentState";
import { programTime } from "@/features/preparations/model";
import { usePackageStrings, type PackageStrings } from "@/features/preparations/package-strings";
import { announce } from "@/ui/a11y";
import { Button } from "@/ui/Button";
import { Text } from "@/ui/Text";

/** Статус комплекта словом: ждёт проверки, проверен, нужны исправления (веб: `packageStatus`). */
export function packageStatus(value: ApplicationPackageSummary, t: PackageStrings): string {
  return value.latestReview ? (value.latestReview.decision === "approved" ? t.approved : t.correction) : t.awaiting;
}

export function PackageDecision({ review, strings: t }: { review: ApplicationPackageReview; strings: PackageStrings }) {
  return (
    <View style={{ gap: 4 }}>
      <Text variant="body" bold>
        {review.decision === "approved" ? t.approved : t.correction}
      </Text>
      <Text variant="secondary" tone="text2">
        {t.reviewedAt}: <Text variant="data">{programTime(review.reviewedAt)}</Text>
      </Text>
      {review.reason ? <Text variant="body">{review.reason}</Text> : null}
    </View>
  );
}

function AffectedMaterials({ review, detail, strings: t }: { review: ApplicationPackageReview; detail: Detail; strings: PackageStrings }) {
  if (review.decision !== "correction_required") return null;
  return review.affectedItemIds.length ? (
    <View style={{ gap: 4 }}>
      <Text variant="body" bold>
        {t.affected}
      </Text>
      {review.affectedItemIds.map((id) => (
        <Text key={id} variant="secondary">
          • {detail.items.find((item) => item.requirementItemId === id)?.definition.label ?? t.document}
        </Text>
      ))}
    </View>
  ) : (
    <Text variant="secondary" tone="text2">
      {t.general}
    </Text>
  );
}

function ReviewEvidence({ evidence, strings: t }: { evidence: ApplicationPackageReview["documentReviews"][number]; strings: PackageStrings }) {
  const { strings: documentStrings } = usePreparation();
  return (
    <View style={{ gap: 2 }}>
      <Text variant="caption" tone="text2">
        {t.reviewEvidence}
      </Text>
      <Text variant="body">{evidence.review ? documentStrings[`review.${evidence.review.decision}`] : t.noReviews}</Text>
      {evidence.review ? <Text variant="caption" tone="text2">{programTime(evidence.review.reviewedAt)}</Text> : null}
      {evidence.review?.reason ? <Text variant="secondary">{evidence.review.reason}</Text> : null}
      {evidence.reusedFromReview ? (
        <Text variant="caption" tone="text2">
          {t.reuseSource}: {documentStrings[`review.${evidence.reusedFromReview.decision}`]} · {programTime(evidence.reusedFromReview.reviewedAt)}
        </Text>
      ) : null}
    </View>
  );
}

function ReviewHistory({ detail, strings: t }: { detail: Detail; strings: PackageStrings }) {
  const { scope } = usePreparation();
  const { transport } = usePortalApi();
  const packageId = detail.package.packageId;
  const [rows, setRows] = useState<readonly ApplicationPackageReview[]>([]);
  const [cursor, setCursor] = useState<ApplicationDocumentCursor | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const lock = useRef(false);
  const load = useCallback(
    async (reset: boolean) => {
      if (lock.current) return;
      lock.current = true;
      setBusy(true);
      setFailed(false);
      try {
        const history = await readPackageReviewHistory(transport, { studentCaseId: scope.studentCaseId, applicationId: scope.applicationId }, packageId, reset ? null : cursor);
        setRows((old) => (reset ? [...history.reviews] : [...old, ...history.reviews.filter((row) => !old.some((value) => value.packageReviewId === row.packageReviewId))]));
        setCursor(history.nextCursor);
        setLoaded(true);
      } catch {
        setFailed(true);
        // Роль «alert» на iPhone молчит: сбой нужно сказать читалке самим.
        announce(t.unavailable);
      } finally {
        lock.current = false;
        setBusy(false);
      }
    },
    [cursor, packageId, scope.applicationId, scope.studentCaseId, t.unavailable, transport],
  );
  return (
    <Collapsible title={t.reviewHistory} testID={`prep-review-history-${packageId}`} onToggle={(open) => { if (open && !loaded && !lock.current) void load(true); }}>
      {rows.map((row) => (
        <View key={row.packageReviewId} style={{ gap: 8 }} testID={`prep-review-${row.packageReviewId}`}>
          <PackageDecision review={row} strings={t} />
          <AffectedMaterials review={row} detail={detail} strings={t} />
          {row.documentReviews.map((evidence) => (
            <View key={evidence.requirementItemId} style={{ gap: 2 }}>
              <Text variant="body" bold>
                {detail.items.find((item) => item.requirementItemId === evidence.requirementItemId)?.definition.label ?? t.document}
              </Text>
              <ReviewEvidence evidence={evidence} strings={t} />
            </View>
          ))}
        </View>
      ))}
      {loaded && !rows.length ? <Text variant="secondary" tone="text2" testID={`prep-review-history-empty-${packageId}`}>{t.noReviews}</Text> : null}
      {busy ? <Text variant="secondary" tone="text2" accessibilityRole="progressbar" accessibilityLabel={t.loading}>{t.loading}</Text> : null}
      {failed ? <Text variant="secondary" tone="error" accessibilityRole="alert" testID={`prep-review-history-error-${packageId}`}>{t.unavailable}</Text> : null}
      <Button variant="ghost" label={t.refresh} onPress={() => void load(true)} disabled={busy} testID={`prep-review-history-refresh-${packageId}`} />
      {cursor ? <Button variant="ghost" label={t.more} onPress={() => void load(false)} disabled={busy} testID={`prep-review-history-more-${packageId}`} /> : null}
    </Collapsible>
  );
}

export function PackageDetail({ detail, strings: t, frozenReview, showDecision = true }: { detail: Detail; strings: PackageStrings; frozenReview?: ApplicationPackageReview; showDecision?: boolean }) {
  const { scope, strings: documentStrings } = usePreparation();
  const { review, newerReview, items, warnings } = packageReviewPresentation(detail, frozenReview);
  return (
    <View style={{ gap: 12 }} accessibilityLabel={`${t.version} ${detail.package.packageVersion}`} testID={`prep-package-detail-${detail.package.packageId}`}>
      <Text variant="heading" accessibilityRole="header">
        {t.version} {detail.package.packageVersion}
      </Text>
      <Text variant="body">
        {detail.program.programTitle} · {detail.program.intakeLabel}
      </Text>
      {detail.package.origin === "evo_starter" ? (
        <>
          <Text variant="secondary" tone="text2">{t.starter}</Text>
          <Text variant="secondary" tone="text2">{t.starterHelp}</Text>
        </>
      ) : null}
      {!detail.package.isCurrentRequirements ? <Text variant="secondary" tone="text2">{t.older}</Text> : null}
      <Text variant="secondary" tone="text2">
        {t.submittedAt}: <Text variant="data">{programTime(detail.package.submittedAt)}</Text>
      </Text>
      {frozenReview ? <Text variant="secondary" tone="text2">{t.historical}</Text> : null}
      {showDecision && review ? <PackageDecision review={review} strings={t} /> : showDecision ? <Text variant="secondary" tone="text2">{t.awaiting}</Text> : null}
      {review ? <AffectedMaterials review={review} detail={detail} strings={t} /> : null}
      {newerReview ? (
        <Block heading={t.newerDecision}>
          <PackageDecision review={newerReview} strings={t} />
          <AffectedMaterials review={newerReview} detail={detail} strings={t} />
        </Block>
      ) : null}
      {warnings.length ? (
        <Block heading={t.currentWarnings} testID={`prep-package-warnings-${detail.package.packageId}`}>
          {warnings.map((warning) => (
            <Text key={`${warning.requirementItemId}:${warning.reason}`} variant="secondary">
              • {detail.items.find((item) => item.requirementItemId === warning.requirementItemId)?.definition.label}: {warning.reason === "review_changed" ? t.reviewChanged : t.fileUnavailable}
            </Text>
          ))}
        </Block>
      ) : null}
      {items.map(({ item, evidence, currentReview }) => {
        const target = { studentCaseId: scope.studentCaseId, applicationId: scope.applicationId, requirementsRevisionId: item.submission.requirementsRevisionId, requirementItemId: item.requirementItemId, documentSlotId: item.definition.documentSlotId };
        return (
          <View key={item.packageItemId} style={{ gap: 8 }} testID={`prep-package-item-${item.requirementItemId}`}>
            <Text variant="body" bold accessibilityRole="header">
              {item.definition.label}
            </Text>
            <Text variant="caption" tone="text2">
              {item.definition.groupLabel} · {item.definition.required ? t.required : t.optionalLabel}
            </Text>
            <Text variant="secondary">{item.definition.instructions}</Text>
            {item.definition.deadline ? <DeadlineBlock deadline={item.definition.deadline} heading={t.deadline} verified={documentStrings.deadlineVerified} sourceLabel={t.deadlineSource} /> : null}
            <FileFacts file={item.submission.file} strings={documentStrings} target={target} testID={`prep-package-file-${item.requirementItemId}`} />
            {evidence ? <ReviewEvidence evidence={evidence} strings={t} /> : null}
            <View style={{ gap: 2 }}>
              <Text variant="caption" tone="text2">{t.currentFileReview}</Text>
              <Text variant="secondary">{currentReview ? documentStrings[`review.${currentReview.decision}`] : documentStrings.waitingReview}</Text>
              {currentReview ? <Text variant="caption" tone="text2">{programTime(currentReview.reviewedAt)}</Text> : null}
              {currentReview?.reason ? <Text variant="secondary">{currentReview.reason}</Text> : null}
            </View>
          </View>
        );
      })}
      <ReviewHistory detail={detail} strings={t} />
    </View>
  );
}

/** Читает комплект и показывает его; «Обновить» перечитывает. */
export function PackageDetailLoader({ packageId, frozenReview, showDecision = true }: { packageId: string; frozenReview?: ApplicationPackageReview; showDecision?: boolean }) {
  const t = usePackageStrings();
  const { scope } = usePreparation();
  const { transport } = usePortalApi();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const { studentCaseId, applicationId } = scope;
  // Текст сбоя для читалки берётся из последнего показа, а не из зависимостей чтения: смена языка не должна перечитывать комплект.
  const failureText = useRef(t.unavailable);
  useEffect(() => {
    failureText.current = t.unavailable;
  });
  useEffect(() => {
    let active = true;
    readPackageDetail(transport, { studentCaseId, applicationId }, packageId)
      .then((value) => {
        if (!active) return;
        setDetail(value);
        setFailed(false);
      })
      .catch(() => {
        if (!active) return;
        setFailed(true);
        // Роль «alert» на iPhone молчит: сбой нужно сказать читалке самим.
        announce(failureText.current);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [transport, studentCaseId, applicationId, packageId, refresh]);
  return (
    <View style={{ gap: 12 }} accessibilityState={{ busy: loading }}>
      {loading ? <Text variant="secondary" tone="text2" accessibilityRole="progressbar" accessibilityLabel={t.loading}>{t.loading}</Text> : null}
      {failed ? <Text variant="secondary" tone="error" accessibilityRole="alert" testID={`prep-package-detail-error-${packageId}`}>{t.unavailable}</Text> : null}
      {detail ? <PackageDetail detail={detail} strings={t} frozenReview={frozenReview} showDecision={showDecision} /> : null}
      <Button variant="ghost" label={t.refresh} onPress={() => { setLoading(true); setRefresh((value) => value + 1); }} testID={`prep-package-detail-refresh-${packageId}`} />
    </View>
  );
}
