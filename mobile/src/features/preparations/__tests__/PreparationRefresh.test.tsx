// Что происходит с экраном программы, когда данные под ним перечитываются: «потянуть вниз», уход с экрана и возврат, возврат в
// приложение. Проверенный состав комплекта (предпросмотр) отправлять можно только из ответа, прочитанного в этом же показе, а полоса
// «потянули вниз» горит только у перечитывания, которое начал студент. Сеть и устройство подменены; хранилище записей - jest-мок.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { AccessibilityInfo, Platform } from "react-native";

import { PreparationScreen } from "@/features/preparations/PreparationScreen";
import type { RpcTransport } from "@/lib/rpc";
import {
  APPLICATION_ID,
  documentState,
  draftOf,
  itemId,
  readiness,
  readinessWithSelections,
  requirementItem,
  requirements,
  reusableVersion,
  selectionEcho,
  versionId,
  versionsPage,
} from "@/test-fixtures/preparations";
import { makeIo } from "@/test-fixtures/preparations-io";
import { renderPortal, testApi } from "@/test-fixtures/render";
import { waitForEnabled } from "@/test-fixtures/settle";
import { fakeTransport, preparationRow } from "@/test-fixtures/universities";

jest.mock("expo-router", () => ({ router: { navigate: jest.fn() }, useLocalSearchParams: jest.fn(() => ({})) }));
jest.mock("expo-crypto", () => ({ ...jest.requireActual("expo-crypto"), randomUUID: () => "99999999-0000-4000-8000-0000000000a1" }));

// Фокус экрана под управлением теста: обычная подмена (`jest.setup.ts`) срабатывает только при монтировании, а здесь нужен уход
// с экрана и возврат без его размонтирования (вкладка остаётся смонтированной).
type MockFocusEntry = { effect: () => void | (() => void); cleanup: void | (() => void) };
const mockFocusRegistry = new Set<MockFocusEntry>();
jest.mock("@/lib/focus", () => {
  const { useEffect } = jest.requireActual<typeof import("react")>("react");
  return {
    useFocusEffect: (effect: () => void | (() => void)) => {
      useEffect(() => {
        const entry: MockFocusEntry = { effect, cleanup: effect() };
        mockFocusRegistry.add(entry);
        return () => {
          mockFocusRegistry.delete(entry);
          if (typeof entry.cleanup === "function") entry.cleanup();
        };
      }, [effect]);
    },
  };
});
const leaveScreen = () =>
  act(async () => {
    for (const entry of mockFocusRegistry) {
      if (typeof entry.cleanup === "function") entry.cleanup();
      entry.cleanup = undefined;
    }
  });
const returnToScreen = () =>
  act(async () => {
    for (const entry of mockFocusRegistry) entry.cleanup = entry.effect();
  });

type Raw = Record<string, unknown>;
const FIRST = itemId(0);
const items = (): Raw[] => [requirementItem(0), requirementItem(1, { required: false })];
/** У первого требования сохранённый файл (версия 4) и сохранённая версия 5. */
const states = (): Raw[] => [documentState(0, { savedDraft: draftOf(0, 4), reusableVersions: [reusableVersion(5)] }), documentState(1, { reusableVersions: [reusableVersion(7)] })];
const current = () => readiness(requirements(items()), states());
/** Тот же набор требований, но версии 5 больше нет (её убрали на сервере). */
const withoutVersion5 = () => readiness(requirements(items()), [documentState(0, { savedDraft: draftOf(0, 4) }), documentState(1, { reusableVersions: [reusableVersion(7)] })]);
const withPicked = () => readinessWithSelections(requirements(items()), states(), [selectionEcho(0, 5)]);

const hasSelections = (args: Raw | undefined) => Array.isArray(args?.p_selections) && (args.p_selections as unknown[]).length > 0;

