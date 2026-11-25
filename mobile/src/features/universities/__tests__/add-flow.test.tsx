// «Добавить в мои программы» на странице вуза (G39): после успеха открывается страница программы, у добавленного набора «Открыть»,
// отказы читаются словами веба, повтор после обрыва идёт с тем же запросом. Экран настоящий, транспорт поддельный.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import { router } from "expo-router";

import { UniversityScreen } from "@/features/universities/UniversityScreen";
import { preparationHref } from "@/features/preparations/routes";
import { RpcError } from "@/lib/rpc";
import { PortalShell, renderPortal, testApi, testClient } from "@/test-fixtures/render";
import { detailBody, documentsBody, initializeReceipt, preparationItem, program, selectReceipt } from "@/test-fixtures/programs";
import { failure, fakeTransport, STUDENT_CASE_ID, uuidN } from "@/test-fixtures/universities";

const mockParams: { current: Record<string, string> } = { current: {} };
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => mockParams.current,
  useNavigation: () => ({ getState: () => ({ routes: [{ name: "index" }] }) }),
  router: { push: jest.fn(), back: jest.fn(), canGoBack: () => false, setParams: jest.fn(), navigate: jest.fn(), replace: jest.fn(), dismissTo: jest.fn() },
}));
jest.mock("@/config", () => ({ getConfig: () => ({ supabaseUrl: "http://localhost:46421", supabasePublishableKey: "k", portalBaseUrl: "http://localhost:46430" }) }));

// Страница программы открывается по запасному таймеру (900 мс) или по закрытию окна; на медленном раннере CI ждём с запасом.
jest.setTimeout(30_000);

beforeEach(async () => {
  mockParams.current = { id: uuidN(1) };
  (router.push as jest.Mock).mockClear();
  await AsyncStorage.clear();
});

const programs = [
  program({ id: "cs-b", title: "Bachelor of Computer Science", intakes: [{ label: "Сентябрь 2027", startMonth: "2027-09", n: 11 }] }),
  program({ id: "ai-m", title: "Master of Artificial Intelligence", level: "master", intakes: [{ label: "Октябрь 2027", startMonth: "2027-10", deadline: null, status: "closed", n: 12 }] }),
];
const item = preparationItem({ n: 9, programs, programId: "cs-b" });

/** Сервер: выбор ещё не сделан, после него в списке и в карточке вуза появляется заявка. */
function world(extra: Record<string, unknown> = {}, detail: { preparations?: unknown } = {}) {
  const state = { selected: false };
  const t = fakeTransport({
    student_university_detail_v1: () => detailBody(programs, { preparations: detail.preparations !== undefined ? detail.preparations : { studentCaseId: STUDENT_CASE_ID, items: state.selected ? [item] : [] } }),
    student_university_favorites_v1: [],
    student_catalog_preparations_v1: () => (state.selected ? [item] : []),
    student_select_catalog_intake_v1: (args: Record<string, unknown> | undefined) => {
      state.selected = true;
      return selectReceipt(item, args);
    },
    student_application_documents_v1: documentsBody(item.applicationId),
    student_initialize_application_requirements_v1: (args: Record<string, unknown> | undefined) => initializeReceipt(item.applicationId, args),
    ...extra,
  });
  return { ...t, state };
}

async function open(w: ReturnType<typeof world>, api: Parameters<typeof testApi>[1] = {}) {
  const result = await renderPortal(<UniversityScreen />, testApi(w.transport, api));
  await screen.findByText("Программы вуза");
  return result;
}

async function openProgram(id: string) {
  await fireEvent.press(await screen.findByTestId(`program-${id}`));
  await screen.findByTestId("program-dialog-title");
}

const sends = (w: ReturnType<typeof world>) => w.calls.filter((call) => call.name === "student_select_catalog_intake_v1");

/** Подождать, пока отработают таймеры экрана (запасной переход на страницу программы - 900 мс); внутри `act`, чтобы оповещения запросов не шумели. */
const idle = (ms: number) =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });

