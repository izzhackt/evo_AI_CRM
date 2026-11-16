import { fireEvent, render, screen } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { LangProvider } from "@/i18n/LangProvider";
import { ThemeProvider } from "@/theme/ThemeProvider";
import { Segmented } from "@/ui/Segmented";

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };

describe("Segmented: длинная подпись не раздувает сегмент", () => {
  it("сегменты делят ширину поровну (flexBasis 0, minWidth 0), выбор срабатывает", async () => {
    const onChange = jest.fn();
    await render(
      <SafeAreaProvider initialMetrics={metrics}>
        <ThemeProvider>
          <LangProvider initial="ru">
            <Segmented
              value="light"
              onChange={onChange}
              testIDPrefix="theme"
              options={[
                { value: "light", label: "Светлая" },
                { value: "dark", label: "Тёмная" },
                { value: "system", label: "Как в системе" },
              ]}
            />
          </LangProvider>
        </ThemeProvider>
      </SafeAreaProvider>,
    );
    const system = StyleSheet.flatten(screen.getByTestId("theme-system").props.style);
    expect(system.flexBasis).toBe(0);
    expect(system.flexGrow).toBe(1);
    expect(system.minWidth).toBe(0);
    fireEvent.press(screen.getByTestId("theme-system"));
    expect(onChange).toHaveBeenCalledWith("system");
  });
});
