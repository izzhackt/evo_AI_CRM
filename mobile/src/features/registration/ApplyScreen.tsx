// Регистрация по личной ссылке (аноним): ссылка -> проверка ссылки -> анкета -> «Проверьте почту».
// Ссылка приходит из universal link / App Link / evoadmissions://apply?invite=…
// (параметр маршрута) или вставляется вручную. Без неё аккаунт не создаётся (SEC-1, 341).
// До анкеты ссылка проверяется на сервере (веб делает это при открытии /apply): использованная, просроченная и неизвестная
// ссылки открывают экран «Регистрация по приглашению», а не семь шагов ради отказа на последнем; у действующей имя
// приглашённого подставляется в анкету. Если маршрут проверки недоступен или сбоит (старый сервер, нет связи), приложение идёт
// дальше, как раньше: ссылку всё равно проверит отправка анкеты (403 `invite`).
// «Проверьте почту» запоминается (pending-store.ts) и после перезапуска возвращается с «Отправить письмо ещё раз».
// Порядок как на вебе (apply/page.tsx:85-98): ожидание подтверждения почты первее ссылки. Сервер гасит личную ссылку при создании
// аккаунта, поэтому ссылка из письма менеджера, открытая второй раз, отвечает «использована», а записи ожидания (предъявитель
// повторной отправки) стирать из-за этого нельзя: без неё не войти (почта не подтверждена), не отправить письмо и не
// зарегистрироваться заново (409). Запись стирает только действующая новая ссылка.
import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, View } from "react-native";