describe("успешное добавление", () => {
  it("выбор уходит, окно закрывается, открывается страница программы; список документов открыт отдельным вызовом", async () => {
    const w = world();
    await open(w);
    await openProgram("cs-b");
    expect(within(screen.getByTestId("program-dialog")).getByText("Это ещё не подача заявки в университет.", { exact: false })).toBeTruthy();
    await fireEvent.press(screen.getByTestId("program-add"));
    await waitFor(() => expect(screen.queryByTestId("program-dialog-title")).toBeNull());
    // страница программы открывается после закрытия окна (на iOS по его `onDismiss`, иначе по таймеру), один раз
    await waitFor(() => expect(router.push).toHaveBeenCalledTimes(1), { timeout: 10_000 });
    expect(router.push).toHaveBeenCalledWith(preparationHref(item.applicationId));
    expect((router.push as jest.Mock).mock.calls[0][0]).toEqual({ pathname: "/preparations/[applicationId]", params: { applicationId: item.applicationId } });
    expect(w.calls.map((call) => call.name)).toEqual(expect.arrayContaining(["student_select_catalog_intake_v1", "student_application_documents_v1", "student_initialize_application_requirements_v1"]));
    expect(sends(w)).toHaveLength(1);
    expect(await AsyncStorage.getAllKeys()).toEqual([]);
  });

  it("карточка вуза перечитывается: у набора теперь «Открыть», а не «Добавить»", async () => {
    const w = world();
    await open(w);
    await openProgram("cs-b");
    await fireEvent.press(screen.getByTestId("program-add"));
    await waitFor(() => expect(w.calls.filter((call) => call.name === "student_university_detail_v1").length).toBeGreaterThanOrEqual(2));
    await fireEvent.press(await screen.findByTestId("program-cs-b"));
    expect(await screen.findByTestId("program-open")).toBeTruthy();
    expect(screen.queryByTestId("program-add")).toBeNull();
  });

  it("уже добавленный набор: «Открыть» сначала закрывает окно и только по его закрытию ведёт на страницу программы, добавить второй раз нельзя", async () => {
    const w = world({}, { preparations: { studentCaseId: STUDENT_CASE_ID, items: [item] } });
    await open(w);
    await openProgram("cs-b");
    expect(screen.queryByTestId("program-add")).toBeNull();
    expect(within(screen.getByTestId("program-open")).getByText("Открыть")).toBeTruthy();
    // к переходу окно уже закрыто: иначе страница программы открылась бы ПОД ещё показанным нативным окном
    let dialogOpenAtPush: boolean | null = null;
    (router.push as jest.Mock).mockImplementationOnce(() => {
      dialogOpenAtPush = screen.queryByTestId("program-dialog-title") !== null;
    });
    // окно у настоящего iOS само вызывает `onDismiss`, когда закрылось; здесь обработчик берётся, пока окно открыто, и вызывается после
    const dismissed = screen.getByTestId("program-dialog").props.onDismiss as () => void;
    await fireEvent.press(screen.getByTestId("program-open"));
    expect(screen.queryByTestId("program-dialog-title")).toBeNull();
    expect(router.push).not.toHaveBeenCalled();
    await act(async () => {
      dismissed();
    });
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith(preparationHref(item.applicationId));
    expect(dialogOpenAtPush).toBe(false);
    // запасной таймер второй переход не делает
    await idle(1_200);
    expect(router.push).toHaveBeenCalledTimes(1);
  });

  it("«Открыть»: запасной таймер сработал раньше `onDismiss` окна, запоздавший `onDismiss` второго перехода не делает (ровно один переход)", async () => {
    const w = world({}, { preparations: { studentCaseId: STUDENT_CASE_ID, items: [item] } });
    await open(w);
    await openProgram("cs-b");
    const dismissed = screen.getByTestId("program-dialog").props.onDismiss as () => void;
    await fireEvent.press(screen.getByTestId("program-open"));
    await waitFor(() => expect(router.push).toHaveBeenCalledTimes(1), { timeout: 10_000 });
    await act(async () => {
      dismissed(); // iOS сообщил о закрытии окна уже после запасного таймера
    });
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith(preparationHref(item.applicationId));
  });

  it("окно программы закрывается и жестом вниз на iOS (`allowSwipeDismissal`): тем же путём, что крестик", async () => {
    const w = world();
    await open(w);
    await openProgram("cs-b");
    const sheet = screen.getByTestId("program-dialog");
    expect(sheet.props.allowSwipeDismissal).toBe(true);
    await act(async () => {
      sheet.props.onRequestClose(); // жест вниз и «Назад» Android приходят сюда же
    });
    expect(screen.queryByTestId("program-dialog-title")).toBeNull();
    await openProgram("cs-b");
    await fireEvent.press(screen.getByTestId("program-dialog-close"));
    expect(screen.queryByTestId("program-dialog-title")).toBeNull();
  });

  it("«Открыть», если окно не сообщило о закрытии: страница программы открывается по запасному таймеру, один раз", async () => {
    const w = world({}, { preparations: { studentCaseId: STUDENT_CASE_ID, items: [item] } });
    await open(w);
    await openProgram("cs-b");
    await fireEvent.press(screen.getByTestId("program-open"));
    expect(router.push).not.toHaveBeenCalled();
    await waitFor(() => expect(router.push).toHaveBeenCalledTimes(1), { timeout: 10_000 });
    expect(router.push).toHaveBeenCalledWith(preparationHref(item.applicationId));
  });

  it("KY: кнопка и пояснение из общего словаря веба", async () => {
    const w = world();
    await renderPortal(<UniversityScreen />, testApi(w.transport), "ky");
    await fireEvent.press(await screen.findByTestId("program-cs-b"));
    expect(within(await screen.findByTestId("program-add")).getByText("Менин программаларыма кошуу")).toBeTruthy();
    expect(screen.getByText("Бул университетке арыз жөнөтүү эмес.", { exact: false })).toBeTruthy();
  });
});

