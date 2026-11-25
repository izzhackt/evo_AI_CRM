// Страница «Незавершённые отправки на этом устройстве»: все программы владельца, где отправка комплекта оборвалась.
// Веб: `src/app/(portal)/portal/package-recovery/page.tsx`. Над каждой программой подпись «вуз, программа, набор» из общего
// списка «Мои программы» (на сайте подписи нет; без неё при двух программах не понять, к какой относится запись).
import { View } from "react-native";

import { usePreparations } from "@/api/queries";
import { PackageOwnerRecovery, PackageRecovery } from "@/features/preparations/PackageRecovery";
import { PROGRAMS_LIST_ROUTE, selectedProgramOf } from "@/features/preparations/model";
import { usePackageStrings } from "@/features/preparations/package-strings";
import { goStamped } from "@/features/portal/navigation";
import { LinkButton } from "@/ui/CardParts";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";

/** Какая это программа. Список не прочитался или программы в нём нет: подписи нет, запись всё равно видна. */
function ScopeTitle({ applicationId }: { applicationId: string }) {
  const preparations = usePreparations();
  const saved = preparations.data?.find((item) => item.applicationId === applicationId) ?? null;
  if (!saved) return null;
  const { program, intake } = selectedProgramOf(saved);
  return (
    <View style={{ gap: 2 }} testID={`prep-recovery-program-${applicationId}`}>
      <Text variant="caption" tone="text2">
        {saved.content.name}
      </Text>
      <Text variant="body" bold accessibilityRole="header">
        {program?.title ?? saved.content.name}
      </Text>
      {intake ? (
        <Text variant="secondary" tone="text2">
          {intake.label}
        </Text>
      ) : null}
    </View>
  );
}

export function PackageRecoveryScreen() {
  const t = usePackageStrings();
  return (
    <Screen topInset={false} tabBar>
      <View style={{ gap: 16 }} testID="prep-recovery-screen">
        <LinkButton label={t.backPrograms} onPress={() => goStamped(PROGRAMS_LIST_ROUTE)} testID="prep-recovery-back" />
        <View style={{ gap: 6 }}>
          <Text variant="title" accessibilityRole="header" testID="prep-recovery-title">
            {t.pendingTitle}
          </Text>
          <Text variant="body" tone="text2">
            {t.pendingIntro}
          </Text>
        </View>
        <PackageOwnerRecovery showEmpty renderScope={(scope, onSaved) => (
            <View style={{ gap: 8 }}>
              <ScopeTitle applicationId={scope.applicationId} />
              <PackageRecovery scope={scope} onSaved={onSaved} historyLink />
            </View>
          )} />
      </View>
    </Screen>
  );
}
