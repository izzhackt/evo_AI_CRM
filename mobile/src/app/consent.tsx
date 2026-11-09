import { useMemo, useRef, useState } from "react";
import { View } from "react-native";

import { acceptConsents, consentAcceptWrite } from "@/features/consent/consent-gate";
import { ConsentChecks } from "@/features/consent/ConsentChecks";
import { useLang } from "@/i18n/LangProvider";
import { getSupabase, platformTransport } from "@/lib/supabase";
import type { FrozenWrite } from "@/lib/rpc";
import { useSession } from "@/session/SessionProvider";
import { Button } from "@/ui/Button";
import { Card, Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";

/**
 * Экран «Конфиденциальность» (решение владельца 09.11.2026, миграция 356): до любого экрана кабинета студент без
 * решения принимает Политику и разрешает ИИ-помощников EVO, обе галочки обязательны. Закрыть экран нельзя; есть
 * «Выйти» и ссылка на Политику. Номер запроса создаётся один раз на показ экрана и повторяется при повторе после
 * сбоя (запись идемпотентна по нему).
 */
export default function ConsentScreen() {
  const { t } = useLang();
  const strings = t("consentGate");
  const { completeConsent, signOut } = useSession();
  const transport = useMemo(() => platformTransport(getSupabase()), []);
  const attempt = useRef<FrozenWrite | null>(null);
  const [policy, setPolicy] = useState(false);
  const [ai, setAi] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const both = policy && ai;

  const submit = async () => {
    if (!both || busy) return;
    attempt.current ??= consentAcceptWrite();
    setBusy(true);
    setFailed(false);
    try {
      await acceptConsents(transport, attempt.current);
      completeConsent();
    } catch {
      setFailed(true);
      setBusy(false);
    }
  };

  return (
    <Screen>
      <View style={{ gap: 8, marginBottom: 24 }}>
        <Text variant="display" accessibilityRole="header">
          {strings.title}
        </Text>
        <Text variant="body" tone="text2">
          {strings.lead}
        </Text>
      </View>
      <Card>
        <ConsentChecks policy={policy} ai={ai} onPolicy={setPolicy} onAi={setAi} editable={!busy} />
        {!both ? (
          <Text variant="secondary" tone="text2" testID="consent-need-both">
            {strings.needBoth}
          </Text>
        ) : null}
        {failed ? (
          <Text variant="secondary" tone="error" accessibilityRole="alert" testID="consent-error">
            {strings.error}
          </Text>
        ) : null}
        <Button label={busy ? strings.saving : strings.submit} onPress={() => void submit()} busy={busy} disabled={!both} testID="consent-submit" />
        <Button label={strings.logout} variant="ghost" onPress={() => void signOut()} disabled={busy} testID="consent-logout" />
      </Card>
    </Screen>
  );
}