async function open(ready: (args: Raw | undefined) => unknown, extra: Record<string, unknown> = {}) {
  const { transport, calls } = fakeTransport({
    student_catalog_preparations_v1: [preparationRow(1)],
    application_package_readiness_v1: (args: Raw | undefined) => (hasSelections(args) ? withPicked() : ready(args)),
    ...extra,
  });
  // Ответ на список программ и на «Проверить состав» можно задержать: чтение «идёт», пока тест не отпустит.
  const hold = { list: null as Promise<void> | null, preview: null as Promise<void> | null, previewStarted: 0 };
  const wrapped: RpcTransport = async (name, args, options) => {
    if (hold.list && name === "student_catalog_preparations_v1") await hold.list;
    if (name === "application_package_readiness_v1" && hasSelections(args as Raw | undefined)) {
      hold.previewStarted += 1;
      if (hold.preview) await hold.preview;
    }
    return transport(name, args, options);
  };
  const view = await renderPortal(<PreparationScreen applicationId={APPLICATION_ID} io={makeIo().io} />, testApi(wrapped));
  return { ...view, calls, hold, reads: () => calls.filter((call) => call.name === "application_package_readiness_v1").length };
}
const readinessQuery = (query: { queryKey: readonly unknown[] }) => query.queryKey.includes("readiness");

/** Раскрыть выбор, выбрать сохранённую версию 5 и проверить состав: на экране предпросмотр с «Отправить комплект в EVO». */
async function showPreview() {
  await fireEvent.press(await screen.findByTestId("prep-package-choose-toggle"));
  await waitForEnabled("prep-package-preview");
  await fireEvent.press(screen.getByTestId(`prep-package-version-${FIRST}-${versionId(5)}`));
  await fireEvent.press(screen.getByTestId("prep-package-preview"));
  await screen.findByTestId("prep-package-preview-box");
  expect(screen.getByTestId("prep-package-submit").props.accessibilityState).toMatchObject({ disabled: false });
}
const selected = () => screen.getByTestId(`prep-package-version-${FIRST}-${versionId(5)}`).props.accessibilityState;
const pullDown = () => screen.getByTestId("screen-scroll").props.refreshControl.props.onRefresh();
const spinner = () => screen.getByTestId("screen-scroll").props.refreshControl.props.refreshing as boolean;
/**
 * Кэш чтений сообщает экрану о смене состояния через `setTimeout(0)` (`notifyManager`). Один такой же ход после начала чтения
 * гарантирует, что экран уже получил «идёт перечитывание» и перерисован: иначе проверка «полоса не горит» прошла бы вхолостую.
 */
const afterQueryNotifications = () =>
  act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });

let restore: () => void = () => undefined;
beforeEach(async () => {
  const spy = jest.replaceProperty(Platform, "OS", "android");
  restore = () => spy.restore();
  await AsyncStorage.clear();
  mockFocusRegistry.clear();
});
afterEach(() => restore());

