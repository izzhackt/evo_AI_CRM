// «Запись на консультацию» (веб: ConsultationRequest.tsx и ConsultationHistory в portal/profile/page.tsx; PORT-5b, миграция 197).
// Решение владельца 25.11.2026 (D1): порт запроса консультации в приложение. Тексты - словарь `consultation` веба (RU и KY),
// новых слов нет.
//   variant="profile": карточка «Консультация» с формой запроса и историей своих запросов (до 20), как раздел «Профиля» веба.
//   variant="university": только запрос, без заголовка и истории, как на странице вуза веба (студенту без сопровождения; у
//   клиента на сопровождении один вход к команде - чат). `institutionId` - вуз, о котором запрос. `initialOpenRequest` - открытый
//   запрос, который страница уже знает (`detail.openConsultation`): тогда история не читается; без него карточка читает её сама.
// Состояние «Запрос отправлен - менеджер свяжется» честное: оно показывается после ответа базы, не раньше. Один открытый запрос
// на участника держит база, повтор нажатия и повтор после обрыва связи дубля не создают (тот же `p_request_id`).
import { CheckCircle2 } from "lucide-react-native";
import { useState } from "react";
import { TextInput, View } from "react-native";
import { openConsultationRequest, type ConsultationReceipt } from "@web/lib/portal/consultation";

import { CONSULTATION_NOTE_LIMIT } from "@/features/consultation/consultation-api";
import { useConsultationHistory, useRequestConsultation } from "@/features/consultation/use-consultation";
import { useLang } from "@/i18n/LangProvider";
import type { Lang } from "@/i18n";
import { sansFont } from "@/theme/fonts";
import { useTheme } from "@/theme/ThemeProvider";
import { announce } from "@/ui/a11y";
import { Button } from "@/ui/Button";
import { CardHead, CardSkeleton, InlineAlert } from "@/ui/CardParts";
import { Card } from "@/ui/Screen";
import { Text } from "@/ui/Text";

export type ConsultationCardProps = Readonly<{
  /** Вуз, о котором запрос (страница вуза); без него запрос из «Профиля». */
  institutionId?: string | null;
  variant?: "profile" | "university";
  /** Открытый запрос, известный странице; `undefined` - карточка читает историю сама. */
  initialOpenRequest?: ConsultationReceipt | null;
}>;

/** «9 ноября 2026» (веб: Intl, UTC); если среда не знает язык, числами «09.11.2026». */
export function consultationDate(value: string, lang: Lang): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  try {
    return new Intl.DateTimeFormat(lang === "ky" ? "ky" : "ru", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(date);
  } catch {
    const two = (n: number) => String(n).padStart(2, "0");
    return `${two(date.getUTCDate())}.${two(date.getUTCMonth() + 1)}.${date.getUTCFullYear()}`;
  }
}

function History({ history }: { history: readonly ConsultationReceipt[] }) {
  const { lang, t, format } = useLang();
  const { tokens } = useTheme();
  const strings = t("consultation");
  if (history.length === 0) return null;
  return (
    <View style={{ gap: 8 }} testID="consult-history">
      <Text variant="heading" accessibilityRole="header">
        {strings.historyHeading}
      </Text>
      {history.map((receipt) => (
        <View
          key={receipt.requestId}
          testID="consult-history-item"
          style={{ gap: 2, paddingTop: 8, borderTopWidth: 1, borderTopColor: tokens.line }}
        >
          <Text variant="body" bold>
            {receipt.status === "handled" ? strings.statusHandled : strings.statusRequested}
          </Text>
          {receipt.institutionName !== null ? (
            <Text variant="secondary" tone="text2">
              {format(strings.universityLine, { name: receipt.institutionName })}
            </Text>
          ) : null}
          {receipt.note !== null ? (
            <Text variant="body" selectable>
              {receipt.note}
            </Text>
          ) : null}
          <Text variant="caption" tone="text2">
            {format(strings.historyDate, { date: consultationDate(receipt.requestedAt, lang) })}
            {receipt.handledAt !== null ? ` · ${format(strings.handledDate, { date: consultationDate(receipt.handledAt, lang) })}` : ""}
          </Text>
        </View>
      ))}
    </View>
  );
}

