// Защита ухода с теста на настоящем стеке expo-router 58 (JS-часть навигации, без симулятора): `usePreventRemove`, `repeat`,
// `useNavigation`, фокус экрана. Экран-заглушка вызывает `useLeaveGuard` так же, как `AssessmentFlow`. Моки expo-router в
// `assessment-screen.test.tsx` проверяют, что хук позвал `repeat`; здесь проверяется, что стек после этого и вправду закрылся (ревью #1559).
import { Stack, router } from "expo-router";
import { act, renderRouter, screen, waitFor } from "expo-router/testing-library";
import { useEffect, useState } from "react";
import { BackHandler, Text } from "react-native";

import { normalizeAssessmentAttempt } from "@/features/learning/tests/assessment-decode";
import { ASSESSMENT_RETRY_MS, ASSESSMENT_SAVE_MS, AssessmentSession } from "@/features/learning/tests/assessment-session";
import { LEAVING_RESET_MS, useLeaveGuard } from "@/features/learning/tests/useLeaveGuard";
import { attemptFixture, sessionHarness } from "@/test-fixtures/assessment";

// Здесь нужен настоящий фокус экрана, а не «всегда на виду» из jest.setup.ts.
jest.mock("@/lib/focus", () => jest.requireActual("@/lib/focus"));

const SAVE = "save_student_assessment_answers_v1";
const READ = "student_assessment_attempt_v1";
/** Одна отправка при обрыве: слой RPC повторяет тот же запрос ещё дважды, поэтому три ответа «обрыв» на один вызов. */
const down = (sends = 1) => Array<string>(3 * sends).fill("NETWORK");
const parse = () => normalizeAssessmentAttempt(attemptFixture("orvis92"));
const saves = (h: ReturnType<typeof sessionHarness>) => h.calls.filter((c) => c.name === SAVE);

let session: AssessmentSession;
let harness: ReturnType<typeof sessionHarness>;
let guard: ReturnType<typeof useLeaveGuard>;
let backTarget: () => void = () => router.back();

function Runner() {
  const current = useLeaveGuard({ session, active: true, back: () => backTarget() });
  // Тест достаёт кнопки хука снаружи; присваивание в эффекте, а не при отрисовке.
  useEffect(() => {
    guard = current;
  });
  return <Text testID="runner">{String(current.exitNotice)}</Text>;
}

const ROUTES = {
  _layout: () => <Stack screenOptions={{ headerShown: false }} />,
  index: () => <Text testID="home">home</Text>,
  other: () => <Text testID="other">other</Text>,
  "tests/[key]": Runner,
};

function start(replies: Record<string, unknown[]>) {
  harness = sessionHarness(replies);
  session = new AssessmentSession(harness.env, "orvis92", null, parse());
  backTarget = () => router.back();
}
/** Экран открыт поверх главной, как открывают тест из каталога: под ним есть экран, который «назад» вернёт. */
async function mount() {
  const view = await renderRouter(ROUTES, { initialUrl: "/" });
  await act(async () => router.push("/tests/orvis92"));
  await waitFor(() => expect(screen.getByTestId("runner")).toBeTruthy());
  return view;
}
const pass = async (ms: number) => {
  await act(async () => {
    await harness.advance(ms);
  });
};

afterEach(() => {
  session.dispose();
});

