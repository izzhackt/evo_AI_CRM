// Календарь сессий CSCA во вкладке «Об экзамене» (веб: components/portal/csca/SessionPicker.tsx; контракт §3, §11):
// даты экзамена как факт с датой проверки и ссылкой на csca.cn; окно регистрации только там, где его опубликовал
// csca.cn; «Готовлюсь к этой» хранит сервер. Три сессии на виду (и выбранная, если она дальше), остальные под
// «Ещё сессии: N». Свой выбор показывает дни до экзамена; три этапа плана (основа, слабые места, пробные тесты)
// считает клиент от `examFrom`: это ориентир EVO, а не обещание. Приложение ничего не напоминает.
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Linking, Pressable, View } from "react-native";

import { sessionLabels, type SessionLabels } from "@web/components/portal/csca/session-labels";
import { daysBetween, type CscaHome, type CscaSession } from "@web/lib/portal/csca";

import { usePortalApi } from "@/api/PortalApi";
import { setTargetSession } from "@/features/learning/csca/api";
import { cscaOnLabelSafe } from "@/features/learning/csca/format";
import { MetaChip } from "@/features/learning/csca/MetaChip";
import { useLang } from "@/i18n/LangProvider";
import { sansFont } from "@/theme/fonts";
import { useTheme } from "@/theme/ThemeProvider";
import { Button } from "@/ui/Button";
import { InlineAlert, LinkButton, MIN_TARGET } from "@/ui/CardParts";
import { Card } from "@/ui/Screen";
import { Text } from "@/ui/Text";

/** Сколько сессий видно сразу (веб `VISIBLE`). */
export const VISIBLE_SESSIONS = 3;

/** Этап плана по дням до экзамена: основа > 28, слабые места ≤ 28, полные пробные ≤ 7 (ориентир EVO). */
export function planStage(daysLeft: number): "foundation" | "intensify" | "sprint" {
  return daysLeft <= 7 ? "sprint" : daysLeft <= 28 ? "intensify" : "foundation";
}

/** Сколько строк открыто: три, а если выбранная дальше, то по неё включительно (веб `visibleCount`). */
export function visibleSessionCount(ordered: readonly Pick<CscaSession, "sessionKey">[], target: string | null): number {
  const targetIndex = ordered.findIndex((session) => session.sessionKey === target);
  return Math.max(VISIBLE_SESSIONS, targetIndex + 1);
}

/** Дата проверки в начале блока: самая поздняя из `verifiedOn` (веб `page.tsx`). */
export function latestVerifiedOn(home: Pick<CscaHome, "sessions" | "today">): string {
  return home.sessions.map((session) => session.verifiedOn).sort().at(-1) ?? home.today;
}

function SessionRow({
  session,
  label,
  chosen,
  daysLeft,
  busyKey,
  first,
  onChoose,
}: {
  session: CscaSession;
  label: SessionLabels[string] | undefined;
  chosen: boolean;
  daysLeft: number;
  busyKey: string | null;
  first: boolean;
  onChoose: (key: string | null, rowKey: string) => void;
}) {
  const { m, t, format } = useLang();
  const { tokens } = useTheme();
  const c = t("csca");
  const dates = label?.dates ?? session.examFrom;
  const busy = busyKey === session.sessionKey;
  const stage = planStage(daysLeft);
  return (
    <View style={{ gap: 6, paddingVertical: 12, borderTopWidth: first ? 0 : 1, borderTopColor: tokens.line }} testID={`session-${session.sessionKey}`}>
      <View style={{ gap: 2 }}>
        <Text variant="body" bold>
          {dates}
        </Text>
        <Text variant="secondary" tone="text2">
          {label?.registration}
          {label?.closesIn ? (
            <>
              {" · "}
              <Text variant="secondary" bold>
                {label.closesIn}
              </Text>
            </>
          ) : null}
        </Text>
      </View>
      {label?.registerUrl ? <LinkButton label={c.sessionRegister} onPress={() => void Linking.openURL(label.registerUrl as string).catch(() => undefined)} /> : null}
      {chosen && daysLeft >= 0 ? (
        <View style={{ gap: 2 }} testID="sessions-plan">
          <Text variant="secondary" style={{ fontFamily: sansFont("medium") }}>
            {format(c.sessionDaysLeft, { count: String(daysLeft) })}
          </Text>
          <Text variant="caption" tone="text2">
            {m(stage === "foundation" ? "learn.stageFoundation" : stage === "intensify" ? "learn.stageIntensify" : "learn.stageSprint")}. {m("learn.stageNote")}
          </Text>
        </View>
      ) : null}
      {chosen ? (
        <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <MetaChip on label={c.sessionTarget} />
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: busyKey !== null, busy }}
            disabled={busyKey !== null}
            onPress={() => onChoose(null, session.sessionKey)}
            testID="session-clear"
            style={{ minHeight: MIN_TARGET, justifyContent: "center", paddingHorizontal: 4 }}
          >
            <Text variant="secondary" tone={busyKey !== null ? "text2" : "text"} style={{ fontFamily: sansFont("medium"), textDecorationLine: "underline", textDecorationColor: tokens.controlEdge }}>
              {busy ? c.sessionSaving : c.sessionClear}
            </Text>
          </Pressable>
        </View>
      ) : (
        <Button
          variant="ghost"
          label={busy ? c.sessionSaving : c.sessionChoose}
          accessibilityLabel={`${c.sessionChoose}: ${dates}`}
          disabled={busyKey !== null}
          onPress={() => onChoose(session.sessionKey, session.sessionKey)}
          testID={`session-choose-${session.sessionKey}`}
          style={{ alignSelf: "flex-start" }}
        />
      )}
    </View>
  );
}

