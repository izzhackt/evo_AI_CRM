// Набор программы: подпись, статус, даты, источник и действие «Добавить в мои программы» (веб: `Intake` в Detail.tsx и
// SelectionAction.tsx). Прежде это был `IntakeBlock` в UniversityScreen.tsx; тексты действия теперь из словаря веба
// (`preparations`), а не свои сокращённые, и порядок действий как у веба (`useAddProgram`, `add-program.ts`).
import { useEffect } from "react";
import { View } from "react-native";

import { isPlatformApplicationCountryCode } from "@web/lib/platform-application-contract";
import type { UniversityIntake, UniversityProgram } from "@web/lib/platform-university-catalog";
import type { StudentUniversityDetail } from "@web/lib/portal/university-index";
import { universityDateLabel, universityIntakeStatusKey, universityMonthLabel } from "@web/lib/portal/universities";

import { usePortalApi } from "@/api/PortalApi";
import type { Lang } from "@/i18n";
import { useLang } from "@/i18n/LangProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { announce } from "@/ui/a11y";
import { Button } from "@/ui/Button";
import { Text } from "@/ui/Text";

import { selectionMessage } from "./add-program";
import { ExternalLink } from "./ExternalLink";
import { useAddProgram } from "./hooks";
import type { UniversityStrings } from "./model";

export function IntakeSelect({
  intake,
  program,
  detail,
  strings,
  now,
  lang,
  onOpenApplication,
  onRefresh,
}: {
  intake: UniversityIntake;
  program: UniversityProgram;
  detail: StudentUniversityDetail;
  strings: UniversityStrings;
  now: Date;
  lang: Lang;
  /**
   * Открыть страницу программы: после добавления и по кнопке «Открыть». Экран сначала закрывает окно программы и только потом
   * переходит (иначе страница откроется ПОД ещё показанным нативным окном).
   */
  onOpenApplication: (applicationId: string) => void;
  /** Перечитать карточку вуза («Обновить страницу»). */
  onRefresh: () => void;
}) {
  const { tokens } = useTheme();
  const { t } = useLang();
  const prep = t("preparations");
  const { canSelectPrograms, studentCaseId } = usePortalApi();
  const start = intake.startDate ? universityDateLabel(intake.startDate, lang) : intake.startMonth ? universityMonthLabel(intake.startMonth, lang) : null;
  const deadline = intake.applicationDeadline
    ? `${universityDateLabel(intake.applicationDeadline, lang)}${intake.deadlineTime ? `, ${intake.deadlineTime} (${intake.timezone})` : ""}`
    : null;
  const statusKey = universityIntakeStatusKey(intake, now);
  const uncertainDeadline = !["open", "announced"].includes(intake.status) || !intake.applicationDeadline || !intake.timezone || statusKey === "intakeStatus.needsConfirmation";
  // Подготовки читаются в том же вызове; чужое дело или нечитаемый список: честно «не знаем» (`bindings === null`).
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
  const add = useAddProgram(intake.id ? { institutionId: detail.university.id, programId: program.id, intakeId: intake.id, publicationVersion: detail.university.version } : null, onOpenApplication);
  const busy = add.state.phase === "busy";
  const message = add.state.phase === "uncertain" || add.state.phase === "refused" ? selectionMessage(add.state.reason, prep) : null;
  // Ошибку слышит и читалка iPhone (роль «alert» там ничего не произносит).
  useEffect(() => {
    if (message !== null) announce(message);
  }, [message]);

  const openedId = existing?.applicationId ?? (add.state.phase === "done" ? add.state.applicationId : null);
  let action: React.ReactNode = null;
  if (openedId !== null) {
    action = <Button label={prep.open} onPress={() => onOpenApplication(openedId)} testID="program-open" />;
  } else if (bindings !== null && !canSelectPrograms) {
    action = null; // одно объяснение стоит над списком программ, на каждом наборе оно не повторяется
  } else {
    const unavailable = bindings === null ? prep.listUnavailable : blocked ? prep[blocked] : null;
    const refused = add.state.phase === "refused";
    action = (
      <View style={{ gap: 8 }}>
        {unavailable ? (
          <Text variant="caption" tone="text2" testID="program-unavailable">
            {unavailable}
          </Text>
        ) : (
          <>
            <Text variant="caption" tone="text2">
              {prep.selectionHint}
            </Text>
            {uncertainDeadline ? (
              <Text variant="caption" tone="text2">
                {prep.confirmDeadline}
              </Text>
            ) : null}
            {refused ? null : <Button label={busy ? prep.selecting : add.pending || add.state.phase === "uncertain" ? prep.retrySelection : prep.select} busy={busy} onPress={() => void add.run()} testID="program-add" />}
          </>
        )}
        {message ? (
          <Text variant="caption" tone="error" accessibilityRole="alert" testID="program-error">
            {message}
          </Text>
        ) : null}
        {refused || bindings === null ? (
          <Button
            variant="ghost"
            label={prep.refresh}
            onPress={() => {
              add.reset();
              onRefresh();
            }}
            testID="program-refresh"
          />
        ) : null}
      </View>
    );
  }
  return (
    <View style={{ gap: 4, paddingTop: 12, borderTopWidth: 1, borderTopColor: tokens.line }} testID="intake">
      <Text variant="body" bold accessibilityRole="header">
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
