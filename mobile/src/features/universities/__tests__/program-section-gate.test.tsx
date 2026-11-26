// Переход на страницу программы идёт, только если окно ИМЕННО этой программы ещё открыто (ревью #1571). Здесь наборы подменены заглушкой,
// и тест сам вызывает обработчик «открыть страницу» запоздавшего набора: так видно, что его не заменяет проверка «какое-то окно открыто».
// Ещё: два выбора подряд дают один переход к первой заявке, а программа, пропавшая из карточки вуза, закрывает окно и «открытость».
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { router } from "expo-router";

import { UniversityScreen } from "@/features/universities/UniversityScreen";
import { preparationHref } from "@/features/preparations/routes";
import { renderPortal, testApi } from "@/test-fixtures/render";
import { detailBody, preparationItem, program } from "@/test-fixtures/programs";
import { fakeTransport, STUDENT_CASE_ID, uuidN } from "@/test-fixtures/universities";

const mockParams: { current: Record<string, string> } = { current: {} };
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => mockParams.current,
  useNavigation: () => ({ getState: () => ({ routes: [{ name: "index" }] }) }),
  router: { push: jest.fn(), back: jest.fn(), canGoBack: () => false, setParams: jest.fn(), navigate: jest.fn(), replace: jest.fn(), dismissTo: jest.fn() },
}));
jest.mock("@/config", () => ({ getConfig: () => ({ supabaseUrl: "http://localhost:46421", supabasePublishableKey: "k", portalBaseUrl: "http://localhost:46430" }) }));
const mockIntakes: Record<string, { onOpenApplication: (applicationId: string) => void }> = {};
jest.mock("@/features/universities/IntakeSelect", () => ({
  IntakeSelect: (props: { program: { id: string }; onOpenApplication: (applicationId: string) => void }) => {
    mockIntakes[props.program.id] = props;
    return null;
  },
}));

jest.setTimeout(30_000);

beforeEach(async () => {
  mockParams.current = { id: uuidN(1) };
  (router.push as jest.Mock).mockClear();
  await AsyncStorage.clear();
});

const programs = [
  program({ id: "cs-b", title: "Bachelor of Computer Science", intakes: [{ label: "Сентябрь 2027", startMonth: "2027-09", n: 11 }] }),
  program({ id: "ai-m", title: "Master of Artificial Intelligence", level: "master", intakes: [{ label: "Октябрь 2027", startMonth: "2027-10", n: 12 }] }),
];
const item = preparationItem({ n: 9, programs, programId: "cs-b" });

const idle = (ms: number) =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });

/** Карточка вуза, которую можно «опубликовать заново» с другим списком программ (`publish`). */
async function show() {
  let published = programs;
  const t = fakeTransport({
    student_university_detail_v1: () => detailBody(published, { preparations: { studentCaseId: STUDENT_CASE_ID, items: [] } }),
    student_university_favorites_v1: [],
  });
  const { client } = await renderPortal(<UniversityScreen />, testApi(t.transport));
  await screen.findByTestId("program-cs-b");
  const publish = (list: typeof programs) => {
    published = list;
    return act(async () => {
      await client.invalidateQueries({ queryKey: ["portal", "user-test", "university-detail", uuidN(1)] });
    });
  };
  return { publish };
}

