// «Профиль → Пароль» (веб: PasswordChangeForm): текущий пароль и новый дважды. Поля очищаются после смены,
// ответ сервера словом под кнопкой. Пароль уходит только на {portal}/api/portal/mobile/password.
import { setSignInNotice } from "@/session/sign-in-notice";
import { useState } from "react";
import { View } from "react-native";

import { submitPasswordChange, webMessageKey, type PasswordChangeStatus } from "@/features/profile/password-change";
import { usePortalApi } from "@/api/PortalApi";
import { useLang } from "@/i18n/LangProvider";
import { useSession } from "@/session/SessionProvider";
import { Button } from "@/ui/Button";
import { CardHead } from "@/ui/CardParts";
import { Card } from "@/ui/Screen";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";

export function PasswordCard() {
  const { m, profile } = useLang();
  const { portalAuth, signOut } = useSession();
  const { getAccessToken, refreshAccessToken } = usePortalApi();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [status, setStatus] = useState<PasswordChangeStatus>("idle");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setStatus("idle");
    let result: PasswordChangeStatus;
    try {
      result = await submitPasswordChange(
        { changeOwnPassword: portalAuth.changeOwnPassword, getAccessToken, refreshAccessToken },
        { current, next, confirm },
      );
    } catch {
      result = "unavailable";
    }
    setBusy(false);
    setStatus(result);
    if (result === "done") {
      setCurrent("");
      setNext("");
      setConfirm("");
    }
    // Сессия не продлилась (двойной 401): вход заново, как и сказано в строке.
    if (result === "sign_in_required") {
      setSignInNotice("session_expired");
      void signOut();
    }
  };

  const cancel = () => {
    setCurrent("");
    setNext("");
    setConfirm("");
    setStatus("idle");
    setOpen(false);
  };

  const key = webMessageKey(status);
  const message =
    status === "idle" ? "" : status === "offline" ? m("error.offline") : status === "staff_account" ? m("auth.err.staff_account") : key ? profile[key] : "";
  const good = status === "done";
  const field = { secure: true, showLabel: m("auth.showPassword"), hideLabel: m("auth.hidePassword"), autoCapitalize: "none", autoCorrect: false, maxLength: 4096, editable: !busy } as const;

  return (
    <Card>
      <CardHead title={profile.passwordHeading} />
      {open ? (
        <View style={{ gap: 12 }} testID="password-form">
          <TextField {...field} label={profile.passwordCurrent} value={current} onChangeText={setCurrent} autoComplete="current-password" textContentType="password" testID="password-current" />
          <TextField {...field} label={profile.passwordNew} hint={profile.passwordHint} value={next} onChangeText={setNext} autoComplete="new-password" textContentType="newPassword" testID="password-new" />
          <TextField {...field} label={profile.passwordConfirm} value={confirm} onChangeText={setConfirm} autoComplete="new-password" textContentType="newPassword" testID="password-confirm" />
          <Text variant="caption" tone="text2">
            {m("profile.passwordOthers")}
          </Text>
          {message ? (
            <Text variant="secondary" tone={good ? "ok" : "error"} accessibilityRole={good ? undefined : "alert"} accessibilityLiveRegion="polite" testID="password-message">
              {message}
            </Text>
          ) : null}
          {status === "wrong_current" ? (
            <Text variant="caption" tone="text2" testID="password-wrong-current-hint">
              {m("profile.passwordWrongCurrentHint")}
            </Text>
          ) : null}
          <Button label={busy ? profile.passwordSaving : profile.passwordSubmit} busy={busy} onPress={() => void submit()} testID="password-submit" />
          <Button label={m("profile.passwordCancel")} variant="ghost" disabled={busy} onPress={cancel} testID="password-cancel" />
        </View>
      ) : (
        <>
          {good && message ? (
            <Text variant="secondary" tone="ok" testID="password-message">
              {message}
            </Text>
          ) : null}
          <Button label={m("profile.passwordOpen")} variant="ghost" onPress={() => setOpen(true)} testID="password-open" />
        </>
      )}
    </Card>
  );
}
