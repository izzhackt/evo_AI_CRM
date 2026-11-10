import { fireEvent, render, screen } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { LangProvider } from "@/i18n/LangProvider";
import { ThemeProvider } from "@/theme/ThemeProvider";
import { TextField } from "@/ui/TextField";

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const renderField = (ui: React.ReactElement, lang: "ru" | "ky" = "ru") =>
  render(
    <SafeAreaProvider initialMetrics={metrics}>
      <ThemeProvider>
        <LangProvider initial={lang}>{ui}</LangProvider>
      </ThemeProvider>
    </SafeAreaProvider>,
  );

describe("TextField: глаз у пароля", () => {
  it("секретное поле скрыто, кнопка переключает показ и сохраняет значение; подпись и состояние на кнопке", async () => {
    await renderField(<TextField label="Пароль" secure value="synthetic-password-1" onChangeText={() => undefined} testID="pw" />);
    expect(screen.getByTestId("pw").props.secureTextEntry).toBe(true);
    const toggle = screen.getByTestId("pw-toggle");
    expect(toggle.props.accessibilityLabel).toBe("Показать пароль");
    expect(toggle.props.accessibilityRole).toBe("button");
    expect(toggle.props.accessibilityState.selected).toBe(false);
    await fireEvent.press(toggle);
    expect(screen.getByTestId("pw").props.secureTextEntry).toBe(false);
    expect(screen.getByTestId("pw").props.value).toBe("synthetic-password-1");
    expect(screen.getByTestId("pw-toggle").props.accessibilityLabel).toBe("Скрыть пароль");
    expect(screen.getByTestId("pw-toggle").props.accessibilityState.selected).toBe(true);
    await fireEvent.press(screen.getByTestId("pw-toggle"));
    expect(screen.getByTestId("pw").props.secureTextEntry).toBe(true);
  });

  it("подписи по умолчанию на языке приложения (KY); явные подписи важнее", async () => {
    await renderField(<TextField label="Сырсөз" secure testID="pw" />, "ky");
    expect(screen.getByTestId("pw-toggle").props.accessibilityLabel).toBe("Сырсөздү көрсөтүү");
    await screen.unmount();
    await renderField(<TextField label="X" secure showLabel="Show" hideLabel="Hide" testID="pw" />);
    expect(screen.getByTestId("pw-toggle").props.accessibilityLabel).toBe("Show");
  });

  it("обычное поле без кнопки; кнопка 44×44 и выключена вместе с полем", async () => {
    await renderField(<TextField label="Логин" testID="login" />);
    expect(screen.queryByTestId("login-toggle")).toBeNull();
    await screen.unmount();
    await renderField(<TextField label="Пароль" secure editable={false} testID="pw" />);
    const toggle = screen.getByTestId("pw-toggle");
    expect(toggle.props.accessibilityState.disabled).toBe(true);
    const style = Object.assign({}, ...[toggle.props.style].flat(Infinity));
    expect(style.width).toBeGreaterThanOrEqual(44);
    expect(style.height).toBeGreaterThanOrEqual(44);
  });
});
