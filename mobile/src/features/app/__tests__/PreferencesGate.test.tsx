// Выбор темы и языка с устройства (рецензия #1568, п. 4): провайдеры сообщают, что выбор прочитан (`hydrated`), а экраны, которые
// могут появиться раньше остальных, до этого не рисуются (`PreferencesGate`). Чтение хранилища здесь управляется тестом.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, render, screen } from "@testing-library/react-native";
import { type ReactNode } from "react";
import { Text as RNText } from "react-native";

import { HYDRATION_CAP_MS } from "@/lib/storage-hydration";
import { PreferencesGate } from "@/features/app/PreferencesGate";
import { LangProvider, useLang } from "@/i18n/LangProvider";
import { deferredStorage } from "@/test-fixtures/deferred-storage";
import { ThemeProvider, useTheme } from "@/theme/ThemeProvider";

type ThemeFrame = { hydrated: boolean; choice: string };
type LangFrame = { hydrated: boolean; lang: string };

/** Пишет каждый кадр, который видят потребители темы. */
function ThemeFrames({ into }: { into: ThemeFrame[] }) {
  const { hydrated, choice } = useTheme();
  into.push({ hydrated, choice });
  return <RNText testID="theme-frame">{`${hydrated}|${choice}`}</RNText>;
}
function LangFrames({ into }: { into: LangFrame[] }) {
  const { hydrated, lang } = useLang();
  into.push({ hydrated, lang });
  return <RNText testID="lang-frame">{`${hydrated}|${lang}`}</RNText>;
}
/** Отдаёт тесту значение хука (`setChoice`, `setLang`): последнее в списке - то, что видит экран сейчас. */
function ThemeHandle({ into }: { into: ReturnType<typeof useTheme>[] }) {
  const value = useTheme();
  into.push(value);
  return null;
}
function LangHandle({ into }: { into: ReturnType<typeof useLang>[] }) {
  const value = useLang();
  into.push(value);
  return null;
}
/** Дети шлюза: пишет язык и тему каждого кадра, в котором шлюз их показал. */
function GatedFrames({ into }: { into: string[] }) {
  const { lang } = useLang();
  const { scheme } = useTheme();
  into.push(`${lang}|${scheme}`);
  return <RNText testID="gated">{`${lang}|${scheme}`}</RNText>;
}

const withProviders = (ui: ReactNode) => (
  <ThemeProvider>
    <LangProvider>{ui}</LangProvider>
  </ThemeProvider>
);
/** Выдаёт ответ хранилища так, чтобы обновления провайдеров успели отработать. */
const run = (action: () => void) => act(async () => action());

