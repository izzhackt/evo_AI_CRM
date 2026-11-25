import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { AccessibilityInfo } from "react-native";

import { ChatScreen, buildEntries } from "@/features/inbox/ChatScreen";
import { useScreenVisible } from "@/features/inbox/visibility";
import { RpcError, type RpcTransport } from "@/lib/rpc";
import { MSG_A, MSG_B, POST_RECEIPT, chatMessage, chatPage } from "@/test-fixtures/inbox";
import { renderPortal, testApi } from "@/test-fixtures/render";
import { failure, fakeTransport } from "@/test-fixtures/universities";

jest.mock("expo-router", () => ({ router: { navigate: jest.fn() }, useRouter: () => ({ back: jest.fn(), canGoBack: () => true, navigate: jest.fn() }), usePathname: () => "/messages/chat" }));
jest.mock("@/features/inbox/visibility", () => ({ useScreenVisible: jest.fn(() => true) }));
const visible = useScreenVisible as jest.Mock;

const PAGE = chatPage([chatMessage(MSG_B, "12", false, "Принесите оригинал паспорта", "2026-09-07T08:30:00+00:00"), chatMessage(MSG_A, "11", true, "Здравствуйте", "2026-09-07T08:00:00+00:00")]);
const NEWER = chatPage([chatMessage("a0000000-0000-4000-8000-000000000009", "13", false, "Новое от команды", "2026-09-07T09:00:00+00:00"), ...PAGE.messages]);

const queued = AccessibilityInfo.announceForAccessibilityWithOptions as unknown as jest.Mock;
beforeEach(() => {
  visible.mockReturnValue(true);
  queued.mockClear();
});

describe("Чат: чтение", () => {
  it("лента: сообщения по возрастанию, имя входящего, время по Бишкеку", async () => {
    const { transport, calls } = fakeTransport({ portal_case_chat_page_v1: PAGE, mark_own_case_chat_notifications_read_v1: null });
    await renderPortal(<ChatScreen />, testApi(transport));
    expect(await screen.findByText("Принесите оригинал паспорта")).toBeTruthy();
    expect(screen.getByText("Здравствуйте")).toBeTruthy();
    expect(screen.getAllByText("Команда EVO").length).toBeGreaterThanOrEqual(2); // заголовок и имя автора
    expect(screen.getByText("14:30")).toBeTruthy(); // 08:30 UTC = 14:30 Бишкек
    // первая страница: GET без аргумента (null превратился бы в текст "null")
    expect(calls[0]).toMatchObject({ name: "portal_case_chat_page_v1", get: true });
    expect(calls[0]!.args).toEqual({});
  });

  it("«команда ждёт ответа»", async () => {
    const waiting = fakeTransport({ portal_case_chat_page_v1: { ...PAGE, awaitState: "awaiting_student" }, mark_own_case_chat_notifications_read_v1: null });
    await renderPortal(<ChatScreen />, testApi(waiting.transport));
    expect(await screen.findByTestId("chat-awaiting")).toBeTruthy();
  });

  it("пустой чат: объяснение", async () => {
    const empty = fakeTransport({ portal_case_chat_page_v1: chatPage([]) });
    await renderPortal(<ChatScreen />, testApi(empty.transport));
    expect(await screen.findByText("Сообщений пока нет")).toBeTruthy();
  });

  it("сбой чтения: плашка с повтором, текст сервера не показывается", async () => {
    const { transport } = fakeTransport({ portal_case_chat_page_v1: failure(null, 503) });
    await renderPortal(<ChatScreen />, testApi(transport));
    expect(await screen.findByTestId("chat-error")).toBeTruthy();
  });

  it("разделитель дня: «Сегодня» для сегодняшнего", () => {
    const now = "2026-09-07T10:00:00+00:00";
    const entries = buildEntries(
      [chatMessage(MSG_A, "11", true, "a", "2026-09-06T08:00:00+00:00"), chatMessage(MSG_B, "12", false, "b", "2026-09-07T08:00:00+00:00")].map((m) => m),
      [],
      "ru",
      "Сегодня",
      now,
    );
    expect(entries.filter((e) => e.kind === "day").map((e) => (e as { label: string }).label)).toEqual(["6 сентября", "Сегодня"]);
  });
});

