// Лента чата не теряет сообщения, когда окно сервера сдвигается (разбор ревью #1566). Последняя страница сервера - окно в 30 сообщений,
// которое обновление заменяет целиком; «Показать более ранние» подгружает старые. Раньше сообщение, выпавшее из окна уже после этого,
// пропадало из ленты (дыра между старыми и новыми), хотя студент его видел. Веб копит ленту и такой дыры не знает.
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Pressable, Text } from "react-native";

import { useChatThread } from "@/features/inbox/useChatThread";
import type { RpcTransport } from "@/lib/rpc";
import { chatMessage, chatPage } from "@/test-fixtures/inbox";
import { PortalShell, renderPortal, testApi, testClient } from "@/test-fixtures/render";
import { fakeTransport } from "@/test-fixtures/universities";

jest.mock("expo-router", () => ({ usePathname: () => "/messages/chat" }));
jest.mock("@/features/inbox/visibility", () => ({ useScreenVisible: jest.fn(() => true) }));

const KEY = ["portal", "user-test", "chat"] as const;
const msg = (n: number) => chatMessage(`a0000000-0000-4000-8000-${String(n).padStart(12, "0")}`, String(n), false, `сообщение ${n}`);
/** Страница сервера: до `before` (не включая) или самые новые; не больше 30, новые первыми, как отдаёт RPC. */
function serverPage(total: number, before: number | null) {
  const top = before === null ? total : before - 1;
  const bottom = Math.max(1, top - 29);
  return chatPage(Array.from({ length: top - bottom + 1 }, (_, i) => msg(top - i)), { cursor: String(bottom), hasMore: bottom > 1 });
}
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

function Probe() {
  const thread = useChatThread();
  return (
    <>
      <Text testID="ids">{thread.messages.map((m) => m.sequenceId).join(",")}</Text>
      <Text testID="busy">{String(thread.earlierBusy)}</Text>
      <Pressable testID="earlier" onPress={() => void thread.loadEarlier()} />
    </>
  );
}
const ids = () => (screen.getByTestId("ids").props.children as string).split(",").filter(Boolean).map(Number);

/** `gate`: пока он не открыт, страницы «более ранние» (с курсором) не отвечают; последняя страница отвечает сразу. */
async function open(total: { value: number }, gate?: Promise<void>) {
  const inner = fakeTransport({
    portal_case_chat_page_v1: (args?: Record<string, unknown>) => serverPage(total.value, args?.p_before_sequence_id === undefined ? null : Number(args.p_before_sequence_id)),
    mark_own_case_chat_notifications_read_v1: null,
  });
  const transport: RpcTransport = async (name, args, options) => {
    if (gate && name === "portal_case_chat_page_v1" && (args as Record<string, unknown> | undefined)?.p_before_sequence_id !== undefined) await gate;
    return inner.transport(name, args, options);
  };
  return renderPortal(<Probe />, testApi(transport));
}
const refresh = (client: Awaited<ReturnType<typeof open>>["client"]) =>
  act(async () => {
    await client.refetchQueries({ queryKey: KEY });
  });

