// Неоконченная отправка комплекта на экране программы: что видно, «Проверить результат», «Повторить сохранённое действие»,
// повреждённая запись и недоступное хранилище. Записи лежат в jest-моке AsyncStorage, как на устройстве.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react-native";
import { AccessibilityInfo, Alert, Platform } from "react-native";

import { packagesPending } from "@/features/preparations/packages-pending";
import { PreparationScreen } from "@/features/preparations/PreparationScreen";
import {
  APPLICATION_ID,
  REVISION_ID,
  STUDENT_CASE_ID,
  documentState,
  draftOf,
  historyPage,
  historySubmission,
  itemId,
  readiness,
  readinessWithSelections,
  requirementItem,
  requirements,
  reusableVersion,
  selectionEcho,
  versionId,
} from "@/test-fixtures/preparations";
import { makeIo } from "@/test-fixtures/preparations-io";
import { PACKAGE_REQUEST, recoveryAbsent, recoveryCommitted, submitIntentOf, submitReceiptOf } from "@/test-fixtures/preparations-packages";
import { pressTwiceInOneTick } from "@/test-fixtures/press";
import { renderPortal, testApi } from "@/test-fixtures/render";
import { settle, waitForEnabled } from "@/test-fixtures/settle";
import type { RpcTransport } from "@/lib/rpc";
import { failure, fakeTransport, preparationRow } from "@/test-fixtures/universities";

jest.mock("expo-router", () => ({ router: { navigate: jest.fn() }, useLocalSearchParams: jest.fn(() => ({})) }));
jest.mock("expo-crypto", () => ({ ...jest.requireActual("expo-crypto"), randomUUID: () => "99999999-0000-4000-8000-0000000000b2" }));

type Raw = Record<string, unknown>;
const FIRST = itemId(0);
const scope = { organizationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", membershipId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", studentCaseId: STUDENT_CASE_ID, applicationId: APPLICATION_ID };

const items = (): Raw[] => [requirementItem(0), requirementItem(1, { required: false })];
const states = (): Raw[] => [documentState(0, { savedDraft: draftOf(0, 4), reusableVersions: [reusableVersion(5)] }), documentState(1)];
const current = () => readiness(requirements(items()), states());
const intent = () => submitIntentOf([0], [5]);
const seed = () => packagesPending.persist(scope, "submit", REVISION_ID, intent() as never);
const packageKeys = async () => (await AsyncStorage.getAllKeys()).filter((key) => key.startsWith("evo.application-packages.v1:"));

async function open(extra: Record<string, unknown> = {}, ready: unknown = current(), wrap?: (inner: RpcTransport) => RpcTransport, lang?: "ru" | "ky") {
  const { transport, calls } = fakeTransport({ student_catalog_preparations_v1: [preparationRow(1)], application_package_readiness_v1: ready, ...extra });
  const view = await renderPortal(<PreparationScreen applicationId={APPLICATION_ID} io={makeIo().io} />, testApi(wrap ? wrap(transport) : transport), lang);
  return { ...view, calls, named: (name: string) => calls.filter((call) => call.name === name) };
}

let restore: () => void = () => undefined;
beforeEach(async () => {
  const spy = jest.replaceProperty(Platform, "OS", "android");
  restore = () => spy.restore();
  await AsyncStorage.clear();
});
afterEach(() => restore());

