// Нижний отступ страниц «Учёбы» (ревью QA 22): главная кнопка внизу страницы («Начать», «Продолжить» в тесте) пряталась под плавающей
// панелью вкладок, потому что у `StackPage` отступ был 48-66 pt, а `Screen` оставляет запас под панель. Теперь те же правила и те же хуки.
import { screen } from "@testing-library/react-native";
import { StyleSheet, Text } from "react-native";

import { RunnerPage } from "@/features/learning/tests/RunnerPage";
import { StackPage } from "@/features/learning/ui";
import { CHAT_FAB_CLEARANCE, TAB_BAR_CLEARANCE } from "@/shell/useTabBarClearance";
import { renderPortal, testApi } from "@/test-fixtures/render";
import { Screen } from "@/ui/Screen";
import { fakeTransport } from "@/test-fixtures/universities";
import type { AccessTier } from "@/session/access";

const INSET_BOTTOM = 34; // нижняя безопасная зона, которую `PortalShell` задаёт телефону
const bottomOf = (testID: string) => (StyleSheet.flatten(screen.getByTestId(testID).props.contentContainerStyle) as { paddingBottom: number }).paddingBottom;

async function render(ui: React.ReactElement, tier: AccessTier) {
  await renderPortal(ui, testApi(fakeTransport({}).transport, { tier }));
}

describe("нижний отступ страницы стека равен отступу `Screen` под панелью", () => {
  it("сопровождение (панель из трёх вкладок и кнопка «Написать EVO»): запас под обе", async () => {
    await render(<StackPage header={null} testID="stack">{null}</StackPage>, "assisted");
    expect(bottomOf("stack-scroll")).toBe(INSET_BOTTOM + TAB_BAR_CLEARANCE + CHAT_FAB_CLEARANCE);
  });

  it("то же число, что даёт `Screen` с панелью: страницы стека и корневые экраны не расходятся", async () => {
    await render(<Screen tabBar>{<Text>x</Text>}</Screen>, "assisted");
    const root = bottomOf("screen-scroll");
    await screen.unmount?.();
    await render(<StackPage header={null} testID="stack">{null}</StackPage>, "assisted");
    expect(bottomOf("stack-scroll")).toBe(root);
  });

  it("approved (одна вкладка, панели нет): запаса под неё нет, остаётся безопасная зона", async () => {
    await render(<StackPage header={null} testID="stack">{null}</StackPage>, "approved");
    expect(bottomOf("stack-scroll")).toBe(INSET_BOTTOM);
  });

  it("свой дополнительный запас (`bottomPad`) прибавляется сверху", async () => {
    await render(<StackPage header={null} testID="stack" bottomPad={32}>{null}</StackPage>, "assisted");
    expect(bottomOf("stack-scroll")).toBe(INSET_BOTTOM + 32 + TAB_BAR_CLEARANCE + CHAT_FAB_CLEARANCE);
  });

  it("страница прохождения теста (`RunnerPage`) оставляет тот же запас, что `StackPage`", async () => {
    await render(<RunnerPage header={null} testID="runner">{null}</RunnerPage>, "assisted");
    expect(bottomOf("runner-scroll")).toBe(INSET_BOTTOM + TAB_BAR_CLEARANCE + CHAT_FAB_CLEARANCE);
    await screen.unmount?.();
    await render(<RunnerPage header={null} testID="runner">{null}</RunnerPage>, "approved");
    expect(bottomOf("runner-scroll")).toBe(INSET_BOTTOM);
  });
});