export function SessionPicker({ home, testID, onLayoutY }: { home: CscaHome; testID?: string; onLayoutY?: (y: number) => void }) {
  const { lang, t, format } = useLang();
  const { tokens } = useTheme();
  const { transport, userKey } = usePortalApi();
  const client = useQueryClient();
  const c = t("csca");
  // Свой выбор, пока сервер не подтвердил его перечитанной главной; новое значение с сервера его заменяет.
  const [override, setOverride] = useState<{ key: string | null } | null>(null);
  const [seenTarget, setSeenTarget] = useState(home.targetSessionKey);
  if (seenTarget !== home.targetSessionKey) {
    setSeenTarget(home.targetSessionKey);
    setOverride(null);
  }
  const target = override ? override.key : home.targetSessionKey;
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [more, setMore] = useState(false);
  const ordered = [...home.sessions].sort((a, b) => a.examFrom.localeCompare(b.examFrom));
  if (ordered.length === 0) return null;
  const labels = sessionLabels(ordered, lang, c, { serverNow: home.serverNow, today: home.today });
  const visible = visibleSessionCount(ordered, target);

  async function choose(key: string | null, rowKey: string) {
    setBusyKey(rowKey);
    setFailed(false);
    try {
      const receipt = await setTargetSession(transport, key);
      setOverride({ key: receipt.targetSessionKey });
      void client.invalidateQueries({ queryKey: ["portal", userKey, "csca-home"] });
    } catch {
      setFailed(true);
    } finally {
      setBusyKey(null);
    }
  }

  const row = (session: CscaSession, first: boolean) => (
    <SessionRow
      key={session.sessionKey}
      session={session}
      label={labels[session.sessionKey]}
      chosen={session.sessionKey === target}
      daysLeft={daysBetween(home.today, session.examFrom)}
      busyKey={busyKey}
      first={first}
      onChoose={(key, rowKey) => void choose(key, rowKey)}
    />
  );
  const rest = ordered.slice(visible);
  return (
    <View testID={testID} onLayout={onLayoutY ? (event) => onLayoutY(event.nativeEvent.layout.y) : undefined}>
      <Card>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text variant="body" bold accessibilityRole="header">
            {c.sessionsHeading}
          </Text>
          <View style={{ minWidth: 24, height: 22, paddingHorizontal: 7, borderRadius: 6, backgroundColor: tokens.bg, alignItems: "center", justifyContent: "center" }}>
            <Text variant="caption" tone="text2" bold>
              {ordered.length}
            </Text>
          </View>
        </View>
        <Text variant="caption" tone="text2">
          {format(c.sessionsLead, { date: cscaOnLabelSafe(latestVerifiedOn(home), lang, true) })}
        </Text>
        <View>{ordered.slice(0, visible).map((session, index) => row(session, index === 0))}</View>
        {rest.length > 0 ? (
          <View>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: more }}
              onPress={() => setMore((value) => !value)}
              testID="sessions-more"
              style={{ minHeight: MIN_TARGET, justifyContent: "center" }}
            >
              <Text variant="secondary" style={{ fontFamily: sansFont("medium") }}>
                {format(c.sessionsMore, { count: String(rest.length) })}
              </Text>
            </Pressable>
            {more ? rest.map((session) => row(session, false)) : null}
          </View>
        ) : null}
        {failed ? <InlineAlert message={c.errorUnavailable} testID="sessions-error" /> : null}
        <LinkButton label={c.sessionSource} onPress={() => void Linking.openURL(ordered[0].sourceUrl).catch(() => undefined)} testID="sessions-source" />
      </Card>
    </View>
  );
}
