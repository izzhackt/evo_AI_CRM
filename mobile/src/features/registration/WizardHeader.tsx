// Шапка мастера анкеты (веб: шапка ApplicationWizard.tsx, строки 289-292): язык RU|KY всегда; у вошедшего ещё «Выйти» и
// «Удалить аккаунт» (веб: ссылка-якорь на секцию `#account-deletion`), у анонима «Уже есть аккаунт? Войти».
// «Выйти» у вошедшего в вебе стоит на странице статуса; в приложении мастер первого шага без «Назад», поэтому выход
// нужен прямо в нём (иначе заявитель заперт в анкете до одобрения).
// Выход стирает с телефона ответы анкеты (черновик лежит только здесь, выход чистит все данные студента), а случайное нажатие
// стоит семи шагов набора: поэтому «Выйти» сначала спрашивает (рецензия #1554). «Выйти» - действие, а не переход: роль «кнопка»;
// «Удалить аккаунт» и «Войти» ведут к месту на экране или на другой экран: роль «ссылка».
import { useState } from "react";
import { Pressable, View } from "react-native";

import { useLang } from "@/i18n/LangProvider";
import { Button } from "@/ui/Button";
import { LinkButton, MIN_TARGET } from "@/ui/CardParts";
import { LangSwitch } from "@/ui/LangSwitch";
import { Card } from "@/ui/Screen";
import { Text } from "@/ui/Text";

export type WizardAccountActions = Readonly<{
  onSignOut: () => void;
  /** Прокрутить к секции удаления аккаунта внизу мастера. */
  onDelete: () => void;
}>;

/** Действие в виде текстовой кнопки (как `LinkButton`, но с ролью «кнопка»). */
function ActionButton({ label, onPress, testID }: { label: string; onPress: () => void; testID?: string }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} testID={testID} hitSlop={4} style={{ minHeight: MIN_TARGET, justifyContent: "center" }}>
      <Text variant="secondary" tone="accent" bold>
        {label}
      </Text>
    </Pressable>
  );
}

export function WizardHeader({ onSignIn, account }: { onSignIn?: () => void; account?: WizardAccountActions }) {
  const { profile, t, m } = useLang();
  const apply = t("apply");
  const deletion = t("accountDeletion");
  const [confirming, setConfirming] = useState(false);
  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", columnGap: 16 }} testID="wizard-header">
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 16, flexShrink: 1 }}>
          {account ? (
            <>
              <ActionButton label={profile.logout} onPress={() => setConfirming(true)} testID="wizard-sign-out" />
              <LinkButton label={deletion.action} onPress={account.onDelete} testID="wizard-delete-account" />
            </>
          ) : onSignIn ? (
            <LinkButton label={apply.loginLink} onPress={onSignIn} testID="wizard-login-link" />
          ) : null}
        </View>
        <LangSwitch />
      </View>
      {account && confirming ? (
        <Card>
          <View accessibilityRole="alert" style={{ gap: 12 }} testID="wizard-sign-out-confirm">
            <Text variant="heading">{m("wizard.signOutTitle")}</Text>
            <Text variant="secondary" tone="text2">
              {m("wizard.signOutNote")}
            </Text>
            <Button label={profile.logout} variant="dangerSolid" onPress={() => account.onSignOut()} testID="wizard-sign-out-yes" />
            <Button label={deletion.cancel} variant="ghost" onPress={() => setConfirming(false)} testID="wizard-sign-out-cancel" />
          </View>
        </Card>
      ) : null}
    </View>
  );
}
