// Свайп назад и системная «назад» во время теста: уход перехватывается, жест закрыт, подтверждение
// досылает несохранённое и только потом закрывает экран.
import { readFileSync } from "node:fs";
import path from "node:path";

import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { Alert } from "react-native";

import { TestScreen } from "@/features/learning/test-runner/TestScreen";
import { renderPortal, testApi } from "@/test-fixtures/render";
import { fakeTransport } from "@/test-fixtures/universities";

const fx = (name: string) => JSON.parse(readFileSync(path.join(__dirname, "../../../test-fixtures/csca", `${name}.json`), "utf8"));

const mockPrevent = jest.fn();
const mockNav = { setOptions: jest.fn(), dispatch: jest.fn() };
jest.mock("expo-router", () => ({
  router: { navigate: jest.fn() },
  useRouter: () => ({ back: jest.fn(), canGoBack: () => true, navigate: jest.fn() }),
  useNavigation: () => mockNav,
  usePreventRemove: (...args: unknown[]) => mockPrevent(...args),
}));

const FORM = "1d2696aa-39b5-5b89-8f3e-e645a1b61dc2";

describe("тест на время: уход с экрана", () => {
  it("пока идёт тест: уход перехвачен, жест закрыт; подтверждение досылает ответы и закрывает экран", async () => {
    const start = fx("csca_test_start_diagnostic");
    const saved = { ...fx("csca_test_save"), attemptId: start.attemptId };
    const { transport, calls } = fakeTransport({
      learning_track_home_v1: fx("csca_home_fresh"),
      start_learning_test_v1: { ...start, serverNow: new Date().toISOString(), deadlineAt: new Date(Date.now() + 240_000).toISOString() },
      save_learning_test_v1: saved,
    });
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    const { unmount } = await renderPortal(<TestScreen formId={FORM} attemptId={null} />, testApi(transport));

    const begin = await screen.findByTestId("test-begin");
    // До начала теста уход свободен.
    const intro = mockPrevent.mock.calls[mockPrevent.mock.calls.length - 1];
    expect(intro[0]).toBe(false);

    fireEvent.press(begin);
    await screen.findByTestId("test-clock");
    const last = () => mockPrevent.mock.calls[mockPrevent.mock.calls.length - 1] as [boolean, (event: { data: { action: unknown } }) => void];
    expect(last()[0]).toBe(true);
    expect(mockNav.setOptions).toHaveBeenLastCalledWith({ gestureEnabled: false });

    // Выбор есть, но таймер сохранения (1,5 с) ещё не сработал.
    fireEvent.press(screen.getByTestId("option-b"));
    expect(calls.some((c) => c.name === "save_learning_test_v1")).toBe(false);

    // Свайп назад: событие уходит в подтверждение, действие не выполнено.
    const action = { type: "GO_BACK" };
    await act(async () => last()[1]({ data: { action } }));
    expect(alert).toHaveBeenCalledTimes(1);
    expect(mockNav.dispatch).not.toHaveBeenCalled();

    // «Выйти»: ответы досылаются, затем действие выполняется.
    const buttons = alert.mock.calls[0][2] as { text: string; style?: string; onPress?: () => void }[];
    const leave = buttons.find((b) => b.style === "destructive") as { onPress: () => void };
    await act(async () => leave.onPress());
    await waitFor(() => expect(mockNav.dispatch).toHaveBeenCalledWith(action));
    const save = calls.find((c) => c.name === "save_learning_test_v1");
    expect(save?.args?.p_answers).toBeDefined();
    expect(Object.values(save?.args?.p_answers as Record<string, string>)).toEqual(["b"]);
    alert.mockRestore();
    unmount();
    await new Promise((resolve) => setTimeout(resolve, 600)); // закрытие экрана досылает остаток «по возможности»
  });
});
