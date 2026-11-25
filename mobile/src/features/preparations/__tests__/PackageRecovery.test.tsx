// Неоконченная отправка комплекта на экране программы: что видно, «Проверить результат», «Повторить сохранённое действие»,
// повреждённая запись и недоступное хранилище. Записи лежат в jest-моке AsyncStorage, как на устройстве.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { fireEvent, screen, waitFor, within } from "@testing-library/react-native";
import { AccessibilityInfo, Platform } from "react-native";

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

async function open(extra: Record<string, unknown> = {}, ready: unknown = current()) {
  const { transport, calls } = fakeTransport({ student_catalog_preparations_v1: [preparationRow(1)], application_package_readiness_v1: ready, ...extra });
  const view = await renderPortal(<PreparationScreen applicationId={APPLICATION_ID} io={makeIo().io} />, testApi(transport));
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
    expect(screen.getByTestId("prep-package-preview").props.accessibilityState).toMatchObject({ disabled: false });
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
    expect(within(box).getByText("Не удалось прочитать или сохранить действие на этом телефоне. Проверьте результат.")).toBeTruthy();
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
    expect(screen.queryByTestId("prep-package-recovery")).toBeNull();
    expect(screen.getByTestId("prep-package-preview").props.accessibilityState).toMatchObject({ disabled: false });
  });
});

describe("хранилище устройства не работает при отправке", () => {
  it("записать запрос не удалось: сообщение, в сеть ничего не ушло", async () => {
    const original = AsyncStorage.setItem;
    const ready = (args: Raw | undefined) => ((args?.p_selections as unknown[] | undefined)?.length ? readinessWithSelections(requirements(items()), states(), [selectionEcho(0, 5)]) : current());
    const t = await open({ application_package_submit_v1: (args: Raw | undefined) => submitReceiptOf(args!.p_intent as Raw, 1) }, ready);
    await fireEvent.press(await screen.findByTestId("prep-package-choose-toggle"));
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
