// Такт лица робота (веб: `useEviFace`, исключение владельца 17.11.2026): реакция настроения, потом «говорит», потом спокоен.
// Сроки берутся из общего `EVI_BEAT`, длина речи - из `eviSpeakMs`; здесь проверяется порядок, а не миллисекунды наугад.
import { act, renderHook } from "@testing-library/react-native";

import { EVI_BEAT, eviSpeakMs } from "@web/lib/portal/evi";

import type { EviFace } from "@/features/learning/evi/EviRobot";
import { useEviFace } from "@/features/learning/evi/useEviFace";

type Args = { mood: EviFace; listening?: boolean; speakMs?: number; poke?: number; hopOnMount?: boolean; reduceMotion?: boolean };
const run = (args: Args) =>
  renderHook((props: Args) => useEviFace(props.mood, props.listening ?? false, props.speakMs, props.poke ?? 0, props.hopOnMount ?? false, props.reduceMotion ?? false), { initialProps: args });
const advance = (ms: number) => act(async () => void jest.advanceTimersByTime(ms));
const SPEECH = eviSpeakMs("Привет! Давай разберёмся, кем тебе интересно стать.");

/** Таймеры такта: по их срокам, потому что React и тестовая библиотека заводят свои. */
const BEAT_DELAYS = [EVI_BEAT.react.happy, EVI_BEAT.react.wow, EVI_BEAT.react.eureka, EVI_BEAT.react.happy + SPEECH, EVI_BEAT.react.wow + SPEECH, SPEECH, 0, EVI_BEAT.poke];
let setTimer: jest.SpyInstance;
let clearTimer: jest.SpyInstance;
const beatTimers = () => setTimer.mock.calls.flatMap(([, ms], index) => (BEAT_DELAYS.includes(ms as number) && ms !== undefined ? [{ ms: ms as number, id: setTimer.mock.results[index]?.value as unknown }] : []));

beforeEach(() => {
  jest.useFakeTimers();
  setTimer = jest.spyOn(globalThis, "setTimeout");
  clearTimer = jest.spyOn(globalThis, "clearTimeout");
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe("такт новой реплики", () => {
  it("радуется: сначала лицо настроения, потом «говорит» по длине реплики, потом спокоен", async () => {
    const { result } = await run({ mood: "happy", speakMs: SPEECH });
    expect(result.current).toEqual({ face: "happy", poking: false });
    await advance(EVI_BEAT.react.happy - 1);
    expect(result.current.face).toBe("happy");
    await advance(1);
    expect(result.current.face).toBe("talk");
    await advance(SPEECH - 1);
    expect(result.current.face).toBe("talk");
    await advance(1);
    expect(result.current.face).toBe("idle");
  });

  it("удивлён - те же три шага с реакцией 900 мс; придумал - реакция 2,4 с и без «говорит»", async () => {
    const wow = await run({ mood: "wow", speakMs: SPEECH });
    await advance(EVI_BEAT.react.wow);
    expect(wow.result.current.face).toBe("talk");
    const eureka = await run({ mood: "eureka", speakMs: SPEECH });
    expect(eureka.result.current.face).toBe("eureka");
    await advance(EVI_BEAT.react.eureka - 1);
    expect(eureka.result.current.face).toBe("eureka");
    await advance(1);
    expect(eureka.result.current.face).toBe("idle");
  });

  it("обычная реплика (`talk`): без реакции, с первого такта говорит и успокаивается; до этого лицо спокойное, не «говорящее»", async () => {
    const { result } = await run({ mood: "talk", speakMs: SPEECH });
    expect(result.current.face).toBe("idle");
    await advance(0);
    expect(result.current.face).toBe("talk");
    await advance(SPEECH);
    expect(result.current.face).toBe("idle");
  });

  it("реплика уже не новая (без `speakMs`): сразу лицо реплики, без такта и без его таймеров; `talk` - спокойное", async () => {
    expect((await run({ mood: "happy" })).result.current.face).toBe("happy");
    expect((await run({ mood: "thinking" })).result.current.face).toBe("thinking");
    expect((await run({ mood: "talk" })).result.current.face).toBe("idle");
    expect(beatTimers().filter(({ ms }) => ms !== 0)).toEqual([]);
  });

  it("«уменьшить движение»: таймеров такта нет, видно настоящее лицо реплики", async () => {
    const { result } = await run({ mood: "happy", speakMs: SPEECH, reduceMotion: true });
    expect(beatTimers()).toEqual([]);
    await advance(10_000);
    expect(result.current.face).toBe("happy");
    expect((await run({ mood: "talk", speakMs: SPEECH, reduceMotion: true })).result.current.face).toBe("idle");
  });

  it("ученик печатает - робот слушает (смотрит в поле), кроме «думает»", async () => {
    expect((await run({ mood: "happy", listening: true, speakMs: SPEECH })).result.current.face).toBe("idle");
    expect((await run({ mood: "happy", listening: true })).result.current.face).toBe("idle");
    expect((await run({ mood: "thinking", listening: true })).result.current.face).toBe("thinking");
  });

  it("таймеры такта снимаются при уходе экрана: каждый заведённый сброшен, лицо после ухода не меняется", async () => {
    const { unmount } = await run({ mood: "happy", speakMs: SPEECH });
    const set = beatTimers();
    expect(set.map(({ ms }) => ms).sort((a, b) => a - b)).toEqual([EVI_BEAT.react.happy, EVI_BEAT.react.happy + SPEECH]);
    await unmount();
    for (const { id } of set) expect(clearTimer).toHaveBeenCalledWith(id);
    // Сброшенные таймеры больше не срабатывают: исключения и обновления после ухода нет.
    await advance(10_000);
  });
});

describe("действия ученика", () => {
  it("выбрал вариант (`poke` вырос) - радость на `EVI_BEAT.poke`, потом прежнее лицо", async () => {
    const { result, rerender } = await run({ mood: "talk", poke: 0 });
    expect(result.current.face).toBe("idle");
    await rerender({ mood: "talk", poke: 1 });
    expect(result.current).toEqual({ face: "happy", poking: true });
    await advance(EVI_BEAT.poke - 1);
    expect(result.current.poking).toBe(true);
    await advance(1);
    expect(result.current).toEqual({ face: "idle", poking: false });
  });

  it("робот, который сейчас начнёт думать (`hopOnMount`), радуется при появлении", async () => {
    const { result } = await run({ mood: "thinking", hopOnMount: true });
    expect(result.current).toEqual({ face: "happy", poking: true });
    await advance(EVI_BEAT.poke);
    expect(result.current).toEqual({ face: "thinking", poking: false });
  });

  it("радость на выбор не зависит от «уменьшить движение»: лицо меняется, движения нет (его нет у плана робота)", async () => {
    const { result } = await run({ mood: "talk", poke: 1, hopOnMount: true, reduceMotion: true });
    expect(result.current.poking).toBe(true);
    await advance(EVI_BEAT.poke);
    expect(result.current.poking).toBe(false);
  });
});