describe("настоящий стек: «назад» при несохранённом ответе", () => {
  it("со связью: первое же нажатие «назад» сохраняет и закрывает экран, запись одна", async () => {
    start({ [SAVE]: [attemptFixture("orvis92", { revision: 2 })] });
    const view = await mount();
    expect(view.getPathname()).toBe("/tests/orvis92");
    await act(async () => session.select("o1", "3"));
    expect(session.getState().unsaved).toBe(true);
    await act(async () => router.back());
    await act(async () => harness.settle());
    await waitFor(() => expect(view.getPathname()).toBe("/"));
    expect(saves(harness)).toHaveLength(1);
    expect(screen.queryByTestId("runner")).toBeNull();
  });

  it("без связи: экран остаётся, плашка просит сохранить; второе «назад» тоже; связь вернулась - таймер досохранил, и «назад» уходит", async () => {
    start({ [SAVE]: [...down(2), attemptFixture("orvis92", { revision: 2 })] });
    const view = await mount();
    await act(async () => session.select("o1", "3"));
    await act(async () => router.back());
    await act(async () => harness.advance(0));
    await act(async () => harness.settle());
    expect(view.getPathname()).toBe("/tests/orvis92");
    expect(screen.getByTestId("runner")).toHaveTextContent("true");
    expect(session.getState().unsaved).toBe(true);
    await act(async () => router.back());
    await act(async () => harness.settle());
    expect(view.getPathname()).toBe("/tests/orvis92");
    await pass(ASSESSMENT_RETRY_MS);
    await act(async () => harness.settle());
    expect(session.getState().unsaved).toBe(false);
    expect(screen.getByTestId("runner")).toHaveTextContent("false");
    await act(async () => router.back());
    await waitFor(() => expect(view.getPathname()).toBe("/"));
    expect(new Set(saves(harness).map((c) => c.args.p_request_id)).size).toBe(1); // один замороженный запрос на все попытки
  });

  it("«Сохранить и выйти» (кнопка) закрывает экран один раз", async () => {
    start({ [SAVE]: [attemptFixture("orvis92", { revision: 2 })] });
    const view = await mount();
    await act(async () => session.select("o2", "4"));
    await act(async () => guard.saveAndExit());
    await act(async () => harness.settle());
    await waitFor(() => expect(view.getPathname()).toBe("/"));
    expect(saves(harness)).toHaveLength(1);
  });

  it("всё сохранено: «назад» уходит сразу, к серверу не обращаясь", async () => {
    start({ [SAVE]: [attemptFixture("orvis92", { revision: 2 })] });
    const view = await mount();
    await act(async () => router.back());
    await waitFor(() => expect(view.getPathname()).toBe("/"));
    expect(harness.calls).toHaveLength(0);
  });

  it("конфликт: «назад» закрыто, пока не сверили; после «Показать сохранённые» уходит", async () => {
    start({ [SAVE]: ["CONFLICT"], [READ]: [attemptFixture("orvis92", { revision: 5, answers: { o1: "5" } })] });
    const view = await mount();
    await act(async () => session.select("o1", "3"));
    await pass(ASSESSMENT_SAVE_MS);
    await act(async () => harness.settle());
    expect(session.getState().reloadRequired).toBe(true);
    await act(async () => router.back());
    await act(async () => harness.settle());
    expect(view.getPathname()).toBe("/tests/orvis92");
    await act(async () => session.loadSaved());
    expect(session.getState().unsaved).toBe(false);
    await act(async () => router.back());
    await waitFor(() => expect(view.getPathname()).toBe("/"));
  });
});

describe("настоящий стек: выходы из упорного сбоя (ревью #1559)", () => {
  it("«Выйти без сохранения»: экран уходит сразу, хотя ответ не сохранён, и больше ничего не запирает", async () => {
    start({ [SAVE]: down(1) });
    const view = await mount();
    await act(async () => session.select("o1", "3"));
    await pass(ASSESSMENT_SAVE_MS);
    expect(session.getState().unsaved).toBe(true);
    await act(async () => guard.leaveAnyway());
    await waitFor(() => expect(view.getPathname()).toBe("/"));
    expect(screen.queryByTestId("runner")).toBeNull();
    // Закрытие экрана досылает неотправленное один раз (`dispose`); здесь экран закрыт сам, повторов по таймеру нет.
    await act(async () => session.dispose());
    const sent = saves(harness).length;
    await pass(10 * ASSESSMENT_RETRY_MS);
    expect(saves(harness)).toHaveLength(sent);
  });

  it("уход не убрал экран: защита возвращается, и новый несохранённый ответ снова держит «назад»", async () => {
    start({ [SAVE]: down(3) });
    backTarget = () => undefined; // «назад» вызвана, а экран остался (другой перехватчик, ссылка в никуда)
    const view = await mount();
    await act(async () => guard.saveAndExit());
    await act(async () => harness.settle());
    expect(view.getPathname()).toBe("/tests/orvis92");
    // Пока метка «уходим» стоит, защиты нет: так и задумано, иначе повторное действие остановило бы само себя.
    // `renderRouter` включает поддельные таймеры Jest: время двигаем им же.
    await act(async () => {
      jest.advanceTimersByTime(LEAVING_RESET_MS + 100);
    });
    await act(async () => session.select("o3", "2"));
    await pass(ASSESSMENT_SAVE_MS); // отправка оборвалась: ответ не сохранён
    expect(session.getState().unsaved).toBe(true);
    await act(async () => router.back());
    await act(async () => harness.settle());
    expect(view.getPathname()).toBe("/tests/orvis92"); // без сброса метки экран ушёл бы с несохранённым ответом
    expect(screen.getByTestId("runner")).toHaveTextContent("true");
  });

  it("экран ушёл с виду (поверх открыт другой): повторов по таймеру нет; вернулись - досылается сразу тем же запросом", async () => {
    start({ [SAVE]: [...down(1), attemptFixture("orvis92", { revision: 2 })] });
    const view = await mount();
    await act(async () => session.select("o1", "3"));
    await pass(ASSESSMENT_SAVE_MS);
    expect(saves(harness)).toHaveLength(3);
    await act(async () => router.push("/other"));
    await waitFor(() => expect(view.getPathname()).toBe("/other"));
    await pass(10 * ASSESSMENT_RETRY_MS);
    expect(saves(harness)).toHaveLength(3); // раньше запрос уходил каждые 3 с и из фона
    await act(async () => router.back());
    await act(async () => harness.settle());
    await waitFor(() => expect(session.getState().saveStatus).toBe("saved"));
    expect(saves(harness)).toHaveLength(4);
    expect(new Set(saves(harness).map((c) => c.args.p_request_id)).size).toBe(1);
  });
});

