// Строка таблицы «Платежи»: Дата, Сумма, Чек, Статус (веб: PaymentRow в PaymentsView.tsx, #1452). На узком экране сайт
// сам складывает таблицу в такие строки (portal.css, max-width 640px): подпись слева, значение справа, строки друг под другом.
// «Чек» собирает ячейка: файл ссылкой, кнопка «Приложить чек» или «Заменить» (ReceiptSlot), у принятой оплаты без файла -
// ProofSlot, после него «Чек приложен» (G34); нет ничего - тире.
import { useEffect, type ReactNode } from "react";
import { View } from "react-native";
import type { PaymentProofResult } from "@web/lib/portal/payment-proof";

import type { PaymentLineView, ReceiptFile } from "@/domain/payments-model";
import type { PaymentsIo } from "@/features/payments/io";
import { ProofSlot } from "@/features/payments/ProofSlot";
import { ReceiptFileLink } from "@/features/payments/ReceiptFileLink";
import { ReceiptSlot } from "@/features/payments/ReceiptSlot";
import { useLang } from "@/i18n/LangProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { announce } from "@/ui/a11y";
import { StatusPill } from "@/ui/StatusPill";
import { Text } from "@/ui/Text";

/**
 * Файлы, приложенные к принятой оплате за время, пока страница открыта: ключ строки -> ответ сервера (`null`: ответ не той формы).
 * Строка держит «Чек приложен» и ссылку и после перечитывания, когда данные уже дали записи файл и ProofSlot исчез.
 */
export type AttachedProofs = ReadonlyMap<string, PaymentProofResult | null>;

/** Одна пара «подпись - значение». Подпись слева, значение справа; на узком экране значение уходит под подпись. */
function Pair({ label, children, grouped = true }: { label: string; children: ReactNode; grouped?: boolean }) {
  return (
    <View
      accessible={grouped}
      style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", columnGap: 16, rowGap: 8, paddingVertical: 6 }}
    >
      {/* Ячейка «Чек» держит кнопки со своими именами (с датой и суммой строки): подпись колонки для читалки лишняя. */}
      <Text variant="caption" tone="text2" bold accessibilityElementsHidden={!grouped} importantForAccessibility={grouped ? "auto" : "no"}>
        {label}
      </Text>
      {children}
    </View>
  );
}

/** «Чек приложен» после загрузки файла к принятой оплате. Читалка слышит сообщение сразу, при появлении. */
function ProofAttachedNote({ testID }: { testID: string }) {
  const { t } = useLang();
  const strings = t("admission");
  useEffect(() => {
    announce(strings.proofAttached);
  }, [strings.proofAttached]);
  return (
    <Text variant="secondary" tone="ok" bold accessibilityRole="alert" accessibilityLiveRegion="polite" testID={testID}>
      {strings.proofAttached}
    </Text>
  );
}

function ReceiptCell({
  view,
  io,
  attached,
  onAttached,
  testID,
}: {
  view: PaymentLineView;
  io: PaymentsIo;
  attached: AttachedProofs;
  onAttached: (lineKey: string, result: PaymentProofResult | null) => void;
  testID: string;
}) {
  const proof = attached.get(view.line.key);
  const justAttached = proof !== undefined;
  // Ссылка из данных строки; пока данные не перечитаны, а файл уже сохранён, ссылка из ответа сервера.
  const file: ReceiptFile | null = view.file ?? (proof ? { fileKind: "receipt", fileId: proof.fileId, filename: proof.filename } : null);
  const showProof = !justAttached && view.proofEventId !== null;
  const empty = file === null && view.slot === null && !showProof && !justAttached;
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 8, rowGap: 4, flexShrink: 1 }} testID={`${testID}-receipt`}>
      {file ? <ReceiptFileLink io={io} file={file} testID={`${testID}-open`} /> : null}
      {view.slot ? <ReceiptSlot io={io} view={view} mode={view.slot} testID={`${testID}-slot`} /> : null}
      {showProof && view.proofEventId ? (
        <ProofSlot io={io} paymentEventId={view.proofEventId} lineKey={view.line.key} context={view.context} testID={`${testID}-proof`} onAttached={onAttached} />
      ) : null}
      {justAttached ? <ProofAttachedNote testID={`${testID}-proof-sent`} /> : null}
      {empty ? (
        <Text variant="secondary" tone="text2" accessibilityElementsHidden importantForAccessibility="no">
          —
        </Text>
      ) : null}
    </View>
  );
}

export function PaymentRow({
  view,
  io,
  attached,
  onAttached,
  testID,
}: {
  view: PaymentLineView;
  io: PaymentsIo;
  attached: AttachedProofs;
  onAttached: (lineKey: string, result: PaymentProofResult | null) => void;
  testID: string;
}) {
  const { t } = useLang();
  const { tokens } = useTheme();
  const strings = t("admission");
  return (
    <View testID={testID} style={{ borderTopWidth: 1, borderTopColor: tokens.line, paddingTop: 8, paddingBottom: 12 }}>
      <Pair label={strings.receiptColumnDate}>
        <View style={{ flexShrink: 1 }}>
          <Text variant="data" testID={`${testID}-date`}>
            {view.dateText}
          </Text>
          {view.rowLabel ? (
            <Text variant="caption" tone="text2" testID={`${testID}-label`}>
              {view.rowLabel}
            </Text>
          ) : null}
        </View>
      </Pair>
      <Pair label={strings.receiptColumnAmount}>
        <Text variant="data" testID={`${testID}-amount`}>
          {view.money}
        </Text>
      </Pair>
      <Pair label={strings.receiptColumnReceipt} grouped={false}>
        <ReceiptCell view={view} io={io} attached={attached} onAttached={onAttached} testID={testID} />
      </Pair>
      <Pair label={strings.receiptColumnStatus}>
        <View style={{ alignItems: "flex-start", gap: 6, flexShrink: 1 }}>
          <StatusPill label={view.status.label} tone={view.status.tone} testID={`${testID}-status`} />
          {view.overdueLabel ? <StatusPill label={view.overdueLabel} tone="danger" testID={`${testID}-overdue`} /> : null}
          {view.rejectReason ? (
            <Text variant="caption" tone="error" bold testID={`${testID}-reason`}>
              {view.rejectReason}
            </Text>
          ) : null}
        </View>
      </Pair>
    </View>
  );
}

/** Таблица строк одной услуги или «Добавленных платежей»: строки по порядку дат (порядок задаёт общий модуль). */
export function PaymentTable({
  lines,
  io,
  attached,
  onAttached,
  testIDPrefix,
}: {
  lines: readonly PaymentLineView[];
  io: PaymentsIo;
  attached: AttachedProofs;
  onAttached: (lineKey: string, result: PaymentProofResult | null) => void;
  testIDPrefix: string;
}) {
  return (
    <View>
      {lines.map((view, index) => (
        <PaymentRow key={view.line.key} view={view} io={io} attached={attached} onAttached={onAttached} testID={`${testIDPrefix}-entry-${index}`} />
      ))}
    </View>
  );
}
