// Верх «Профессий» (веб: `ProfessionsEviHero.tsx` и `ProfessionsTestHero.tsx`, решение владельца 17.11.2026): вход в подбор с Эви
// вместо карточки теста интересов; тест остаётся в «Тестах», а Эви не отвечает (нет ключа на сервере) или студент отозвал согласие -
// прежняя карточка теста. Вкладки «Каталог | Подбор с Эви» из веба в приложении не нужны: Эви открывается отдельным экраном со стрелкой
// «назад» (нативная навигация), поэтому здесь только сам блок.
import { View } from "react-native";

import { formatPortalString } from "@web/lib/portal/i18n";

import { EviRobot } from "@/features/learning/evi/EviRobot";
import { testHeroView, type InterestTestState } from "@/features/learning/professions/model";
import type { PortalStrings } from "@/i18n";
import { useTheme } from "@/theme/ThemeProvider";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Screen";
import { Text } from "@/ui/Text";

type Strings = PortalStrings<"professions">;

/** «Тест интересов» / «Подбор с Эви» над названием блока: подпись капителью, цвет акцента, как `.pt-prof-hero-kicker`. */
function Kicker({ children }: { children: string }) {
  return (
    <Text variant="caption" tone="accent" bold style={{ textTransform: "uppercase", letterSpacing: 1.04 }}>
      {children}
    </Text>
  );
}

/** «Не знаешь, кем стать?», неподвижный робот и одна кнопка в Эви. */
export function EviHero({ strings, onOpen }: Readonly<{ strings: Strings; onOpen: () => void }>) {
  return (
    <Card>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
        <EviRobot face="happy" settled still size={56} testID="evi-hero-robot" />
        <View style={{ flex: 1, gap: 4 }}>
          <Kicker>{strings["tab.evi"]}</Kicker>
          <Text variant="heading" bold accessibilityRole="header">
            {strings.testTitle}
          </Text>
          <Text variant="secondary" tone="text2">
            {strings["evi.heroMeta"]}
          </Text>
        </View>
      </View>
      <Button label={strings["evi.heroAction"]} onPress={onOpen} testID="professions-evi-open" />
    </Card>
  );
}

/** Тот же вопрос, что у Эви, и тест интересов: сколько утверждений, прогресс начатого или «Тест пройден», одно действие по состоянию. */
export function TestHero({ strings, state, onOpen }: Readonly<{ strings: Strings; state: InterestTestState | null; onOpen: () => void }>) {
  const { tokens } = useTheme();
  const view = testHeroView(state);
  const label = view.action === "continue" ? strings.testContinue : view.action === "retake" ? strings.testRetake : strings.testStart;
  return (
    <Card>
      <View style={{ gap: 4 }}>
        <Kicker>{strings.testKicker}</Kicker>
        <Text variant="heading" bold accessibilityRole="header">
          {strings.testTitle}
        </Text>
        <Text variant="secondary" tone="text2">
          {formatPortalString(strings.testMeta, { count: String(view.total) })}
        </Text>
      </View>
      {view.answered !== null ? (
        <View style={{ gap: 8 }} testID="test-hero-progress">
          <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
            <Text variant="caption" tone="text2">
              {view.draft ? strings.testDraft : strings.testDone}
            </Text>
            <Text variant="caption" bold testID="test-hero-count">
              {formatPortalString(strings.testProgress, { answered: String(view.answered), total: String(view.total) })}
            </Text>
          </View>
          {/* Полоса - украшение (числа выше уже сказаны словами), как `<progress aria-hidden>` веба. */}
          <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ height: 4, borderRadius: 2, overflow: "hidden", backgroundColor: tokens.line }}>
            <View testID="test-hero-bar" style={{ height: 4, width: `${Math.round(Math.min(1, view.answered / view.total) * 100)}%`, backgroundColor: tokens.accent }} />
          </View>
        </View>
      ) : null}
      <Button variant={view.action === "retake" ? "ghost" : "primary"} label={label} onPress={onOpen} testID="professions-test-open" />
    </Card>
  );
}