export function ConsultationCard({ institutionId = null, variant = "profile", initialOpenRequest }: ConsultationCardProps) {
  const { m, t } = useLang();
  const { tokens } = useTheme();
  const strings = t("consultation");
  const profile = variant === "profile";
  const history = useConsultationHistory(profile || initialOpenRequest === undefined);
  const request = useRequestConsultation(institutionId);
  const [expanded, setExpanded] = useState(false);
  const [note, setNote] = useState("");
  const [sent, setSent] = useState<ConsultationReceipt | null>(null);

  // Прочитанная история - главный источник; пока её нет (страница вуза), открытый запрос из страницы или только что отправленный.
  const open: ConsultationReceipt | null = history.data ? openConsultationRequest(history.data) : (sent ?? initialOpenRequest ?? null);

  const body = (() => {
    if (open !== null) {
      return (
        <View accessibilityLiveRegion="polite" style={{ flexDirection: "row", alignItems: "center", gap: 8 }} testID="consult-sent">
          <CheckCircle2 size={20} strokeWidth={1.75} color={tokens.ok} />
          <Text variant="body" bold style={{ flex: 1 }}>
            {strings.sent}
          </Text>
        </View>
      );
    }
    if (!expanded) {
      return (
        <View style={{ gap: 12 }}>
          <Text variant="secondary" tone="text2">
            {strings.hint}
          </Text>
          <Button label={strings.ctaButton} onPress={() => setExpanded(true)} testID="consult-cta" />
        </View>
      );
    }
    const pending = request.isPending;
    return (
      <View style={{ gap: 12 }} testID="consult-form">
        <Text variant="secondary" tone="text2">
          {strings.hint}
        </Text>
        <View style={{ gap: 6 }}>
          <Text variant="secondary" tone="text2" bold>
            {strings.noteLabel}
          </Text>
          <TextInput
            value={note}
            onChangeText={setNote}
            multiline
            maxLength={CONSULTATION_NOTE_LIMIT}
            placeholder={strings.notePlaceholder}
            placeholderTextColor={tokens.text2}
            accessibilityLabel={strings.noteLabel}
            editable={!pending}
            textAlignVertical="top"
            style={{
              minHeight: 96,
              borderWidth: 1,
              borderColor: tokens.controlEdge,
              borderRadius: tokens.radiusControl,
              backgroundColor: tokens.surface,
              paddingHorizontal: 12,
              paddingVertical: 10,
              fontFamily: sansFont(),
              fontSize: tokens.sizeBody,
              color: tokens.text,
            }}
            testID="consult-note"
          />
        </View>
        <Button
          label={strings.submit}
          busy={pending}
          onPress={() =>
            request.mutate(note, {
              onSuccess: (receipt) => {
                setSent(receipt);
                setExpanded(false);
                setNote("");
                announce(strings.sent);
              },
            })
          }
          testID="consult-submit"
        />
        <Button
          label={strings.cancel}
          variant="ghost"
          disabled={pending}
          onPress={() => {
            setExpanded(false);
            request.reset();
          }}
          testID="consult-cancel"
        />
        {request.isError ? <InlineAlert message={strings.error} testID="consult-error" /> : null}
      </View>
    );
  })();

  // Профиль: история не прочиталась - честная строка и повтор, а не кнопка поверх возможного открытого запроса.
  if (profile && history.isError && !history.data) {
    return (
      <Card>
        <CardHead title={strings.heading} />
        <InlineAlert message={strings.historyUnavailable} retryLabel={m("profile.retry")} onRetry={() => void history.refetch()} testID="consult-history-error" />
      </Card>
    );
  }
  if (profile && history.isPending) {
    return (
      <Card>
        <CardSkeleton label={`${strings.heading}. ${m("state.loading")}`} lines={2} testID="consult-loading" />
      </Card>
    );
  }

  const content = (
    <>
      {body}
      {profile && history.data ? <History history={history.data} /> : null}
    </>
  );
  return profile ? (
    <Card>
      <CardHead title={strings.heading} />
      <View style={{ gap: 12 }} testID="consult-card">
        {content}
      </View>
    </Card>
  ) : (
    <View style={{ gap: 12 }} testID="consult-card">
      {content}
    </View>
  );
}
