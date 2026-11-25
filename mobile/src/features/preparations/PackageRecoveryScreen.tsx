// Страница «Незавершённые отправки на этом устройстве»: все программы владельца, где отправка комплекта оборвалась.
// Веб: `src/app/(portal)/portal/package-recovery/page.tsx`.
import { View } from "react-native";

import { PackageOwnerRecovery, PackageRecovery } from "@/features/preparations/PackageRecovery";
import { PROGRAMS_LIST_ROUTE } from "@/features/preparations/model";
import { usePackageStrings } from "@/features/preparations/package-strings";
import { goStamped } from "@/features/portal/navigation";
import { LinkButton } from "@/ui/CardParts";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";

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
        <PackageOwnerRecovery showEmpty renderScope={(scope, onSaved) => <PackageRecovery scope={scope} onSaved={onSaved} historyLink />} />
      </View>
    </Screen>
  );
}
