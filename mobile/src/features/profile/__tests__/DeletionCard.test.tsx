import AsyncStorage from "@react-native-async-storage/async-storage";
import { fireEvent, screen } from "@testing-library/react-native";

import { OPEN_STEPS_PREFIX } from "@/features/admission/useOpenSteps";
import { DeletionCard } from "@/features/profile/DeletionCard";
import { RpcError } from "@/lib/rpc";
import { clearAllLocalData, registerLocalDataCleaner } from "@/session/local-data";
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
  it("запроса нет: описание и «Удалить аккаунт»; подтверждение отдельным шагом, «Отмена» возвращает", async () => {
    const { transport, calls } = fakeTransport({ own_account_deletion_request_v1: null });
    await renderPortal(<DeletionCard />, testApi(transport));
    expect(await screen.findByText("Мы удалим аккаунт и связанные с ним данные в течение 30 дней.")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("deletion-start"));
    expect(screen.getByText("Удалить аккаунт и связанные с ним данные?")).toBeTruthy();
    expect(screen.getByText("Запрос нельзя отменить. Пока аккаунт не удалён, он работает как обычно.")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("deletion-cancel"));
    expect(screen.getByTestId("deletion-start")).toBeTruthy();
    expect(calls.some((c) => c.name === "request_account_deletion_v2")).toBe(false);
  });

  it("подтверждение шлёт request_account_deletion_v2 и показывает статус с датой срока", async () => {
    const { transport, calls } = fakeTransport({ own_account_deletion_request_v1: null, request_account_deletion_v2: open });
    await renderPortal(<DeletionCard />, testApi(transport));
    await fireEvent.press(await screen.findByTestId("deletion-start"));
    await fireEvent.press(screen.getByTestId("deletion-confirm-yes"));
    expect(await screen.findByText("Запрос на удаление принят 09.11.2026.")).toBeTruthy();
    expect(screen.getByText("Удалим аккаунт и связанные с ним данные до 09.12.2026.")).toBeTruthy();
    const write = calls.filter((c) => c.name === "request_account_deletion_v2");
    expect(write).toHaveLength(1);
    expect(write[0]?.args).toEqual({ p_request_id: expect.stringMatching(/^[0-9a-f-]{36}$/) });
  });

  it("сбой: честная ошибка, повтор шлёт тот же p_request_id", async () => {
    const { transport, calls } = fakeTransport({
      own_account_deletion_request_v1: null,
      request_account_deletion_v2: (_a: unknown, n: number) => (n === 1 ? failure("XX000", 500) : open),
    });
    await renderPortal(<DeletionCard />, testApi(transport));
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
    await renderPortal(<DeletionCard />, testApi(a.transport));
    expect(await screen.findByTestId("deletion-status")).toBeTruthy();
    expect(screen.queryByTestId("deletion-start")).toBeNull();
    const b = fakeTransport({ own_account_deletion_request_v1: { ...open, status: "processing" } });
    await renderPortal(<DeletionCard />, testApi(b.transport));
    expect(await screen.findByText("Удаляем аккаунт и связанные с ним данные. После этого войти будет нельзя.")).toBeTruthy();
  });

  it("не удалось проверить запрос: ошибка вместо кнопки поверх возможного запроса", async () => {
    const { transport } = fakeTransport({ own_account_deletion_request_v1: new RpcError("server") });
    await renderPortal(<DeletionCard />, testApi(transport));
    expect(await screen.findByText("Не удалось проверить запрос на удаление. Обновите страницу.")).toBeTruthy();
    expect(screen.queryByTestId("deletion-start")).toBeNull();
  });

  it("«Выйти и стереть данные на этом устройстве» вызывает выход", async () => {
    const { transport } = fakeTransport({ own_account_deletion_request_v1: open });
    await renderPortal(<DeletionCard />, testApi(transport));
    await fireEvent.press(await screen.findByTestId("deletion-sign-out"));
    expect(mockSession.signOut).toHaveBeenCalledTimes(1);
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
