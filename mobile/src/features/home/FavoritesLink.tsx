// Ссылка «Избранное» в каталоге университетов (веб UniversitySearch: `favorites={{ href: "/portal#list", label: favoritesLink }}`,
// кнопка с сердцем рядом с поиском): ведёт на «Главную» к списку «Вузы» - «Мой список» с лентой избранного и «Всё избранное».
import { Heart } from "lucide-react-native";
import { Pressable } from "react-native";

import { goStamped } from "@/features/portal/navigation";
import { useLang } from "@/i18n/LangProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { MIN_TARGET } from "@/ui/CardParts";
import { Text } from "@/ui/Text";

/** Куда ведёт ссылка: «Главная», вкладка «Вузы» (метка `at` добавляется при переходе: повторная ссылка срабатывает снова). */
export const FAVORITES_ROUTE = "/home?list=universities";

export function FavoritesLink() {
  const { t } = useLang();
  const { tokens } = useTheme();
  const label = t("universities").favoritesLink;
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={label}
      onPress={() => goStamped(FAVORITES_ROUTE)}
      testID="catalog-favorites-link"
      style={({ pressed }) => ({
        alignSelf: "flex-start",
        minHeight: MIN_TARGET,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingHorizontal: 14,
        borderRadius: tokens.radiusControl,
        borderWidth: 1,
        borderColor: tokens.line,
        backgroundColor: tokens.surface,
        opacity: pressed ? 0.8 : 1,
      })}
    >
      <Heart size={20} strokeWidth={1.5} color={tokens.text} />
      <Text variant="body" bold>
        {label}
      </Text>
    </Pressable>
  );
}
