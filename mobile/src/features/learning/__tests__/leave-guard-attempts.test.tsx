// Счётчик отказанных уходов `exitAttempts` (QA 24, N2) на настоящем стеке expo-router: каждый отказ (ответы не сохранены) прибавляет 1,
// и раннер по нему снова показывает блок сбоя, хотя строка «Сначала сохраним ответы…» та же. Сохранённый уход и «Выйти без сохранения»
// счётчик не трогают. Стенд тот же, что у `leave-guard-router.test.tsx`; экран-заглушка выводит `exitNotice:exitAttempts`.
import { Stack, router } from "expo-router";
import { act, renderRouter, screen, waitFor } from "expo-router/testing-library";
import { useEffect } from "react";
import { Text } from "react-native";

import { normalizeAssessmentAttempt } from "@/features/learning/tests/assessment-decode";
import { ASSESSMENT_RETRY_MS, AssessmentSession } from "@/features/learning/tests/assessment-session";
import { useLeaveGuard } from "@/features/learning/tests/useLeaveGuard";
import { attemptFixture, sessionHarness } from "@/test-fixtures/assessment";

// Здесь нужен настоящий фокус экрана, а не «всегда на виду» из jest.setup.ts.
jest.mock("@/lib/focus", () => jest.requireActual("@/lib/focus"));

const SAVE = "save_student_assessment_answers_v1";
/** Одна отправка при обрыве: слой RPC повторяет тот же запрос ещё дважды, поэтому три ответа «обрыв» на один вызов. */
const down = (sends = 1) => Array<string>(3 * sends).fill("NETWORK");
const parse = () => normalizeAssessmentAttempt(attemptFixture("orvis92"));

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
  // Как `AssessmentFlow`: закрытие экрана закрывает сессию.
  useEffect(() => () => session.dispose(), []);
  return <Text testID="runner">{`${current.exitNotice}:${current.exitAttempts}`}</Text>;
}

const ROUTES = {
  _layout: () => <Stack screenOptions={{ headerShown: false }} />,
  index: () => <Text testID="home">home</Text>,
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

afterEach(() => {
  session.dispose();
});

describe("exitAttempts на настоящем стеке", () => {
  it("«назад» (свайп, системная, стрелка шапки идут через usePreventRemove) без связи: каждый отказ прибавляет 1; сохранённый уход не прибавляет", async () => {
    start({ [SAVE]: [...down(2), attemptFixture("orvis92", { revision: 2 })] });
    const view = await mount();
    expect(screen.getByTestId("runner")).toHaveTextContent("false:0");
    await act(async () => session.select("o1", "3"));
    await act(async () => router.back());
    await act(async () => harness.advance(0));
    await act(async () => harness.settle());
    expect(view.getPathname()).toBe("/tests/orvis92");
    expect(screen.getByTestId("runner")).toHaveTextContent("true:1");
    await act(async () => router.back());
    await act(async () => harness.settle());
    expect(screen.getByTestId("runner")).toHaveTextContent("true:2");
    await act(async () => harness.advance(ASSESSMENT_RETRY_MS));
    await act(async () => harness.settle());
    expect(session.getState().unsaved).toBe(false);
    expect(screen.getByTestId("runner")).toHaveTextContent("false:2"); // связь вернулась, таймер досохранил: строки нет, счёт прежний
    await act(async () => router.back()); // всё сохранено: уход свободен
    await waitFor(() => expect(view.getPathname()).toBe("/"));
  });

  it("«Сохранить и выйти» (кнопка, стрелка шапки, Android «назад» без экрана под тестом) без связи: отказ прибавляет 1", async () => {
    start({ [SAVE]: [...down(3)] });
    await mount();
    await act(async () => session.select("o1", "3"));
    await act(async () => guard.saveAndExit());
    await act(async () => harness.advance(0));
    await act(async () => harness.settle());
    expect(screen.getByTestId("runner")).toHaveTextContent("true:1");
  });

  it("«Сохранить и выйти» со связью (ответы сохранились): счётчик не растёт", async () => {
    start({ [SAVE]: [attemptFixture("orvis92", { revision: 2 })] });
    backTarget = () => undefined; // экран остаётся, и видно, что счётчик не тронут
    await mount();
    await act(async () => session.select("o1", "3"));
    await act(async () => guard.saveAndExit());
    await act(async () => harness.settle());
    expect(session.getState().unsaved).toBe(false);
    expect(screen.getByTestId("runner")).toHaveTextContent("false:0");
  });

  it("«Выйти без сохранения» счётчик не трогает", async () => {
    start({ [SAVE]: [...down(3)] });
    backTarget = () => undefined; // экран остаётся, и видно, что счётчик не тронут
    await mount();
    await act(async () => session.select("o1", "3"));
    await act(async () => guard.saveAndExit());
    await act(async () => harness.settle());
    expect(screen.getByTestId("runner")).toHaveTextContent("true:1");
    await act(async () => guard.leaveAnyway());
    expect(screen.getByTestId("runner")).toHaveTextContent("false:1"); // строка ушла, счёт прежний
  });
});