describe("оборванная отправка комплекта на экране программы", () => {
  it("записанный запрос виден; пока он не разрешён, выбор и «Проверить состав» закрыты, а сама отправка в сеть не уходит", async () => {
    await seed();
    const t = await open();
    const box = await screen.findByTestId("prep-package-recovery");
    expect(within(box).getByText("Незавершённые отправки на этом устройстве")).toBeTruthy();
    expect(within(box).getByText("Сохранённый состав")).toBeTruthy();
    expect(within(box).getByText("Это действие ещё не подтверждено. Проверьте результат или повторите его.")).toBeTruthy();
    await fireEvent.press(await screen.findByTestId("prep-package-choose-toggle"));
    expect(screen.getByTestId("prep-package-preview").props.accessibilityState).toMatchObject({ disabled: true });
    expect(screen.getByTestId(`prep-package-none-${FIRST}`).props.accessibilityState).toMatchObject({ disabled: true });
    expect(screen.getByTestId(`prep-package-version-${FIRST}-${versionId(5)}`).props.accessibilityState).toMatchObject({ disabled: true });
    expect(t.named("application_package_submit_v1")).toHaveLength(0);
    expect(t.named("application_package_recover_v1")).toHaveLength(0);
  });

  it("«Проверить результат»: сервер подтвердил запись - запрос снят, итог показан, список перечитан, выбор снова доступен", async () => {
    await seed();
    const t = await open({ application_package_recover_v1: (args: Raw | undefined) => recoveryCommitted(args!.p_intent as Raw, 1) });
    const reads = () => t.named("application_package_readiness_v1").length;
    await fireEvent.press(await screen.findByTestId(`prep-recovery-check-${PACKAGE_REQUEST}`));
    await waitFor(() => expect(screen.getByTestId("prep-recovery-notice")).toHaveTextContent("Комплект отправлен в EVO"));
    expect(t.named("application_package_recover_v1")[0]!.args).toMatchObject({ p_operation: "submit", p_intent: intent() });
    expect(await packageKeys()).toEqual([]);
    await waitFor(() => expect(screen.queryByTestId("prep-package-recovery")).toBeNull());
    expect(screen.getByTestId("prep-package-message")).toHaveTextContent("Комплект отправлен в EVO");
    expect(reads()).toBeGreaterThan(1);
    await fireEvent.press(screen.getByTestId("prep-package-choose-toggle"));
    // после подтверждения список перечитывается: выбор открывается, когда ответ пришёл
    await waitForEnabled("prep-package-preview");
  });

  it("два нажатия «Проверить результат» раньше, чем кнопка выключилась: проверка уходит один раз", async () => {
    const spoken = AccessibilityInfo.announceForAccessibility as unknown as jest.Mock;
    await seed();
    const t = await open({ application_package_recover_v1: (args: Raw | undefined) => recoveryCommitted(args!.p_intent as Raw, 1) });
    await screen.findByTestId(`prep-recovery-check-${PACKAGE_REQUEST}`);
    spoken.mockClear();
    await pressTwiceInOneTick(`prep-recovery-check-${PACKAGE_REQUEST}`);
    await waitFor(async () => expect(await packageKeys()).toEqual([]));
    expect(t.named("application_package_recover_v1")).toHaveLength(1);
    expect(spoken.mock.calls.filter(([text]) => String(text).includes("Действие уже выполняется"))).toHaveLength(0);
  });

  it("«Проверить результат»: сервер ответил «не записано» - запрос снят, можно готовить новый", async () => {
    await seed();
    await open({ application_package_recover_v1: (args: Raw | undefined) => recoveryAbsent(args!.p_intent as Raw) });
    await fireEvent.press(await screen.findByTestId(`prep-recovery-check-${PACKAGE_REQUEST}`));
    await waitFor(() => expect(screen.getByTestId("prep-recovery-notice")).toHaveTextContent("Действие не было сохранено. Можно подготовить новый запрос."));
    expect(await packageKeys()).toEqual([]);
    await waitFor(() => expect(screen.queryByTestId("prep-package-recovery")).toBeNull());
  });

  it("«Проверить результат»: нет ответа сервера - запрос остаётся, сообщение «ещё не подтверждено»", async () => {
    await seed();
    await open({ application_package_recover_v1: failure("PT500", 500) });
    await fireEvent.press(await screen.findByTestId(`prep-recovery-check-${PACKAGE_REQUEST}`));
    expect(await screen.findByTestId(`prep-recovery-message-${PACKAGE_REQUEST}`)).toHaveTextContent("Это действие ещё не подтверждено", { exact: false });
    expect(await packageKeys()).toHaveLength(1);
    expect(screen.getByTestId("prep-package-recovery")).toBeTruthy();
  });

  it("«Повторить сохранённое действие» открывается только после загрузки сохранённого состава и уходит прежним запросом", async () => {
    await seed();
    const t = await open({
      application_document_history_v1: historyPage([historySubmission(0, 5)], FIRST),
      application_package_submit_v1: (args: Raw | undefined) => submitReceiptOf(args!.p_intent as Raw, 1),
    });
    const retry = await screen.findByTestId(`prep-recovery-retry-${PACKAGE_REQUEST}`);
    expect(retry.props.accessibilityState).toMatchObject({ disabled: true });
    expect(screen.getByText("Перед повтором нужно загрузить сохранённый состав. Если он недоступен, сначала проверьте результат.")).toBeTruthy();
    await fireEvent.press(screen.getByTestId(`prep-recovery-preview-${PACKAGE_REQUEST}`));
    const entry = await screen.findByTestId(`prep-recovery-package-${PACKAGE_REQUEST}`);
    await waitFor(() => expect(within(entry).getByText("scan-5.pdf")).toBeTruthy());
    expect(within(entry).getByText("Требование 1")).toBeTruthy();
    expect(within(entry).getByText("Версия файла 5")).toBeTruthy();
    expect(t.named("application_document_history_v1")[0]!.args).toMatchObject({ p_requirement_item_id: FIRST });
    expect(screen.getByTestId(`prep-recovery-retry-${PACKAGE_REQUEST}`).props.accessibilityState).toMatchObject({ disabled: false });
    await fireEvent.press(screen.getByTestId(`prep-recovery-retry-${PACKAGE_REQUEST}`));
    await waitFor(() => expect(screen.getByTestId("prep-recovery-notice")).toHaveTextContent("Комплект отправлен в EVO"));
    // тот же запрос с тем же номером: дубля на сервере не будет
    expect(t.named("application_package_submit_v1")).toHaveLength(1);
    expect(t.named("application_package_submit_v1")[0]!.args).toEqual({ p_intent: intent() });
    expect(await packageKeys()).toEqual([]);
  });

  it("состав записанного запроса не загрузился: «Не удалось обновить данные», повтор остаётся закрытым, «Проверить результат» доступна", async () => {
    await seed();
    const t = await open({ application_document_history_v1: failure("PT500", 500) });
    await fireEvent.press(await screen.findByTestId(`prep-recovery-preview-${PACKAGE_REQUEST}`));
    expect(await screen.findByTestId(`prep-recovery-message-${PACKAGE_REQUEST}`)).toHaveTextContent("Не удалось обновить данные. Попробуйте ещё раз.");
    expect(screen.getByTestId(`prep-recovery-retry-${PACKAGE_REQUEST}`).props.accessibilityState).toMatchObject({ disabled: true });
    expect(screen.getByTestId(`prep-recovery-check-${PACKAGE_REQUEST}`).props.accessibilityState).toMatchObject({ disabled: false });
    expect(t.named("application_package_submit_v1")).toHaveLength(0);
  });

  it("в истории нет файла из записанного запроса: состав не показан, повтор закрыт", async () => {
    await seed();
    await open({ application_document_history_v1: historyPage([historySubmission(0, 9)], FIRST) });
    await fireEvent.press(await screen.findByTestId(`prep-recovery-preview-${PACKAGE_REQUEST}`));
    expect(await screen.findByTestId(`prep-recovery-message-${PACKAGE_REQUEST}`)).toHaveTextContent("Не удалось обновить данные", { exact: false });
    expect(screen.getByTestId(`prep-recovery-retry-${PACKAGE_REQUEST}`).props.accessibilityState).toMatchObject({ disabled: true });
  });

  it("повреждённая запись не стирается: экран говорит, что хранилище не читается, а выбор закрыт", async () => {
    await AsyncStorage.setItem(packagesPending.key(scope, "submit", REVISION_ID), "{сломано");
    const t = await open();
    const box = await screen.findByTestId("prep-package-recovery");
    // запись нечитаема: повторять бессмысленно, сказано прямо, а снять её можно только отказом (кнопка ниже)
    expect(within(box).getByText("Запись о незавершённой отправке комплекта на этом телефоне не читается, повторять попытку бессмысленно. Её можно снять и собрать комплект заново.")).toBeTruthy();
    await fireEvent.press(await screen.findByTestId("prep-package-choose-toggle"));
    expect(screen.getByTestId("prep-package-preview").props.accessibilityState).toMatchObject({ disabled: true });
    expect(await AsyncStorage.getItem(packagesPending.key(scope, "submit", REVISION_ID))).toBe("{сломано");
    expect(t.named("application_package_submit_v1")).toHaveLength(0);
  });

  it("чужие записи (другая программа, другой участник) на этом экране не видны и не мешают", async () => {
    const otherApplication = "bbbbbbbb-0000-4000-8000-0000000000ff";
    const otherMember = { ...scope, membershipId: "aaaaaaaa-0000-4000-8000-0000000000ff" };
    await packagesPending.persist({ ...scope, applicationId: otherApplication }, "submit", REVISION_ID, submitIntentOf([0], [5], { applicationId: otherApplication }) as never);
    await packagesPending.persist(otherMember, "submit", REVISION_ID, intent() as never);
    await open();
    await fireEvent.press(await screen.findByTestId("prep-package-choose-toggle"));
    // записи устройства читаются в фоне: выбор открывается, когда они прочитаны (чужие его не закрывают), и только потом
    // «раздела восстановления нет» чего-то стоит
    await waitForEnabled("prep-package-preview");
    await settle();
    expect(screen.queryByTestId("prep-package-recovery")).toBeNull();
  });
});

