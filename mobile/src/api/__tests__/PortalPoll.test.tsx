import { POLL_BASE_MS, REQUEST_TIMEOUT_MS, RESUME_MIN_GAP_MS } from "@web/lib/light-poll";
import { act, fireEvent, screen } from "@testing-library/react-native";
import { useEffect, useState } from "react";
import { AppState, Pressable, Text } from "react-native";

import { POLL_INTERVAL_MS, PortalPoll, usePortalPollFailure, usePortalUnread } from "@/api/PortalPoll";
import { TRANSPORT_TIMEOUT_MS } from "@/lib/supabase";
import { renderPortal, testApi } from "@/test-fixtures/render";
import { failure, fakeTransport } from "@/test-fixtures/universities";

let mockPath = "/messages";
jest.mock("expo-router", () => ({ usePathname: () => mockPath }));

const VERSION_1 = "0123456789abcdef0123456789abcdef";
const VERSION_2 = "fedcba9876543210fedcba9876543210";

function Badge() {
  const unread = usePortalUnread();
  const { failed, retry } = usePortalPollFailure();
  return (
    <>
      <Text testID="unread">{unread === null ? "none" : String(unread)}</Text>
      <Text testID="failed">{failed ? "failed" : "ok"}</Text>
      <Pressable testID="retry" onPress={retry} />
    </>
  );
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

  it("расписание и предел ожидания те же, что у веба", () => {
    expect(POLL_INTERVAL_MS).toBe(POLL_BASE_MS);
    expect(POLL_BASE_MS).toBe(60_000);
    expect(RESUME_MIN_GAP_MS).toBe(30_000);
    // предел ожидания ответа стоит в самом транспорте приложения (fetchWithTimeout), как REQUEST_TIMEOUT_MS у веба
    expect(TRANSPORT_TIMEOUT_MS).toBe(REQUEST_TIMEOUT_MS);
  });

  describe("сбои: задержка растёт, число сбрасывается, сбой виден, повтор опрашивает сразу", () => {
    const polls = (calls: { name: string }[]) => calls.filter((c) => c.name === "student_portal_poll_v1");

    it("120 с, потом 240 с, первый успех возвращает минуту; число и сбой следуют за опросами", async () => {
      let ok = true;
      const { transport, calls } = fakeTransport({ student_portal_poll_v1: () => (ok ? { access: true, unread: 4, version: VERSION_1 } : failure(null, 503)) });
      await renderPortal(<PortalPoll><Badge /></PortalPoll>, testApi(transport));
      await act(async () => {
        await jest.advanceTimersByTimeAsync(10);
      });
      expect(screen.getByTestId("unread").props.children).toBe("4");
      expect(screen.getByTestId("failed").props.children).toBe("ok");
      ok = false;
      await act(async () => {
        await jest.advanceTimersByTimeAsync(60_000); // опрос в минуту: сбой 1
      });
      expect(polls(calls)).toHaveLength(2);
      expect(screen.getByTestId("failed").props.children).toBe("failed");
      expect(screen.getByTestId("unread").props.children).toBe("none"); // как у веба: число сбрасывается
      await act(async () => {
        await jest.advanceTimersByTimeAsync(119_000);
      });
      expect(polls(calls)).toHaveLength(2); // после сбоя ждём 120 с
      await act(async () => {
        await jest.advanceTimersByTimeAsync(1_500); // сбой 2
      });
      expect(polls(calls)).toHaveLength(3);
      await act(async () => {
        await jest.advanceTimersByTimeAsync(239_000);
      });
      expect(polls(calls)).toHaveLength(3); // потом 240 с
      ok = true;
      await act(async () => {
        await jest.advanceTimersByTimeAsync(1_500); // успех
      });
      expect(polls(calls)).toHaveLength(4);
      expect(screen.getByTestId("failed").props.children).toBe("ok");
      expect(screen.getByTestId("unread").props.children).toBe("4");
      await act(async () => {
        await jest.advanceTimersByTimeAsync(60_500);
      });
      expect(polls(calls)).toHaveLength(5); // снова минута
    });

    it("«Повторить»: опрос сразу, сбой снимается первым успехом", async () => {
      let ok = false;
      const { transport, calls } = fakeTransport({ student_portal_poll_v1: () => (ok ? { access: true, unread: 2, version: VERSION_1 } : failure(null, 503)) });
      await renderPortal(<PortalPoll><Badge /></PortalPoll>, testApi(transport));
      await act(async () => {
        await jest.advanceTimersByTimeAsync(10);
      });
      expect(screen.getByTestId("failed").props.children).toBe("failed");
      ok = true;
      await fireEvent.press(screen.getByTestId("retry"));
      await act(async () => {
        await jest.advanceTimersByTimeAsync(10);
      });
      expect(polls(calls)).toHaveLength(2); // сразу, не через 120 с
      expect(screen.getByTestId("failed").props.children).toBe("ok");
      expect(screen.getByTestId("unread").props.children).toBe("2");
    });

    it("ответ «нет доступа» - такой же сбой, как отказ 403 у веба: число сброшено, карточка, задержка растёт; успех снимает", async () => {
      let mode: "ok" | "denied" = "ok";
      const { transport, calls } = fakeTransport({ student_portal_poll_v1: () => (mode === "ok" ? { access: true, unread: 4, version: VERSION_1 } : { access: false }) });
      await renderPortal(<PortalPoll><Badge /></PortalPoll>, testApi(transport));
      await act(async () => {
        await jest.advanceTimersByTimeAsync(10);
      });
      expect(screen.getByTestId("unread").props.children).toBe("4");
      mode = "denied";
      await act(async () => {
        await jest.advanceTimersByTimeAsync(60_000); // опрос в минуту: «нет доступа»
      });
      expect(polls(calls)).toHaveLength(2);
      expect(screen.getByTestId("failed").props.children).toBe("failed");
      expect(screen.getByTestId("unread").props.children).toBe("none");
      await act(async () => {
        await jest.advanceTimersByTimeAsync(119_000);
      });
      expect(polls(calls)).toHaveLength(2); // задержка выросла: 120 с, не 60
      await act(async () => {
        await jest.advanceTimersByTimeAsync(1_500);
      });
      expect(polls(calls)).toHaveLength(3);
      mode = "ok";
      await act(async () => {
        await jest.advanceTimersByTimeAsync(240_500); // и ещё вдвое
      });
      expect(polls(calls)).toHaveLength(4);
      expect(screen.getByTestId("failed").props.children).toBe("ok");
      expect(screen.getByTestId("unread").props.children).toBe("4");
    });

    it("«Повторить» без связи в счёт сбоев не идёт: задержка растёт только от опросов по расписанию", async () => {
      const { transport, calls } = fakeTransport({ student_portal_poll_v1: failure(null, 503) });
      await renderPortal(<PortalPoll><Badge /></PortalPoll>, testApi(transport));
      await act(async () => {
        await jest.advanceTimersByTimeAsync(10); // первый опрос по расписанию: сбой 1, дальше 120 с
      });
      expect(polls(calls)).toHaveLength(1);
      for (let i = 0; i < 3; i += 1) {
        await fireEvent.press(screen.getByTestId("retry")); // три нажатия «Повторить»: каждое падает
        await act(async () => {
          await jest.advanceTimersByTimeAsync(10);
        });
      }
      expect(polls(calls)).toHaveLength(4);
      await act(async () => {
        await jest.advanceTimersByTimeAsync(119_000);
      });
      expect(polls(calls)).toHaveLength(4); // 120 с от последнего нажатия
      await act(async () => {
        await jest.advanceTimersByTimeAsync(1_500);
      });
      expect(polls(calls)).toHaveLength(5); // а не через 8 минут, как было бы при счёте нажатий
    });
  });

  describe("фон и возврат: не чаще чем раз в 30 с", () => {
    // Слушателей состояния приложения несколько (опрос, провайдер чтений): сообщаем всем, как система.
    let listeners: ((status: string) => void)[] = [];
    beforeEach(() => {
      listeners = [];
      jest.spyOn(AppState, "addEventListener").mockImplementation(((_type: string, handler: (status: string) => void) => {
        listeners.push(handler);
        return { remove: () => undefined };
      }) as never);
    });
    afterEach(() => jest.restoreAllMocks());
    const move = async (status: "background" | "active") => {
      await act(async () => {
        for (const listener of listeners) listener(status);
        await jest.advanceTimersByTimeAsync(0);
      });
    };
    const count = (calls: { name: string }[]) => calls.filter((c) => c.name === "student_portal_poll_v1").length;

    it("вернулся быстрее чем через 30 с: сразу не опрашивает, обычный отсчёт идёт от возврата", async () => {
      const { transport, calls } = fakeTransport({ student_portal_poll_v1: { access: true, unread: 1, version: VERSION_1 } });
      await renderPortal(<PortalPoll><Badge /></PortalPoll>, testApi(transport));
      await act(async () => {
        await jest.advanceTimersByTimeAsync(10);
      });
      expect(count(calls)).toBe(1);
      await act(async () => {
        await jest.advanceTimersByTimeAsync(10_000);
      });
      await move("background");
      await act(async () => {
        await jest.advanceTimersByTimeAsync(5_000);
      });
      await move("active"); // с начала прошлого опроса прошло 15 с
      expect(count(calls)).toBe(1);
      await act(async () => {
        await jest.advanceTimersByTimeAsync(59_000);
      });
      expect(count(calls)).toBe(1);
      await act(async () => {
        await jest.advanceTimersByTimeAsync(1_500);
      });
      expect(count(calls)).toBe(2);
    });

    it("вернулся через 30 с и больше: опрашивает сразу; в фоне не опрашивает вовсе", async () => {
      const { transport, calls } = fakeTransport({ student_portal_poll_v1: { access: true, unread: 1, version: VERSION_1 } });
      await renderPortal(<PortalPoll><Badge /></PortalPoll>, testApi(transport));
      await act(async () => {
        await jest.advanceTimersByTimeAsync(10);
      });
      await move("background");
      await act(async () => {
        await jest.advanceTimersByTimeAsync(120_000);
      });
      expect(count(calls)).toBe(1); // в фоне ни одного опроса
      await move("active");
      expect(count(calls)).toBe(2); // прошло больше 30 с: сразу
    });
  });

  it("смена раздела опрашивает сразу и спрашивает уже новый раздел", async () => {
    const force = { current: () => undefined as void };
    function Harness() {
      const [, setTick] = useState(0);
      useEffect(() => {
        force.current = () => setTick((n) => n + 1);
      }, []);
      return <PortalPoll><Badge /></PortalPoll>;
    }
    const { transport, calls } = fakeTransport({ student_portal_poll_v1: { access: true, unread: 1, version: VERSION_1 } });
    mockPath = "/documents";
    await renderPortal(<Harness />, testApi(transport));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(10);
    });
    mockPath = "/payments";
    await act(async () => {
      force.current();
      await jest.advanceTimersByTimeAsync(10);
    });
    const sections = calls.filter((c) => c.name === "student_portal_poll_v1").map((c) => (c.args as { p_section: string }).p_section);
    expect(sections).toEqual(["documents", "payments"]);
    mockPath = "/messages";
  });
});
