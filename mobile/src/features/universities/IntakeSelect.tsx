// Набор программы: подпись, статус, даты, источник и действие «Добавить в мои программы». Вынесен из UniversityScreen.tsx
// (прежнее имя IntakeBlock) без изменений.
import { isPlatformApplicationCountryCode } from "@web/lib/platform-application-contract";
import type { UniversityIntake, UniversityProgram } from "@web/lib/platform-university-catalog";
import type { StudentUniversityDetail } from "@web/lib/portal/university-index";
import { universityDateLabel, universityIntakeStatusKey, universityMonthLabel } from "@web/lib/portal/universities";
import { View } from "react-native";

import { usePortalApi } from "@/api/PortalApi";
import { go } from "@/features/portal/navigation";
import { useLang } from "@/i18n/LangProvider";
import { rpcErrorKey } from "@/lib/rpc";
import { useTheme } from "@/theme/ThemeProvider";
import { Button } from "@/ui/Button";
import { Text } from "@/ui/Text";

import { ExternalLink } from "./ExternalLink";
import { useSelectProgram } from "./hooks";
import type { UniversityStrings } from "./model";

export function IntakeSelect({ intake, program, detail, strings, now, lang }: { intake: UniversityIntake; program: UniversityProgram; detail: StudentUniversityDetail; strings: UniversityStrings; now: Date; lang: "ru" | "ky" }) {
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
    action = <Button variant="ghost" label={m("programs.openMine")} onPress={() => go("/home", { list: "programs", at: String(Date.now()) })} testID="program-open-mine" />;
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
