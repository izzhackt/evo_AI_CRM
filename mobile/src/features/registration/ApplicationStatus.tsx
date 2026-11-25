// Статус анкеты вошедшего студента (SessionState.applicationStatus): статус, ответы, почта анкеты, логин для входа,
// комментарий команды, исправление отклонённой, «Обновить статус», «Выйти» и «Удалить аккаунт» (веб: apply/status/page.tsx
// и ApplicationStatus.tsx; Apple 5.1.1(v): аккаунт удаляется из приложения до одобрения анкеты).
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { isTechnicalStudentEmail } from "@/features/registration/account-identity";

import { createPortalQueryClient } from "@/api/PortalApi";
import { readOwnLogin } from "@/features/profile/profile-source";
import { ApplicantDeletionSection } from "@/features/registration/ApplicantDeletion";
import { SignedInWizard, useSubmitDeps } from "@/features/registration/SignedInApplication";
import { applicationAnswers } from "@/features/registration/answers";
import { readOwnApplication, type FullApplication } from "@/features/registration/own-application";
import { useLang } from "@/i18n/LangProvider";
import { rpcErrorKey } from "@/lib/rpc";
import type { OwnApplication } from "@/session/access";
import { useSession } from "@/session/SessionProvider";
import { Button } from "@/ui/Button";
import { InlineAlert, CardSkeleton } from "@/ui/CardParts";
import { LangSwitch } from "@/ui/LangSwitch";
import { Card, Screen } from "@/ui/Screen";
import { StatusPill } from "@/ui/StatusPill";
import { Text } from "@/ui/Text";

const TONE = { pending: "warn", approved: "ok", rejected: "danger" } as const;

/** Своя анкета читается через react-query: у экрана статуса отдельный кэш, он живёт, пока экран открыт. */
export function ApplicationStatusScreen({ application, readOnly = false }: { application: OwnApplication; readOnly?: boolean }) {
  const [client] = useState(() => createPortalQueryClient());
  // Кэш живёт, пока открыт экран; его таймеры не должны пережить выход.
  // Отложенно: наблюдатели запроса отписываются позже родительской очистки и заново ставят таймер сборки.
  useEffect(
    () => () => {
      void Promise.resolve().then(() => client.clear());
    },
    [client],
  );
  return (
    <QueryClientProvider client={client}>
      <ApplicationStatusBody application={application} readOnly={readOnly} />
    </QueryClientProvider>
  );
}

