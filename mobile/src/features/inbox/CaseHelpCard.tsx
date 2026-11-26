// «Прежние вопросы куратору и ответы» под списком «Входящих» (веб: CaseHelpWorkspace с `student`, блок слева внизу).
// Новых вопросов куратору из кабинета нет (#1356: вопрос команде EVO задаётся в чате); блок показывает только то, что было:
// без прежних обращений он не рисуется. Раскрыт сразу, если есть обращение без ответа. Страницы по 50: «Более ранние
// обращения» показывают следующую страницу, «Последние обращения» возвращают первую (как в вебе).
import type { CaseHelpPage } from "@web/lib/platform-admissions-support-contract";
import { ChevronDown, ChevronUp } from "lucide-react-native";
import { useState } from "react";
import { Pressable, View } from "react-native";

import { readCaseHelpPage } from "@/api/inbox-detail-api";
import { useCaseHelp } from "@/api/inbox-queries";
import { usePortalApi } from "@/api/PortalApi";
import { formatPortalTimestamp } from "@/domain/presentation";
import { useLang } from "@/i18n/LangProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { InlineAlert, LinkButton, MIN_TARGET } from "@/ui/CardParts";
import { Card } from "@/ui/Screen";
import { Text } from "@/ui/Text";

export function CaseHelpCard() {
  const { m, t } = useLang();
  const { tokens } = useTheme();
  const { transport, studentCaseId } = usePortalApi();
  const admission = t("admission");
  const messages = t("messages");
  const help = useCaseHelp();
  const [older, setOlder] = useState<CaseHelpPage | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [expanded, setExpanded] = useState<boolean | null>(null);

  const page = older ?? help.data ?? null;
  if (page === null) {
    // Чтение не удалось и данных нет: блок с причиной, как в вебе («Помощь по делу»); пока читается, блока нет.
    if (help.status !== "error") return null;
    return (
      <Card>
        <Text variant="heading" accessibilityRole="header">
          {m("inbox.helpFootFailedTitle")}
        </Text>
        <InlineAlert message={m("inbox.helpFootFailed")} retryLabel={m("gate.retry")} onRetry={() => void help.refetch()} testID="help-foot-error" />
      </Card>
    );
  }
  if (page.items.length === 0 && page.nextCursor === null) return null;

  const open = expanded ?? page.items.some((item) => item.status === "open");
  const Chevron = open ? ChevronUp : ChevronDown;

  const loadOlder = async () => {
    if (busy || page.nextCursor === null) return;
    setBusy(true);
    setFailed(false);
    try {
      setOlder(await readCaseHelpPage(transport, studentCaseId, page.nextCursor));
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={m("inbox.helpFootTitle")}
        onPress={() => setExpanded(!open)}
        testID="help-toggle"
        style={{ minHeight: MIN_TARGET, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}
      >
        <Text variant="body" bold style={{ flex: 1 }} testID="help-foot">
          {m("inbox.helpFootTitle")}
        </Text>
        <Chevron size={20} strokeWidth={1.75} color={tokens.text2} />
      </Pressable>
      {open ? (
        <View style={{ gap: 12 }}>
          {page.items.length === 0 ? (
            <Text variant="secondary" tone="text2">
              {m("inbox.helpEmpty")}
            </Text>
          ) : (
            page.items.map((request) => (
              <View key={request.id} testID={`help-item-${request.id}`} style={{ gap: 6, paddingTop: 12, borderTopWidth: 1, borderTopColor: tokens.line }}>
                <Text variant="body" bold>
                  {request.subject}
                </Text>
                <Text variant="caption" tone="text2">
                  {request.status === "open" ? m("inbox.helpAwaiting") : m("inbox.helpAnswered")} · {formatPortalTimestamp(request.createdAt)}
                </Text>
                <Text variant="secondary" selectable>
                  {request.body}
                </Text>
                {request.answer ? (
                  <View style={{ gap: 4, paddingLeft: 12, borderLeftWidth: 2, borderLeftColor: tokens.accent }}>
                    <Text variant="caption" tone="text2" bold>
                      {admission.replyAnswer}
                    </Text>
                    <Text variant="secondary" selectable>
                      {request.answer}
                    </Text>
                  </View>
                ) : null}
              </View>
            ))
          )}
          {failed ? (
            <Text variant="caption" tone="error" accessibilityRole="alert" testID="help-older-error">
              {m("inbox.helpOlderError")}
            </Text>
          ) : null}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 16 }}>
            {older ? (
              <LinkButton
                label={m("inbox.helpLatest")}
                onPress={() => {
                  setOlder(null);
                  setFailed(false);
                }}
                testID="help-latest"
              />
            ) : null}
            {page.nextCursor ? <LinkButton label={busy ? messages.loadingEarlier : m("inbox.helpOlder")} onPress={() => void loadOlder()} testID="help-older" /> : null}
          </View>
        </View>
      ) : null}
    </Card>
  );
}
