// «Проверьте почту» после 202 pending_confirmation: маска почты, повторная отправка с
// ожиданием, «Войти». Тексты — словарь подтверждения веба (signup-confirmation-i18n.ts).
import { useEffect, useState } from "react";
import { Linking, View } from "react-native";

import {
  type PendingConfirmation,
  type RegistrationApi,
  type ResendFailure,
} from "@/features/registration/registration-api";
import { useLang } from "@/i18n/LangProvider";
import { Button } from "@/ui/Button";
import { LinkButton } from "@/ui/CardParts";
import { Card } from "@/ui/Screen";
import { Text } from "@/ui/Text";
import { getSignupConfirmationStrings } from "@web/lib/portal/signup-confirmation-i18n";

export const SUPPORT_MAILTO = "mailto:evoadmissions@gmail.com";
const DEFAULT_COOLDOWN_SECONDS = 30;

/** Ключ строки подтверждения для отказа повторной отправки. */
export function resendFailureKey(reason: ResendFailure): "confirmed" | "expired" | "rate_limit" | "account_conflict" | "unavailable" {
  switch (reason) {
    case "confirmed":
    case "expired":
    case "rate_limit":
    case "account_conflict":
      return reason;
    default:
      return "unavailable";
  }
}

export function ConfirmationPending({
  initial,
  api,
  onSignIn,
  onEdit,
}: {
  initial: PendingConfirmation;
  api: RegistrationApi;
  onSignIn: () => void;
  /** Назад к ответам не предлагаем: аккаунт уже создан. Параметр оставлен для проверки Mailpit-сценария. */
  onEdit?: () => void;
}) {
  const { lang, m, format } = useLang();
  const copy = getSignupConfirmationStrings(lang);
  const [pending, setPending] = useState(initial);
  const [cooldown, setCooldown] = useState(initial.retryAfterSeconds ?? DEFAULT_COOLDOWN_SECONDS);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => clearInterval(timer);
  }, [cooldown > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  const resend = async () => {
    if (busy || cooldown > 0) return;
    setBusy(true);
    setNotice(null);
    const result = await api.resend(pending.resendCapability);
    setBusy(false);
    if (result.ok) {
      setPending(result.pending);
      setCooldown(result.pending.retryAfterSeconds ?? DEFAULT_COOLDOWN_SECONDS);
      setNotice({ tone: result.pending.dispatch === "failed" ? "error" : "ok", text: copy[result.pending.dispatch === "accepted" ? "accepted" : result.pending.dispatch] });
      return;
    }
    if (result.reason === "rate_limit") setCooldown(DEFAULT_COOLDOWN_SECONDS);
    if (result.reason === "network") {
      setNotice({ tone: "error", text: m("error.offline") });
      return;
    }
    if (result.reason === "upgrade_required") {
      setNotice({ tone: "error", text: m("wizard.err.upgrade") });
      return;
    }
    setNotice({ tone: result.reason === "confirmed" ? "ok" : "error", text: copy[resendFailureKey(result.reason)] });
  };

  const dispatchText = pending.dispatch === "accepted" ? copy.accepted : pending.dispatch === "failed" ? copy.failed : copy.unknown;

  return (
    <Card>
      <Text variant="title" accessibilityRole="header" testID="pending-title">
        {copy.title}
      </Text>
      <Text variant="body">
        {copy.instruction}{" "}
        <Text variant="body" bold testID="pending-masked-email">
          {pending.maskedEmail}
        </Text>
      </Text>
      <Text variant="secondary" tone="text2">
        {copy.next}
      </Text>
      <Text variant="secondary" tone="text2" testID="pending-dispatch">
        {dispatchText}
      </Text>
      <Text variant="secondary" tone="text2">
        {m("pending.afterConfirm")}
      </Text>
      {notice ? (
        <Text variant="secondary" tone={notice.tone === "ok" ? "ok" : "error"} accessibilityRole="alert" accessibilityLiveRegion="polite" testID="pending-notice">
          {notice.text}
        </Text>
      ) : null}
      <View style={{ gap: 8 }}>
        <Button
          label={busy ? copy.sending : cooldown > 0 ? format(m("pending.resendIn"), { seconds: String(cooldown) }) : copy.resend}
          variant="ghost"
          onPress={() => void resend()}
          busy={busy}
          disabled={cooldown > 0}
          testID="pending-resend"
        />
        <Button label={copy.login} onPress={onSignIn} testID="pending-sign-in" />
        <LinkButton label={copy.support} onPress={() => void Linking.openURL(SUPPORT_MAILTO)} testID="pending-support" />
        {onEdit ? <LinkButton label={m("pending.edit")} onPress={onEdit} /> : null}
      </View>
    </Card>
  );
}