describe("обрыв и повтор", () => {
  it("обрыв: «не получилось проверить», кнопка «Проверить сохранение и продолжить»; повтор шлёт тот же запрос и проходит", async () => {
    const w = world({
      student_select_catalog_intake_v1: (args: Record<string, unknown> | undefined, n: number) => {
        if (n <= 3) return new RpcError("transport");
        w.state.selected = true;
        return selectReceipt(item, args);
      },
    });
    await open(w);
    await openProgram("cs-b");
    await fireEvent.press(screen.getByTestId("program-add"));
    expect(await screen.findByTestId("program-error")).toBeTruthy();
    expect(screen.getByTestId("program-error").props.children).toBe("Не получилось проверить, сохранилось ли действие. Повторите попытку — запрос продолжится, ничего не задвоится.");
    expect(within(screen.getByTestId("program-add")).getByText("Проверить сохранение и продолжить")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("program-add"));
    await waitFor(() => expect(router.push).toHaveBeenCalledTimes(1), { timeout: 10_000 });
    const ids = new Set(sends(w).map((call) => call.args?.p_request_id));
    expect(ids.size).toBe(1);
  });

  it("запрос переживает закрытие экрана: после возврата кнопка уже «Проверить сохранение», повтор с тем же id", async () => {
    const w = world({ student_select_catalog_intake_v1: new RpcError("transport") });
    const first = await open(w);
    await openProgram("cs-b");
    await fireEvent.press(screen.getByTestId("program-add"));
    await screen.findByTestId("program-error");
    const usedId = sends(w)[0]!.args!.p_request_id;
    await first.unmount();

    const again = world({
      student_select_catalog_intake_v1: (args: Record<string, unknown> | undefined) => {
        again.state.selected = true;
        return selectReceipt(item, args);
      },
    });
    await open(again);
    await openProgram("cs-b");
    await waitFor(() => expect(within(screen.getByTestId("program-add")).getByText("Проверить сохранение и продолжить")).toBeTruthy());
    await fireEvent.press(screen.getByTestId("program-add"));
    await waitFor(() => expect(sends(again)).toHaveLength(1));
    expect(sends(again)[0]!.args!.p_request_id).toBe(usedId);
  });
});

