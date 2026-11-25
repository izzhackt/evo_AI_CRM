// Одна услуга страницы «Оплата»: заголовок, суммы (К оплате, Оплачено, Осталось, Возвращено), полоса, «Следующий шаг» и таблица
// платежей (веб: ServiceBlock в PaymentsView.tsx, #1452). Заголовок - категория («Услуги EVO»), а не сгенерированное «Получено в USD».
import { View } from "react-native";
import type { PaymentProofResult } from "@web/lib/portal/payment-proof";

import type { AmountTile, ProgressBar, ServiceView } from "@/domain/payments-model";
import type { PaymentsIo } from "@/features/payments/io";
import { PaymentTable, type AttachedProofs } from "@/features/payments/PaymentRow";
import { useLang } from "@/i18n/LangProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { Text } from "@/ui/Text";

function Tiles({ tiles, testIDPrefix, index }: { tiles: readonly AmountTile[]; testIDPrefix: string; index: number }) {
  // Как на сайте на узком экране: три столбца, а при четвёртой сумме («Возвращено») два.
  const basis = tiles.length > 3 ? "44%" : "28%";
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 16, rowGap: 12 }}>
      {tiles.map((tile) => (
        <View key={tile.key} accessible style={{ flexBasis: basis, flexGrow: 1, minWidth: 96, gap: 2 }}>
          <Text variant="caption" tone="text2">
            {tile.label}
          </Text>
          <Text variant="data" bold testID={`${testIDPrefix}-${tile.key}-${index}`}>
            {tile.value}
          </Text>
          {tile.aside ? (
            <Text variant="caption" tone="text2" testID={`${testIDPrefix}-${tile.key}-aside-${index}`}>
              {tile.aside}
            </Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}

/** Полоса «оплачено из»: зачтённое сплошным цветом, чеки на проверке бледнее следом (веб: `.pt-pay-bar`). Для читалки - одна подпись. */
function Bar({ bar, testID }: { bar: ProgressBar; testID: string }) {
  const { tokens } = useTheme();
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={bar.label}
      accessibilityValue={{ min: 0, max: 100, now: bar.valueNow }}
      testID={testID}
      style={{ flexDirection: "row", height: 6, overflow: "hidden", borderRadius: tokens.radiusChip, backgroundColor: tokens.bg }}
    >
      <View testID={`${testID}-paid`} style={{ width: `${bar.paidPct}%`, height: "100%", backgroundColor: tokens.ok }} />
      {bar.reviewPct > 0 ? <View testID={`${testID}-review`} style={{ width: `${bar.reviewPct}%`, height: "100%", backgroundColor: tokens.ok, opacity: 0.45 }} /> : null}
    </View>
  );
}

export function ServiceBlock({
  view,
  index,
  io,
  attached,
  onAttached,
}: {
  view: ServiceView;
  index: number;
  io: PaymentsIo;
  attached: AttachedProofs;
  onAttached: (lineKey: string, result: PaymentProofResult | null) => void;
}) {
  const { t } = useLang();
  const { tokens } = useTheme();
  const strings = t("admission");
  return (
    <View testID={`payment-${index}`} style={{ gap: 12, paddingTop: index === 0 ? 0 : 16, borderTopWidth: index === 0 ? 0 : 1, borderTopColor: tokens.line }}>
      <View style={{ gap: 2 }}>
        <Text variant="secondary" bold accessibilityRole="header" testID={`payment-${index}-title`}>
          {view.title}
        </Text>
        {view.sharedName ? (
          <Text variant="caption" tone="text2" testID={`payment-${index}-name`}>
            {view.sharedName}
          </Text>
        ) : null}
      </View>
      <Tiles tiles={view.tiles} testIDPrefix="amount" index={index} />
      {view.bar ? <Bar bar={view.bar} testID={`payment-${index}-bar`} /> : null}
      {view.nextActions.map((action) => (
        <Text key={action} variant="secondary" testID={`payment-${index}-next`}>
          <Text variant="secondary" bold>
            {strings.nextStepLabel}
          </Text>{" "}
          {action}
        </Text>
      ))}
      {view.lines.length > 0 ? <PaymentTable lines={view.lines} io={io} attached={attached} onAttached={onAttached} testIDPrefix={`payment-${index}`} /> : null}
    </View>
  );
}
