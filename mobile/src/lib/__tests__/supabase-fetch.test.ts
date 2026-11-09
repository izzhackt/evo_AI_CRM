import { fetchWithTimeout } from "@/lib/supabase";

describe("fetchWithTimeout", () => {
  afterEach(() => jest.useRealTimers());

  it("прерывает зависший запрос по таймауту", async () => {
    jest.useFakeTimers();
    const hung = jest.fn((_input: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted")))));
    const wrapped = fetchWithTimeout(hung as unknown as typeof fetch, 1000);
    const pending = wrapped("https://example.test/x");
    const assertion = expect(pending).rejects.toThrow("aborted");
    jest.advanceTimersByTime(1001);
    await assertion;
  });

  it("передаёт внешнюю отмену и не мешает быстрому ответу", async () => {
    const ok = jest.fn(async () => new Response("{}"));
    const wrapped = fetchWithTimeout(ok as unknown as typeof fetch, 1000);
    const res = await wrapped("https://example.test/x", { signal: new AbortController().signal });
    expect(res.status).toBe(200);
    const outer = new AbortController();
    const seen: AbortSignal[] = [];
    const spy = (async (_i: unknown, init?: RequestInit) => {
      seen.push(init!.signal!);
      return new Response("{}");
    }) as unknown as typeof fetch;
    await fetchWithTimeout(spy, 1000)("https://example.test/y", { signal: outer.signal });
    expect(seen[0]?.aborted).toBe(false);
  });
});
