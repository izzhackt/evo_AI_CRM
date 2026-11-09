import { act, screen } from "@testing-library/react-native";
import { Text } from "react-native";

import { PortalPoll, usePortalUnread } from "@/api/PortalPoll";
import { renderPortal, testApi } from "@/test-fixtures/render";
import { fakeTransport } from "@/test-fixtures/universities";

const mockPath = "/messages";
jest.mock("expo-router", () => ({ usePathname: () => mockPath }));

const VERSION_1 = "0123456789abcdef0123456789abcdef";
const VERSION_2 = "fedcba9876543210fedcba9876543210";

function Badge() {
  const unread = usePortalUnread();
  return <Text testID="unread">{unread === null ? "none" : String(unread)}</Text>;
}

describe("Опрос оболочки", () => {
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate", "queueMicrotask"] });
  });
  afterEach(() => jest.useRealTimers());

  it("опрашивает сразу и раз в 60 с, раздел по вкладке, значок из ответа", async () => {
    let unread = 2;
    const { transport, calls } = fakeTransport({ student_portal_poll_v1: () => ({ access: true, unread, version: VERSION_1 }) });
    await renderPortal(<PortalPoll><Badge /></PortalPoll>, testApi(transport));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(10);
    });
    const polls = () => calls.filter((c) => c.name === "student_portal_poll_v1");
    expect(polls()).toHaveLength(1);
    expect(polls()[0]).toMatchObject({ get: true, args: { p_section: "messages" } });
    expect(screen.getByTestId("unread").props.children).toBe("2");
    unread = 5;
    await act(async () => {
      await jest.advanceTimersByTimeAsync(59_000);
    });
    expect(polls()).toHaveLength(1);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(1_500);
    });
    expect(polls()).toHaveLength(2);
    expect(screen.getByTestId("unread").props.children).toBe("5");
  });

  it("approved: не опрашивает вовсе", async () => {
    const { transport, calls } = fakeTransport({ student_portal_poll_v1: { access: true, unread: 0, version: null } });
    await renderPortal(<PortalPoll><Badge /></PortalPoll>, testApi(transport, { tier: "approved" }));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(130_000);
    });
    expect(calls).toHaveLength(0);
  });

  it("смена версии перечитывает открытые экраны", async () => {
    let version = VERSION_1;
    const { transport } = fakeTransport({ student_portal_poll_v1: () => ({ access: true, unread: 1, version }) });
    const { client } = await renderPortal(<PortalPoll><Badge /></PortalPoll>, testApi(transport));
    const spy = jest.spyOn(client, "invalidateQueries");
    await act(async () => {
      await jest.advanceTimersByTimeAsync(10);
    });
    expect(spy).not.toHaveBeenCalled(); // первый ответ только запоминается
    version = VERSION_2;
    await act(async () => {
      await jest.advanceTimersByTimeAsync(60_500);
    });
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
