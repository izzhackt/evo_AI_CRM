// Ссылка на политику - отдельный фокусируемый элемент рядом с флажком, а не вложенный текст внутри него (G13 аудита паритета
// 25.11.2026; веб: ConsentGateForm.tsx и мастер анкеты). Какой звук получится на VoiceOver и TalkBack, покажет только устройство
// (U5 аудита); здесь проверено дерево доступности: что читалка видит и что нет.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { fireEvent, render, screen, within } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { Linking } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { PolicyCheckRow } from "@/features/consent/PolicyCheckRow";
import { ApplyScreen } from "@/features/registration/ApplyScreen";
import type { RegistrationApi } from "@/features/registration/registration-api";
import { LangProvider } from "@/i18n/LangProvider";
import { ThemeProvider } from "@/theme/ThemeProvider";
import { INVITE } from "@/test-fixtures/registration";
import { openAccountStep } from "@/test-fixtures/registration-wizard";

jest.mock("expo-router", () => ({ router: { replace: jest.fn(), navigate: jest.fn() }, useLocalSearchParams: jest.fn(() => ({})) }));
jest.mock("expo-secure-store", () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: "when-unlocked-this-device-only",
  setItemAsync: async () => undefined,
  getItemAsync: async () => null,
  deleteItemAsync: async () => undefined,
}));

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
async function renderPlain(ui: ReactElement, lang: "ru" | "ky" = "ru") {
  return render(
    <SafeAreaProvider initialMetrics={metrics}>
      <ThemeProvider>
        <LangProvider initial={lang}>{ui}</LangProvider>
      </ThemeProvider>
    </SafeAreaProvider>,
  );
}

const TEMPLATE = "Принимаю {policy}.";
const SENTENCE = "Принимаю политику конфиденциальности.";
const LINK = "политику конфиденциальности";

describe("PolicyCheckRow", () => {
  it("читалка видит два элемента: флажок с предложением целиком и отдельную ссылку; куски предложения ей не показываются", async () => {
    await renderPlain(<PolicyCheckRow checked={false} onToggle={() => undefined} template={TEMPLATE} linkLabel={LINK} onOpenLink={() => undefined} testID="box" linkTestID="link" />);
    const checkbox = screen.getByRole("checkbox", { name: SENTENCE });
    const link = screen.getByRole("link", { name: LINK });
    expect(checkbox).toBeTruthy();
    expect(link).toBeTruthy();
    // ссылка не вложена в флажок: фокус до неё доходит отдельно
    expect(within(checkbox).queryByRole("link")).toBeNull();
    // видимые куски предложения не читаются второй раз
    expect(screen.queryByText("Принимаю")).toBeNull();
    expect(screen.queryByText(".")).toBeNull();
    // а на экране они есть
    expect(screen.getByText("Принимаю ", { includeHiddenElements: true, exact: false })).toBeTruthy();
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });

  it("состояние флажка доходит до читалки", async () => {
    const view = await renderPlain(<PolicyCheckRow checked={false} onToggle={() => undefined} template={TEMPLATE} linkLabel={LINK} onOpenLink={() => undefined} testID="box" />);
    expect(screen.getByTestId("box").props.accessibilityState).toEqual({ checked: false });
    await view.unmount();
    await renderPlain(<PolicyCheckRow checked onToggle={() => undefined} template={TEMPLATE} linkLabel={LINK} onOpenLink={() => undefined} testID="box" />);
    expect(screen.getByTestId("box").props.accessibilityState).toEqual({ checked: true });
  });

  it("флажок и видимое предложение ставят галочку, ссылка открывает политику и галочку не трогает", async () => {
    const toggle = jest.fn();
    const open = jest.fn();
    await renderPlain(<PolicyCheckRow checked={false} onToggle={toggle} template={TEMPLATE} linkLabel={LINK} onOpenLink={open} testID="box" linkTestID="link" />);
    await fireEvent.press(screen.getByTestId("box"));
    expect(toggle).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByText("Принимаю ", { includeHiddenElements: true, exact: false }));
    expect(toggle).toHaveBeenCalledTimes(2);
    await fireEvent.press(screen.getByTestId("link"));
    expect(open).toHaveBeenCalledTimes(1);
    expect(toggle).toHaveBeenCalledTimes(2);
  });

  it("предложение без текста после ссылки или до неё не рисует пустых кусков", async () => {
    await renderPlain(<PolicyCheckRow checked={false} onToggle={() => undefined} template="{policy}" linkLabel={LINK} onOpenLink={() => undefined} />);
    expect(screen.getByRole("checkbox", { name: LINK })).toBeTruthy();
    expect(screen.getByRole("link", { name: LINK })).toBeTruthy();
  });
});

describe("в мастере анкеты", () => {
  const api: RegistrationApi = {
    register: async () => ({ ok: false, reason: "unavailable" }),
    resend: async () => ({ ok: false, reason: "unavailable" }),
    acceptInvite: async () => ({ ok: false }),
    checkInvite: async () => null,
  };

  it("ссылка на политику - отдельный элемент, открывает политику сайта и не ставит галочку", async () => {
    await AsyncStorage.clear();
    const open = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined as never);
    try {
      await renderPlain(<ApplyScreen api={api} inviteParam={INVITE} />);
      await openAccountStep();
      const checkbox = screen.getByTestId("consent");
      expect(checkbox.props.accessibilityState).toEqual({ checked: false });
      expect(checkbox.props.accessibilityLabel).toMatch(/Политику конфиденциальности/);
      expect(within(checkbox).queryByRole("link")).toBeNull();
      const link = screen.getByRole("link", { name: "Политику конфиденциальности" });
      await fireEvent.press(link);
      expect(open).toHaveBeenCalledTimes(1);
      expect(String(open.mock.calls[0][0])).toMatch(/^https:\/\/evoadmissions\.com\//);
      expect(screen.getByTestId("consent").props.accessibilityState).toEqual({ checked: false });
      await fireEvent.press(screen.getByTestId("consent"));
      expect(screen.getByTestId("consent").props.accessibilityState).toEqual({ checked: true });
      // вторая галочка (ИИ-помощники) осталась обычной строкой-флажком: ссылок две, политика и «Уже есть аккаунт? Войти» в шапке (#1554)
      expect(screen.getAllByRole("link").map((node) => node.props.accessibilityLabel).sort()).toEqual(["Политику конфиденциальности", "Уже есть аккаунт? Войти"].sort());
    } finally {
      open.mockRestore();
    }
  });
});
