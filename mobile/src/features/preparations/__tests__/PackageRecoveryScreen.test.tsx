// Страница «Незавершённые отправки на этом устройстве», ссылка на неё с «Главной» и файл маршрута. Записи лежат в jest-моке
// AsyncStorage; чужие участники и чужие программы не видны.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react-native";
import { existsSync } from "node:fs";
import path from "node:path";
import { router } from "expo-router";
import { Alert } from "react-native";

import PackageRecoveryRoute from "@/app/(app)/preparations/recovery";
import { PackageRecoveryScreen } from "@/features/preparations/PackageRecoveryScreen";
import { PendingPackagesLink } from "@/features/preparations/PendingPackagesLink";
import { packagesPending } from "@/features/preparations/packages-pending";
import { PACKAGE_RECOVERY_ROUTE } from "@/features/preparations/recovery-route";
import { APPLICATION_ID, REVISION_ID, STUDENT_CASE_ID } from "@/test-fixtures/preparations";
import { PACKAGE_REQUEST, recoveryCommitted, submitIntentOf } from "@/test-fixtures/preparations-packages";
import { renderPortal, testApi } from "@/test-fixtures/render";
import { failure, fakeTransport, preparationRow } from "@/test-fixtures/universities";

jest.mock("expo-router", () => ({ router: { navigate: jest.fn() }, useLocalSearchParams: jest.fn(() => ({})) }));

type Raw = Record<string, unknown>;
const ORGANIZATION = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MEMBERSHIP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_APPLICATION = "bbbbbbbb-0000-4000-8000-0000000000ff";
const scope = { organizationId: ORGANIZATION, membershipId: MEMBERSHIP, studentCaseId: STUDENT_CASE_ID, applicationId: APPLICATION_ID };
const seed = (over: Partial<typeof scope> = {}, intentOver: Raw = {}) => packagesPending.persist({ ...scope, ...over }, "submit", REVISION_ID, submitIntentOf([0], [5], intentOver) as never);
const navigate = router.navigate as jest.Mock;

async function renderPage(handlers: Record<string, unknown> = {}) {
  const { transport, calls } = fakeTransport({ student_catalog_preparations_v1: [preparationRow(1)], ...handlers });
  const view = await renderPortal(<PackageRecoveryScreen />, testApi(transport));
  return { ...view, calls };
}

beforeEach(async () => {
  navigate.mockClear();
  await AsyncStorage.clear();
});

describe("ссылка «Незавершённые отправки» на «Главной»", () => {
  async function renderLink() {
    const { transport } = fakeTransport({});
    await renderPortal(<PendingPackagesLink />, testApi(transport));
    // чтение записей прошло: хранилище опрошено
    await waitFor(() => expect(AsyncStorage.getAllKeys).toHaveBeenCalled());
    await act(async () => undefined);
  }

  it("записей нет: ссылки нет", async () => {
    await renderLink();
    expect(screen.queryByTestId("pending-packages-link")).toBeNull();
  });

  it("есть оборванная отправка этого участника: ссылка с подписью словаря сайта ведёт на страницу восстановления", async () => {
    await seed();
    await renderLink();
    const link = await screen.findByTestId("pending-packages-link");
    expect(link).toHaveTextContent("Незавершённые отправки на этом устройстве");
    await fireEvent.press(link);
    expect(navigate).toHaveBeenCalledWith(PACKAGE_RECOVERY_ROUTE);
  });

  it("запись другого участника или другой организации ссылку не показывает", async () => {
    await seed({ membershipId: "aaaaaaaa-0000-4000-8000-0000000000ff" });
    await seed({ organizationId: "bbbbbbbb-0000-4000-8000-0000000000ee" });
    await renderLink();
    expect(screen.queryByTestId("pending-packages-link")).toBeNull();
  });

  it("хранилище не читается: ссылка показана (лучше показать, чем спрятать)", async () => {
    const original = AsyncStorage.getAllKeys;
    (AsyncStorage as { getAllKeys: typeof AsyncStorage.getAllKeys }).getAllKeys = jest.fn(async () => {
      throw new Error("нет доступа");
    });
    try {
      await renderLink();
      expect(await screen.findByTestId("pending-packages-link")).toBeTruthy();
    } finally {
      (AsyncStorage as { getAllKeys: typeof AsyncStorage.getAllKeys }).getAllKeys = original;
    }
  });

  it("запись снята: ссылка исчезает без перезапуска", async () => {
    await seed();
    await renderLink();
    await screen.findByTestId("pending-packages-link");
    await act(async () => {
      await packagesPending.clear(scope, "submit", REVISION_ID, submitIntentOf([0], [5]) as never);
    });
    await waitFor(() => expect(screen.queryByTestId("pending-packages-link")).toBeNull());
  });
});

