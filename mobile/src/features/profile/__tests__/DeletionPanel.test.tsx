import AsyncStorage from "@react-native-async-storage/async-storage";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { OPEN_STEPS_PREFIX } from "@/features/admission/useOpenSteps";
import { DeletionPanel } from "@/features/profile/DeletionPanel";
import { LangProvider } from "@/i18n/LangProvider";
import { RpcError } from "@/lib/rpc";
import { clearAllLocalData, registerLocalDataCleaner } from "@/session/local-data";
import { ThemeProvider } from "@/theme/ThemeProvider";
import { renderPortal, testApi } from "@/test-fixtures/render";
import { failure, fakeTransport } from "@/test-fixtures/universities";

const mockSession = { signOut: jest.fn(async () => undefined) };
jest.mock("@/session/SessionProvider", () => ({ useSession: () => mockSession }));
// Кэш файлов — на нативном модуле файловой системы; в Jest проверяем только вызов очистки.
const mockClearDownloads = jest.fn(async () => undefined);
jest.mock("@/features/documents/download-cache", () => ({ clearDownloadCache: () => mockClearDownloads() }));

const open = {
  requestId: "11111111-1111-4111-8111-111111111111",
  status: "requested",
  requestedAt: "2026-11-09T08:00:00+00:00",
  dueAt: "2026-12-09T08:00:00+00:00",
};

beforeEach(() => {
  mockSession.signOut.mockClear();
  mockClearDownloads.mockClear();
});

describe("удаление аккаунта", () => {
  it("запроса нет: одна кнопка «Удалить аккаунт» без пояснений; подтверждение отдельным шагом, «Отмена» возвращает", async () => {
    const { transport, calls } = fakeTransport({ own_account_deletion_request_v1: null });
    await renderPortal(<DeletionPanel />, testApi(transport));
    expect(await screen.findByText("Удалить аккаунт")).toBeTruthy();
    // Решение владельца 14.11.2026: срок и хранение записей на рабочем экране не поясняются (слова окна подтверждения остаются).
    expect(screen.queryByText("Мы удалим аккаунт и связанные с ним данные в течение 30 дней.")).toBeNull();
    expect(screen.queryByText(/хранятся обезличенно/)).toBeNull();
    await fireEvent.press(screen.getByTestId("deletion-start"));
    expect(screen.getByText("Удалить аккаунт и связанные с ним данные?")).toBeTruthy();
    expect(screen.getByText("Запрос нельзя отменить. Пока аккаунт не удалён, он работает как обычно.")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("deletion-cancel"));
    expect(screen.getByTestId("deletion-start")).toBeTruthy();
    expect(calls.some((c) => c.name === "request_account_deletion_v2")).toBe(false);
  });

  it("подтверждение шлёт request_account_deletion_v2 и показывает статус с датой срока", async () => {
    const { transport, calls } = fakeTransport({ own_account_deletion_request_v1: null, request_account_deletion_v2: open });
    await renderPortal(<DeletionPanel />, testApi(transport));
    await fireEvent.press(await screen.findByTestId("deletion-start"));
    await fireEvent.press(screen.getByTestId("deletion-confirm-yes"));
    expect(await screen.findByText("Запрос на удаление принят 09.11.2026.")).toBeTruthy();
    expect(screen.getByText("Удалим аккаунт и связанные с ним данные до 09.12.2026.")).toBeTruthy();
    expect(screen.queryByText(/хранятся обезличенно/)).toBeNull();
    const write = calls.filter((c) => c.name === "request_account_deletion_v2");
    expect(write).toHaveLength(1);
    expect(write[0]?.args).toEqual({ p_request_id: expect.stringMatching(/^[0-9a-f-]{36}$/) });
  });

  it("сбой: честная ошибка, повтор шлёт тот же p_request_id", async () => {
    const { transport, calls } = fakeTransport({
      own_account_deletion_request_v1: null,
      request_account_deletion_v2: (_a: unknown, n: number) => (n === 1 ? failure("XX000", 500) : open),
    });
    await renderPortal(<DeletionPanel />, testApi(transport));
    await fireEvent.press(await screen.findByTestId("deletion-start"));
    await fireEvent.press(screen.getByTestId("deletion-confirm-yes"));
    expect(await screen.findByText("Не удалось отправить запрос. Проверьте соединение и попробуйте снова.")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("deletion-confirm-yes"));
    await screen.findByText("Запрос на удаление принят 09.11.2026.");
    const writes = calls.filter((c) => c.name === "request_account_deletion_v2");
    expect(writes).toHaveLength(2);
    expect(writes[1]?.args?.p_request_id).toBe(writes[0]?.args?.p_request_id);
  });

  it("уже есть запрос (другое устройство): статус без кнопки удаления; processing — свой текст", async () => {
    const a = fakeTransport({ own_account_deletion_request_v1: open });
    await renderPortal(<DeletionPanel />, testApi(a.transport));
    expect(await screen.findByTestId("deletion-status")).toBeTruthy();
    expect(screen.queryByTestId("deletion-start")).toBeNull();
    const b = fakeTransport({ own_account_deletion_request_v1: { ...open, status: "processing" } });
    await renderPortal(<DeletionPanel />, testApi(b.transport));
    expect(await screen.findByText("Удаляем аккаунт и связанные с ним данные. После этого войти будет нельзя.")).toBeTruthy();
  });

  it("не удалось проверить запрос: ошибка вместо кнопки поверх возможного запроса", async () => {
    const { transport } = fakeTransport({ own_account_deletion_request_v1: new RpcError("server") });
    await renderPortal(<DeletionPanel />, testApi(transport));
    expect(await screen.findByText("Не удалось проверить запрос на удаление. Обновите страницу.")).toBeTruthy();
    expect(screen.queryByTestId("deletion-start")).toBeNull();
  });

  it("«Выйти и стереть данные на этом устройстве» вызывает выход", async () => {
    const { transport } = fakeTransport({ own_account_deletion_request_v1: open });
    await renderPortal(<DeletionPanel />, testApi(transport));
    await fireEvent.press(await screen.findByTestId("deletion-sign-out"));
    expect(mockSession.signOut).toHaveBeenCalledTimes(1);
  });
});