describe("Чат: «прочитано»", () => {
  it("видимый чат отмечает самое новое сообщение один раз", async () => {
    const { transport, calls } = fakeTransport({ portal_case_chat_page_v1: PAGE, mark_own_case_chat_notifications_read_v1: null });
    await renderPortal(<ChatScreen />, testApi(transport));
    await screen.findByText("Здравствуйте");
    await waitFor(() => expect(calls.filter((c) => c.name === "mark_own_case_chat_notifications_read_v1")).toHaveLength(1));
    const mark = calls.find((c) => c.name === "mark_own_case_chat_notifications_read_v1")!;
    expect(mark.args).toEqual({ p_up_to_sequence_id: "12" });
    expect(mark.get).toBe(false);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(calls.filter((c) => c.name === "mark_own_case_chat_notifications_read_v1")).toHaveLength(1);
  });

  it("невидимый чат (другая вкладка или фон) не отмечает ничего", async () => {
    visible.mockReturnValue(false);
    const { transport, calls } = fakeTransport({ portal_case_chat_page_v1: PAGE, mark_own_case_chat_notifications_read_v1: null });
    await renderPortal(<ChatScreen />, testApi(transport));
    await screen.findByText("Здравствуйте");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(calls.some((c) => c.name === "mark_own_case_chat_notifications_read_v1")).toBe(false);
  });
});

