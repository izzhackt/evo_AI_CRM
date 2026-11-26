// Токены отправки привязаны к студенту, который её начал (ревью #1560, L-A): отправка студента А не должна уйти с сессией студента Б,
// даже если первый ответ на неё пришёл как 401 уже после выхода А и входа Б.
import { sendWithRefresh, type ReceiptResponse } from "@/features/payments/receipt-upload";
import { ownerBoundTokens } from "@/features/payments/upload-session";

const ACK: ReceiptResponse = { status: 201, body: { receipt_id: "e5555555-5555-4555-8555-555555555555", status: "pending" } };

/** Устройство: `live.user` - кто вошёл сейчас, `calls` - сколько раз у сессии просили токен или обновление. */
function device(owner = "user-A") {
  const live: { user: string | null } = { user: owner };
  const calls = { read: 0, refresh: 0 };
  const api = {
    userKey: owner,
    getAccessToken: async () => {
      calls.read += 1;
      return live.user === null ? null : `token-${live.user}`;
    },
    refreshAccessToken: async () => {
      calls.refresh += 1;
      return live.user === null ? null : `renewed-${live.user}`;
    },
  };
  return { live, calls, api, tokens: ownerBoundTokens(api, async () => live.user) };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("ownerBoundTokens: токен выдаётся и обновляется, только пока вошёл тот же студент", () => {
  it("вошёл тот же студент: токен и обновление проходят как есть", async () => {
    const { tokens } = device("user-A");
    expect(await tokens.getToken()).toBe("token-user-A");
    expect(await tokens.refreshToken()).toBe("renewed-user-A");
  });

  it("вошёл другой студент: ни токена, ни обновления, и сессия другого студента даже не трогается", async () => {
    const { tokens, live, calls } = device("user-A");
    live.user = "user-B";
    expect(await tokens.getToken()).toBeNull();
    expect(await tokens.refreshToken()).toBeNull();
    expect(calls).toEqual({ read: 0, refresh: 0 });
  });

  it("никто не вошёл: отказ", async () => {
    const { tokens, live, calls } = device("user-A");
    live.user = null;
    expect(await tokens.getToken()).toBeNull();
    expect(await tokens.refreshToken()).toBeNull();
    expect(calls).toEqual({ read: 0, refresh: 0 });
  });

  it("не удалось узнать, кто вошёл: отказ, а не «наверное, свой»", async () => {
    const { api } = device("user-A");
    const broken = ownerBoundTokens(api, async () => {
      throw new Error("хранилище недоступно");
    });
    expect(await broken.getToken()).toBeNull();
    expect(await broken.refreshToken()).toBeNull();
  });

  it("сеть ответила уже после смены студента: токен отбрасывается", async () => {
    const live: { user: string | null } = { user: "user-A" };
    const api = {
      userKey: "user-A",
      getAccessToken: async () => "token-user-A",
      // обновление идёт по сети; пока оно идёт, А выходит и входит Б
      refreshAccessToken: async () => {
        await settle();
        live.user = "user-B";
        return "renewed";
      },
    };
    const tokens = ownerBoundTokens(api, async () => live.user);
    expect(await tokens.refreshToken()).toBeNull();
  });

  it("тот же студент вышел и вошёл снова: это его сессия, отправка продолжается", async () => {
    const { tokens, live } = device("user-A");
    live.user = null;
    expect(await tokens.getToken()).toBeNull();
    live.user = "user-A";
    expect(await tokens.getToken()).toBe("token-user-A");
  });

  it("токен не берётся из сессии без токена: null остаётся null", async () => {
    const api = { userKey: "user-A", getAccessToken: async () => null, refreshAccessToken: async () => null };
    const tokens = ownerBoundTokens(api, async () => "user-A");
    expect(await tokens.getToken()).toBeNull();
    expect(await tokens.refreshToken()).toBeNull();
  });
});

describe("sendWithRefresh с привязанными токенами: сценарий ревью", () => {
  /** Первый запрос висит, пока тест не ответит на него; второй (после обновления) отвечает сразу. */
  function twoPosts(tokens: ReturnType<typeof ownerBoundTokens>) {
    const posted: string[] = [];
    let answerFirst: (response: ReceiptResponse) => void = () => undefined;
    const result = sendWithRefresh(
      (token) => {
        posted.push(token);
        return posted.length === 1 ? new Promise<ReceiptResponse>((resolve) => (answerFirst = resolve)) : Promise.resolve(ACK);
      },
      tokens.getToken,
      tokens.refreshToken,
    );
    return { posted, result, answerFirst: (response: ReceiptResponse) => answerFirst(response) };
  }

  it("А вышел, вошёл Б, и только теперь пришёл 401: второй запрос не уходит, файл А не уйдёт с токеном Б", async () => {
    const { tokens, live, calls } = device("user-A");
    const send = twoPosts(tokens);
    await settle();
    expect(send.posted).toEqual(["token-user-A"]);
    live.user = "user-B";
    send.answerFirst({ status: 401, body: null });
    expect(await send.result).toEqual({ status: 401, body: null });
    expect(send.posted).toEqual(["token-user-A"]);
    expect(calls.refresh).toBe(0);
  });

  it("А просто на 401 обновляет свою сессию и повторяет запрос: это работает как прежде", async () => {
    const { tokens } = device("user-A");
    const send = twoPosts(tokens);
    await settle();
    send.answerFirst({ status: 401, body: null });
    expect(await send.result).toEqual(ACK);
    expect(send.posted).toEqual(["token-user-A", "renewed-user-A"]);
  });

  it("между нажатием и чтением токена вошёл другой студент: запрос не уходит совсем", async () => {
    const { tokens, live } = device("user-A");
    live.user = "user-B";
    const send = twoPosts(tokens);
    expect(await send.result).toEqual({ status: 401, body: null });
    expect(send.posted).toEqual([]);
  });
});