describe("страница «Незавершённые отправки на этом устройстве»", () => {
  it("записей нет: заголовок, пояснение и «Незавершённых отправок на этом устройстве нет»", async () => {
    await renderPage();
    expect(screen.getByTestId("prep-recovery-title")).toHaveTextContent("Незавершённые отправки на этом устройстве");
    expect(screen.getByText("Если загрузка оборвалась, продолжите её здесь.")).toBeTruthy();
    expect(await screen.findByTestId("prep-recovery-empty")).toHaveTextContent("Незавершённых отправок на этом устройстве нет");
  });

  it("записи нескольких программ видны вместе; чужого участника нет; у каждой «Открыть историю программы» ведёт на её экран", async () => {
    await seed();
    await seed({ applicationId: OTHER_APPLICATION }, { applicationId: OTHER_APPLICATION, requestId: "99999999-0000-4000-8000-0000000000a2" });
    await seed({ membershipId: "aaaaaaaa-0000-4000-8000-0000000000ff" });
    await renderPage();
    await screen.findByTestId(`prep-recovery-package-${PACKAGE_REQUEST}`);
    expect(screen.getByTestId("prep-recovery-package-99999999-0000-4000-8000-0000000000a2")).toBeTruthy();
    expect(screen.getAllByTestId("prep-package-recovery")).toHaveLength(2);
    expect(screen.queryByTestId("prep-recovery-empty")).toBeNull();
    await fireEvent.press(screen.getByTestId(`prep-recovery-history-${PACKAGE_REQUEST}`));
    expect(navigate).toHaveBeenCalledWith(`/preparations/${APPLICATION_ID}`);
    await fireEvent.press(screen.getByTestId("prep-recovery-history-99999999-0000-4000-8000-0000000000a2"));
    expect(navigate).toHaveBeenLastCalledWith(`/preparations/${OTHER_APPLICATION}`);
  });

  it("над записью подпись программы из списка «Мои программы»; программы нет в списке или список не прочитался: подписи нет, запись видна", async () => {
    await seed();
    await seed({ applicationId: OTHER_APPLICATION }, { applicationId: OTHER_APPLICATION, requestId: "99999999-0000-4000-8000-0000000000a2" });
    await renderPage();
    const title = await screen.findByTestId(`prep-recovery-program-${APPLICATION_ID}`);
    expect(within(title).getByText("Университет 1")).toBeTruthy();
    expect(within(title).getByText("Информатика")).toBeTruthy();
    expect(within(title).getByText("Осень 2027")).toBeTruthy();
    // второй программы в списке нет: запись есть, подписи нет
    expect(screen.getByTestId("prep-recovery-package-99999999-0000-4000-8000-0000000000a2")).toBeTruthy();
    expect(screen.queryByTestId(`prep-recovery-program-${OTHER_APPLICATION}`)).toBeNull();
  });

  it("список «Мои программы» не прочитался: записи видны без подписи", async () => {
    await seed();
    await renderPage({ student_catalog_preparations_v1: failure("PT500", 500) });
    expect(await screen.findByTestId(`prep-recovery-package-${PACKAGE_REQUEST}`)).toBeTruthy();
    expect(screen.queryByTestId(`prep-recovery-program-${APPLICATION_ID}`)).toBeNull();
  });

  it("«Проверить результат» подтвердил запись: запрос снят, программа пропала со страницы, итог остаётся виден", async () => {
    await seed();
    const t = await renderPage({ application_package_recover_v1: (args: Raw | undefined) => recoveryCommitted(args!.p_intent as Raw, 1) });
    await fireEvent.press(await screen.findByTestId(`prep-recovery-check-${PACKAGE_REQUEST}`));
    await waitFor(() => expect(screen.getByTestId("prep-recovery-owner-notice")).toHaveTextContent("Комплект отправлен в EVO"));
    expect(t.calls.filter((call) => call.name === "application_package_recover_v1")).toHaveLength(1);
    await waitFor(() => expect(screen.queryByTestId(`prep-recovery-package-${PACKAGE_REQUEST}`)).toBeNull());
    expect(await screen.findByTestId("prep-recovery-empty")).toBeTruthy();
    expect((await AsyncStorage.getAllKeys()).filter((key) => key.startsWith("evo.application-packages.v1:"))).toEqual([]);
  });

  it("сервер не ответил: запись остаётся на странице, итог не показан", async () => {
    await seed();
    await renderPage({ application_package_recover_v1: failure("PT500", 500) });
    await fireEvent.press(await screen.findByTestId(`prep-recovery-check-${PACKAGE_REQUEST}`));
    expect(await screen.findByTestId(`prep-recovery-message-${PACKAGE_REQUEST}`)).toHaveTextContent("Это действие ещё не подтверждено", { exact: false });
    expect(screen.queryByTestId("prep-recovery-owner-notice")).toBeNull();
    expect((await AsyncStorage.getAllKeys()).filter((key) => key.startsWith("evo.application-packages.v1:"))).toHaveLength(1);
  });

  it("хранилище не читается: сообщение вместо списка", async () => {
    const original = AsyncStorage.getAllKeys;
    (AsyncStorage as { getAllKeys: typeof AsyncStorage.getAllKeys }).getAllKeys = jest.fn(async () => {
      throw new Error("нет доступа");
    });
    try {
      await renderPage();
      expect(await screen.findByTestId("prep-recovery-storage")).toHaveTextContent("Не удалось прочитать или сохранить действие на этом телефоне. Проверьте результат.");
      expect(screen.queryByTestId("prep-recovery-empty")).toBeNull();
    } finally {
      (AsyncStorage as { getAllKeys: typeof AsyncStorage.getAllKeys }).getAllKeys = original;
    }
  });

  it("«Моё поступление» ведёт к списку «Мои программы»", async () => {
    await renderPage();
    await fireEvent.press(screen.getByTestId("prep-recovery-back"));
    expect(navigate).toHaveBeenCalledWith(expect.stringContaining("/home?list=programs"));
  });

  it("на кыргызском заголовок и пояснение берутся из словаря сайта", async () => {
    const { transport } = fakeTransport({});
    await renderPortal(<PackageRecoveryScreen />, testApi(transport), "ky");
    expect(screen.getByTestId("prep-recovery-title")).toHaveTextContent("Бул түзмөктөгү аякталбаган жөнөтүүлөр");
    expect(screen.getByText("Жүктөө үзүлсө, ушул жерден улантыңыз.")).toBeTruthy();
  });
});