function ApplicationStatusBody({ application, readOnly }: { application: OwnApplication; readOnly: boolean }) {
  const { lang, m, profile, t, format } = useLang();
  const strings = t("apply") as unknown as Readonly<Record<string, string>>;
  const { refreshAccess, signOut } = useSession();
  const deps = useSubmitDeps();
  const [refreshing, setRefreshing] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [fixing, setFixing] = useState(false);
  const query = useQuery({
    queryKey: ["own-student-application", application.status],
    queryFn: () => readOwnApplication(deps.transport),
  });
  // 340: логин для следующего входа; нет логина или сбой чтения - строки нет (веб: apply-status-login).
  const login = useQuery({ queryKey: ["own-student-login"], queryFn: () => readOwnLogin(deps.transport), enabled: !readOnly });
  const full: FullApplication | null = query.data ?? null;
  const loadFailed = query.isError ? m(rpcErrorKey(query.error)) : null;
  const load = () => void query.refetch();

  const refresh = async () => {
    setRefreshing(true);
    setRefreshFailed(false);
    try {
      await refreshAccess();
      const result = await query.refetch();
      if (result.isError) setRefreshFailed(true);
    } catch {
      setRefreshFailed(true);
    } finally {
      setRefreshing(false);
    }
  };
  const status = full?.status ?? application.status;

  if (fixing && full) {
    return (
      <SignedInWizard
        email={full.email}
        expectedRevision={full.revision}
        initialDraft={full.questionnaire}
        onDone={() => {
          setFixing(false);
          void refresh();
        }}
        onExit={() => setFixing(false)}
      />
    );
  }

  const title = status === "approved" ? strings.statusApprovedTitle : status === "rejected" ? strings.statusRejectedTitle : strings.statusPendingTitle;
  const lead = status === "approved" ? strings.statusApprovedLead : status === "rejected" ? strings.statusRejectedLead : strings.statusPendingLead;

  return (
    <Screen onRefresh={() => void (readOnly ? query.refetch() : refresh())} refreshing={refreshing || (readOnly && query.isRefetching)} topInset={!readOnly} tabBar={readOnly}>
      <View style={{ gap: 16 }}>
        {readOnly ? null : (
          <View style={{ alignItems: "flex-end" }}>
            <LangSwitch />
          </View>
        )}
        <Card>
          <Text variant="caption" tone="text2">
            {strings.statusKicker}
          </Text>
          <Text variant="title" accessibilityRole="header" testID="application-status-title">
            {title}
          </Text>
          <StatusPill label={m(`gate.status.${status}`)} tone={TONE[status]} testID="application-status-pill" />
          <Text variant="body">{lead}</Text>
          {full?.decisionReason ? (
            <View style={{ gap: 4 }} testID="application-reason">
              <Text variant="secondary" tone="text2" bold>
                {m("status.reasonLabel")}
              </Text>
              <Text variant="body">{full.decisionReason}</Text>
            </View>
          ) : null}
          {status === "rejected" && full && !readOnly ? (
            <>
              <Text variant="secondary" tone="text2">
                {m("status.resubmitHint")}
              </Text>
              <Button label={strings.fixApplication} onPress={() => setFixing(true)} testID="application-fix" />
            </>
          ) : null}
          {readOnly ? null : (
            <>
              <Button
                label={status === "approved" ? strings.openCabinet : refreshing ? m("status.refreshing") : m("gate.refresh")}
                variant={status === "rejected" ? "ghost" : "primary"}
                onPress={() => void refresh()}
                busy={refreshing}
                testID="gate-refresh"
              />
              {refreshFailed ? (
                <Text variant="secondary" tone="error" accessibilityRole="alert" testID="application-refresh-failed">
                  {strings.refreshFailed}
                </Text>
              ) : null}
              <Button label={profile.logout} variant="ghost" onPress={() => void signOut()} testID="application-sign-out" />
            </>
          )}
        </Card>

        {loadFailed ? <InlineAlert message={`${m("status.loadFailed")} ${loadFailed}`} retryLabel={m("gate.retry")} onRetry={load} /> : null}
        {query.isPending ? (
          <Card>
            <CardSkeleton label={m("state.loading")} lines={4} />
          </Card>
        ) : null}
        {full ? (
          <Card>
            <Text variant="heading" accessibilityRole="header">
              {strings.answersHeading}
            </Text>
            {isTechnicalStudentEmail(full.email) ? null : (
              <Text variant="secondary" tone="text2" selectable testID="application-email">
                {full.email}
              </Text>
            )}
            {applicationAnswers(full.questionnaire, strings, lang).map((row) => (
              <View key={row.label} style={{ gap: 2 }}>
                <Text variant="caption" tone="text2">
                  {row.label}
                </Text>
                <Text variant="body">{row.value}</Text>
              </View>
            ))}
            <Text variant="caption" tone="text2">
              {format(m("status.submitted"), { date: full.submittedAt.slice(0, 10) })}
            </Text>
          </Card>
        ) : null}
        {login.data ? (
          <Text variant="body" tone="text2" accessibilityLabel={`${strings.loginLabel}: ${login.data}`} testID="application-login">
            {strings.loginLabel}: {login.data}
          </Text>
        ) : null}
        {readOnly ? null : <ApplicantDeletionSection transport={deps.transport} />}
      </View>
    </Screen>
  );
}
