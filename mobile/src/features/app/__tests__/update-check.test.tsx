// Проверка обновления при возврате на передний план (рецензия #1568, 1а): не чаще раза в час, только при включённых обновлениях,
// без интерфейса, все сбои проглатываются. `expo-updates` заменён: путь OTA в приложении ещё ни разу не проходился до конца.
import { render } from "@testing-library/react-native";
import { AppState, type AppStateStatus } from "react-native";

import { createForegroundUpdateChecker, UPDATE_CHECK_INTERVAL_MS, useForegroundUpdateCheck, type UpdateCheckDeps } from "@/features/app/update-check";

const mockUpdates: { isEnabled: boolean; check: jest.Mock; fetch: jest.Mock } = {
  isEnabled: true,
  check: jest.fn(),
  fetch: jest.fn(),
};
jest.mock("expo-updates", () => ({
  __esModule: true,
  get isEnabled() {
    return mockUpdates.isEnabled;
  },
  checkForUpdateAsync: (...args: unknown[]) => mockUpdates.check(...args),
  fetchUpdateAsync: (...args: unknown[]) => mockUpdates.fetch(...args),
}));

const HOUR = UPDATE_CHECK_INTERVAL_MS;

function fakeDeps(over: Partial<UpdateCheckDeps> & { available?: boolean } = {}) {
  const { available = false, ...rest } = over;
  const clock = { now: 1_000_000 };
  const calls: string[] = [];
  const deps: UpdateCheckDeps = {
    now: () => clock.now,
    isEnabled: () => true,
    check: async () => {
      calls.push("check");
      return { isAvailable: available };
    },
    fetch: async () => {
      calls.push("fetch");
      return { isNew: true };
    },
    ...rest,
  };
  return { deps, clock, calls };
}

describe("createForegroundUpdateChecker", () => {
  it("интервал - час", () => {
    expect(UPDATE_CHECK_INTERVAL_MS).toBe(3_600_000);
  });

  it("сразу после запуска не проверяет: запуск уже проверен (ON_LOAD)", async () => {
    const { deps, clock, calls } = fakeDeps();
    const run = createForegroundUpdateChecker(deps);
    clock.now += 5 * 60_000;
    expect(await run()).toBe("skipped");
    expect(calls).toEqual([]);
  });

  it("через час после запуска проверяет; обновления нет: ничего не скачивает", async () => {
    const { deps, clock, calls } = fakeDeps();
    const run = createForegroundUpdateChecker(deps);
    clock.now += HOUR;
    expect(await run()).toBe("none");
    expect(calls).toEqual(["check"]);
  });

  it("обновление есть: скачивает (карточка появится, когда оно скачано)", async () => {
    const { deps, clock, calls } = fakeDeps({ available: true });
    const run = createForegroundUpdateChecker(deps);
    clock.now += HOUR + 1;
    expect(await run()).toBe("downloaded");
    expect(calls).toEqual(["check", "fetch"]);
  });

  it("не чаще раза в час: второй возврат за час пропускается, через час после пробы разрешён снова", async () => {
    const { deps, clock, calls } = fakeDeps();
    const run = createForegroundUpdateChecker(deps);
    clock.now += HOUR;
    expect(await run()).toBe("none");
    clock.now += 30 * 60_000;
    expect(await run()).toBe("skipped");
    clock.now += 30 * 60_000 - 1;
    expect(await run()).toBe("skipped");
    clock.now += 1;
    expect(await run()).toBe("none");
    expect(calls).toEqual(["check", "check"]);
  });

  it("обновления выключены (разработка, Expo Go): никаких обращений, даже спустя часы", async () => {
    const { deps, clock, calls } = fakeDeps({ isEnabled: () => false });
    const run = createForegroundUpdateChecker(deps);
    clock.now += 10 * HOUR;
    expect(await run()).toBe("skipped");
    expect(calls).toEqual([]);
  });

  it("сбой проверки проглатывается, и он тоже считается пробой: бить в сервер чаще нельзя", async () => {
    let attempts = 0;
    const { deps, clock } = fakeDeps({
      check: async () => {
        attempts += 1;
        throw new Error("network down");
      },
    });
    const run = createForegroundUpdateChecker(deps);
    clock.now += HOUR;
    expect(await run()).toBe("failed");
    clock.now += 10 * 60_000;
    expect(await run()).toBe("skipped");
    expect(attempts).toBe(1);
  });

  it("сбой скачивания проглатывается", async () => {
    const { deps, clock } = fakeDeps({
      check: async () => ({ isAvailable: true }),
      fetch: async () => {
        throw new Error("download failed");
      },
    });
    const run = createForegroundUpdateChecker(deps);
    clock.now += HOUR;
    await expect(run()).resolves.toBe("failed");
  });

  it("ошибка самих часов или флага обновлений тоже не уходит наружу", async () => {
    const { deps } = fakeDeps({
      isEnabled: () => {
        throw new Error("native module is missing");
      },
    });
    await expect(createForegroundUpdateChecker(deps)()).resolves.toBe("failed");
  });

  it("одновременно идёт одна проверка", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let checks = 0;
    const { deps, clock } = fakeDeps({
      check: async () => {
        checks += 1;
        await gate;
        return { isAvailable: false };
      },
    });
    const run = createForegroundUpdateChecker(deps);
    clock.now += HOUR;
    const first = run();
    expect(await run()).toBe("skipped");
    // Первая проверка зависла и идёт дольше интервала: возврат через ещё час всё равно не запускает вторую рядом с ней.
    clock.now += HOUR;
    expect(await run()).toBe("skipped");
    expect(checks).toBe(1);
    release();
    expect(await first).toBe("none");
    expect(checks).toBe(1);
    // Когда первая закончилась, следующий возврат снова проверяет.
    clock.now += HOUR;
    expect(await run()).toBe("none");
    expect(checks).toBe(2);
  });

  it("часы ушли назад: ждём, пока они догонят, а не проверяем при каждом возврате", async () => {
    const { deps, clock } = fakeDeps();
    const run = createForegroundUpdateChecker(deps);
    clock.now -= 5 * HOUR;
    expect(await run()).toBe("skipped");
  });
});

