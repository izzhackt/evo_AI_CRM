// «Программы вуза» на странице вуза (веб: раздел в Detail.tsx): подбор с карточками, окно программы с наборами и кнопкой
// «Добавить в мои программы». Прежде все программы шли подряд полными карточками с наборами, у UTM их 270, у Universiti Malaya 252,
// у вузов Китая до 77: «километровый список», который владелец отверг 10.11.2026.
import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform, View } from "react-native";

import type { StudentUniversityDetail } from "@web/lib/portal/university-index";

import { usePortalApi } from "@/api/PortalApi";
import { preparationHref } from "@/features/preparations/routes";
import { useLang } from "@/i18n/LangProvider";
import { Text } from "@/ui/Text";

import { IntakeSelect } from "./IntakeSelect";
import type { UniversityStrings } from "./model";
import { ProgramDialog } from "./ProgramDialog";
import { ProgramPicker } from "./ProgramPicker";
import { programOptions, programRows } from "./program-model";

/** Если окно не сообщило, что закрылось (на iOS это `onDismiss`), на экран программы переходим по таймеру: после выбора студент не остаётся ни с чем. */
const FOLLOW_FALLBACK_MS = Platform.OS === "ios" ? 900 : 50;

export function ProgramSection({ detail, strings, now, onRefresh }: { detail: StudentUniversityDetail; strings: UniversityStrings; now: Date; onRefresh: () => void }) {
  const { lang, t } = useLang();
  const prep = t("preparations");
  const { canSelectPrograms, studentCaseId } = usePortalApi();
  const content = detail.university.content;
  const rows = useMemo(() => programRows(content.programs), [content.programs]);
  const options = useMemo(() => programOptions(rows, content, strings, lang), [rows, content, strings, lang]);
  const bindings = detail.preparations?.studentCaseId === studentCaseId ? detail.preparations.items : null;
  const [openId, setOpenId] = useState<string | null>(null);
  const open = rows.find((row) => row.program.id === openId) ?? null;

  // К странице программы ведут два пути: после добавления и кнопка «Открыть» у уже добавленного набора. И там и там окно закрывается,
  // и только потом открывается страница: нативное окно iOS, ещё уезжающее вниз, не даёт показать следующий экран (страница
  // открывалась бы ПОД ним). Переход один раз, по `onDismiss` окна или по таймеру, что раньше.
  const follow = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flush = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    const applicationId = follow.current;
    follow.current = null;
    if (applicationId !== null) router.push(preparationHref(applicationId));
  }, []);
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );
  const openApplication = useCallback(
    (applicationId: string) => {
      follow.current = applicationId;
      setOpenId(null);
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(flush, FOLLOW_FALLBACK_MS);
    },
    [flush],
  );

  return (
    <View style={{ gap: 12 }}>
      <Text variant="heading" accessibilityRole="header">
        {strings.programsHeading}
      </Text>
      {bindings !== null && !canSelectPrograms ? (
        <Text variant="caption" tone="text2" testID="programs-case-ineligible">
          {prep.caseIneligible}
        </Text>
      ) : null}
      <ProgramPicker rows={rows} options={options} strings={strings} lang={lang} onOpen={setOpenId} />
      <ProgramDialog row={open} strings={strings} onClose={() => setOpenId(null)} onDismiss={flush}>
        {(row) => (
          <View style={{ gap: 12 }}>
            {row.program.intakes.map((intake, index) => (
              <IntakeSelect key={intake.id ?? index} intake={intake} program={row.program} detail={detail} strings={strings} now={now} lang={lang} onOpenApplication={openApplication} onRefresh={onRefresh} />
            ))}
          </View>
        )}
      </ProgramDialog>
    </View>
  );
}
