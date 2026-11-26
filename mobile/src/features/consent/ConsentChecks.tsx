// Две обязательные галочки «Конфиденциальность» (веб `ConsentGateForm`, словарь `consentGate`) и одна строка о
// файлах (решение владельца 14.11.2026: единственное место, где о них говорится). Политика открывается в браузере
// системы; ссылка на неё отдельный фокусируемый элемент (PolicyCheckRow), как на вебе.
import { View } from "react-native";

import { PolicyCheckRow } from "@/features/consent/PolicyCheckRow";
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
  return (
    <View style={{ gap: 12 }} testID="consent-checks">
      <PolicyCheckRow
        checked={policy}
        onToggle={() => editable && onPolicy(!policy)}
        template={strings.policyLabel}
        linkLabel={strings.policyLink}
        onOpenLink={() => void openExternal(PRIVACY_URL)}
        testID="consent-policy"
        linkTestID="consent-policy-link"
      />
      <CheckRow checked={ai} onToggle={() => editable && onAi(!ai)} testID="consent-ai">
        <Text variant="secondary" tone="text2">
          {strings.aiLabel}
        </Text>
      </CheckRow>
      <Text variant="secondary" tone="text2" testID="consent-ai-detail">
        {strings.aiDetail}
      </Text>
      <Text variant="secondary" tone="text2" testID="consent-files-note">
        {strings.filesNote}
      </Text>
    </View>
  );
}