// До кабинета (анкета, статус анкеты, «Доступ готовится») `PortalApiProvider` нет: `usePortalApi()` там бросает ошибку,
// поэтому панель получает транспорт и ключ кэша явно (G9 аудита паритета, Apple 5.1.1(v)).
const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
async function renderBeforeCabinet(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity }, mutations: { retry: false, gcTime: Infinity } } });
  const result = await render(
    <SafeAreaProvider initialMetrics={metrics}>
      <ThemeProvider>
        <LangProvider initial="ru">
          <QueryClientProvider client={client}>{ui}</QueryClientProvider>
        </LangProvider>
      </ThemeProvider>
    </SafeAreaProvider>,
  );
  return { ...result, client };
}

describe("удаление аккаунта до кабинета: явный источник, как на вебе (look=apply)", () => {
  it("без PortalApiProvider панель читает статус, подтверждает и шлёт request_account_deletion_v2 с тем же p_request_id при повторе", async () => {
    const { transport, calls } = fakeTransport({
      own_account_deletion_request_v1: null,
      request_account_deletion_v2: (_a: unknown, n: number) => (n === 1 ? failure("XX000", 500) : open),
    });
    const { client } = await renderBeforeCabinet(<DeletionPanel source={{ transport, userKey: "applicant" }} look="apply" />);
    await fireEvent.press(await screen.findByTestId("deletion-start"));
    await fireEvent.press(screen.getByTestId("deletion-confirm-yes"));
    expect(await screen.findByText("Не удалось отправить запрос. Проверьте соединение и попробуйте снова.")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("deletion-confirm-yes"));
    expect(await screen.findByText("Запрос на удаление принят 09.11.2026.")).toBeTruthy();
    const writes = calls.filter((c) => c.name === "request_account_deletion_v2");
    expect(writes).toHaveLength(2);
    expect(writes[0]?.args).toEqual({ p_request_id: expect.stringMatching(/^[0-9a-f-]{36}$/) });
    expect(writes[1]?.args?.p_request_id).toBe(writes[0]?.args?.p_request_id);
    // ответ лёг в кэш под ключ явного источника
    expect(client.getQueryData(["portal", "applicant", "account-deletion"])).toMatchObject({ requestId: open.requestId, status: "requested" });
  });

  it("look=apply говорит о сроке и хранении записей (description, keptNote), look=portal молчит", async () => {
    const a = fakeTransport({ own_account_deletion_request_v1: null });
    const apply = await renderBeforeCabinet(<DeletionPanel source={{ transport: a.transport, userKey: "applicant" }} look="apply" />);
    expect(await screen.findByText("Мы удалим аккаунт и связанные с ним данные в течение 30 дней.")).toBeTruthy();
    expect(screen.getByText("Записи о договоре и оплатах хранятся обезличенно столько, сколько требует закон.")).toBeTruthy();
    await apply.unmount();
    const b = fakeTransport({ own_account_deletion_request_v1: null });
    await renderBeforeCabinet(<DeletionPanel source={{ transport: b.transport, userKey: "applicant" }} />);
    await screen.findByTestId("deletion-start");
    expect(screen.queryByTestId("deletion-description")).toBeNull();
    expect(screen.queryByTestId("deletion-kept-note")).toBeNull();
  });

  it("запрос уже принят: статус, пояснение о хранении записей и «Выйти и стереть данные на этом устройстве»", async () => {
    const { transport } = fakeTransport({ own_account_deletion_request_v1: open });
    await renderBeforeCabinet(<DeletionPanel source={{ transport, userKey: "applicant" }} look="apply" />);
    expect(await screen.findByTestId("deletion-status")).toBeTruthy();
    expect(screen.getByTestId("deletion-kept-note")).toBeTruthy();
    expect(screen.queryByTestId("deletion-start")).toBeNull();
    await fireEvent.press(screen.getByTestId("deletion-sign-out"));
    expect(mockSession.signOut).toHaveBeenCalledTimes(1);
  });

  it("без явного источника и без кабинета ошибка называет причину, а не молча ломает экран", async () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await expect(renderBeforeCabinet(<DeletionPanel />)).rejects.toThrow(/требует явного источника/);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("очистка локальных данных (выход и удаление аккаунта)", () => {
  it("стирает состояние интерфейса пользователя, кэш файлов и зарегистрированные кэши других срезов", async () => {
    await AsyncStorage.setItem(`${OPEN_STEPS_PREFIX}:user-a:cn:1`, "[\"s1\"]");
    await AsyncStorage.setItem("evo.lang", "ky"); // настройка устройства, не данные студента
    const universities = jest.fn(async () => undefined);
    const off = registerLocalDataCleaner(universities);
    await clearAllLocalData();
    expect(await AsyncStorage.getItem(`${OPEN_STEPS_PREFIX}:user-a:cn:1`)).toBeNull();
    expect(await AsyncStorage.getItem("evo.lang")).toBe("ky");
    expect(mockClearDownloads).toHaveBeenCalledTimes(1);
    expect(universities).toHaveBeenCalledTimes(1);
    off();
  });

  it("сбой одной очистки не мешает остальным", async () => {
    const ok = jest.fn(async () => undefined);
    const offBad = registerLocalDataCleaner(async () => { throw new Error("disk"); });
    const offOk = registerLocalDataCleaner(ok);
    await expect(clearAllLocalData()).resolves.toBeUndefined();
    expect(ok).toHaveBeenCalled();
    expect(mockClearDownloads).toHaveBeenCalled();
    offBad();
    offOk();
  });
});
