// Галочка с политикой конфиденциальности внутри предложения (веб: ConsentGateForm.tsx и мастер анкеты, где ссылка стоит
// в подписи галочки и при этом отдельно фокусируема). Раньше ссылка была вложенным `Text` внутри нажимаемой строки с ролью
// «флажок»: читалка (VoiceOver, TalkBack) собирает такую строку в один элемент и до ссылки не доходит, а ссылка на политику
// обязательна по закону (аудит паритета 25.11.2026, G13).
// Теперь три отдельных элемента: флажок с полным предложением в названии, отдельная ссылка (роль «ссылка») и видимые куски
// предложения, которые читалке не показываются (она уже прочла предложение в названии флажка), но нажатие по ним, как и
// раньше, ставит и снимает галочку. Вид тот же: предложение, в нём подчёркнутая ссылка.
import { Check } from "lucide-react-native";
import { Pressable, View } from "react-native";

import { useTheme } from "@/theme/ThemeProvider";
import { Text } from "@/ui/Text";

/** Часть предложения: видима, нажатие ставит галочку, читалке не показывается (предложение целиком в названии флажка). */
function Sentence({ text, onPress }: { text: string; onPress: () => void }) {
  if (text === "") return null;
  return (
    <Pressable onPress={onPress} accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ flexShrink: 1 }}>
      <Text variant="secondary" tone="text2">
        {text}
      </Text>
    </Pressable>
  );
}

export function PolicyCheckRow({
  checked,
  onToggle,
  template,
  linkLabel,
  onOpenLink,
  testID,
  linkTestID,
}: {
  checked: boolean;
  onToggle: () => void;
  /** Предложение с `{policy}` на месте ссылки (`apply.consentLabel`, `consentGate.policyLabel`). */
  template: string;
  /** Подпись ссылки (`apply.consentPolicyLink`, `consentGate.policyLink`). */
  linkLabel: string;
  onOpenLink: () => void;
  testID?: string;
  linkTestID?: string;
}) {
  const { tokens } = useTheme();
  const [before, after = ""] = template.split("{policy}");
  const sentence = `${before}${linkLabel}${after}`.replace(/\s+/g, " ").trim();
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12, minHeight: 44, paddingVertical: 4 }}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked }}
        accessibilityLabel={sentence}
        onPress={onToggle}
        testID={testID}
        hitSlop={{ top: 10, bottom: 10, left: 8, right: 4 }}
        style={{ marginTop: 2, width: 24, height: 24, borderRadius: 6, borderWidth: 1, borderColor: checked ? tokens.accent : tokens.controlEdge, backgroundColor: checked ? tokens.accent : tokens.surface, alignItems: "center", justifyContent: "center" }}
      >
        {checked ? <Check size={16} strokeWidth={3} color={tokens.onAccent} /> : null}
      </Pressable>
      <View style={{ flex: 1, flexDirection: "row", flexWrap: "wrap", alignItems: "center" }}>
        <Sentence text={before} onPress={onToggle} />
        <Pressable accessibilityRole="link" accessibilityLabel={linkLabel} onPress={onOpenLink} testID={linkTestID} hitSlop={{ top: 12, bottom: 12, left: 4, right: 4 }}>
          <Text variant="secondary" tone="accent" bold style={{ textDecorationLine: "underline" }}>
            {linkLabel}
          </Text>
        </Pressable>
        <Sentence text={after} onPress={onToggle} />
      </View>
    </View>
  );
}
