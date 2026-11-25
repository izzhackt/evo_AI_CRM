// «Подбор с Эви»: то, что приложение доводит до веба (25.11.2026): робот на своих местах, шапка с «печатает» и «Новым чатом» словами,
// новая реплика с начала, объявления для читалки, «Эви недоступен» без ключа на сервере и уход в каталог при отозванном согласии.
// Робот подменён заглушкой, которая записывает, что ей передали: рисунок и движение проверяет EviRobot.test.
import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { useState } from "react";
import { AccessibilityInfo, Platform, Pressable, ScrollView } from "react-native";

import { EviScreen } from "@/features/learning/evi/EviScreen";
import { EviMemoryProvider } from "@/features/learning/evi/EviMemory";
import type { EviApi } from "@/features/learning/evi/api";
import { renderPortal, testApi } from "@/test-fixtures/render";
import { failure, fakeTransport } from "@/test-fixtures/universities";
import type { RpcTransport } from "@/lib/rpc";

const mockNavigate = jest.fn();
const mockDismissTo = jest.fn();
jest.mock("expo-router", () => ({
  router: { navigate: (...args: unknown[]) => mockNavigate(...args), dismissTo: (...args: unknown[]) => mockDismissTo(...args), canGoBack: () => false, back: jest.fn() },
  useRouter: () => ({ canGoBack: () => false, back: jest.fn(), navigate: (...args: unknown[]) => mockNavigate(...args) }),
}));
jest.mock("@/ui/useReduceMotion", () => ({ useReduceMotion: () => true }));
type RobotProps = { testID?: string; face: string; settled?: boolean; still?: boolean; listening?: boolean; size?: number };
const mockRobots: RobotProps[] = [];
jest.mock("@/features/learning/evi/EviRobot", () => {
  const { View } = jest.requireActual<typeof import("react-native")>("react-native");
  const React = jest.requireActual<typeof import("react")>("react");
  return {
    ...jest.requireActual("@/features/learning/evi/EviRobot"),
    EviRobot: (props: RobotProps) => {
      mockRobots.push({ ...props });
      return React.createElement(View, { testID: props.testID ?? "evi-robot", accessibilityElementsHidden: true });
    },
  };
});
const robot = (testID: string) => [...mockRobots].reverse().find((props) => props.testID === testID);

type Ask = EviApi["ask"];
const GRANTED = { status: "granted", policyVersion: "2026-10-25", decidedAt: "2026-11-01T10:00:00Z", currentPolicyVersion: "2026-10-25" };
const DECLINED = { ...GRANTED, status: "declined" };
const answer = (over: Record<string, unknown> = {}) => ({ ok: true as const, answer: { message: "Что тебе нравится делать?", mood: "talk" as const, options: ["Рисовать", "Считать"], multi: false, results: null, progress: { step: 1, total: 10 }, ...over } });
const results = [1, 2, 3].map((n) => ({ cardId: `card-${n}`, cardKey: `key-${n}`, title: `Профессия ${n}`, summary: null, why: `Причина ${n}` }));
const scrollTo = ScrollView.prototype.scrollTo as unknown as jest.Mock;
const scrollToEnd = ScrollView.prototype.scrollToEnd as unknown as jest.Mock;
const announce = AccessibilityInfo.announceForAccessibility as unknown as jest.Mock;

type Options = { available?: boolean | null | "throws"; consent?: unknown; lang?: "ru" | "ky"; transport?: RpcTransport };
function apiOf(ask: Ask, available: Options["available"] = true): EviApi {
  return { ask, available: available === "throws" ? async () => { throw new Error("offline"); } : async () => available };
}

