// Ссылка «Незавершённые отправки на этом устройстве» на «Главной», в карточке «Мой список», на любой вкладке списка.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { router } from "expo-router";

import { HomeList } from "@/features/home/HomeList";
import { packagesPending } from "@/features/preparations/packages-pending";
import { PACKAGE_RECOVERY_ROUTE } from "@/features/preparations/recovery-route";
import { APPLICATION_ID, REVISION_ID, STUDENT_CASE_ID } from "@/test-fixtures/preparations";
import { submitIntentOf } from "@/test-fixtures/preparations-packages";
import { renderPortal, testApi } from "@/test-fixtures/render";
import { fakeTransport, preparationRow } from "@/test-fixtures/universities";

jest.mock("@/config", () => ({ getConfig: () => ({ supabaseUrl: "http://localhost:46421", supabasePublishableKey: "k", portalBaseUrl: "http://localhost:46430" }) }));
jest.mock("expo-router", () => ({ router: { navigate: jest.fn() }, useLocalSearchParams: jest.fn(() => ({})) }));
jest.mock("expo-file-system", () => jest.requireActual("@/test-fixtures/memory-file-system").memoryFileSystem());

const navigate = router.navigate as jest.Mock;
const scope = { organizationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", membershipId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", studentCaseId: STUDENT_CASE_ID, applicationId: APPLICATION_ID };

async function renderList(tab: "universities" | "programs") {
  const { transport } = fakeTransport({ student_catalog_preparations_v1: [preparationRow(1)] });
  await renderPortal(<HomeList tab={tab} onTabChange={() => undefined} now={new Date("2026-11-25T05:00:00Z")} />, testApi(transport));
  await waitFor(() => expect(AsyncStorage.getAllKeys).toHaveBeenCalled());
  await act(async () => undefined);
}

beforeEach(async () => {
  navigate.mockClear();
  await AsyncStorage.clear();
});

describe("«Мой список»: незавершённые отправки комплекта", () => {
  it.each(["universities", "programs"] as const)("есть оборванная отправка: ссылка видна на вкладке %s и ведёт на страницу восстановления", async (tab) => {
    await packagesPending.persist(scope, "submit", REVISION_ID, submitIntentOf([0], [5]) as never);
    await renderList(tab);
    const link = await screen.findByTestId("pending-packages-link");
    expect(link).toHaveTextContent("Незавершённые отправки на этом устройстве");
    await fireEvent.press(link);
    expect(navigate).toHaveBeenCalledWith(PACKAGE_RECOVERY_ROUTE);
  });

  it("записей нет: в карточке «Мой список» ссылки нет", async () => {
    await renderList("programs");
    expect(screen.queryByTestId("pending-packages-link")).toBeNull();
  });
});