describe("ProgramSection: переход на страницу программы", () => {
  it("запоздавший набор закрытой программы, пока открыта другая, перехода не делает; набор открытой - делает один раз", async () => {
    await show();
    await fireEvent.press(screen.getByTestId("program-cs-b"));
    await screen.findByTestId("program-dialog-title");
    const stale = mockIntakes["cs-b"]!.onOpenApplication;
    await fireEvent.press(screen.getByTestId("program-dialog-close"));
    await fireEvent.press(screen.getByTestId("program-ai-m"));
    expect((await screen.findByTestId("program-dialog-title")).props.children).toBe("Master of Artificial Intelligence");

    await act(async () => {
      stale(item.applicationId); // выбор первой программы закончился, пока открыта вторая
    });
    await idle(1_200);
    expect(router.push).not.toHaveBeenCalled();
    expect(screen.getByTestId("program-dialog-title")).toBeTruthy(); // окно второй программы не тронуто

    await act(async () => {
      mockIntakes["ai-m"]!.onOpenApplication(item.applicationId);
    });
    await waitFor(() => expect(router.push).toHaveBeenCalledTimes(1), { timeout: 10_000 });
    expect(router.push).toHaveBeenCalledWith(preparationHref(item.applicationId));
  });

  it("окно закрыто совсем: запоздавший набор перехода не делает", async () => {
    await show();
    await fireEvent.press(screen.getByTestId("program-cs-b"));
    await screen.findByTestId("program-dialog-title");
    const stale = mockIntakes["cs-b"]!.onOpenApplication;
    await fireEvent.press(screen.getByTestId("program-dialog-close"));
    await act(async () => {
      stale(item.applicationId);
    });
    await idle(1_200);
    expect(router.push).not.toHaveBeenCalled();
  });

  it("два выбора подряд, пока окно закрывается: один переход, к ПЕРВОЙ заявке", async () => {
    await show();
    await fireEvent.press(screen.getByTestId("program-cs-b"));
    await screen.findByTestId("program-dialog-title");
    const complete = mockIntakes["cs-b"]!.onOpenApplication;
    const first = uuidN(21, "bbbbbbbb");
    const second = uuidN(22, "bbbbbbbb");
    await act(async () => {
      complete(first);
      complete(second); // окно уже закрывается: второй выбор стоит позади первого
    });
    await waitFor(() => expect(router.push).toHaveBeenCalledTimes(1), { timeout: 10_000 });
    expect(router.push).toHaveBeenCalledWith(preparationHref(first));
    await idle(1_200);
    expect(router.push).toHaveBeenCalledTimes(1);
  });

  it("открытая программа пропала из карточки вуза после повторной публикации: окно закрыто, запоздавший выбор перехода не делает, вернувшаяся программа окно сама не открывает", async () => {
    const { publish } = await show();
    await fireEvent.press(screen.getByTestId("program-cs-b"));
    await screen.findByTestId("program-dialog-title");
    const stale = mockIntakes["cs-b"]!.onOpenApplication;

    await publish([programs[1]!]);
    await waitFor(() => expect(screen.queryByTestId("program-dialog-title")).toBeNull());
    expect(screen.queryByTestId("program-cs-b")).toBeNull();
    await act(async () => {
      stale(item.applicationId);
    });
    await idle(1_200);
    expect(router.push).not.toHaveBeenCalled();

    await publish(programs);
    expect(await screen.findByTestId("program-cs-b")).toBeTruthy();
    expect(screen.queryByTestId("program-dialog-title")).toBeNull();
  });

  it("«Открыть» у программы A, а окно B открыто раньше запасного таймера (`onDismiss` не пришёл): страница A не открывается", async () => {
    await show();
    await fireEvent.press(screen.getByTestId("program-cs-b"));
    await screen.findByTestId("program-dialog-title");
    const openA = mockIntakes["cs-b"]!.onOpenApplication;
    await act(async () => {
      openA(item.applicationId); // «Открыть»: окно A закрывается, переход ждёт его закрытия или таймера (900 мс)
    });
    await waitFor(() => expect(screen.queryByTestId("program-dialog-title")).toBeNull());
    await fireEvent.press(screen.getByTestId("program-ai-m")); // студент открыл B, не дождавшись; `onDismiss` у заглушки Jest не приходит никогда
    expect((await screen.findByTestId("program-dialog-title")).props.children).toBe("Master of Artificial Intelligence");
    await idle(1_200); // дольше запасного таймера A
    expect(router.push).not.toHaveBeenCalled();
    expect(screen.getByTestId("program-dialog-title")).toBeTruthy(); // окно B на месте
  });
});