describe("отказы и крайние состояния словами веба", () => {
  it("публикация устарела: причина, кнопки «Добавить» нет, «Обновить страницу» перечитывает карточку и возвращает кнопку", async () => {
    let refused = true;
    const w = world({
      student_select_catalog_intake_v1: async (args: Record<string, unknown> | undefined) => {
        if (refused) {
          const { rpcRead } = jest.requireActual<typeof import("@/lib/rpc")>("@/lib/rpc");
          throw await rpcRead(() => Promise.resolve({ data: null, error: { code: "PT409", message: "catalog_preparation_stale_publication" } as never, status: 409 }), "x").catch((e: unknown) => e);
        }
        return selectReceipt(item, args);
      },
    });
    await open(w);
    await openProgram("cs-b");
    await fireEvent.press(screen.getByTestId("program-add"));
    expect((await screen.findByTestId("program-error")).props.children).toBe("Карточка программы обновилась. Обновите страницу и проверьте набор перед выбором.");
    expect(screen.queryByTestId("program-add")).toBeNull();
    expect(await AsyncStorage.getAllKeys()).toEqual([]); // окончательный отказ запрос не оставляет
    const before = w.calls.filter((call) => call.name === "student_university_detail_v1").length;
    refused = false;
    await fireEvent.press(screen.getByTestId("program-refresh"));
    await waitFor(() => expect(w.calls.filter((call) => call.name === "student_university_detail_v1").length).toBe(before + 1));
    expect(await screen.findByTestId("program-add")).toBeTruthy();
    expect(screen.queryByTestId("program-error")).toBeNull();
  });

  it("набор закрыт: причина вместо кнопки, ничего не отправляется", async () => {
    const w = world();
    await open(w);
    await openProgram("ai-m");
    expect(screen.queryByTestId("program-add")).toBeNull();
    expect(screen.getByTestId("program-unavailable").props.children).toBe("Набор закрыт для нового выбора.");
    expect(sends(w)).toHaveLength(0);
  });

  it("список программ не читается: «Не удалось загрузить ваши программы» и «Обновить страницу»; добавить нельзя", async () => {
    const w = world({}, { preparations: null });
    await open(w);
    await openProgram("cs-b");
    expect(screen.getByTestId("program-unavailable").props.children).toBe("Не удалось загрузить ваши программы. Обновите страницу перед новым добавлением.");
    expect(screen.queryByTestId("program-add")).toBeNull();
    const before = w.calls.filter((call) => call.name === "student_university_detail_v1").length;
    await fireEvent.press(screen.getByTestId("program-refresh"));
    await waitFor(() => expect(w.calls.filter((call) => call.name === "student_university_detail_v1").length).toBe(before + 1));
  });

  it("выбор закрыт для дела: одно объяснение над списком, на наборах действия нет", async () => {
    const w = world();
    await open(w, { canSelectPrograms: false });
    expect(screen.getByTestId("programs-case-ineligible").props.children).toMatch(/^Новые программы в «Мои программы» открывает куратор при активном сопровождении\./);
    await openProgram("cs-b");
    expect(screen.queryByTestId("program-add")).toBeNull();
    expect(screen.queryByTestId("program-unavailable")).toBeNull();
  });

  it("нет доступа (42501): «Не получается открыть это сейчас», без повтора", async () => {
    const w = world({ student_select_catalog_intake_v1: failure("42501", 403) });
    await open(w);
    await openProgram("cs-b");
    await fireEvent.press(screen.getByTestId("program-add"));
    expect((await screen.findByTestId("program-error")).props.children).toMatch(/^Не получается открыть это сейчас\./);
    expect(screen.queryByTestId("program-add")).toBeNull();
  });
});

