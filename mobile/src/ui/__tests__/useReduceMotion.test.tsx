// «Уменьшить движение» в системе: читается один раз при показе, смена настройки подхватывается на лету, подписка снимается.
import { act, renderHook } from "@testing-library/react-native";
import { AccessibilityInfo } from "react-native";

import { useReduceMotion } from "@/ui/useReduceMotion";

describe("useReduceMotion", () => {
  afterEach(() => jest.restoreAllMocks());

  it("до ответа системы движение разрешено; ответ «включено» его запрещает", async () => {
    let answer: (value: boolean) => void = () => undefined;
    jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockImplementation(() => new Promise<boolean>((resolve) => (answer = resolve)));
    const { result } = await renderHook(() => useReduceMotion());
    expect(result.current).toBe(false);
    await act(async () => answer(true));
    expect(result.current).toBe(true);
  });

  it("настройку меняют при открытом экране - хук это слышит; подписка снимается при уходе", async () => {
    jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(false);
    const remove = jest.fn();
    let listener: (on: boolean) => void = () => undefined;
    const subscribe = jest.spyOn(AccessibilityInfo, "addEventListener").mockImplementation(((name: string, handler: (on: boolean) => void) => {
      expect(name).toBe("reduceMotionChanged");
      listener = handler;
      return { remove };
    }) as never);
    // `addEventListener` у RN в Jest уже заглушка с общей историей вызовов: счёт начинается с нуля.
    subscribe.mockClear();
    const { result, unmount } = await renderHook(() => useReduceMotion());
    await act(async () => listener(true));
    expect(result.current).toBe(true);
    await act(async () => listener(false));
    expect(result.current).toBe(false);
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(remove).not.toHaveBeenCalled();
    await unmount();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("система не ответила ошибкой - движение остаётся разрешённым, исключения нет", async () => {
    jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockRejectedValue(new Error("no"));
    const { result } = await renderHook(() => useReduceMotion());
    await act(async () => undefined);
    expect(result.current).toBe(false);
  });
});