describe("ThemeProvider: выбор с устройства прочитан", () => {
  const storage = deferredStorage();
  afterEach(() => jest.useRealTimers());

  it("до ответа хранилища hydrated = false и тема по умолчанию; выбор и флаг приходят одним обновлением", async () => {
    const frames: ThemeFrame[] = [];
    await render(
      <ThemeProvider>
        <ThemeFrames into={frames} />
      </ThemeProvider>,
    );
    expect(frames).toEqual([{ hydrated: false, choice: "light" }]);

    await run(() => storage.release({ "evo.theme": "dark" }));
    expect(frames.at(-1)).toEqual({ hydrated: true, choice: "dark" });
    // ни одного кадра «выбор прочитан, но тема ещё светлая по умолчанию»
    expect(frames.filter((frame) => frame.hydrated && frame.choice === "light")).toEqual([]);
    expect(screen.getByTestId("theme-frame")).toHaveTextContent("true|dark");
  });

  it("на устройстве ничего нет: hydrated = true, тема по умолчанию остаётся", async () => {
    const frames: ThemeFrame[] = [];
    await render(
      <ThemeProvider>
        <ThemeFrames into={frames} />
      </ThemeProvider>,
    );
    await run(() => storage.release());
    expect(frames.at(-1)).toEqual({ hydrated: true, choice: "light" });
  });

  it("запись на устройстве мусорная: игнорируется, hydrated = true", async () => {
    const frames: ThemeFrame[] = [];
    await render(
      <ThemeProvider>
        <ThemeFrames into={frames} />
      </ThemeProvider>,
    );
    await run(() => storage.release({ "evo.theme": "sepia" }));
    expect(frames.at(-1)).toEqual({ hydrated: true, choice: "light" });
  });

  it("чтение сорвалось: hydrated = true, тема по умолчанию (экран не ждёт вечно)", async () => {
    const frames: ThemeFrame[] = [];
    await render(
      <ThemeProvider>
        <ThemeFrames into={frames} />
      </ThemeProvider>,
    );
    await run(() => storage.fail());
    expect(frames.at(-1)).toEqual({ hydrated: true, choice: "light" });
  });

  it("хранилище молчит: по истечении предела hydrated = true со значением по умолчанию, запоздавший выбор всё равно применяется", async () => {
    jest.useFakeTimers();
    const frames: ThemeFrame[] = [];
    await render(
      <ThemeProvider>
        <ThemeFrames into={frames} />
      </ThemeProvider>,
    );
    await act(async () => {
      jest.advanceTimersByTime(HYDRATION_CAP_MS - 1);
    });
    expect(frames.at(-1)).toEqual({ hydrated: false, choice: "light" });
    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(frames.at(-1)).toEqual({ hydrated: true, choice: "light" });

    await run(() => storage.release({ "evo.theme": "dark" }));
    expect(frames.at(-1)).toEqual({ hydrated: true, choice: "dark" });
  });

  it("запоздавшее чтение не перебивает выбор, сделанный за это время: студент нажал «солнце/луна», медленное чтение вернуло старое", async () => {
    jest.useFakeTimers();
    const frames: ThemeFrame[] = [];
    const handle: ReturnType<typeof useTheme>[] = [];
    (AsyncStorage.setItem as unknown as jest.Mock).mockClear();
    await render(
      <ThemeProvider>
        <ThemeHandle into={handle} />
        <ThemeFrames into={frames} />
      </ThemeProvider>,
    );
    await act(async () => {
      jest.advanceTimersByTime(HYDRATION_CAP_MS);
    });
    expect(frames.at(-1)).toEqual({ hydrated: true, choice: "light" });
    await act(async () => handle.at(-1)?.setChoice("dark"));
    expect(frames.at(-1)).toEqual({ hydrated: true, choice: "dark" });

    // чтение вернулось после выбора и принесло то, что лежало на устройстве раньше
    await run(() => storage.release({ "evo.theme": "system" }));
    expect(frames.at(-1)).toEqual({ hydrated: true, choice: "dark" });
    expect(AsyncStorage.setItem).toHaveBeenCalledTimes(1);
    expect(AsyncStorage.setItem).toHaveBeenLastCalledWith("evo.theme", "dark");
  });

  it("выбор сделан, пока чтение ещё идёт (до предела): прочитанное его тоже не перебивает, но чтение завершено", async () => {
    const frames: ThemeFrame[] = [];
    const handle: ReturnType<typeof useTheme>[] = [];
    await render(
      <ThemeProvider>
        <ThemeHandle into={handle} />
        <ThemeFrames into={frames} />
      </ThemeProvider>,
    );
    await act(async () => handle.at(-1)?.setChoice("dark"));
    expect(frames.at(-1)).toEqual({ hydrated: false, choice: "dark" });
    await run(() => storage.release({ "evo.theme": "light" }));
    expect(frames.at(-1)).toEqual({ hydrated: true, choice: "dark" });
  });

  it("экран ушёл до ответа: позднее чтение ничего не обновляет", async () => {
    const frames: ThemeFrame[] = [];
    const view = await render(
      <ThemeProvider>
        <ThemeFrames into={frames} />
      </ThemeProvider>,
    );
    await view.unmount();
    const shown = frames.length;
    await run(() => storage.release({ "evo.theme": "dark" }));
    expect(frames).toHaveLength(shown);
  });
});