describe("не мешают друг другу", () => {
  it("сбой открытия списка документов не отменяет добавление: страница программы всё равно открывается", async () => {
    const w = world({ student_application_documents_v1: new RpcError("server", "XX000", 500) });
    await open(w);
    await openProgram("cs-b");
    await fireEvent.press(screen.getByTestId("program-add"));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith(preparationHref(item.applicationId)), { timeout: 10_000 });
  });

  it("повторное нажатие, пока идёт запрос, второго выбора не отправляет", async () => {
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const w = world({
      student_select_catalog_intake_v1: async (args: Record<string, unknown> | undefined) => {
        await gate;
        w.state.selected = true;
        return selectReceipt(item, args);
      },
    });
    await open(w);
    await openProgram("cs-b");
    await fireEvent.press(screen.getByTestId("program-add"));
    await fireEvent.press(screen.getByTestId("program-add"));
    await act(async () => {
      release?.();
    });
    await waitFor(() => expect(router.push).toHaveBeenCalledTimes(1), { timeout: 10_000 });
    expect(sends(w)).toHaveLength(1);
  });

  it("студент ушёл с экрана, пока выбор в полёте: выбор доходит до конца, но страница программы из чужого места не открывается", async () => {
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const w = world({
      student_select_catalog_intake_v1: async (args: Record<string, unknown> | undefined) => {
        await gate;
        w.state.selected = true;
        return selectReceipt(item, args);
      },
    });
    const view = await open(w);
    await openProgram("cs-b");
    await fireEvent.press(screen.getByTestId("program-add"));
    await view.unmount(); // «Назад» со страницы вуза
    await act(async () => {
      release?.();
    });
    await waitFor(() => expect(w.calls.some((call) => call.name === "student_initialize_application_requirements_v1")).toBe(true), { timeout: 10_000 });
    await waitFor(async () => expect(await AsyncStorage.getAllKeys()).toEqual([]));
    await idle(1_200); // дольше запасного таймера перехода (900 мс)
    expect(sends(w)).toHaveLength(1);
    expect(router.push).not.toHaveBeenCalled();
  });

  it("окно программы закрыли, пока выбор в полёте: выбор доходит до конца, страница программы не открывается, у набора потом «Открыть»", async () => {
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const w = world({
      student_select_catalog_intake_v1: async (args: Record<string, unknown> | undefined) => {
        await gate;
        w.state.selected = true;
        return selectReceipt(item, args);
      },
    });
    await open(w);
    await openProgram("cs-b");
    await fireEvent.press(screen.getByTestId("program-add"));
    await fireEvent.press(screen.getByTestId("program-dialog-close"));
    expect(screen.queryByTestId("program-dialog-title")).toBeNull();
    const reads = () => w.calls.filter((call) => call.name === "student_university_detail_v1").length;
    const before = reads();
    await act(async () => {
      release?.();
    });
    await waitFor(() => expect(reads()).toBeGreaterThan(before), { timeout: 10_000 }); // карточка вуза перечитана и без окна
    await idle(1_200);
    expect(router.push).not.toHaveBeenCalled();
    await fireEvent.press(await screen.findByTestId("program-cs-b"));
    expect(await screen.findByTestId("program-open")).toBeTruthy();
  });

  it("кэш кабинета с настоящими настройками: заявка в списке «Мои программы» перечитывается после добавления", async () => {
    const w = world();
    const client = testClient("production");
    const api = testApi(w.transport);
    await render(
      <PortalShell api={api} client={client}>
        <UniversityScreen />
      </PortalShell>,
    );
    await screen.findByText("Программы вуза");
    const invalidated = jest.spyOn(client, "invalidateQueries");
    await openProgram("cs-b");
    await fireEvent.press(screen.getByTestId("program-add"));
    await waitFor(() => expect(invalidated).toHaveBeenCalled());
    const keys = invalidated.mock.calls.map((call) => JSON.stringify(call[0]?.queryKey));
    expect(keys).toEqual(expect.arrayContaining([JSON.stringify(["portal", "user-test", "preparations"]), JSON.stringify(["portal", "user-test", "university-detail", uuidN(1)])]));
  });
});