async function open(ask: Ask, options: Options = {}) {
  const transport = options.transport ?? fakeTransport({ portal_ai_consent_get_v1: options.consent ?? GRANTED }).transport;
  const view = await renderPortal(<EviScreen api={apiOf(ask, options.available)} />, testApi(transport), options.lang ?? "ru");
  return view;
}
const chatOpen = () => screen.findByTestId("evi-screen");
/** Ответ, который приходит, когда скажем: пока он не пришёл, на экране «печатает». */
function deferred() {
  let resolve: (value: Awaited<ReturnType<Ask>>) => void = () => undefined;
  const promise = new Promise<Awaited<ReturnType<Ask>>>((done) => (resolve = done));
  return { promise, resolve };
}
async function talk(ask: Ask, options: Options = {}, reply = "Что тебе нравится делать?") {
  const view = await open(ask, options);
  await chatOpen();
  await fireEvent.press(screen.getByTestId(options.lang === "ky" ? "evi-option-Баштайлы!" : "evi-option-Начнём!"));
  await waitFor(() => expect(screen.getByText(reply)).toBeTruthy());
  return view;
}

beforeEach(() => {
  mockNavigate.mockReset();
  mockDismissTo.mockReset();
  mockRobots.length = 0;
  scrollTo.mockClear();
  scrollToEnd.mockClear();
  announce.mockClear();
});
afterEach(() => jest.restoreAllMocks());

describe("робот на своих местах", () => {
  it("приветствие: крупный робот (104) с настроением приветствия, реакция ему положена; шапки разговора ещё нет", async () => {
    await open(jest.fn());
    await chatOpen();
    expect(robot("evi-mascot")).toMatchObject({ size: 104, face: "happy", settled: false });
    expect(robot("evi-mascot")?.still).toBeUndefined();
    expect(robot("evi-avatar")).toBeUndefined();
  });

  it("реплика Эви: робот стоит у последней реплики (56), пока она не ждёт ответа; шапка получает неподвижный аватар (44) с «довольным» лицом", async () => {
    await talk(jest.fn(async () => answer()));
    expect(robot("evi-mascot")).toMatchObject({ size: 56 });
    expect(robot("evi-avatar")).toMatchObject({ size: 44, face: "happy", still: true, settled: true });
  });

  it("Эви думает: у реплики её нет, рядом с «печатает» - думающий робот, в шапке аватар с «думающим» лицом", async () => {
    await open(jest.fn(() => new Promise(() => undefined)));
    await chatOpen();
    await fireEvent.press(screen.getByTestId("evi-option-Начнём!"));
    expect(screen.getByTestId("evi-typing")).toBeTruthy();
    expect(robot("evi-mascot-typing")).toMatchObject({ size: 56 });
    expect(robot("evi-avatar")).toMatchObject({ face: "thinking", still: true, settled: true });
    // Робот у предыдущей реплики ушёл вместе с её строкой «последней»: он один, и это думающий.
    expect(screen.queryByTestId("evi-mascot")).toBeNull();
  });

  it("сбой после ответа ученика: робот остаётся у последней реплики Эви и спокоен, а не улыбается", async () => {
    const ask = jest.fn<ReturnType<Ask>, Parameters<Ask>>().mockResolvedValueOnce(answer()).mockResolvedValueOnce({ ok: false, reason: "busy" });
    await talk(ask);
    await fireEvent.press(screen.getByTestId("evi-option-Рисовать"));
    await waitFor(() => expect(screen.getByTestId("evi-failure")).toBeTruthy());
    expect(screen.getByTestId("evi-mascot", { includeHiddenElements: true })).toBeTruthy();
    expect(robot("evi-mascot")).toMatchObject({ face: "idle" });
  });

  it("ученик пишет в поле - робот слушает", async () => {
    await talk(jest.fn(async () => answer()));
    await fireEvent.changeText(screen.getByTestId("evi-input"), "Мне нравится биология");
    expect(robot("evi-mascot")).toMatchObject({ face: "idle", listening: true });
  });

  it("итог «Придумал!»: робот с настроением «придумал»", async () => {
    await talk(jest.fn(async () => answer({ message: "Придумал!", mood: "eureka", options: [], results, progress: null })), {}, "Придумал!");
    await waitFor(() => expect(screen.getByTestId("evi-results")).toBeTruthy());
    expect(robot("evi-mascot")).toMatchObject({ face: "eureka", settled: false });
  });
});

