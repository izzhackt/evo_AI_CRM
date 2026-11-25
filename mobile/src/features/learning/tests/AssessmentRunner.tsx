// Прохождение теста как на сайте (`components/portal/tests/AssessmentRunner.tsx`): сверху «Ответили на N из M», состояние
// сохранения и цельная полоса прогресса; ниже карточка со страницей заданий (english36 по одному, orvis92 по четыре
// утверждения: «Часть N из 23»), «Назад» и «Далее», шаг «Готовы завершить?»; под ней «Сохранить и выйти».
// Сохранение, повторы и конфликт ведёт `AssessmentSession`; уход с экрана придерживает экран (`useLeaveGuard`).
import { useEffect, useRef } from "react";
import { Alert, View } from "react-native";

import type { AssessmentAttempt } from "@web/lib/student-assessment-contract";

import { AssessmentQuestionView } from "@/features/learning/tests/AssessmentQuestionView";
import type { AssessmentSession, AssessmentUiState } from "@/features/learning/tests/assessment-session";
import { assessmentPageCount, assessmentPageSize, firstOpenPage, pageQuestions } from "@/features/learning/tests/paging";
import { runNotice } from "@/features/learning/tests/run-notice";
import { SegmentBar } from "@/features/learning/ui";
import { useLang } from "@/i18n/LangProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { announce } from "@/ui/a11y";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Screen";
import { Text } from "@/ui/Text";

export function AssessmentRunner({ session, state, attempt, exitNotice, onSaveAndExit, onPageChange }: { session: AssessmentSession; state: AssessmentUiState; attempt: AssessmentAttempt; exitNotice: boolean; onSaveAndExit: () => void; onPageChange: () => void }) {
  const { m, t, format } = useLang();
  const { tokens } = useTheme();
  const s = t("tests");
  const questions = attempt.questions;
  const total = questions.length;
  const pageSize = assessmentPageSize(attempt.instrumentKey);
  const pageCount = assessmentPageCount(total, pageSize);
  const answeredCount = questions.filter((q) => state.answers[q.id] !== undefined).length;
  const page = state.page;
  const reviewing = page >= pageCount;
  const completing = state.phase === "completing";
  const locked = completing || state.reloadRequired;
  const heading = reviewing ? s.reviewHeading : attempt.instrumentKey === "english36" ? format(s.taskOf, { n: String(page + 1), total: String(total) }) : format(s.partOf, { n: String(page + 1), parts: String(pageCount) });
  // Веб после «Далее» переводит фокус на заголовок страницы: читалка называет «Часть 3 из 23». На телефоне это объявление.
  const firstHeading = useRef(true);
  useEffect(() => {
    if (firstHeading.current) {
      firstHeading.current = false;
      return;
    }
    announce(heading);
  }, [heading]);

  const status =
    state.reload === "loading" ? s.statusLoadingSaved : state.saveStatus === "saving" ? s.statusSaving : state.saveStatus === "unconfirmed" || state.reloadRequired ? s.statusUnconfirmed : state.saveStatus === "dirty" ? s.statusDirty : s.statusSaved;
  const go = (next: number) => {
    session.goTo(next);
    onPageChange();
  };
  const select = (questionId: string, optionId: string) => session.select(questionId, optionId);
  const notice = runNotice(state, exitNotice);
  const noticeText = notice.messages.map((key) => s[key]);
  const lastNotice = noticeText.length > 0 ? noticeText[noticeText.length - 1] : "";
  // Читалка узнаёт о сбое сохранения без поиска плашки глазами (на iPhone живые области не работают).
  useEffect(() => announce(lastNotice), [lastNotice]);
  // Веб: `window.confirm`; на телефоне системное окно с теми же словами.
  const confirmLoadSaved = () =>
    Alert.alert(s.loadSaved, s.confirmReload, [
      { text: m("assess.replaceCancel"), style: "cancel" },
      { text: m("assess.replaceConfirm"), style: "destructive", onPress: () => void session.loadSaved() },
    ]);

  return (
    <View style={{ gap: 12 }}>
      <Card>
        <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", alignItems: "baseline", columnGap: 16, rowGap: 4 }}>
          <Text variant="secondary" bold testID="assessment-answered">
            {format(s.answeredOf, { count: String(answeredCount), total: String(total) })}
          </Text>
          <Text variant="caption" tone="text2" accessibilityLiveRegion="polite" testID="assessment-save-status">
            {status}
          </Text>
        </View>
        <SegmentBar
          variant="continuous"
          testID="assessment-progress"
          states={questions.map((q) => (state.answers[q.id] !== undefined ? "done" : "todo"))}
          summaryLabel={format(s.progressAria, { count: String(answeredCount), total: String(total) })}
        />
      </Card>
      {notice.messages.length > 0 ? (
        <View accessibilityRole="alert" testID="assessment-error" style={{ gap: 8, padding: 12, borderRadius: tokens.radiusItem, borderWidth: 1, borderColor: tokens.error, backgroundColor: tokens.surface }}>
          {noticeText.map((text, i) => (
            <Text key={notice.messages[i]} variant="secondary" tone="error">
              {text}
            </Text>
          ))}
          {notice.action === "loadSaved" ? <Button variant="ghost" label={s.loadSaved} busy={state.reload === "loading"} onPress={confirmLoadSaved} testID="assessment-load-saved" /> : null}
          {notice.action === "retrySave" ? <Button variant="ghost" label={s.retrySave} onPress={() => void session.flush()} testID="assessment-retry-save" /> : null}
        </View>
      ) : null}
      <Card>
        <Text variant="heading" accessibilityRole="header" testID="assessment-heading">
          {heading}
        </Text>
        {reviewing ? (
          <View style={{ gap: 12 }}>
            <Text variant="secondary" tone="text2">
              {answeredCount === total ? s.reviewAllAnswered : format(s.reviewRemaining, { count: String(total - answeredCount) })}
            </Text>
            {answeredCount < total ? <Button variant="ghost" label={s.toFirstUnanswered} onPress={() => go(firstOpenPage(questions, state.answers, pageSize))} testID="assessment-first-open" /> : null}
            <Button label={completing ? s.statusSaving : s.completeButton} accessibilityLabel={completing ? s.statusSaving : s.completeButton} busy={completing} disabled={answeredCount < total || state.reloadRequired} onPress={() => void session.complete()} testID="assessment-complete" />
          </View>
        ) : (
          <View style={{ gap: 24 }}>
            {pageQuestions(questions, page, pageSize).map((question, offset) => (
              <AssessmentQuestionView key={question.id} question={question} instrumentKey={attempt.instrumentKey} answer={state.answers[question.id]} number={page * pageSize + offset + 1} disabled={locked} onSelect={select} />
            ))}
          </View>
        )}
        <View style={{ flexDirection: "row", gap: 12, paddingTop: 16, borderTopWidth: 1, borderTopColor: tokens.line }}>
          <Button variant="ghost" label={s.back} disabled={page === 0 || completing} onPress={() => go(page - 1)} style={{ flex: 1 }} testID="assessment-prev" />
          {!reviewing ? <Button label={page + 1 === pageCount ? s.checkAndFinish : s.next} disabled={completing} onPress={() => go(page + 1)} style={{ flex: 1 }} testID="assessment-next" /> : null}
        </View>
      </Card>
      <View style={{ gap: 8 }}>
        <Button variant="ghost" label={s.saveAndExit} disabled={locked} onPress={onSaveAndExit} testID="assessment-exit" />
        <Text variant="caption" tone="text2">
          {s.returnNote}
        </Text>
      </View>
    </View>
  );
}
