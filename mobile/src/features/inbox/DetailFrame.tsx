// Рамка экранов решения во «Входящих» (ответ куратора, решение по документу, решение по комплекту): стрелка назад, заголовок
// и прокрутка. Экраны лежат в стеке «Входящих» (`app/(app)/messages/...`), поэтому «назад» возвращает в ленту «Что нового», а
// не на другую вкладку. Нижний запас: панель вкладок и кнопка «Написать EVO» (на этих экранах, как в вебе, она есть).
import { useRouter } from "expo-router";
import { ArrowLeft } from "lucide-react-native";
import type { ReactNode } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useChatFabClearance, useTabBarClearance } from "@/shell/useTabBarClearance";
import { useTheme } from "@/theme/ThemeProvider";
import { MIN_TARGET } from "@/ui/CardParts";
import { Text } from "@/ui/Text";

export function DetailFrame({ title, backLabel, children, testID }: { title: string; backLabel: string; children: ReactNode; testID: string }) {
  const { tokens } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const clearance = useTabBarClearance();
  const fabClearance = useChatFabClearance();
  const back = () => (router.canGoBack() ? router.back() : router.navigate("/messages/updates"));
  return (
    <View style={{ flex: 1, backgroundColor: tokens.bg }} testID={testID}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 4, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: tokens.line }}>
        <Pressable accessibilityRole="button" accessibilityLabel={backLabel} onPress={back} testID="detail-back" hitSlop={4} style={{ width: MIN_TARGET, height: MIN_TARGET, alignItems: "center", justifyContent: "center" }}>
          <ArrowLeft size={22} strokeWidth={1.75} color={tokens.text} />
        </Pressable>
        <Text variant="body" bold accessibilityRole="header" style={{ flex: 1 }} testID="detail-title">
          {title}
        </Text>
      </View>
      <ScrollView testID="detail-scroll" keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: Math.max(insets.bottom, 16) + clearance + fabClearance }}>
        {children}
      </ScrollView>
    </View>
  );
}