describe("отказ на странице «Незавершённые отправки»", () => {
  const OTHER_MEMBER = "aaaaaaaa-0000-4000-8000-0000000000ff";
  let alert: jest.SpyInstance;
  beforeEach(() => {
    alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
  });
  afterEach(() => alert.mockRestore());
  async function confirm(testID: string) {
    await fireEvent.press(await screen.findByTestId(testID));
    const button = (alert.mock.lastCall![2] as { text?: string; onPress?: () => void }[]).find((value) => value.text === "Отказаться")!;
    await act(async () => button.onPress?.());
  }
  const packageKeys = async () => (await AsyncStorage.getAllKeys()).filter((key) => key.startsWith("evo.application-packages.v1:"));

  it("«Отказаться»: запись снята, программа пропала со страницы, итог остаётся виден; запись другого участника цела", async () => {
    await seed();
    await seed({ membershipId: OTHER_MEMBER });
    await renderPage();
    await confirm(`prep-recovery-discard-${PACKAGE_REQUEST}`);
    await waitFor(() => expect(screen.getByTestId("prep-recovery-owner-notice")).toHaveTextContent("Незавершённое действие снято с этого телефона."));
    await waitFor(() => expect(screen.queryByTestId(`prep-recovery-package-${PACKAGE_REQUEST}`)).toBeNull());
    expect(await screen.findByTestId("prep-recovery-empty")).toBeTruthy();
    expect(await packageKeys()).toEqual([packagesPending.key({ ...scope, membershipId: OTHER_MEMBER }, "submit", REVISION_ID)]);
  });

  it("нечитаемая запись: на странице сказано прямо, «Отказаться» снимает её", async () => {
    const key = packagesPending.key(scope, "submit", REVISION_ID);
    await AsyncStorage.setItem(key, "{сломано");
    await renderPage();
    expect(await screen.findByTestId(`prep-recovery-unreadable-${REVISION_ID}`)).toHaveTextContent("не читается, повторять попытку бессмысленно", { exact: false });
    await confirm(`prep-recovery-discard-unreadable-${REVISION_ID}`);
    await waitFor(async () => expect(await AsyncStorage.getItem(key)).toBeNull());
    expect(await screen.findByTestId("prep-recovery-empty")).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("prep-recovery-owner-notice")).toHaveTextContent("Незавершённое действие снято с этого телефона."));
  });
});

describe("маршрут страницы", () => {
  it("постоянная часть пути совпадает с файлом маршрута внутри стека «Требования программы»; рядом файл `[applicationId]`", () => {
    const folder = path.join(__dirname, "../../../app/(app)/preparations");
    expect(PACKAGE_RECOVERY_ROUTE).toBe("/preparations/recovery");
    expect(existsSync(path.join(folder, "recovery.tsx"))).toBe(true);
    expect(existsSync(path.join(folder, "_layout.tsx"))).toBe(true);
    expect(existsSync(path.join(folder, "[applicationId].tsx"))).toBe(true);
  });

  it("файл маршрута показывает страницу", async () => {
    const { transport } = fakeTransport({});
    await renderPortal(<PackageRecoveryRoute />, testApi(transport));
    expect(screen.getByTestId("prep-recovery-screen")).toBeTruthy();
    expect(within(screen.getByTestId("prep-recovery-screen")).getByTestId("prep-recovery-title")).toBeTruthy();
  });
});
