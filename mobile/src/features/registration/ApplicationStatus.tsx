// Статус анкеты вошедшего студента (SessionState.applicationStatus): статус, ответы,
// комментарий команды при отказе, исправление отклонённой, «Обновить статус».
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { View } from "react-native";

import { createPortalQueryClient } from "@/api/PortalApi";
import { SignedInWizard, useSubmitDeps } from "@/features/registration/SignedInApplication";
import { applicationAnswers } from "@/features/registration/answers";
import { readOwnApplication, type FullApplication } from "@/features/registration/own-application";
import { useLang } from "@/i18n/LangProvider";
import { rpcErrorKey } from "@/lib/rpc";
import type { OwnApplication } from "@/session/access";
import { useSession } from "@/session/SessionProvider";
import { Button } from "@/ui/Button";
import { InlineAlert, CardSkeleton } from "@/ui/CardParts";
import { Card, Screen } from "@/ui/Screen";
import { StatusPill } from "@/ui/StatusPill";
import { Text } from "@/ui/Text";

const TONE = { pending: "warn", approved: "ok", rejected: "danger" } as const;

/** Своя анкета читается через react-query: у экрана статуса отдельный кэш, он живёт, пока экран открыт. */
export function ApplicationStatusScreen({ application }: { application: OwnApplication }) {
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
      <ApplicationStatusBody application={application} />
    </QueryClientProvider>
  );
}

function ApplicationStatusBody({ application }: { application: OwnApplication }) {
  const { lang, m, profile, t, format } = useLang();
  const strings = t("apply") as unknown as Readonly<Record<string, string>>;
  const { refreshAccess, signOut } = useSession();
  const deps = useSubmitDeps();
  const [refreshing, setRefreshing] = useState(false);
  const [fixing, setFixing] = useState(false);
  const query = useQuery({
    queryKey: ["own-student-application", application.status],
    queryFn: () => readOwnApplication(deps.transport),
  });
  const full: FullApplication | null = query.data ?? null;
  const loadFailed = query.isError ? m(rpcErrorKey(query.error)) : null;
  const load = () => void query.refetch();

  const refresh = async () => {
    setRefreshing(true);
    try {
      await refreshAccess();
      await query.refetch();
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
    <Screen onRefresh={() => void refresh()} refreshing={refreshing}>
      <View style={{ gap: 16 }}>
        <Card>
          <Text variant="caption" tone="text2">
            {strings.statusKicker}
          </Text>
          <Text variant="title" accessibilityRole="header" testID="application-status-title">
            {title}
          </Text>
          <StatusPill label={m(`gate.status.${status}`)} tone={TONE[status]} testID="application-status-pill" />
          <Text variant="body">{lead}</Text>
          {status === "rejected" && full?.decisionReason ? (
            <View style={{ gap: 4 }} testID="application-reason">
              <Text variant="secondary" tone="text2" bold>
                {m("status.reasonLabel")}
              </Text>
              <Text variant="body">{full.decisionReason}</Text>
            </View>
          ) : null}
          {status === "rejected" && full ? (
            <>
              <Text variant="secondary" tone="text2">
                {m("status.resubmitHint")}
              </Text>
              <Button label={strings.fixApplication} onPress={() => setFixing(true)} testID="application-fix" />
            </>
          ) : null}
          <Button
            label={status === "approved" ? strings.openCabinet : refreshing ? m("status.refreshing") : m("gate.refresh")}
            variant={status === "rejected" ? "ghost" : "primary"}
            onPress={() => void refresh()}
            busy={refreshing}
            testID="gate-refresh"
          />
          <Button label={profile.logout} variant="ghost" onPress={() => void signOut()} />
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
      </View>
    </Screen>
  );
}
