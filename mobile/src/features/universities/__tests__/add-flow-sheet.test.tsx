// «Добавить в мои программы», окно программы закрыто, пока выбор шёл (ревью #1571): у iPhone RN 0.88 держит содержимое закрытого окна до
// его `onDismiss`, около 0,4 с (Modal.js: `isRendered`), поэтому «экран ещё жив» ничего не говорит. Заглушка `Modal` ниже ведёт себя так же
// (у заглушки Jest содержимое пропадает сразу, и add-flow.test.tsx этого не видит). Переход на страницу программы идёт только
// если окно именно этой программы ещё открыто.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { router } from "expo-router";

import { UniversityScreen } from "@/features/universities/UniversityScreen";
import { renderPortal, testApi } from "@/test-fixtures/render";
import { detailBody, documentsBody, initializeReceipt, preparationItem, program, selectReceipt } from "@/test-fixtures/programs";
import { fakeTransport, STUDENT_CASE_ID, uuidN } from "@/test-fixtures/universities";

const mockParams: { current: Record<string, string> } = { current: {} };
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => mockParams.current,
  useNavigation: () => ({ getState: () => ({ routes: [{ name: "index" }] }) }),
  router: { push: jest.fn(), back: jest.fn(), canGoBack: () => false, setParams: jest.fn(), navigate: jest.fn(), replace: jest.fn(), dismissTo: jest.fn() },
}));
jest.mock("@/config", () => ({ getConfig: () => ({ supabaseUrl: "http://localhost:46421", supabasePublishableKey: "k", portalBaseUrl: "http://localhost:46430" }) }));

// Окно как у iPhone в RN 0.88: закрыли (`visible=false`) - содержимое остаётся, пока окно не «доехало» (`finish` = нативный `onDismiss`).
const mockSheets: Record<string, { finish: () => void }> = {};
jest.mock("react-native/Libraries/Modal/Modal", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  const { View } = jest.requireActual<typeof import("react-native")>("react-native");
  function IosLikeModal({ visible, children, onDismiss, testID }: { visible?: boolean; children?: React.ReactNode; onDismiss?: () => void; testID?: string }) {
    const [rendered, setRendered] = React.useState(visible === true);
    if (visible === true && !rendered) setRendered(true);
    mockSheets[testID ?? "sheet"] = {
      finish: () => {
        setRendered(false);
        onDismiss?.();
      },
    };
    if (!rendered && visible !== true) return null;
    return <View testID={testID}>{children}</View>;
  }
  return { __esModule: true, default: IosLikeModal };
});

jest.setTimeout(30_000);

beforeEach(async () => {
  mockParams.current = { id: uuidN(1) };
  (router.push as jest.Mock).mockClear();
  await AsyncStorage.clear();
});

const programs = [program({ id: "cs-b", title: "Bachelor of Computer Science", intakes: [{ label: "Сентябрь 2027", startMonth: "2027-09", n: 11 }] })];
const item = preparationItem({ n: 9, programs, programId: "cs-b" });

const idle = (ms: number) =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });

/** Сервер: выбор держится на `gate`, пока тест его не отпустит; после выбора заявка появляется и в списке. */
function world(gate: Promise<void>, list = programs) {
  const state = { selected: false };
  const t = fakeTransport({
    student_university_detail_v1: () => detailBody(list, { preparations: { studentCaseId: STUDENT_CASE_ID, items: state.selected ? [item] : [] } }),
    student_university_favorites_v1: [],
    student_catalog_preparations_v1: () => (state.selected ? [item] : []),
    student_select_catalog_intake_v1: async (args: Record<string, unknown> | undefined) => {
      await gate;
      state.selected = true;
      return selectReceipt(item, args);
    },
    student_application_documents_v1: documentsBody(item.applicationId),
    student_initialize_application_requirements_v1: (args: Record<string, unknown> | undefined) => initializeReceipt(item.applicationId, args),
  });
  return { ...t, state };
}

