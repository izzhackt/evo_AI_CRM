// Объявления для читалки: iOS - `announceForAccessibility`, Android - постоянная живая область с меняющимся текстом.
import { act, renderHook, screen } from "@testing-library/react-native";
import { AccessibilityInfo, Platform } from "react-native";

import { renderPortal, testApi } from "@/test-fixtures/render";
import { fakeTransport } from "@/test-fixtures/universities";
import { useAnnouncer } from "@/ui/useAnnouncer";

function Host({ onReady }: { onReady: (announce: ReturnType<typeof useAnnouncer>["announce"]) => void }) {
  const { announce, region } = useAnnouncer();
  onReady(announce);
  return region;
}

describe("useAnnouncer", () => {
  afterEach(() => jest.restoreAllMocks());

  it("iOS: текст уходит в `announceForAccessibility`, на экране ничего не появляется; пустой текст не объявляется", async () => {
    jest.replaceProperty(Platform, "OS", "ios");
    const announceForAccessibility = jest.spyOn(AccessibilityInfo, "announceForAccessibility");
    announceForAccessibility.mockClear();
    const { result } = await renderHook(() => useAnnouncer());
    expect(result.current.region).toBeNull();
    await act(async () => result.current.announce("Эви печатает…"));
    await act(async () => result.current.announce(""));
    expect(announceForAccessibility.mock.calls).toEqual([["Эви печатает…"]]);
  });

  it("Android: область есть всегда, как точка, и меняет текст; сбой - срочная, остальное - вежливая; повтор того же текста различим", async () => {
    jest.replaceProperty(Platform, "OS", "android");
    const announceForAccessibility = jest.spyOn(AccessibilityInfo, "announceForAccessibility");
    announceForAccessibility.mockClear();
    let announce: ReturnType<typeof useAnnouncer>["announce"] = () => undefined;
    await renderPortal(<Host onReady={(fn) => (announce = fn)} />, testApi(fakeTransport({}).transport));
    const region = screen.getByTestId("live-region");
    expect(region.props.accessibilityLiveRegion).toBe("polite");
    expect(region.props.importantForAccessibility).toBe("yes");
    expect(screen.getByTestId("live-region-text").props.children.join("")).toBe("​");
    await act(async () => announce("Привет"));
    const first = screen.getByTestId("live-region-text").props.children.join("");
    expect(first.replace("​", "")).toBe("Привет");
    await act(async () => announce("Привет"));
    const second = screen.getByTestId("live-region-text").props.children.join("");
    expect(second.replace("​", "")).toBe("Привет");
    expect(second).not.toBe(first);
    await act(async () => announce("Не получилось ответить", "assertive"));
    expect(screen.getByTestId("live-region").props.accessibilityLiveRegion).toBe("assertive");
    // Одна дорога на платформу: на Android системный вызов не используется.
    expect(announceForAccessibility).not.toHaveBeenCalled();
  });
});
