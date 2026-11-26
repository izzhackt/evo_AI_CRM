// Чтение выбора студента (тема, язык) с устройства для провайдеров: ответ приходит один раз, сбой и долгое ожидание не
// оставляют экран ждать вечно (рецензия #1568, п. 4).
import AsyncStorage from "@react-native-async-storage/async-storage";

import { HYDRATION_CAP_MS, hydrateFromStorage } from "@/lib/storage-hydration";

const getItem = AsyncStorage.getItem as unknown as jest.Mock;

/** Чтение, которое завершает тест: отдаёт значение или ошибку, когда скажем. */
function pendingRead() {
  let resolve!: (value: string | null) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<string | null>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  getItem.mockReturnValueOnce(promise);
  return { resolve, reject };
}

/** Даёт отработать цепочке обещаний после ответа хранилища (React здесь не участвует: счёт таймеров точный). */
const settle = () => jest.advanceTimersByTimeAsync(0);

beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});

describe("hydrateFromStorage", () => {
  it("предел ожидания - две секунды (записан числом: правка константы не должна незаметно сдвинуть его)", () => {
    expect(HYDRATION_CAP_MS).toBe(2_000);
  });

  it("отдаёт сохранённое значение, как только оно прочитано, и снимает таймер ожидания", async () => {
    const onResult = jest.fn();
    const before = jest.getTimerCount();
    const read = pendingRead();
    hydrateFromStorage("evo.theme", onResult);
    expect(jest.getTimerCount()).toBe(before + 1);
    expect(onResult).not.toHaveBeenCalled();

    read.resolve("dark");
    await settle();
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult).toHaveBeenCalledWith("dark");
    expect(jest.getTimerCount()).toBe(before);
  });

  it("читает именно свой ключ", async () => {
    pendingRead().resolve("ky");
    hydrateFromStorage("evo.lang", jest.fn());
    expect(getItem).toHaveBeenLastCalledWith("evo.lang");
    await settle();
  });

  it("на устройстве ничего нет: null, один раз", async () => {
    const onResult = jest.fn();
    pendingRead().resolve(null);
    hydrateFromStorage("evo.theme", onResult);
    await settle();
    expect(onResult.mock.calls).toEqual([[null]]);
  });

  it("чтение сорвалось: null, один раз, таймер снят", async () => {
    const onResult = jest.fn();
    const before = jest.getTimerCount();
    const read = pendingRead();
    hydrateFromStorage("evo.theme", onResult);
    read.reject(new Error("хранилище недоступно"));
    await settle();
    expect(onResult.mock.calls).toEqual([[null]]);
    expect(jest.getTimerCount()).toBe(before);
  });

  it("не уложилось в предел ожидания: null ровно по его истечении; запоздавшее значение приходит вторым ответом", async () => {
    const onResult = jest.fn();
    const read = pendingRead();
    hydrateFromStorage("evo.theme", onResult);

    await jest.advanceTimersByTimeAsync(HYDRATION_CAP_MS - 1);
    expect(onResult).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(onResult.mock.calls).toEqual([[null]]);

    read.resolve("dark");
    await settle();
    expect(onResult.mock.calls).toEqual([[null], ["dark"]]);
  });

  it("после предела запоздавшие «ничего нет» и ошибка не повторяют ответ", async () => {
    const quiet = jest.fn();
    const quietRead = pendingRead();
    hydrateFromStorage("evo.theme", quiet);
    const failing = jest.fn();
    const failingRead = pendingRead();
    hydrateFromStorage("evo.lang", failing);

    await jest.advanceTimersByTimeAsync(HYDRATION_CAP_MS);
    quietRead.resolve(null);
    failingRead.reject(new Error("хранилище недоступно"));
    await settle();
    expect(quiet.mock.calls).toEqual([[null]]);
    expect(failing.mock.calls).toEqual([[null]]);
  });

  it("предел задаётся параметром", async () => {
    const onResult = jest.fn();
    pendingRead();
    hydrateFromStorage("evo.theme", onResult, 50);
    await jest.advanceTimersByTimeAsync(49);
    expect(onResult).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(onResult.mock.calls).toEqual([[null]]);
  });

  it("отмена (экран ушёл): таймер снят, ответ ни до, ни после предела никому не уходит", async () => {
    const onResult = jest.fn();
    const before = jest.getTimerCount();
    const read = pendingRead();
    const cancel = hydrateFromStorage("evo.theme", onResult);
    cancel();
    expect(jest.getTimerCount()).toBe(before);

    read.resolve("dark");
    await jest.advanceTimersByTimeAsync(HYDRATION_CAP_MS * 2);
    expect(onResult).not.toHaveBeenCalled();
  });

  it("отмена после предела: запоздавшее значение больше не доставляется", async () => {
    const onResult = jest.fn();
    const read = pendingRead();
    const cancel = hydrateFromStorage("evo.theme", onResult);
    await jest.advanceTimersByTimeAsync(HYDRATION_CAP_MS);
    expect(onResult.mock.calls).toEqual([[null]]);
    cancel();
    read.resolve("dark");
    await settle();
    expect(onResult.mock.calls).toEqual([[null]]);
  });
});