async function startAdd(w: ReturnType<typeof world>) {
  const view = await renderPortal(<UniversityScreen />, testApi(w.transport));
  await fireEvent.press(await screen.findByTestId("program-cs-b"));
  await screen.findByTestId("program-dialog-title");
  await fireEvent.press(screen.getByTestId("program-add"));
  return view;
}

describe("окно закрыли, пока выбор шёл, а содержимое окна ещё живо (iPhone)", () => {
  it("заглушка держит содержимое закрытого окна до `onDismiss`", async () => {
    let release!: () => void;
    const w = world(new Promise<void>((resolve) => (release = resolve)));
    await startAdd(w);
    await fireEvent.press(screen.getByTestId("program-dialog-close"));
    expect(screen.queryByTestId("program-dialog-title")).toBeTruthy(); // как у iPhone: окно уезжает, содержимое ещё в дереве
    await act(async () => {
      mockSheets["program-dialog"]!.finish();
    });
    expect(screen.queryByTestId("program-dialog-title")).toBeNull();
    await act(async () => {
      release();
    });
    await idle(300); // выбор доходит до конца уже без окна: оповещения запросов приходят внутри `act`
  });

  it("выбор заканчивается во время закрытия окна: сохранён, карточка перечитана, страница программы не открывается ни по таймеру, ни по `onDismiss`", async () => {
    let release!: () => void;
    const w = world(new Promise<void>((resolve) => (release = resolve)));
    await startAdd(w);
    await fireEvent.press(screen.getByTestId("program-dialog-close"));
    const reads = () => w.calls.filter((call) => call.name === "student_university_detail_v1").length;
    const before = reads();
    await act(async () => {
      release(); // выбор доехал, пока окно ещё уезжает
    });
    await waitFor(() => expect(w.calls.some((call) => call.name === "student_initialize_application_requirements_v1")).toBe(true), { timeout: 10_000 });
    await waitFor(() => expect(reads()).toBeGreaterThan(before), { timeout: 10_000 });
    await idle(1_200); // дольше запасного таймера перехода (900 мс)
    expect(router.push).not.toHaveBeenCalled();
    await act(async () => {
      mockSheets["program-dialog"]!.finish(); // окно доехало: его `onDismiss` тоже ничего не открывает
    });
    expect(router.push).not.toHaveBeenCalled();
    expect(await AsyncStorage.getAllKeys()).toEqual([]);
  });

  it("закрыли и открыли другую программу: выбор первой переходов не делает", async () => {
    const second = program({ id: "ai-m", title: "Master of Artificial Intelligence", level: "master", intakes: [{ label: "Октябрь 2027", startMonth: "2027-10", n: 12 }] });
    let release!: () => void;
    const w = world(new Promise<void>((resolve) => (release = resolve)), [programs[0]!, second]);
    await renderPortal(<UniversityScreen />, testApi(w.transport));
    await fireEvent.press(await screen.findByTestId("program-cs-b"));
    await screen.findByTestId("program-dialog-title");
    await fireEvent.press(screen.getByTestId("program-add"));
    await fireEvent.press(screen.getByTestId("program-dialog-close"));
    await act(async () => {
      mockSheets["program-dialog"]!.finish();
    });
    await fireEvent.press(await screen.findByTestId("program-ai-m"));
    expect((await screen.findByTestId("program-dialog-title")).props.children).toBe("Master of Artificial Intelligence");
    await act(async () => {
      release();
    });
    await waitFor(() => expect(w.calls.some((call) => call.name === "student_initialize_application_requirements_v1")).toBe(true), { timeout: 10_000 });
    await idle(1_200);
    expect(router.push).not.toHaveBeenCalled();
  });

  it("выбор заканчивается, пока окно этой программы открыто: переход как обычно, один раз", async () => {
    let release!: () => void;
    const w = world(new Promise<void>((resolve) => (release = resolve)));
    await startAdd(w);
    await act(async () => {
      release();
    });
    await waitFor(() => expect(router.push).toHaveBeenCalledTimes(1), { timeout: 10_000 });
    expect((router.push as jest.Mock).mock.calls[0][0]).toEqual({ pathname: "/preparations/[applicationId]", params: { applicationId: item.applicationId } });
  });
});