describe("LangProvider: выбор с устройства прочитан", () => {
  const storage = deferredStorage();
  afterEach(() => jest.useRealTimers());

  it("до ответа хранилища hydrated = false и язык по умолчанию; язык и флаг приходят одним обновлением", async () => {
    const frames: LangFrame[] = [];
    await render(
      <LangProvider>
        <LangFrames into={frames} />
      </LangProvider>,
    );
    expect(frames).toEqual([{ hydrated: false, lang: "ru" }]);

    await run(() => storage.release({ "evo.lang": "ky" }));
    expect(frames.at(-1)).toEqual({ hydrated: true, lang: "ky" });
    expect(frames.filter((frame) => frame.hydrated && frame.lang === "ru")).toEqual([]);
  });

  it("запоздавшее чтение не перебивает язык, выбранный за это время; а если студент ничего не выбирал, применяется", async () => {
    jest.useFakeTimers();
    const handle: ReturnType<typeof useLang>[] = [];
    const chosen: LangFrame[] = [];
    const first = await render(
      <LangProvider>
        <LangHandle into={handle} />
        <LangFrames into={chosen} />
      </LangProvider>,
    );
    await act(async () => {
      jest.advanceTimersByTime(HYDRATION_CAP_MS);
    });
    expect(chosen.at(-1)).toEqual({ hydrated: true, lang: "ru" });
    await act(async () => handle.at(-1)?.setLang("ky"));
    await run(() => storage.release({ "evo.lang": "ru" }));
    expect(chosen.at(-1)).toEqual({ hydrated: true, lang: "ky" });
    await first.unmount();

    const untouched: LangFrame[] = [];
    await render(
      <LangProvider>
        <LangFrames into={untouched} />
      </LangProvider>,
    );
    await act(async () => {
      jest.advanceTimersByTime(HYDRATION_CAP_MS);
    });
    await run(() => storage.release({ "evo.lang": "ky" }));
    expect(untouched.at(-1)).toEqual({ hydrated: true, lang: "ky" });
  });

  it("на устройстве ничего нет или чтение сорвалось: hydrated = true, язык по умолчанию", async () => {
    const empty: LangFrame[] = [];
    const first = await render(
      <LangProvider>
        <LangFrames into={empty} />
      </LangProvider>,
    );
    await run(() => storage.release());
    expect(empty.at(-1)).toEqual({ hydrated: true, lang: "ru" });
    await first.unmount();

    const failed: LangFrame[] = [];
    await render(
      <LangProvider>
        <LangFrames into={failed} />
      </LangProvider>,
    );
    await run(() => storage.fail());
    expect(failed.at(-1)).toEqual({ hydrated: true, lang: "ru" });
  });
});

describe("PreferencesGate", () => {
  const storage = deferredStorage();
  afterEach(() => jest.useRealTimers());

  it("не рисует детей, пока не прочитаны ОБА выбора; потом ни одного кадра на светлой русской схеме по умолчанию", async () => {
    const frames: string[] = [];
    await render(
      withProviders(
        <PreferencesGate>
          <GatedFrames into={frames} />
        </PreferencesGate>,
      ),
    );
    expect(screen.queryByTestId("gated")).toBeNull();

    // тема уже известна, язык ещё нет: по-прежнему пусто
    await run(() => storage.answer("evo.theme", "dark"));
    expect(screen.queryByTestId("gated")).toBeNull();
    expect(frames).toEqual([]);

    await run(() => storage.answer("evo.lang", "ky"));
    expect(screen.getByTestId("gated")).toHaveTextContent("ky|dark");
    expect(frames.length).toBeGreaterThan(0);
    expect(new Set(frames)).toEqual(new Set(["ky|dark"]));
  });

  it("порядок ответов не важен: сначала язык, потом тема", async () => {
    const frames: string[] = [];
    await render(
      withProviders(
        <PreferencesGate>
          <GatedFrames into={frames} />
        </PreferencesGate>,
      ),
    );
    await run(() => storage.answer("evo.lang", "ky"));
    expect(screen.queryByTestId("gated")).toBeNull();
    await run(() => storage.answer("evo.theme", "dark"));
    expect(new Set(frames)).toEqual(new Set(["ky|dark"]));
  });

  it("хранилище недоступно: шлюз открывается на значениях по умолчанию", async () => {
    await render(
      withProviders(
        <PreferencesGate>
          <GatedFrames into={[]} />
        </PreferencesGate>,
      ),
    );
    expect(screen.queryByTestId("gated")).toBeNull();
    await run(() => storage.fail());
    expect(screen.getByTestId("gated")).toHaveTextContent("ru|light");
  });

  it("хранилище молчит: шлюз открывается по истечении предела и не раньше", async () => {
    jest.useFakeTimers();
    await render(
      withProviders(
        <PreferencesGate>
          <GatedFrames into={[]} />
        </PreferencesGate>,
      ),
    );
    await act(async () => {
      jest.advanceTimersByTime(HYDRATION_CAP_MS - 1);
    });
    expect(screen.queryByTestId("gated")).toBeNull();
    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(screen.getByTestId("gated")).toHaveTextContent("ru|light");
  });
});