describe("Чат: отправка", () => {
  it("успех: тело без пробелов, один p_request_id, квитанция, лента перечитывается", async () => {
    let page = PAGE;
    const { transport, calls } = fakeTransport({
      portal_case_chat_page_v1: () => page,
      mark_own_case_chat_notifications_read_v1: null,
      portal_case_chat_post_v1: (args: Record<string, unknown> | undefined) => {
        page = NEWER;
        return POST_RECEIPT(String(args?.p_request_id), "13");
      },
    });
    await renderPortal(<ChatScreen />, testApi(transport));
    await screen.findByText("Здравствуйте");
    await fireEvent.changeText(screen.getByTestId("chat-input"), "  Привет, вот скан  ");
    await fireEvent.press(screen.getByTestId("chat-send"));
    await screen.findByText("Новое от команды");
    const posts = calls.filter((c) => c.name === "portal_case_chat_post_v1");
    expect(posts).toHaveLength(1);
    expect(posts[0]!.args).toMatchObject({ p_body: "Привет, вот скан" });
    expect(String(posts[0]!.args!.p_request_id)).toMatch(/^[0-9a-f-]{36}$/);
    expect(posts[0]!.get).toBe(false);
    await waitFor(() => expect(screen.queryByTestId("outbox-sending")).toBeNull());
    expect(screen.getByTestId("chat-input").props.value).toBe("");
  });

  it("пустой текст не отправляется, кнопка отключена", async () => {
    const { transport, calls } = fakeTransport({ portal_case_chat_page_v1: PAGE, mark_own_case_chat_notifications_read_v1: null });
    await renderPortal(<ChatScreen />, testApi(transport));
    await screen.findByText("Здравствуйте");
    await fireEvent.changeText(screen.getByTestId("chat-input"), "   ");
    expect(screen.getByTestId("chat-send").props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.press(screen.getByTestId("chat-send"));
    expect(calls.some((c) => c.name === "portal_case_chat_post_v1")).toBe(false);
  });

  it("обрыв: сообщение остаётся «Не отправлено», повтор шлёт ТОТ ЖЕ id и текст (без дубля)", async () => {
    let attempt = 0;
    let page = PAGE;
    const { transport, calls } = fakeTransport({
      portal_case_chat_page_v1: () => page,
      mark_own_case_chat_notifications_read_v1: null,
      portal_case_chat_post_v1: (args: Record<string, unknown> | undefined) => {
        attempt += 1;
        if (attempt <= 3) return new RpcError("transport"); // rpcWrite повторит дважды сам, затем сдастся
        page = NEWER;
        return POST_RECEIPT(String(args?.p_request_id), "13");
      },
    });
    await renderPortal(<ChatScreen />, testApi(transport));
    await screen.findByText("Здравствуйте");
    await fireEvent.changeText(screen.getByTestId("chat-input"), "Не уходит");
    await fireEvent.press(screen.getByTestId("chat-send"));
    expect(await screen.findByTestId("outbox-failed")).toBeTruthy();
    expect(screen.getByText("Не уходит")).toBeTruthy();
    expect(screen.getByTestId("chat-send-error")).toBeTruthy();
    const first = calls.filter((c) => c.name === "portal_case_chat_post_v1");
    expect(first).toHaveLength(3);
    expect(new Set(first.map((c) => c.args!.p_request_id)).size).toBe(1);

    await fireEvent.press(screen.getByTestId("chat-retry"));
    await screen.findByText("Новое от команды");
    const all = calls.filter((c) => c.name === "portal_case_chat_post_v1");
    expect(all).toHaveLength(4);
    expect(new Set(all.map((c) => c.args!.p_request_id)).size).toBe(1);
    expect(new Set(all.map((c) => c.args!.p_body))).toEqual(new Set(["Не уходит"]));
    await waitFor(() => expect(screen.queryByTestId("outbox-failed")).toBeNull());
  });

  it("отказ сервера: ошибка из словаря, «Удалить» убирает сообщение из очереди", async () => {
    const { transport } = fakeTransport({
      portal_case_chat_page_v1: PAGE,
      mark_own_case_chat_notifications_read_v1: null,
      portal_case_chat_post_v1: failure("42501", 403),
    });
    await renderPortal(<ChatScreen />, testApi(transport));
    await screen.findByText("Здравствуйте");
    await fireEvent.changeText(screen.getByTestId("chat-input"), "Нельзя");
    await fireEvent.press(screen.getByTestId("chat-send"));
    expect(await screen.findByTestId("outbox-failed")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("chat-discard"));
    expect(screen.queryByTestId("outbox-failed")).toBeNull();
  });
});

describe("Чат: опрос раз в 30 с", () => {
  it("видимый чат перечитывает страницу каждые 30 с и подхватывает новое", async () => {
    jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate", "queueMicrotask"] });
    try {
      let page = PAGE;
      const { transport, calls } = fakeTransport({ portal_case_chat_page_v1: () => page, mark_own_case_chat_notifications_read_v1: null });
      await renderPortal(<ChatScreen />, testApi(transport));
      await screen.findByText("Здравствуйте");
      const reads = () => calls.filter((c) => c.name === "portal_case_chat_page_v1").length;
      expect(reads()).toBe(1);
      page = NEWER;
      await act(async () => {
        await jest.advanceTimersByTimeAsync(29_000);
      });
      expect(reads()).toBe(1);
      await act(async () => {
        await jest.advanceTimersByTimeAsync(1_500);
      });
      expect(reads()).toBe(2);
      expect(await screen.findByText("Новое от команды")).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });

  it("невидимый чат не опрашивается", async () => {
    visible.mockReturnValue(false);
    jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate", "queueMicrotask"] });
    try {
      const { transport, calls } = fakeTransport({ portal_case_chat_page_v1: PAGE });
      await renderPortal(<ChatScreen />, testApi(transport));
      await screen.findByText("Здравствуйте");
      await act(async () => {
        await jest.advanceTimersByTimeAsync(120_000);
      });
      expect(calls.filter((c) => c.name === "portal_case_chat_page_v1")).toHaveLength(1);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("Чат: статусы и читалка (веб MessagesThread, PORT-6a)", () => {
  /** Транспорт, который держит каждую отправку, пока тест не отпустит её: видно промежуточное «Отправляем…». */
  function gatedTransport(handlers: Record<string, unknown>) {
    const inner = fakeTransport(handlers);
    const waiting: (() => void)[] = [];
    const transport: RpcTransport = async (name, args, options) => {
      if (name === "portal_case_chat_post_v1") await new Promise<void>((resolve) => waiting.push(resolve));
      return inner.transport(name, args, options);
    };
    return { transport, calls: inner.calls, release: () => waiting.shift()?.() };
  }

  it("лента названа для читалки («Переписка по делу»)", async () => {
    const { transport } = fakeTransport({ portal_case_chat_page_v1: PAGE, mark_own_case_chat_notifications_read_v1: null });
    await renderPortal(<ChatScreen />, testApi(transport));
    await screen.findByText("Здравствуйте");
    expect(screen.getByTestId("chat-list").props.accessibilityLabel).toBe("Переписка по делу");
  });

  it("отправка: «Отправляем…» под полем, затем «Сообщение отправлено.» и одно сообщение читалке в очередь; новая отправка снимает статус", async () => {
    let page = PAGE;
    const { transport, release } = gatedTransport({
      portal_case_chat_page_v1: () => page,
      mark_own_case_chat_notifications_read_v1: null,
      portal_case_chat_post_v1: (args: Record<string, unknown> | undefined) => {
        page = NEWER;
        return POST_RECEIPT(String(args?.p_request_id), "13");
      },
    });
    await renderPortal(<ChatScreen />, testApi(transport));
    await screen.findByText("Здравствуйте");
    expect(screen.queryByTestId("chat-send-status")).toBeNull(); // до отправки статуса нет
    await fireEvent.changeText(screen.getByTestId("chat-input"), "Вот скан");
    await fireEvent.press(screen.getByTestId("chat-send"));
    await waitFor(() => expect(screen.getByTestId("chat-send-status")).toHaveTextContent("Отправляем…"));
    expect(queued).not.toHaveBeenCalledWith("Сообщение отправлено.", expect.anything());
    await act(async () => {
      release();
    });
    await waitFor(() => expect(screen.getByTestId("chat-send-status")).toHaveTextContent("Сообщение отправлено."));
    expect(queued.mock.calls.filter(([text]) => text === "Сообщение отправлено.")).toEqual([["Сообщение отправлено.", { queue: true }]]);
    // следующая отправка снимает «отправлено»: пока идёт, снова «Отправляем…» (повтор того же сообщения читалке в пределах
    // 800 мс склеивает сам `announce`, его договор проверен в ui/__tests__/a11y.test.ts)
    await fireEvent.changeText(screen.getByTestId("chat-input"), "Ещё одно");
    await fireEvent.press(screen.getByTestId("chat-send"));
    await waitFor(() => expect(screen.getByTestId("chat-send-status")).toHaveTextContent("Отправляем…"));
    expect(screen.getByTestId("chat-send-status")).not.toHaveTextContent("Сообщение отправлено.");
    await act(async () => {
      release();
    });
    await waitFor(() => expect(screen.getByTestId("chat-send-status")).toHaveTextContent("Сообщение отправлено."));
  });

  it("после удачной отправки неудачная следующая не оставляет «Сообщение отправлено.»", async () => {
    let page = PAGE;
    const { transport } = fakeTransport({
      portal_case_chat_page_v1: () => page,
      mark_own_case_chat_notifications_read_v1: null,
      portal_case_chat_post_v1: (args: Record<string, unknown> | undefined, count: number) => {
        if (count > 1) return failure("42501", 403);
        page = NEWER;
        return POST_RECEIPT(String(args?.p_request_id), "13");
      },
    });
    await renderPortal(<ChatScreen />, testApi(transport));
    await screen.findByText("Здравствуйте");
    await fireEvent.changeText(screen.getByTestId("chat-input"), "Первое");
    await fireEvent.press(screen.getByTestId("chat-send"));
    await waitFor(() => expect(screen.getByTestId("chat-send-status")).toHaveTextContent("Сообщение отправлено."));
    await fireEvent.changeText(screen.getByTestId("chat-input"), "Второе");
    await fireEvent.press(screen.getByTestId("chat-send"));
    expect(await screen.findByTestId("chat-send-error")).toBeTruthy();
    expect(screen.queryByTestId("chat-send-status")).toBeNull();
  });

  it("отправка не удалась: статуса «отправлено» нет, ошибка как была", async () => {
    const { transport } = fakeTransport({
      portal_case_chat_page_v1: PAGE,
      mark_own_case_chat_notifications_read_v1: null,
      portal_case_chat_post_v1: failure("42501", 403),
    });
    await renderPortal(<ChatScreen />, testApi(transport));
    await screen.findByText("Здравствуйте");
    await fireEvent.changeText(screen.getByTestId("chat-input"), "Нельзя");
    await fireEvent.press(screen.getByTestId("chat-send"));
    expect(await screen.findByTestId("chat-send-error")).toBeTruthy();
    expect(screen.queryByText("Сообщение отправлено.")).toBeNull();
    expect(queued).not.toHaveBeenCalled();
  });

  it("кыргызский язык: статусы из общего словаря", async () => {
    let page = PAGE;
    const { transport } = fakeTransport({
      portal_case_chat_page_v1: () => page,
      mark_own_case_chat_notifications_read_v1: null,
      portal_case_chat_post_v1: (args: Record<string, unknown> | undefined) => {
        page = NEWER;
        return POST_RECEIPT(String(args?.p_request_id), "13");
      },
    });
    await renderPortal(<ChatScreen />, testApi(transport), "ky");
    await screen.findByText("Здравствуйте");
    await fireEvent.changeText(screen.getByTestId("chat-input"), "Салам");
    await fireEvent.press(screen.getByTestId("chat-send"));
    await waitFor(() => expect(screen.getByTestId("chat-send-status")).toHaveTextContent("Билдирүү жөнөтүлдү."));
    expect(screen.getByTestId("chat-list").props.accessibilityLabel).toBe("Иш боюнча кат алышуу");
  });

  describe("обновление ленты опросом раз в 30 с", () => {
    beforeEach(() => jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate", "queueMicrotask"] }));
    afterEach(() => jest.useRealTimers());

    it("новое сообщение команды объявляется один раз, в очередь, с именем автора; первый показ не объявляется", async () => {
      let page = PAGE;
      const { transport } = fakeTransport({ portal_case_chat_page_v1: () => page, mark_own_case_chat_notifications_read_v1: null });
      await renderPortal(<ChatScreen />, testApi(transport));
      await screen.findByText("Здравствуйте");
      expect(queued).not.toHaveBeenCalled();
      page = NEWER;
      await act(async () => {
        await jest.advanceTimersByTimeAsync(30_500);
      });
      expect(await screen.findByText("Новое от команды")).toBeTruthy();
      expect(queued.mock.calls.filter(([text]) => String(text).startsWith("Новое сообщение от"))).toEqual([["Новое сообщение от Команда EVO.", { queue: true }]]);
      // следующий опрос с тем же содержимым ничего не объявляет
      await act(async () => {
        await jest.advanceTimersByTimeAsync(30_500);
      });
      expect(queued.mock.calls.filter(([text]) => String(text).startsWith("Новое сообщение от"))).toHaveLength(1);
    });

    it("своё новое сообщение из обновления не объявляется", async () => {
      let page = PAGE;
      const own = chatPage([chatMessage("a0000000-0000-4000-8000-000000000008", "13", true, "Моё новое", "2026-09-07T09:00:00+00:00"), ...PAGE.messages]);
      const { transport } = fakeTransport({ portal_case_chat_page_v1: () => page, mark_own_case_chat_notifications_read_v1: null });
      await renderPortal(<ChatScreen />, testApi(transport));
      await screen.findByText("Здравствуйте");
      page = own;
      await act(async () => {
        await jest.advanceTimersByTimeAsync(30_500);
      });
      expect(await screen.findByText("Моё новое")).toBeTruthy();
      expect(queued).not.toHaveBeenCalled();
    });

    it("сбой обновления: «Не удалось обновить переписку.» и «Повторить»; лента остаётся; повтор читает снова", async () => {
      let reads = 0;
      const { transport } = fakeTransport({
        portal_case_chat_page_v1: () => (++reads === 2 ? failure(null, 503) : PAGE),
        mark_own_case_chat_notifications_read_v1: null,
      });
      await renderPortal(<ChatScreen />, testApi(transport));
      await screen.findByText("Здравствуйте");
      await act(async () => {
        await jest.advanceTimersByTimeAsync(30_500);
      });
      expect(await screen.findByText("Не удалось обновить переписку.")).toBeTruthy();
      expect(screen.getByText("Здравствуйте")).toBeTruthy(); // прежняя лента на месте
      await fireEvent.press(screen.getByText("Повторить"));
      await waitFor(() => expect(screen.queryByText("Не удалось обновить переписку.")).toBeNull());
    });
  });
});