describe("лента чата накапливается", () => {
  it("70 сообщений: «Показать более ранние», затем приходит новое и окно уезжает - сообщение 41 остаётся, дыры нет", async () => {
    const total = { value: 70 };
    const { client } = await open(total);
    await waitFor(() => expect(ids()).toEqual(range(41, 70)));
    await fireEvent.press(screen.getByTestId("earlier"));
    await waitFor(() => expect(ids()).toEqual(range(11, 70)));
    total.value = 71; // окно теперь 42..71
    await refresh(client);
    await waitFor(() => expect(ids()).toEqual(range(11, 71)));
    await fireEvent.press(screen.getByTestId("earlier")); // окно рядом (пересекается): «ранние» продолжаются со своего курсора (до 11)
    await waitFor(() => expect(ids()).toEqual(range(1, 71)));
  });

  it("окно уехало дважды, а более ранние ещё не загружали: каждое виденное окно остаётся, подгрузка потом закрывает пропуск", async () => {
    const total = { value: 70 };
    const { client } = await open(total);
    await waitFor(() => expect(ids()).toEqual(range(41, 70)));
    total.value = 75; // окно 46..75: сообщения 41..45 в него уже не входят, а 71..75 видны только в нём
    await refresh(client);
    await waitFor(() => expect(ids()).toEqual(range(41, 75)));
    total.value = 110; // сразу далеко: окно 81..110; 76..80 студент не видел, 71..75 из прошлого окна не должны пропасть
    await refresh(client);
    await waitFor(() => expect(ids()).toEqual([...range(41, 75), ...range(81, 110)]));
    await fireEvent.press(screen.getByTestId("earlier"));
    await waitFor(() => expect(ids()).toEqual(range(41, 110))); // курсор окна 81: более ранние 51..80 закрывают пропуск, без повторов
  });

  it("окно прыгнуло далеко (между двумя чтениями больше 30 новых): «Показать более ранние» начинается от нового окна и закрывает пропуск", async () => {
    const total = { value: 70 };
    const { client } = await open(total);
    await waitFor(() => expect(ids()).toEqual(range(41, 70)));
    await fireEvent.press(screen.getByTestId("earlier"));
    await waitFor(() => expect(ids()).toEqual(range(11, 70)));
    total.value = 110; // окно 81..110 не пересекается с загруженным 11..70: пропуск 71..80
    await refresh(client);
    await waitFor(() => expect(ids()).toEqual([...range(11, 70), ...range(81, 110)]));
    await fireEvent.press(screen.getByTestId("earlier")); // от нового окна (курсор 81), а не от прежнего (11)
    await waitFor(() => expect(ids()).toEqual(range(11, 110)));
  });

  it("запрос «Показать более ранние», начатый до прыжка окна, курсор назад не возвращает: пропуск всё равно закрывается", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const total = { value: 70 };
    const { client } = await open(total, gate);
    await waitFor(() => expect(ids()).toEqual(range(41, 70)));
    await fireEvent.press(screen.getByTestId("earlier")); // запрос ушёл и ждёт
    total.value = 110; // пока он ждёт, окно прыгнуло
    await refresh(client);
    await waitFor(() => expect(ids()).toEqual([...range(41, 70), ...range(81, 110)]));
    await act(async () => {
      release();
    });
    await waitFor(() => expect(ids()).toEqual([...range(11, 70), ...range(81, 110)])); // ответ на старый запрос влился
    await waitFor(() => expect(screen.getByTestId("busy").props.children).toBe("false"));
    await fireEvent.press(screen.getByTestId("earlier")); // дальше всё равно от нового окна
    await waitFor(() => expect(ids()).toEqual(range(11, 110)));
  });

  it("300 опросов подряд: загруженное накапливается без дублей - каждое сообщение один раз", async () => {
    const total = { value: 30 };
    const { client } = await open(total);
    await waitFor(() => expect(ids()).toEqual(range(1, 30)));
    for (let n = 31; n <= 330; n += 1) {
      total.value = n;
      await refresh(client);
    }
    await waitFor(() => expect(ids()).toEqual(range(1, 330)));
    expect(new Set(ids()).size).toBe(330);
  }, 60_000);

  it("беседу открыли с уже готовой страницей в кэше («Входящие» читали её раньше): и она не пропадает, когда окно уедет", async () => {
    const total = { value: 70 };
    const { transport } = fakeTransport({
      portal_case_chat_page_v1: (args?: Record<string, unknown>) => serverPage(total.value, args?.p_before_sequence_id === undefined ? null : Number(args.p_before_sequence_id)),
      mark_own_case_chat_notifications_read_v1: null,
    });
    const client = testClient();
    client.setQueryData(KEY, serverPage(70, null)); // свежая страница: при открытии её не перечитывают
    await render(
      <PortalShell api={testApi(transport)} client={client}>
        <Probe />
      </PortalShell>,
    );
    expect(ids()).toEqual(range(41, 70));
    total.value = 110;
    await refresh(client);
    await waitFor(() => expect(ids()).toEqual([...range(41, 70), ...range(81, 110)]));
  });

  it("опрос с теми же сообщениями ничего не меняет", async () => {
    const total = { value: 40 };
    const { client } = await open(total);
    await waitFor(() => expect(ids()).toEqual(range(11, 40)));
    await refresh(client);
    await refresh(client);
    expect(ids()).toEqual(range(11, 40));
  });
});