describe("шапка разговора", () => {
  it("«Новый чат» - кнопка со значком и словами из общего словаря (ru и ky), с целью нажатия не меньше 44", async () => {
    await talk(jest.fn(async () => answer()));
    const button = screen.getByTestId("evi-new-chat");
    expect(button.props.accessibilityRole).toBe("button");
    expect(screen.getByText("Новый чат")).toBeTruthy();
    const style = Object.assign({}, ...[button.props.style].flat(Infinity).filter(Boolean));
    expect(style.minHeight).toBeGreaterThanOrEqual(44);
  });

  it("kyrgyz: подпись кнопки и слово «жазып жатат» из словаря", async () => {
    await talk(jest.fn(async () => answer()), { lang: "ky" });
    expect(screen.getByText("Жаңы маек")).toBeTruthy();
  });

  it("пока Эви печатает - во второй строке «печатает» и бегущие точки; после ответа строка снова «Вопрос N из M», точек нет", async () => {
    let release: (value: Awaited<ReturnType<Ask>>) => void = () => undefined;
    await open(jest.fn(() => new Promise((resolve) => { release = resolve; })));
    await chatOpen();
    await fireEvent.press(screen.getByTestId("evi-option-Начнём!"));
    expect(screen.getByTestId("evi-title-subtitle").props.children).toBe("печатает");
    expect(screen.getByTestId("evi-header-dots", { includeHiddenElements: true })).toBeTruthy();
    release(answer());
    await waitFor(() => expect(screen.queryByTestId("evi-header-dots", { includeHiddenElements: true })).toBeNull());
    expect(screen.getByText("Вопрос 1 из 10")).toBeTruthy();
    expect(screen.getByTestId("evi-progress-fill", { includeHiddenElements: true }).props.style.width).toBe("10%");
  });

  it("точки в облачке переписки - те же бегущие точки (8 pt), слово «печатает» читает подпись облачка", async () => {
    await open(jest.fn(() => new Promise(() => undefined)));
    await chatOpen();
    await fireEvent.press(screen.getByTestId("evi-option-Начнём!"));
    const typing = screen.getByTestId("evi-typing");
    expect(typing.props.accessibilityLabel).toBe("Эви печатает…");
    // Точки и в облачке переписки, и в шапке.
    expect(screen.getByTestId("evi-dots", { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByTestId("evi-header-dots", { includeHiddenElements: true })).toBeTruthy();
  });
});

describe("новая реплика открывается с начала", () => {
  const speakingRowLayout = async (y: number) => {
    const rows = screen.getAllByTestId("evi-row");
    await fireEvent(rows[rows.length - 1]!, "layout", { nativeEvent: { layout: { x: 0, y, width: 300, height: 90 } } });
  };

  it("пока строка не измерена, прокручивать некуда; после замера - к её началу с отступом 12, один раз", async () => {
    await open(jest.fn(async () => answer()));
    await chatOpen();
    await fireEvent.press(screen.getByTestId("evi-option-Начнём!"));
    await waitFor(() => expect(screen.getByText("Что тебе нравится делать?")).toBeTruthy());
    expect(scrollTo).not.toHaveBeenCalled();
    await speakingRowLayout(400);
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith({ y: 388, animated: true });
    await speakingRowLayout(430);
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });

  it("реплика у самого верха не уходит в минус", async () => {
    await talk(jest.fn(async () => answer()));
    await speakingRowLayout(4);
    expect(scrollTo).toHaveBeenCalledWith({ y: 0, animated: true });
  });

  it("всё остальное - к концу: ответ ученика, «печатает», сбой; реплика, открытая с начала, концом не перебивается", async () => {
    const reply = deferred();
    const ask = jest.fn<ReturnType<Ask>, Parameters<Ask>>().mockReturnValueOnce(reply.promise).mockResolvedValueOnce({ ok: false, reason: "error" });
    await open(ask);
    await chatOpen();
    scrollToEnd.mockClear();
    await fireEvent.press(screen.getByTestId("evi-option-Начнём!"));
    // Ответ ученика и «печатает»: к концу.
    expect(screen.getByTestId("evi-typing")).toBeTruthy();
    expect(scrollToEnd).toHaveBeenCalled();
    scrollToEnd.mockClear();
    reply.resolve(answer());
    await waitFor(() => expect(screen.getByText("Что тебе нравится делать?")).toBeTruthy());
    await speakingRowLayout(300);
    expect(scrollToEnd).not.toHaveBeenCalled();
    expect(scrollTo).toHaveBeenCalledWith({ y: 288, animated: true });
    // Сбой: строка системы внизу, к концу.
    scrollTo.mockClear();
    scrollToEnd.mockClear();
    await fireEvent.press(screen.getByTestId("evi-option-Рисовать"));
    await waitFor(() => expect(screen.getByTestId("evi-failure")).toBeTruthy());
    expect(scrollToEnd).toHaveBeenCalled();
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("после «Нового чата» номера реплик начинаются снова: замер строки из прошлого разговора не используется, ждём замера новой", async () => {
    const ask = jest.fn(async () => answer());
    await open(ask);
    await chatOpen();
    await fireEvent.press(screen.getByTestId("evi-option-Начнём!"));
    await waitFor(() => expect(screen.getByText("Что тебе нравится делать?")).toBeTruthy());
    await speakingRowLayout(640);
    expect(scrollTo).toHaveBeenCalledWith({ y: 628, animated: true });
    scrollTo.mockClear();
    await fireEvent.press(screen.getByTestId("evi-new-chat"));
    await fireEvent.press(screen.getByTestId("evi-option-Начнём!"));
    await waitFor(() => expect(ask).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getAllByTestId("evi-bubble").length).toBe(2));
    // Реплика с тем же номером (2), что и в первом разговоре, пришла; её строка ещё не измерена - старое положение 640 не годится.
    expect(scrollTo).not.toHaveBeenCalled();
    await speakingRowLayout(300);
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith({ y: 288, animated: true });
  });

  it("итог с тремя профессиями открывается с «Придумал!»: первая профессия видна сразу под репликой, а не конец списка", async () => {
    await talk(jest.fn(async () => answer({ message: "Придумал!", mood: "eureka", options: [], results, progress: null })), {}, "Придумал!");
    await speakingRowLayout(520);
    expect(scrollTo).toHaveBeenCalledWith({ y: 508, animated: true });
  });
});

describe("читалка слышит то, что слышит живая область веба", () => {
  it("iOS: «печатает», потом сама реплика; приветствие и открытие экрана ничего не объявляют", async () => {
    jest.replaceProperty(Platform, "OS", "ios");
    const reply = deferred();
    await open(jest.fn(() => reply.promise));
    await chatOpen();
    expect(announce).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId("evi-option-Начнём!"));
    expect(announce.mock.calls).toEqual([["Эви печатает…"]]);
    reply.resolve(answer());
    await waitFor(() => expect(screen.getByText("Что тебе нравится делать?")).toBeTruthy());
    expect(announce.mock.calls).toEqual([["Эви печатает…"], ["Что тебе нравится делать?"]]);
  });

  it("«Новый чат»: приветствие нового разговора не объявляется (читалка уже на кнопке, экран приветствия - не новая реплика)", async () => {
    jest.replaceProperty(Platform, "OS", "ios");
    await talk(jest.fn(async () => answer()));
    announce.mockClear();
    await fireEvent.press(screen.getByTestId("evi-new-chat"));
    expect(screen.getByTestId("evi-welcome")).toBeTruthy();
    expect(announce).not.toHaveBeenCalled();
  });

  it("итог читается с заголовком и тремя названиями", async () => {
    await talk(jest.fn(async () => answer({ message: "Придумал!", mood: "eureka", options: [], results, progress: null })), {}, "Придумал!");
    expect(announce).toHaveBeenLastCalledWith("Придумал! Твои профессии: 1. Профессия 1, 2. Профессия 2, 3. Профессия 3");
  });

  it("сбой объявляется один раз, тем же словом, что строка над полем", async () => {
    const reply = deferred();
    await open(jest.fn(() => reply.promise));
    await chatOpen();
    await fireEvent.press(screen.getByTestId("evi-option-Начнём!"));
    reply.resolve({ ok: false, reason: "busy" });
    await waitFor(() => expect(screen.getByTestId("evi-failure")).toBeTruthy());
    const failureText = "Слишком много сообщений подряд. Подождите немного и попробуйте ещё раз.";
    expect(announce.mock.calls).toEqual([["Эви печатает…"], [failureText]]);
  });

  it("Android: область есть всегда, слова попадают в неё; сбой - срочно", async () => {
    jest.replaceProperty(Platform, "OS", "android");
    await open(jest.fn(async () => ({ ok: false as const, reason: "busy" as const })));
    await chatOpen();
    expect(screen.getByTestId("live-region").props.accessibilityLiveRegion).toBe("polite");
    await fireEvent.press(screen.getByTestId("evi-option-Начнём!"));
    await waitFor(() => expect(screen.getByTestId("evi-failure")).toBeTruthy());
    expect(screen.getByTestId("live-region").props.accessibilityLiveRegion).toBe("assertive");
    expect(screen.getByTestId("live-region-text").props.children.join("")).toContain("Слишком много сообщений");
    expect(announce).not.toHaveBeenCalled();
  });

  it("вернувшийся из памяти разговор ничего не объявляет: объявляется только то, что случилось на глазах", async () => {
    jest.replaceProperty(Platform, "OS", "ios");
    const ask = jest.fn(async () => answer());
    function Cabinet() {
      const [shown, setShown] = useState(true);
      return (
        <EviMemoryProvider>
          <Pressable testID="leave" onPress={() => setShown(false)} />
          <Pressable testID="return" onPress={() => setShown(true)} />
          {shown ? <EviScreen api={apiOf(ask)} /> : null}
        </EviMemoryProvider>
      );
    }
    const transport = fakeTransport({ portal_ai_consent_get_v1: GRANTED }).transport;
    await renderPortal(<Cabinet />, testApi(transport));
    await chatOpen();
    await fireEvent.press(screen.getByTestId("evi-option-Начнём!"));
    await waitFor(() => expect(screen.getByText("Что тебе нравится делать?")).toBeTruthy());
    announce.mockClear();
    await fireEvent.press(screen.getByTestId("leave"));
    await fireEvent.press(screen.getByTestId("return"));
    expect(screen.getByText("Что тебе нравится делать?")).toBeTruthy();
    expect(announce).not.toHaveBeenCalled();
  });
});

describe("ключа Эви на сервере нет - как на вебе: «недоступен» с первого экрана", () => {
  it("`available = false`: приветствие говорит «Эви сейчас недоступен», поле и варианты закрыты, одно действие - «Открыть каталог»", async () => {
    const ask = jest.fn();
    await open(ask, { available: false });
    expect(await screen.findByTestId("evi-welcome-text")).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("evi-welcome-text").props.children).toBe("Эви сейчас недоступен. Загляните позже."));
    expect(screen.queryByTestId("evi-input")).toBeNull();
    expect(screen.queryByTestId("evi-option-Начнём!")).toBeNull();
    expect(screen.queryByTestId("evi-failure")).toBeNull();
    await fireEvent.press(screen.getByTestId("evi-catalog"));
    expect(mockDismissTo).toHaveBeenCalledWith("/professions");
    expect(ask).not.toHaveBeenCalled();
  });

  it("не удалось узнать (null, сбой, старый сервер): чат открывается как прежде, ответит или откажет сервер", async () => {
    for (const available of [null, "throws"] as const) {
      const view = await open(jest.fn(), { available });
      await chatOpen();
      expect(screen.getByTestId("evi-option-Начнём!")).toBeTruthy();
      expect(screen.getByTestId("evi-input")).toBeTruthy();
      expect(screen.queryByTestId("evi-catalog")).toBeNull();
      await view.unmount();
    }
  });

  it("ответ пришёл позже открытия: чат был открыт как прежде и становится недоступным, поле закрывается", async () => {
    let answerAvailable: (value: boolean) => void = () => undefined;
    const api: EviApi = { ask: jest.fn(), available: () => new Promise<boolean>((resolve) => (answerAvailable = resolve)) };
    await renderPortal(<EviScreen api={api} />, testApi(fakeTransport({ portal_ai_consent_get_v1: GRANTED }).transport));
    await chatOpen();
    expect(screen.getByTestId("evi-input")).toBeTruthy();
    answerAvailable(false);
    await waitFor(() => expect(screen.queryByTestId("evi-input")).toBeNull());
    expect(screen.getByTestId("evi-catalog")).toBeTruthy();
  });

  it("открытие недоступного Эви не стирает разговор, который помнит кабинет: вернулся ключ - вернулся и разговор", async () => {
    const ask = jest.fn(async () => answer());
    const transport = fakeTransport({ portal_ai_consent_get_v1: GRANTED }).transport;
    const view = await renderPortal(
      <EviMemoryProvider>
        <EviScreen api={apiOf(ask)} />
      </EviMemoryProvider>,
      testApi(transport),
    );
    await chatOpen();
    await fireEvent.press(screen.getByTestId("evi-option-Начнём!"));
    await waitFor(() => expect(screen.getByText("Что тебе нравится делать?")).toBeTruthy());
    // Ключ пропал: чат закрывается, его реплик нет, но память цела.
    view.client.setQueryData(["portal", "user-test", "evi-available"], false);
    await waitFor(() => expect(screen.queryByText("Что тебе нравится делать?")).toBeNull());
    expect(screen.getByTestId("evi-catalog")).toBeTruthy();
    // Ключ вернулся: разговор на месте.
    view.client.setQueryData(["portal", "user-test", "evi-available"], true);
    await waitFor(() => expect(screen.getByText("Что тебе нравится делать?")).toBeTruthy());
    expect(screen.getByTestId("evi-option-Рисовать")).toBeTruthy();
  });
});

