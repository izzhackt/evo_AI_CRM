// Две обязательные галочки «Конфиденциальность» (веб `ConsentGateBoxes`, словарь `consentGate`):
// на самом экране и на «Задайте свой пароль». Политика открывается в браузере системы.
import { View } from "react-native";

import { CheckRow } from "@/features/registration/WizardFields";
import { openExternal, PRIVACY_URL } from "@/features/profile/external";
import { useLang } from "@/i18n/LangProvider";
import { Text } from "@/ui/Text";

export function ConsentChecks({
  policy,
  ai,
  onPolicy,
  onAi,
  editable = true,
}: {
  policy: boolean;
  ai: boolean;
  onPolicy: (next: boolean) => void;
  onAi: (next: boolean) => void;
  editable?: boolean;
}) {
  const { t } = useLang();
  const strings = t("consentGate");
  const [before, after = ""] = strings.policyLabel.split("{policy}");
  return (
    <View style={{ gap: 12 }} testID="consent-checks">
      <CheckRow checked={policy} onToggle={() => editable && onPolicy(!policy)} testID="consent-policy">
        <Text variant="secondary" tone="text2">
          {before}
          <Text variant="secondary" tone="accent" bold onPress={() => void openExternal(PRIVACY_URL)} accessibilityRole="link" testID="consent-policy-link">
            {strings.policyLink}
          </Text>
          {after}
        </Text>
      </CheckRow>
      <CheckRow checked={ai} onToggle={() => editable && onAi(!ai)} testID="consent-ai">
        <Text variant="secondary" tone="text2">
          {strings.aiLabel}
        </Text>
      </CheckRow>
      <Text variant="secondary" tone="text2" testID="consent-ai-detail">
        {strings.aiDetail}
      </Text>
    </View>
  );
}