describe("хранилище устройства не работает при отправке", () => {
  it("записать запрос не удалось: сообщение, в сеть ничего не ушло", async () => {
    const original = AsyncStorage.setItem;
    const ready = (args: Raw | undefined) => ((args?.p_selections as unknown[] | undefined)?.length ? readinessWithSelections(requirements(items()), states(), [selectionEcho(0, 5)]) : current());
    const t = await open({ application_package_submit_v1: (args: Raw | undefined) => submitReceiptOf(args!.p_intent as Raw, 1) }, ready);
    await fireEvent.press(await screen.findByTestId("prep-package-choose-toggle"));
    await waitForEnabled("prep-package-preview");
    await fireEvent.press(screen.getByTestId(`prep-package-version-${FIRST}-${versionId(5)}`));
    await fireEvent.press(screen.getByTestId("prep-package-preview"));
    await screen.findByTestId("prep-package-preview-box");
    // с этого места устройство не принимает записи
    (AsyncStorage as { setItem: typeof AsyncStorage.setItem }).setItem = jest.fn(async () => {
      throw new Error("диск полон");
    });
    try {
      await fireEvent.press(screen.getByTestId("prep-package-submit"));
      expect(await screen.findByTestId("prep-package-error")).toHaveTextContent("Не удалось прочитать или сохранить действие на этом телефоне. Проверьте результат.");
    } finally {
      (AsyncStorage as { setItem: typeof AsyncStorage.setItem }).setItem = original;
    }
    expect(t.named("application_package_submit_v1")).toHaveLength(0);
    expect(await packageKeys()).toEqual([]);
  });
});

