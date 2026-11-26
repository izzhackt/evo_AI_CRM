// Полоса «потянули вниз» (ревью #1572/#1583): горит только у запроса, который начал сам студент, и гаснет по его концу, в том числе по сбою.
import { act, renderHook } from "@testing-library/react-native";

import { usePullRefresh } from "@/features/universities/use-pull-refresh";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe("usePullRefresh", () => {
  it("полоса горит, пока идёт перечитывание, начатое вызовом `pull`; результат перечитывания возвращается", async () => {
    const pending = deferred<string>();
    const refetch = jest.fn(() => pending.promise);
    const { result } = await renderHook(() => usePullRefresh(refetch));
    expect(result.current.refreshing).toBe(false);
    let outcome: Promise<string> | null = null;
    await act(async () => {
      outcome = result.current.pull();
    });
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(result.current.refreshing).toBe(true);
    await act(async () => {
      pending.resolve("готово");
    });
    expect(result.current.refreshing).toBe(false);
    await expect(outcome).resolves.toBe("готово");
  });

  it("сбой перечитывания тоже гасит полосу и доходит до вызывающего", async () => {
    const pending = deferred<string>();
    const { result } = await renderHook(() => usePullRefresh(() => pending.promise));
    let outcome: Promise<string> | null = null;
    await act(async () => {
      outcome = result.current.pull();
      outcome.catch(() => undefined);
    });
    expect(result.current.refreshing).toBe(true);
    await act(async () => {
      pending.reject(new Error("сеть"));
    });
    expect(result.current.refreshing).toBe(false);
    await expect(outcome).rejects.toThrow("сеть");
  });

  it("само перечитывание запроса без `pull` полосу не включает; `pull` не меняется, пока не изменилось перечитывание", async () => {
    const refetch = jest.fn(async () => "x");
    const { result, rerender } = await renderHook(() => usePullRefresh(refetch));
    const first = result.current.pull;
    await act(async () => {
      await refetch();
    });
    expect(result.current.refreshing).toBe(false);
    await rerender(undefined);
    expect(result.current.pull).toBe(first);
  });
});
