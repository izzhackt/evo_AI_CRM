import { useLang } from "@/i18n/LangProvider";
import { TAB_BAR_CLEARANCE } from "@/shell/TabBar";
import { SECTIONS, type SectionId } from "@/shell/sections";
import { Card, Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";

/**
 * Заглушка раздела: честно говорит, что он ещё не готов (без фальшивых данных).
 * Срез плана, который наполнит раздел, указан в `SECTIONS[].milestone`
 * (docs/mobile/PLAN.md); в коде каждого экрана стоит TODO(Mx).
 */
export function SectionPlaceholder({ id }: { id: SectionId }) {
  const { shell, m } = useLang();
  const section = SECTIONS.find((s) => s.id === id);
  if (!section) return null;
  return (
    <Screen topInset={false} bottomInset={TAB_BAR_CLEARANCE}>
      <Text variant="display" accessibilityRole="header" style={{ marginBottom: 16 }} testID={`title-${id}`}>
        {shell[section.navKey]}
      </Text>
      <Card>
        <Text variant="heading">{m("shell.soonTitle")}</Text>
        <Text variant="secondary" tone="text2">
          {m("shell.soonBody")}
        </Text>
      </Card>
    </Screen>
  );
}