describe("проверенный состав комплекта не переживает перечитывание", () => {
  it("«потянуть вниз» снимает предпросмотр: «Отправить комплект в EVO» исчезает, выбор остаётся, состав можно проверить заново", async () => {
    const t = await open(current);
    await showPreview();
    const before = t.reads();
    await act(async () => {
      await pullDown();
    });
    await waitFor(() => expect(screen.queryByTestId("prep-package-preview-box")).toBeNull());
    expect(screen.queryByTestId("prep-package-submit")).toBeNull();
    // данные действительно перечитаны, выбор студента на месте, а новая проверка возвращает предпросмотр
    expect(t.reads()).toBeGreaterThan(before);
    await waitFor(() => expect(selected()).toMatchObject({ selected: true }));
    await waitForEnabled("prep-package-preview");
    await fireEvent.press(screen.getByTestId("prep-package-preview"));
    expect(await screen.findByTestId("prep-package-submit")).toBeTruthy();
  });

  it("уход с экрана снимает предпросмотр, и возврат его не возвращает; выбор остаётся", async () => {
    await open(current);
    await showPreview();
    await leaveScreen();
    await waitFor(() => expect(screen.queryByTestId("prep-package-preview-box")).toBeNull());
    expect(screen.queryByTestId("prep-package-submit")).toBeNull();
    await returnToScreen();
    await waitFor(() => expect(selected()).toMatchObject({ selected: true }));
    expect(screen.queryByTestId("prep-package-submit")).toBeNull();
  });

  it("возврат в приложение перечитал данные, и версии 5 больше нет: предпросмотр снят сам, старый состав отправить нельзя", async () => {
    let phase: "before" | "after" = "before";
    const t = await open(() => (phase === "before" ? current() : withoutVersion5()));
    await showPreview();
    phase = "after";
    // перечитывание без нажатий студента: так возврат в приложение обновляет устаревшие чтения
    await act(async () => {
      await t.client.refetchQueries({ predicate: (query) => query.queryKey.includes("readiness") });
    });
    await waitFor(() => expect(screen.queryByTestId("prep-package-preview-box")).toBeNull());
    expect(screen.queryByTestId("prep-package-submit")).toBeNull();
    // выбранный файл пропал из списка: строка «Выбранный файл недоступен» стоит выбранной
    expect(await screen.findByTestId(`prep-package-missing-${FIRST}`)).toHaveTextContent("Выбранный файл недоступен");
  });

  it("ответ о составе пришёл, когда данные под ним уже изменились: предпросмотра нет, и читалке о нём не сказано", async () => {
    const spoken = AccessibilityInfo.announceForAccessibility as unknown as jest.Mock;
    let phase: "before" | "after" = "before";
    const t = await open(() => (phase === "before" ? current() : withoutVersion5()));
    await fireEvent.press(await screen.findByTestId("prep-package-choose-toggle"));
    await waitForEnabled("prep-package-preview");
    await fireEvent.press(screen.getByTestId(`prep-package-version-${FIRST}-${versionId(5)}`));
    let release: () => void = () => undefined;
    t.hold.preview = new Promise<void>((resolve) => (release = resolve));
    spoken.mockClear();
    await fireEvent.press(screen.getByTestId("prep-package-preview"));
    await waitFor(() => expect(t.hold.previewStarted).toBe(1));
    // пока идёт проверка состава, возврат в приложение перечитал данные: версии 5 больше нет, и экран уже показывает это
    phase = "after";
    await act(async () => {
      await t.client.refetchQueries({ predicate: readinessQuery });
    });
    expect(await screen.findByTestId(`prep-package-missing-${FIRST}`)).toHaveTextContent("Выбранный файл недоступен");
    await act(async () => release());
    await waitForEnabled("prep-package-preview");
    expect(screen.queryByTestId("prep-package-preview-box")).toBeNull();
    expect(screen.queryByTestId("prep-package-submit")).toBeNull();
    // «Состав перед отправкой. Комплект можно отправить» не прозвучало: на экране его нет
    expect(spoken.mock.calls.filter(([text]) => String(text).startsWith("Состав перед отправкой"))).toHaveLength(0);
  });

  it("перечитывание, которое ничего не изменило, предпросмотр не снимает", async () => {
    const t = await open(current);
    await showPreview();
    const before = t.reads();
    await act(async () => {
      await t.client.refetchQueries({ predicate: (query) => query.queryKey.includes("readiness") });
    });
    expect(t.reads()).toBeGreaterThan(before);
    expect(screen.getByTestId("prep-package-preview-box")).toBeTruthy();
    expect(screen.getByTestId("prep-package-submit").props.accessibilityState).toMatchObject({ disabled: false });
  });
});