describe("настоящий стек: выход из кабинета при несохранённом ответе", () => {
  it("выход (Stack.Protected) не блокируется защитой, экран теста снят", async () => {
    harness = sessionHarness({ [SAVE]: down(10) });
    session = new AssessmentSession(harness.env, "orvis92", null, parse());
    let signOut: () => void = () => undefined;
    function Root() {
      const [signedIn, set] = useState(true);
      useEffect(() => {
        signOut = () => set(false);
      }, []);
      return (
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Protected guard={!signedIn}>
            <Stack.Screen name="sign-in" />
          </Stack.Protected>
          <Stack.Protected guard={signedIn}>
            <Stack.Screen name="(app)" />
          </Stack.Protected>
        </Stack>
      );
    }
    await renderRouter(
      {
        _layout: Root,
        "sign-in": () => <Text testID="signin">sign-in</Text>,
        "(app)/_layout": () => <Stack screenOptions={{ headerShown: false }} />,
        "(app)/index": () => <Text>home</Text>,
        "(app)/tests/[key]": Runner,
      },
      { initialUrl: "/tests/orvis92" },
    );
    await waitFor(() => expect(screen.getByTestId("runner")).toBeTruthy());
    await act(async () => session.select("o1", "3"));
    await pass(ASSESSMENT_SAVE_MS);
    expect(session.getState().unsaved).toBe(true);
    await act(async () => session.dispose()); // то же делает `AssessmentFlow` при размонтировании
    await act(async () => signOut());
    await act(async () => harness.settle());
    await waitFor(() => expect(screen.getByTestId("signin")).toBeTruthy());
    expect(screen.queryByTestId("runner")).toBeNull();
  });
});

describe("Android: системная «назад», когда под тестом нет другого экрана", () => {
  /**
   * Подписчики `hardwareBackPress`, как их ведёт Android (в Jest под iOS `BackHandler` ничего не делает). Среди них есть и общий
   * обработчик навигации (он снимает экран со стека); `press` - нажатие целиком, `ours` - только обработчик защиты (он подписан последним).
   */
  function captureBackHandler() {
    const handlers: (() => boolean)[] = [];
    const spy = jest.spyOn(BackHandler, "addEventListener").mockImplementation(((_event: string, handler: () => boolean) => {
      handlers.push(handler);
      return { remove: () => void handlers.splice(handlers.indexOf(handler), 1) };
    }) as never);
    const ours = () => handlers[handlers.length - 1]();
    return { ours, spy, count: () => handlers.length };
  }

  it("тест единственный в стеке: «назад» идёт как «Сохранить и выйти» (сохраняет и уходит), а не переключает вкладку", async () => {
    const back = captureBackHandler();
    start({ [SAVE]: [attemptFixture("orvis92", { revision: 2 })] });
    const exit = jest.fn();
    backTarget = exit;
    await renderRouter(ROUTES, { initialUrl: "/tests/orvis92" }); // стек: только тест
    await waitFor(() => expect(screen.getByTestId("runner")).toBeTruthy());
    await act(async () => session.select("o1", "3"));
    let consumed = false;
    await act(async () => {
      consumed = back.ours();
    });
    expect(consumed).toBe(true);
    await act(async () => harness.settle());
    expect(exit).toHaveBeenCalledTimes(1);
    expect(saves(harness)).toHaveLength(1);
    back.spy.mockRestore();
  });

  it("под тестом есть экран: «назад» не перехватывается, её снимет стек, а защита сработает как обычно", async () => {
    const back = captureBackHandler();
    start({ [SAVE]: [attemptFixture("orvis92", { revision: 2 })] });
    await mount();
    expect(back.count()).toBeGreaterThan(0);
    let consumed = true;
    await act(async () => {
      consumed = back.ours();
    });
    expect(consumed).toBe(false);
    back.spy.mockRestore();
  });

  it("подписка снимается, когда экран уходит с виду", async () => {
    const back = captureBackHandler();
    start({ [SAVE]: [attemptFixture("orvis92", { revision: 2 })] });
    await mount();
    const before = back.count();
    expect(before).toBeGreaterThan(0);
    await act(async () => router.push("/other"));
    await waitFor(() => expect(back.count()).toBeLessThan(before));
    back.spy.mockRestore();
  });
});
