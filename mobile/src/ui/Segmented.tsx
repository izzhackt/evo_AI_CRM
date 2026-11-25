import { Pressable, View } from "react-native";

import { useTheme } from "@/theme/ThemeProvider";
import { Text } from "@/ui/Text";

type Option<T extends string> = {
  value: T;
  label: string;
  /** Что читает читалка вместо видимой подписи («Мои программы, 3»). По умолчанию читается видимая подпись. */
  accessibilityLabel?: string;
  /** Подсказка читалки («Показывает список вузов»). */
  accessibilityHint?: string;
};

/**
 * Переключатель из 2-3 вариантов (`.pt-pill-tab`: высота 44, активный на поверхности).
 *
 * Доступность (аудит паритета 25.11.2026, G44) добавлена без изменения вида:
 * - `accessibilityLabel` - название группы («Вид списка», веб: `tabsLabel`, `viewAria`). Читалка читает его при входе
 *   в группу; если на устройстве iOS его не слышно, то же слово кладут в `accessibilityLabel` вариантов.
 * - `semantics`: `"radio"` (по умолчанию) - переключатель вида или языка, `radiogroup` + `radio` + состояние `checked`;
 *   `"tabs"` - вкладки раздела («Вузы | Мои программы»), `tablist` + `tab` + состояние `selected`, как `role=tablist`
 *   и `aria-selected` в вебе.
 * - у варианта свои `accessibilityLabel` и `accessibilityHint`.
 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  testIDPrefix,
  accessibilityLabel,
  semantics = "radio",
}: {
  value: T;
  options: readonly Option<T>[];
  onChange: (v: T) => void;
  testIDPrefix?: string;
  accessibilityLabel?: string;
  semantics?: "radio" | "tabs";
}) {
  const { tokens, scheme } = useTheme();
  const tabs = semantics === "tabs";
  return (
    <View
      accessibilityRole={tabs ? "tablist" : "radiogroup"}
      accessibilityLabel={accessibilityLabel}
      testID={testIDPrefix ? `${testIDPrefix}-group` : undefined}
      style={{ flexDirection: "row", backgroundColor: tokens.skeleton, borderRadius: tokens.radiusChip, padding: 3 }}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole={tabs ? "tab" : "radio"}
            accessibilityLabel={o.accessibilityLabel}
            accessibilityHint={o.accessibilityHint}
            accessibilityState={tabs ? { selected: active } : { checked: active }}
            onPress={() => onChange(o.value)}
            testID={testIDPrefix ? `${testIDPrefix}-${o.value}` : undefined}
            style={{ flexGrow: 1, flexBasis: 0, minWidth: 0, paddingHorizontal: 6, minHeight: 44, alignItems: "center", justifyContent: "center", borderRadius: tokens.radiusChip, backgroundColor: active ? tokens.surface : "transparent", boxShadow: active && scheme === "light" ? tokens.shadowCard : undefined }}
          >
            <Text variant="secondary" bold={active} tone={active ? "text" : "text2"} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={{ textAlign: "center" }}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
