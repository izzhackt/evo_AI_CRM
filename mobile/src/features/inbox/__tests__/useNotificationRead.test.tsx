// «Прочитано» для ленты (хук): записи идут по очереди и останавливаются на первом сбое, итог уходит в общее хранилище сбоев,
// экран узнаёт о сбое через `onFailure` (то, что он хочет СЕЙЧАС), опрос оболочки подталкивается после каждой попытки
// (разбор ревью #1557, F2-F4).
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Pressable, Text } from "react-native";

import { resetReadFailuresForTests } from "@/features/inbox/read-failures";
import { useNotificationRead, type NotificationReadFailure } from "@/features/inbox/useNotificationRead";
import type { RpcTransport } from "@/lib/rpc";
import { PortalShell, renderPortal, testApi, testClient } from "@/test-fixtures/render";
import { failure, fakeTransport } from "@/test-fixtures/universities";

const mockPoke = jest.fn();
jest.mock("@/api/PortalPoll", () => ({ ...jest.requireActual("@/api/PortalPoll"), usePokePoll: () => mockPoke }));

const AUTH = "11111111-1111-4111-8111-111111111111";
const A = "66666666-6666-4666-8666-6666666666aa";
const B = "66666666-6666-4666-8666-6666666666bb";
const WRITE = "mark_own_student_portal_notification_read_v2";

beforeEach(() => mockPoke.mockClear());
afterEach(() => resetReadFailuresForTests());

type ProbeProps = Readonly<{ ids: readonly string[]; scope: NotificationReadFailure; onFailure?: (scope: NotificationReadFailure) => void }>;

function Probe({ ids, scope, onFailure }: ProbeProps) {
  const read = useNotificationRead({ onFailure });
  return (
    <>
      <Pressable testID="go" onPress={() => void read.markRead(ids.map((notificationId) => ({ notificationId })), scope)} />
      <Text testID="state">{`${[...read.failedIds].sort().join(",")}|${read.allFailed ? "all" : "-"}|${read.busy ? "busy" : "idle"}`}</Text>
    </>
  );
}
const state = () => screen.getByTestId("state").props.children as string;
const written = (calls: readonly { name: string; args?: Record<string, unknown> }[]) => calls.filter((c) => c.name === WRITE).map((c) => c.args!.p_notification_id);

describe("useNotificationRead", () => {
  it("записи идут по очереди и встают на первом сбое: остальные не пишутся, ставится общий признак", async () => {
    const { transport, calls } = fakeTransport({ [WRITE]: failure("42501", 403) });
    await renderPortal(<Probe ids={[A, B]} scope="all" />, testApi(transport, { userKey: AUTH }));
    await fireEvent.press(screen.getByTestId("go"));
    await waitFor(() => expect(state()).toBe("|all|idle"));
    expect(written(calls)).toEqual([A]);
  });

  it("частичный сбой одной области: записанное в сбои не попадает, не записанное попадает", async () => {
    const { transport } = fakeTransport({ [WRITE]: (args?: Record<string, unknown>) => (args?.p_notification_id === B ? failure("42501", 403) : {}) });
    const onFailure = jest.fn();
    await renderPortal(<Probe ids={[A, B]} scope="one" onFailure={onFailure} />, testApi(transport, { userKey: AUTH }));
    await fireEvent.press(screen.getByTestId("go"));
    await waitFor(() => expect(state()).toBe(`${B}|-|idle`));
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(onFailure).toHaveBeenCalledWith("one");
  });

  it("удача: экран о сбое не извещается, опрос оболочки подталкивается один раз, сбоев нет", async () => {
    const { transport } = fakeTransport({ [WRITE]: {} });
    const onFailure = jest.fn();
    await renderPortal(<Probe ids={[A]} scope="one" onFailure={onFailure} />, testApi(transport, { userKey: AUTH }));
    await fireEvent.press(screen.getByTestId("go"));
    await waitFor(() => expect(mockPoke).toHaveBeenCalledTimes(1));
    expect(state()).toBe("|-|idle");
    expect(onFailure).not.toHaveBeenCalled();
  });

  it("сбой: экран извещается областью, опрос подталкивается и после неудачи тоже", async () => {
    const { transport } = fakeTransport({ [WRITE]: failure("42501", 403) });
    const onFailure = jest.fn();
    await renderPortal(<Probe ids={[A, B]} scope="all" onFailure={onFailure} />, testApi(transport, { userKey: AUTH }));
    await fireEvent.press(screen.getByTestId("go"));
    await waitFor(() => expect(onFailure).toHaveBeenCalledWith("all"));
    expect(mockPoke).toHaveBeenCalledTimes(1);
  });

  it("о сбое извещается то, что экран хочет сейчас, а не то, что было при нажатии (экран мог уйти с виду)", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const base = fakeTransport({ [WRITE]: failure("42501", 403) });
    const transport: RpcTransport = async (name, args, options) => {
      await gate;
      return base.transport(name, args, options);
    };
    const api = testApi(transport, { userKey: AUTH });
    const client = testClient();
    const first = jest.fn();
    const second = jest.fn();
    const ui = (onFailure: () => void) => (
      <PortalShell api={api} client={client}>
        <Probe ids={[A]} scope="one" onFailure={onFailure} />
      </PortalShell>
    );
    const view = await render(ui(first));
    await fireEvent.press(screen.getByTestId("go"));
    await view.rerender(ui(second));
    release();
    await waitFor(() => expect(second).toHaveBeenCalledWith("one"));
    expect(first).not.toHaveBeenCalled();
  });
});
