// Сессии CSCA (контракт §3, §11): официальный календарь с датой проверки, окно регистрации как факт
// (даты по Бишкеку с подписью пояса), «Готовлюсь к этой» хранит сервер, обратный отсчёт и три
// этапа плана считает клиент от `examFrom`. Приложение ничего не обещает и не напоминает.
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Linking, View } from "react-native";

import { daysBetween, type CscaHome } from "@web/lib/portal/csca";
import { sessionLabels } from "@web/components/portal/csca/session-labels";

import { usePortalApi } from "@/api/PortalApi";
import { setTargetSession } from "@/features/learning/csca/api";
import { cscaOnLabelSafe } from "@/features/learning/csca/format";
import { Chip } from "@/features/learning/ui";
import { useLang } from "@/i18n/LangProvider";
import { Button } from "@/ui/Button";
import { InlineAlert, LinkButton } from "@/ui/CardParts";
import { Card } from "@/ui/Screen";
import { Text } from "@/ui/Text";

/** Этап плана по дням до экзамена: основа > 28, слабые места ≤ 28, полные пробные ≤ 7 (ориентир EVO). */
export function planStage(daysLeft: number): "foundation" | "intensify" | "sprint" {
  return daysLeft <= 7 ? "sprint" : daysLeft <= 28 ? "intensify" : "foundation";
}

export function SessionsPanel({ home, testID }: { home: CscaHome; testID?: string }) {
  const { lang, m, t, format } = useLang();
  const { transport, userKey } = usePortalApi();
  const client = useQueryClient();
  const c = t("csca");
  const [target, setTarget] = useState(home.targetSessionKey);
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const sessions = [...home.sessions].sort((a, b) => a.examFrom.localeCompare(b.examFrom));
  if (sessions.length === 0) return null;
  const labels = sessionLabels(sessions, lang, c, { serverNow: home.serverNow, today: home.today });

  async function choose(key: string | null, rowKey: string) {
    setBusy(rowKey);
    setFailed(false);
    try {
      const receipt = await setTargetSession(transport, key);
      setTarget(receipt.targetSessionKey);
      void client.invalidateQueries({ queryKey: ["portal", userKey, "csca-home"] });
    } catch {
      setFailed(true);
    } finally {
      setBusy(null);
    }
  }

  const chosen = sessions.find((s) => s.sessionKey === target) ?? null;
  const chosenDays = chosen ? daysBetween(home.today, chosen.examFrom) : null;
  return (
    <Card>
      <View testID={testID} style={{ gap: 12 }}>
        <Text variant="heading" accessibilityRole="header">
          {c.sessionsHeading}
        </Text>
        <Text variant="secondary" tone="text2">
          {format(c.sessionsLead, { date: cscaOnLabelSafe(sessions[0].verifiedOn, lang, true) })}
        </Text>
        {chosen && chosenDays !== null && chosenDays >= 0 ? (
          <View style={{ gap: 2 }} testID="sessions-plan">
            <Text variant="body" bold>
              {format(c.sessionDaysLeft, { count: String(chosenDays) })}
            </Text>
            <Text variant="secondary" tone="text2">
              {m(`learn.stage${planStage(chosenDays) === "foundation" ? "Foundation" : planStage(chosenDays) === "intensify" ? "Intensify" : "Sprint"}`)}. {m("learn.stageNote")}
            </Text>
          </View>
        ) : null}
        {sessions.map((session) => {
          const label = labels[session.sessionKey];
          const isTarget = session.sessionKey === target;
          return (
            <View key={session.sessionKey} style={{ gap: 4 }} testID={`session-${session.sessionKey}`}>
              <Text variant="body" bold>
                {label?.dates}
              </Text>
              <Text variant="secondary" tone="text2">
                {label?.registration}
                {label?.closesIn ? ` · ${label.closesIn}` : ""}
              </Text>
              {label?.registerUrl ? <LinkButton label={c.sessionRegister} onPress={() => void Linking.openURL(label.registerUrl as string).catch(() => undefined)} /> : null}
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                {isTarget ? (
                  <>
                    <Chip tone="accent" label={c.sessionTarget} />
                    <Button variant="ghost" label={busy === session.sessionKey ? c.sessionSaving : c.sessionClear} disabled={busy !== null} onPress={() => void choose(null, session.sessionKey)} testID="session-clear" />
                  </>
                ) : (
                  <Button variant="ghost" label={busy === session.sessionKey ? c.sessionSaving : c.sessionChoose} accessibilityLabel={`${c.sessionChoose}: ${label?.dates}`} disabled={busy !== null} onPress={() => void choose(session.sessionKey, session.sessionKey)} testID={`session-choose-${session.sessionKey}`} />
                )}
              </View>
            </View>
          );
        })}
        {failed ? <InlineAlert message={c.errorUnavailable} testID="sessions-error" /> : null}
        <LinkButton label={c.sessionSource} onPress={() => void Linking.openURL(sessions[0].sourceUrl).catch(() => undefined)} />
      </View>
    </Card>
  );
}