import { getConfig } from "@/config";
import { ApplicationWizard, type WizardSubmit } from "@/features/registration/ApplicationWizard";
import { ConfirmationPending } from "@/features/registration/ConfirmationPending";
import { clearDraft, clearInviteToken, loadInviteToken, saveInviteToken } from "@/features/registration/draft-store";
import { InviteRequired, type InviteProblem } from "@/features/registration/InviteRequired";
import { parseInviteToken } from "@/features/registration/invite-link";
import { clearPendingSignup, loadPendingSignup, savePendingSignup } from "@/features/registration/pending-store";
import { createRegistrationApi, type PendingConfirmation, type RegisterFailure, type RegistrationApi } from "@/features/registration/registration-api";
import { buildQuestionnaire, type NamePrefill } from "@/features/registration/wizard-model";
import { useLang } from "@/i18n/LangProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { Button } from "@/ui/Button";
import { LinkButton } from "@/ui/CardParts";
import { EvoMark } from "@/ui/EvoMark";
import { LangSwitch } from "@/ui/LangSwitch";
import { Card, Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";
import { getSignupConfirmationStrings } from "@web/lib/portal/signup-confirmation-i18n";

type Phase =
  | { kind: "loading" }
  | { kind: "checking"; invite: string }
  | { kind: "entry" }
  | { kind: "invite"; status: InviteProblem; invite: string }
  | { kind: "wizard"; invite: string; prefill: NamePrefill | null }
  | { kind: "pending"; pending: PendingConfirmation; restored: boolean };

/** Сообщение пользователю для отказа регистрации (тексты веба, ответ сервера не показывается). */
export function useRegisterFailureMessage(): (reason: RegisterFailure) => string {
  const { lang, m, t } = useLang();
  const apply = t("apply") as unknown as Readonly<Record<string, string>>;
  return useCallback(
    (reason) => {
      switch (reason) {
        case "password":
          return apply["server.password"];
        case "password_too_long":
          return apply["server.password_too_long"];
        case "rate_limit":
          return apply["server.rate_limit"];
        case "conflict":
          return apply["server.conflict"];
        case "invalid":
          return apply["server.invalid"];
        case "invite":
          return apply["server.invite"];
        case "create_unknown":
          return getSignupConfirmationStrings(lang).create_unknown;
        case "upgrade_required":
          return m("wizard.err.upgrade");
        case "network":
          return m("wizard.err.network");
        default:
          return apply["server.unavailable"];
      }
    },
    [apply, lang, m],
  );
}

export function ApplyScreen({ inviteParam, api: apiProp }: { inviteParam?: string | null; api?: RegistrationApi }) {
  const { tokens } = useTheme();
  const { m } = useLang();
  const api = useMemo(() => apiProp ?? createRegistrationApi({ baseUrl: getConfig().portalBaseUrl }), [apiProp]);
  const failureMessage = useRegisterFailureMessage();
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [pasted, setPasted] = useState("");
  const [pasteError, setPasteError] = useState(false);
  // Сообщение на экране ввода ссылки: например, «ссылка недействительна» после отказа сервера.
  const [notice, setNotice] = useState<string | null>(null);

  // Каждое новое начало (ссылка, вставка, повтор) получает номер: ответ проверки, пришедший после ухода с экрана или после
  // следующего начала, отбрасывается.
  const run = useRef(0);
  useEffect(
    () => () => {
      run.current += 1;
    },
    [],
  );

  /**
   * Проверить ссылку и открыть анкету или экран «Регистрация по приглашению». Если регистрация уже ждёт подтверждения почты,
   * анкета открывается только по действующей новой ссылке (запись ожидания стирается ею); использованная, просроченная, неизвестная
   * ссылка и сбой проверки оставляют запись и показывают «Подтвердите почту» с повтором письма.
   */
  const begin = useCallback(
    async (invite: string) => {
      const id = ++run.current;
      setPhase({ kind: "checking", invite });
      const [waiting, check] = await Promise.all([loadPendingSignup(), api.checkInvite(invite)]);
      if (id !== run.current) return;
      if (waiting) {
        if (check?.status === "valid") {
          await clearPendingSignup();
          await saveInviteToken(invite);
          if (id !== run.current) return;
          setPhase({ kind: "wizard", invite, prefill: check.prefill });
          return;
        }
        setPhase({ kind: "pending", pending: { ...waiting.pending, retryAfterSeconds: waiting.cooldownSeconds }, restored: true });
        return;
      }
      // `null`: маршрута нет или он сбоит. Как раньше: анкета открыта, ссылку проверит отправка.
      if (check === null || check.status === "valid") {
        await saveInviteToken(invite);
        if (id !== run.current) return;
        setPhase({ kind: "wizard", invite, prefill: check === null ? null : check.prefill });
        return;
      }
      // Использованная, просроченная и неизвестная ссылка бесполезна: стереть её и черновик (как после отказа `invite`).
      // «Не удалось проверить» ничего не стирает: ссылка, возможно, в порядке.
      if (check.status === "unavailable") await saveInviteToken(invite);
      else {
        await clearInviteToken();
        await clearDraft("anonymous");
      }
      if (id !== run.current) return;
      setPhase({ kind: "invite", status: check.status, invite });
    },
    [api],
  );

  // Токен из ссылки приложения важнее сохранённого; без обоих — ввод вручную. Ожидающая регистрация («Проверьте почту»)
  // возвращается, пока нет действующей новой ссылки (её проверяет `begin`).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (inviteParam) {
        if (!cancelled) await begin(inviteParam);
        return;
      }
      const restored = await loadPendingSignup();
      if (restored) {
        if (!cancelled) setPhase({ kind: "pending", pending: { ...restored.pending, retryAfterSeconds: restored.cooldownSeconds }, restored: true });
        return;
      }
      const stored = await loadInviteToken();
      if (cancelled) return;
      if (stored) await begin(stored);
      else setPhase({ kind: "entry" });
    })();
    return () => {
      cancelled = true;
    };
  }, [inviteParam, begin]);

  const submitPasted = async () => {
    const token = parseInviteToken(pasted);
    if (!token) {
      setPasteError(true);
      return;
    }
    setPasteError(false);
    setNotice(null);
    await begin(token);
  };

  const changeLink = async () => {
    run.current += 1;
    await clearInviteToken();
    await clearDraft("anonymous");
    setPasted("");
    setNotice(null);
    setPhase({ kind: "entry" });
  };

  const onSubmit: WizardSubmit = useCallback(
    async ({ values, password }) => {
      if (phase.kind !== "wizard" || password === null) return failureMessage("invalid");
      const result = await api.register({
        email: values.email.trim().toLowerCase(),
        password,
        questionnaire: buildQuestionnaire({ ...values, email: values.email.trim().toLowerCase() }),
        invite: phase.invite,
      });
      if (result.ok) {
        await clearInviteToken();
        await clearDraft("anonymous");
        // Письмо читают в почте, а приложение за это время могут выгрузить: «Отправить письмо ещё раз» не должно пропасть.
        await savePendingSignup(result.pending);
        setPhase({ kind: "pending", pending: result.pending, restored: false });
        return null;
      }
      if (result.reason === "invite") {
        // Чужая или просроченная ссылка: стереть её и вернуться к вводу ссылки («Другая ссылка»).
        await clearInviteToken();
        await clearDraft("anonymous");
        setNotice(failureMessage("invite"));
        setPhase({ kind: "entry" });
        return null;
      }
      // Аккаунт с этой почтой уже есть: под сообщением появляется «Перейти ко входу» (веб: server.conflict + goToLogin).
      if (result.reason === "conflict") return { message: failureMessage(result.reason), signIn: true };
      return failureMessage(result.reason);
    },
    [api, failureMessage, phase],
  );

  if (phase.kind === "loading" || phase.kind === "checking") {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: tokens.bg }} accessibilityLiveRegion="polite">
        <ActivityIndicator color={tokens.accent} />
      </View>
    );
  }

  if (phase.kind === "wizard") {
    return (
      <ApplicationWizard
        signedInEmail={null}
        scope="anonymous"
        namePrefill={phase.prefill}
        onSubmit={onSubmit}
        onExit={() => void changeLink()}
        exitLabel={m("apply.changeLink")}
        // Черновик остаётся: «Уже есть аккаунт? Войти» не стирает ответы (в отличие от «Другая ссылка»).
        onSignIn={() => router.replace("/sign-in")}
      />
    );
  }

  return (
    <Screen>
      <View style={{ alignItems: "flex-end" }}>
        <LangSwitch />
      </View>
      <View style={{ marginTop: 24, marginBottom: 20, gap: 12 }}>
        <EvoMark size={44} color={tokens.brandRed} />
        {phase.kind === "pending" || phase.kind === "invite" ? null : (
          <Text variant="display" accessibilityRole="header">
            {m("apply.entryTitle")}
          </Text>
        )}
      </View>
      {phase.kind === "pending" ? (
        <ConfirmationPending
          initial={phase.pending}
          api={api}
          restored={phase.restored}
          onPendingChange={(next) => void savePendingSignup(next)}
          onTerminal={() => void clearPendingSignup()}
          onSignIn={() => router.replace("/sign-in")}
        />
      ) : phase.kind === "invite" ? (
        <InviteRequired
          status={phase.status}
          onSignIn={() => router.replace("/sign-in")}
          onChangeLink={() => void changeLink()}
          onRetry={phase.status === "unavailable" ? () => void begin(phase.invite) : undefined}
        />
      ) : (
        <Card>
          <Text variant="body" tone="text2">
            {m("apply.entryIntro")}
          </Text>
          <TextField
            label={m("apply.pasteLabel")}
            value={pasted}
            onChangeText={(value) => {
              setPasted(value);
              setPasteError(false);
            }}
            placeholder={m("apply.pastePlaceholder")}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            maxLength={600}
            returnKeyType="go"
            onSubmitEditing={() => void submitPasted()}
            testID="invite-input"
          />
          {notice ? (
            <Text variant="secondary" tone="error" accessibilityRole="alert" testID="invite-notice">
              {notice}
            </Text>
          ) : null}
          {pasteError ? (
            <Text variant="secondary" tone="error" accessibilityRole="alert" testID="invite-error">
              {m("apply.pasteInvalid")}
            </Text>
          ) : null}
          <Button label={m("apply.pasteContinue")} onPress={() => void submitPasted()} testID="invite-continue" />
          <Text variant="secondary" tone="text2">
            {m("apply.noLink")}
          </Text>
          <LinkButton label={m("apply.toSignIn")} onPress={() => router.replace("/sign-in")} testID="apply-to-sign-in" />
        </Card>
      )}
    </Screen>
  );
}