describe("строка выбора файлов не теряет открытые страницы при обновлении", () => {
  const CURSOR = { versionNo: "5", documentVersionId: versionId(5) };
  /** У первого требования есть ещё сохранённые версии за первой страницей (`cursor`), если он задан. */
  const withMore = (cursor: Raw | null) =>
    readiness(requirements(items()), [documentState(0, { savedDraft: draftOf(0, 4), reusableVersions: [reusableVersion(5)], reusableVersionsNextCursor: cursor }), documentState(1, { reusableVersions: [reusableVersion(7)] })]);
  const moreButton = () => screen.queryByTestId(`prep-package-more-${FIRST}`);
  const version = (n: number) => screen.getByTestId(`prep-package-version-${FIRST}-${versionId(n)}`);

  it("файл со второй страницы «Показать ещё файлы» после «потянуть вниз» остаётся в списке и выбранным, а не «Выбранный файл недоступен»", async () => {
    // две дополнительные страницы: версия 3, затем версия 2 (последняя)
    const NEXT = { versionNo: "3", documentVersionId: versionId(3) };
    const t = await open(() => withMore(CURSOR), {
      application_document_reusable_versions_v1: (args: Raw | undefined) => (args?.p_cursor && (args.p_cursor as Raw).versionNo === "3" ? versionsPage(0, [reusableVersion(2)], null) : versionsPage(0, [reusableVersion(3)], NEXT)),
    });
    await fireEvent.press(await screen.findByTestId("prep-package-choose-toggle"));
    await waitForEnabled("prep-package-preview");
    await fireEvent.press(screen.getByTestId(`prep-package-more-${FIRST}`));
    await screen.findByTestId(`prep-package-version-${FIRST}-${versionId(3)}`);
    await fireEvent.press(screen.getByTestId(`prep-package-more-${FIRST}`));
    await fireEvent.press(await screen.findByTestId(`prep-package-version-${FIRST}-${versionId(2)}`));
    expect(version(2).props.accessibilityState).toMatchObject({ selected: true });
    expect(moreButton()).toBeNull();
    const before = t.reads();
    await act(async () => {
      await pullDown();
    });
    expect(t.reads()).toBeGreaterThan(before);
    await waitForEnabled("prep-package-preview");
    expect(screen.queryByTestId(`prep-package-missing-${FIRST}`)).toBeNull();
    // обе открытые страницы на месте, выбранная версия выбрана
    expect(version(2).props.accessibilityState).toMatchObject({ selected: true });
    expect(version(3).props.accessibilityState).toMatchObject({ selected: false });
    // последняя страница прочитана: «Показать ещё файлы» не возвращается, хотя в свежем ответе курсор первой страницы тот же
    expect(moreButton()).toBeNull();
  });

  it("после обновления у требования появились ещё сохранённые версии: «Показать ещё файлы» появляется (курсор берётся из свежего ответа)", async () => {
    let phase: "before" | "after" = "before";
    await open(() => withMore(phase === "before" ? null : CURSOR));
    await fireEvent.press(await screen.findByTestId("prep-package-choose-toggle"));
    await waitForEnabled("prep-package-preview");
    expect(moreButton()).toBeNull();
    phase = "after";
    await act(async () => {
      await pullDown();
    });
    expect(await screen.findByTestId(`prep-package-more-${FIRST}`)).toBeTruthy();
  });
});

describe("полоса «потянули вниз» горит только у перечитывания, которое начал студент", () => {
  it("перечитывание списка программ без студента (возврат, «Добавить в мои программы») полосу не зажигает; нажатие студента зажигает до конца чтения", async () => {
    const t = await open(current);
    await screen.findByTestId("prep-requirement-list");
    expect(spinner()).toBe(false);

    // список программ перечитывается сам: запрос идёт, а полосы нет
    let release: () => void = () => undefined;
    t.hold.list = new Promise<void>((resolve) => (release = resolve));
    await act(async () => {
      void t.client.refetchQueries({ predicate: (query) => query.queryKey.includes("preparations") });
    });
    await waitFor(() => expect(t.client.isFetching({ predicate: (query) => query.queryKey.includes("preparations") })).toBe(1));
    await afterQueryNotifications();
    expect(spinner()).toBe(false);
    await act(async () => release());
    await waitFor(() => expect(t.client.isFetching()).toBe(0));

    // студент потянул вниз: полоса горит, пока список перечитывается, и гаснет, когда он прочитан
    t.hold.list = new Promise<void>((resolve) => (release = resolve));
    await act(async () => {
      void pullDown();
    });
    await waitFor(() => expect(spinner()).toBe(true));
    await act(async () => release());
    await waitFor(() => expect(spinner()).toBe(false));
  });
});
