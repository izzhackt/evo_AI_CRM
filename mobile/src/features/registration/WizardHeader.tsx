// Шапка мастера анкеты (веб: шапка ApplicationWizard.tsx, строки 289-292): язык RU|KY всегда; у вошедшего ещё «Выйти» и
// «Удалить аккаунт» (веб: ссылка-якорь на секцию `#account-deletion`), у анонима «Уже есть аккаунт? Войти».
// «Выйти» у вошедшего в вебе стоит на странице статуса; в приложении мастер первого шага без «Назад», поэтому выход
// нужен прямо в нём (иначе заявитель заперт в анкете до одобрения).
import { View } from "react-native";

import { useLang } from "@/i18n/LangProvider";
import { LinkButton } from "@/ui/CardParts";
import { LangSwitch } from "@/ui/LangSwitch";

export type WizardAccountActions = Readonly<{
  onSignOut: () => void;
  /** Прокрутить к секции удаления аккаунта внизу мастера. */
  onDelete: () => void;
}>;

export function WizardHeader({ onSignIn, account }: { onSignIn?: () => void; account?: WizardAccountActions }) {
  const { profile, t } = useLang();
  const apply = t("apply");
  const deletion = t("accountDeletion");
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", columnGap: 16 }} testID="wizard-header">
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 16, flexShrink: 1 }}>
        {account ? (
          <>
            <LinkButton label={profile.logout} onPress={account.onSignOut} testID="wizard-sign-out" />
            <LinkButton label={deletion.action} onPress={account.onDelete} testID="wizard-delete-account" />
          </>
        ) : onSignIn ? (
          <LinkButton label={apply.loginLink} onPress={onSignIn} testID="wizard-login-link" />
        ) : null}
      </View>
      <LangSwitch />
    </View>
  );
}