describe("useForegroundUpdateCheck", () => {
  let handler: ((status: AppStateStatus) => void) | null = null;
  const remove = jest.fn();
  let now = 5_000_000;

  beforeEach(() => {
    handler = null;
    remove.mockClear();
    now = 5_000_000;
    mockUpdates.isEnabled = true;
    mockUpdates.check = jest.fn(async () => ({ isAvailable: true }));
    mockUpdates.fetch = jest.fn(async () => ({ isNew: true }));
    jest.spyOn(Date, "now").mockImplementation(() => now);
    jest.spyOn(AppState, "addEventListener").mockImplementation(((type: string, listener: (status: AppStateStatus) => void) => {
      if (type === "change") handler = listener;
      return { remove };
    }) as never);
  });
  afterEach(() => jest.restoreAllMocks());

  function Probe() {
    useForegroundUpdateCheck();
    return null;
  }

  it("на «active» через час проверяет и скачивает; свёрнутое и неактивное состояния ничего не запускают", async () => {
    await render(<Probe />);
    expect(handler).not.toBeNull();
    now += HOUR;
    handler?.("background");
    handler?.("inactive");
    await Promise.resolve();
    expect(mockUpdates.check).not.toHaveBeenCalled();
    handler?.("active");
    await new Promise((resolve) => setImmediate(resolve));
    expect(mockUpdates.check).toHaveBeenCalledTimes(1);
    expect(mockUpdates.fetch).toHaveBeenCalledTimes(1);
  });

  it("повторный возврат в течение часа ничего не спрашивает у сервера", async () => {
    await render(<Probe />);
    now += HOUR;
    handler?.("active");
    await new Promise((resolve) => setImmediate(resolve));
    now += 20 * 60_000;
    handler?.("active");
    await new Promise((resolve) => setImmediate(resolve));
    expect(mockUpdates.check).toHaveBeenCalledTimes(1);
  });

  it("обновления выключены: подписка есть, обращений к expo-updates нет", async () => {
    mockUpdates.isEnabled = false;
    await render(<Probe />);
    now += 3 * HOUR;
    handler?.("active");
    await new Promise((resolve) => setImmediate(resolve));
    expect(mockUpdates.check).not.toHaveBeenCalled();
    expect(mockUpdates.fetch).not.toHaveBeenCalled();
  });

  it("сбой проверки не доходит до экрана; при уходе с экрана подписка снимается", async () => {
    mockUpdates.check = jest.fn(async () => {
      throw new Error("timeout");
    });
    const view = await render(<Probe />);
    now += HOUR;
    handler?.("active");
    await new Promise((resolve) => setImmediate(resolve));
    expect(mockUpdates.check).toHaveBeenCalledTimes(1);
    await view.unmount();
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