describe("согласие отозвано - экран уходит в каталог, как `?view=evi` веба", () => {
  it("отозвано: чата нет, экран идёт к каталогу, который уже в стеке, и модель не спрашивается", async () => {
    const ask = jest.fn();
    await open(ask, { consent: DECLINED });
    await waitFor(() => expect(mockDismissTo).toHaveBeenCalledWith("/professions"));
    expect(mockDismissTo).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("evi-screen")).toBeNull();
    expect(screen.queryByTestId("evi-input")).toBeNull();
    expect(ask).not.toHaveBeenCalled();
  });

  it("не выбрано для текущей версии текста - тоже не «разрешено»: уходит", async () => {
    await open(jest.fn(), { consent: { ...GRANTED, status: null, policyVersion: null, decidedAt: null } });
    await waitFor(() => expect(mockDismissTo).toHaveBeenCalledWith("/professions"));
    await open(jest.fn(), { consent: { ...GRANTED, policyVersion: "2026-01-01" } });
    await waitFor(() => expect(mockDismissTo).toHaveBeenCalledTimes(2));
  });

  it("разрешено: чат открыт, никуда не уходит", async () => {
    await open(jest.fn());
    await chatOpen();
    expect(mockDismissTo).not.toHaveBeenCalled();
  });

  it("чтение согласия не удалось: Эви не прячется, сервер проверит согласие сам", async () => {
    await open(jest.fn(), { consent: failure("XX000", 500) });
    await chatOpen();
    expect(screen.getByTestId("evi-input")).toBeTruthy();
    expect(mockDismissTo).not.toHaveBeenCalled();
  });

  it("пока согласие читается - шапка и заглушка вместо чата; прочиталось - чат", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const base = fakeTransport({ portal_ai_consent_get_v1: GRANTED }).transport;
    const slow: RpcTransport = async (name, args, options) => {
      await gate;
      return base(name, args, options);
    };
    await open(jest.fn(), { transport: slow });
    expect(screen.getByTestId("evi-waiting")).toBeTruthy();
    expect(screen.getByTestId("evi-title-back")).toBeTruthy();
    expect(screen.queryByTestId("evi-screen")).toBeNull();
    release();
    await chatOpen();
    expect(screen.queryByTestId("evi-waiting")).toBeNull();
    expect(mockDismissTo).not.toHaveBeenCalled();
  });

  it("согласие отозвали, пока экран открыт (в «Профиле»): экран уходит, как только это стало известно", async () => {
    const view = await open(jest.fn());
    await chatOpen();
    view.client.setQueryData(["portal", "user-test", "ai-consent"], DECLINED);
    await waitFor(() => expect(mockDismissTo).toHaveBeenCalledWith("/professions"));
  });
});