describe("отказ от незавершённой отправки комплекта", () => {
  type AlertButton = { text?: string; style?: string; onPress?: () => void };
  const OTHER_APPLICATION = "bbbbbbbb-0000-4000-8000-0000000000ff";
  const OTHER_MEMBER = "aaaaaaaa-0000-4000-8000-0000000000ff";
  const OTHER_ORGANIZATION = "bbbbbbbb-0000-4000-8000-0000000000ee";
  const SECOND_REVISION = "dddddddd-0000-4000-8000-0000000000d2";
  const spoken = AccessibilityInfo.announceForAccessibility as unknown as jest.Mock;
  let alert: jest.SpyInstance;
  beforeEach(() => {
    alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    spoken.mockClear();
  });
  afterEach(() => alert.mockRestore());

  const lastAlert = () => ({ title: String(alert.mock.lastCall![0]), body: String(alert.mock.lastCall![1]), buttons: alert.mock.lastCall![2] as AlertButton[] });
  /** Нажать кнопку отказа и ответить в окне подтверждения. */
  async function discard(testID: string, answer: "Отказаться" | "Оставить") {
    await fireEvent.press(await screen.findByTestId(testID));
    const button = lastAlert().buttons.find((value) => value.text === answer)!;
    await act(async () => button.onPress?.());
  }
  const DISCARD = `prep-recovery-discard-${PACKAGE_REQUEST}`;

  it("исход неизвестен: рядом с «Проверить результат» кнопка отказа; «Оставить» ничего не меняет, «Отказаться» снимает запись, выбор снова открыт", async () => {
    await seed();
    await open();
    const button = await screen.findByTestId(DISCARD);
    expect(button).toHaveTextContent("Отказаться от незавершённой отправки комплекта");
    expect(button).toHaveStyle({ minHeight: 44 });
    // читаемая запись сохраняет «Проверить результат»: отказ не вместо проверки
    expect(screen.getByTestId(`prep-recovery-check-${PACKAGE_REQUEST}`)).toHaveTextContent("Проверить результат");

    await discard(DISCARD, "Оставить");
    const { title, body, buttons } = lastAlert();
    expect(title).toBe("Отказаться от незавершённого действия?");
    // честный текст: если комплект уже дошёл до EVO, новая отправка может добавить версию комплекта (больше ничего не обещано)
    expect(body).toBe("Телефон забудет, что отправка комплекта не завершилась. Если комплект уже дошёл до EVO, новая отправка может добавить ещё одну версию комплекта.");
    expect(buttons.map((value) => [value.text, value.style])).toEqual([["Оставить", "cancel"], ["Отказаться", "destructive"]]);
    expect(await packageKeys()).toHaveLength(1);

    await discard(DISCARD, "Отказаться");
    await waitFor(async () => expect(await packageKeys()).toEqual([]));
    await waitFor(() => expect(screen.queryByTestId("prep-package-recovery")).toBeNull());
    expect(screen.getByTestId("prep-package-message")).toHaveTextContent("Незавершённое действие снято с этого телефона.");
    await waitFor(() => expect(spoken).toHaveBeenCalledWith("Незавершённое действие снято с этого телефона."));
    // новый комплект снова можно готовить
    await fireEvent.press(await screen.findByTestId("prep-package-choose-toggle"));
    await waitForEnabled("prep-package-preview");
  });

  it("снимается только запись этой программы: другая программа, другой участник, другая организация и вторая ревизия этой же программы целы", async () => {
    await seed();
    const own = packagesPending.key(scope, "submit", REVISION_ID);
    await packagesPending.persist({ ...scope, applicationId: OTHER_APPLICATION }, "submit", REVISION_ID, submitIntentOf([0], [5], { applicationId: OTHER_APPLICATION, requestId: "99999999-0000-4000-8000-0000000000c1" }) as never);
    await packagesPending.persist({ ...scope, membershipId: OTHER_MEMBER }, "submit", REVISION_ID, intent() as never);
    await packagesPending.persist({ ...scope, organizationId: OTHER_ORGANIZATION }, "submit", REVISION_ID, intent() as never);
    await packagesPending.persist(scope, "submit", SECOND_REVISION, submitIntentOf([0], [5], { requirementsRevisionId: SECOND_REVISION, requestId: "99999999-0000-4000-8000-0000000000c2" }) as never);
    const before = (await packageKeys()).sort();
    expect(before).toHaveLength(5);
    await open();
    await discard(DISCARD, "Отказаться");
    await waitFor(async () => expect((await packageKeys()).sort()).toEqual(before.filter((key) => key !== own)));
    // вторая запись этой программы осталась и всё ещё на экране со своей кнопкой отказа
    expect(await screen.findByTestId("prep-recovery-discard-99999999-0000-4000-8000-0000000000c2")).toBeTruthy();
  });

  it("запись нечитаема: до отказа она на месте, после подтверждения снята, выбор открыт; «Оставить» ничего не снимает", async () => {
    const key = packagesPending.key(scope, "submit", REVISION_ID);
    await AsyncStorage.setItem(key, "{сломано");
    await open();
    const DISCARD_BROKEN = `prep-recovery-discard-unreadable-${REVISION_ID}`;
    expect(await screen.findByTestId(`prep-recovery-unreadable-${REVISION_ID}`)).toHaveTextContent("не читается, повторять попытку бессмысленно", { exact: false });
    expect(screen.getByTestId(DISCARD_BROKEN)).toHaveTextContent("Отказаться от незавершённой отправки комплекта");
    await discard(DISCARD_BROKEN, "Оставить");
    expect(await AsyncStorage.getItem(key)).toBe("{сломано");
    await discard(DISCARD_BROKEN, "Отказаться");
    await waitFor(async () => expect(await AsyncStorage.getItem(key)).toBeNull());
    await waitFor(() => expect(screen.queryByTestId("prep-package-recovery")).toBeNull());
    await fireEvent.press(await screen.findByTestId("prep-package-choose-toggle"));
    await waitForEnabled("prep-package-preview");
  });

  it("идёт отправка или проверка этой программы (замок команд): отказ получает «занято», запись цела", async () => {
    await seed();
    await open();
    await screen.findByTestId(DISCARD);
    // замок команд комплекта один на программу: его берёт «Отправить комплект» и «Проверить результат»
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const running = packagesPending.withLock(scope, "submit", APPLICATION_ID, () => gate);
    await discard(DISCARD, "Отказаться");
    expect(await screen.findByTestId(`${DISCARD}-error`)).toHaveTextContent("Это действие сейчас выполняется. Дождитесь результата.");
    expect(await packageKeys()).toHaveLength(1);
    expect(screen.getByTestId(DISCARD)).toBeTruthy();
    release();
    await running;
    await discard(DISCARD, "Отказаться");
    await waitFor(async () => expect(await packageKeys()).toEqual([]));
  });

  it("проверка результата этой записи идёт: кнопка отказа выключена, запись цела", async () => {
    await seed();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await open({ application_package_recover_v1: (args: Raw | undefined) => recoveryCommitted(args!.p_intent as Raw, 1) }, current(), (inner) => async (name, args, options) => {
      if (name === "application_package_recover_v1") await gate;
      return inner(name, args, options);
    });
    await waitForEnabled(`prep-recovery-check-${PACKAGE_REQUEST}`);
    await fireEvent.press(screen.getByTestId(`prep-recovery-check-${PACKAGE_REQUEST}`));
    await waitFor(() => expect(screen.getByTestId(DISCARD).props.accessibilityState).toMatchObject({ disabled: true }));
    await fireEvent.press(screen.getByTestId(DISCARD));
    expect(alert).not.toHaveBeenCalled();
    expect(await packageKeys()).toHaveLength(1);
    await act(async () => release());
    await waitFor(async () => expect(await packageKeys()).toEqual([]));
  });

  it("хранилище не читается целиком (перечень записей недоступен): записи не видно, кнопки отказа нет", async () => {
    await seed();
    const original = AsyncStorage.getAllKeys;
    (AsyncStorage as { getAllKeys: typeof AsyncStorage.getAllKeys }).getAllKeys = jest.fn(async () => {
      throw new Error("нет доступа");
    });
    try {
      await open();
      const box = await screen.findByTestId("prep-package-recovery");
      expect(within(box).getByText("Не удалось прочитать или сохранить действие на этом телефоне. Проверьте результат.")).toBeTruthy();
      await settle();
      expect(screen.queryByTestId(DISCARD)).toBeNull();
    } finally {
      (AsyncStorage as { getAllKeys: typeof AsyncStorage.getAllKeys }).getAllKeys = original;
    }
  });

  it("хранилище не удаляет: сказано словами, запись на месте", async () => {
    await seed();
    await open();
    await screen.findByTestId(DISCARD);
    const original = AsyncStorage.removeItem;
    AsyncStorage.removeItem = (async () => {
      throw new Error("диск");
    }) as typeof AsyncStorage.removeItem;
    try {
      await discard(DISCARD, "Отказаться");
      expect(await screen.findByTestId(`${DISCARD}-error`)).toHaveTextContent("Повторите попытку позже", { exact: false });
    } finally {
      AsyncStorage.removeItem = original;
    }
    expect(await packageKeys()).toHaveLength(1);
  });

  it("кыргызский язык: кнопка и окно написаны по-кыргызски", async () => {
    await seed();
    await open({}, current(), undefined, "ky");
    const button = await screen.findByTestId(DISCARD);
    expect(button).toHaveTextContent("Бүтпөгөн топтомду жөнөтүүдөн баш тартуу");
    await fireEvent.press(button);
    expect(lastAlert().title).toBe("Бүтпөгөн аракеттен баш тартасызбы?");
    expect(lastAlert().body).toContain("топтомдун дагы бир версиясын");
  });
});
