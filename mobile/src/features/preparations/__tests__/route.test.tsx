// Файл маршрута `app/(app)/preparations/[applicationId].tsx` существует там, куда ведёт `preparationHref`, и отдаёт параметр экрану.
import { screen } from "@testing-library/react-native";
import { existsSync } from "node:fs";
import path from "node:path";
import { useLocalSearchParams } from "expo-router";

import PreparationRoute from "@/app/(app)/preparations/[applicationId]";
import { PREPARATION_ROUTE, preparationHref } from "@/features/preparations/routes";
import { APPLICATION_ID, starterReadiness } from "@/test-fixtures/preparations";
import { renderPortal, testApi } from "@/test-fixtures/render";
import { fakeTransport, preparationRow } from "@/test-fixtures/universities";

jest.mock("expo-router", () => ({ router: { navigate: jest.fn() }, useLocalSearchParams: jest.fn(() => ({})) }));

const params = useLocalSearchParams as jest.Mock;

describe("маршрут «Требования программы»", () => {
  it("шаблон из routes.ts совпадает с файлом маршрута: ссылки других срезов ведут на настоящий экран", () => {
    const file = path.join(__dirname, "../../../app/(app)/preparations/[applicationId].tsx");
    expect(PREPARATION_ROUTE).toBe("/preparations/[applicationId]");
    expect(existsSync(file)).toBe(true);
    expect(existsSync(path.join(path.dirname(file), "_layout.tsx"))).toBe(true);
    expect(preparationHref(APPLICATION_ID)).toEqual({ pathname: PREPARATION_ROUTE, params: { applicationId: APPLICATION_ID } });
  });

  it("параметр applicationId из адреса доходит до экрана", async () => {
    params.mockReturnValue({ applicationId: APPLICATION_ID });
    const { transport } = fakeTransport({ student_catalog_preparations_v1: [preparationRow(1)], application_package_readiness_v1: starterReadiness() });
    await renderPortal(<PreparationRoute />, testApi(transport));
    expect(await screen.findByTestId("prep-title")).toHaveTextContent("Информатика");
    expect(await screen.findByTestId("prep-requirement-list")).toBeTruthy();
  });

  it("адрес без параметра: «не найдена», ни одного запроса", async () => {
    params.mockReturnValue({});
    const { transport, calls } = fakeTransport({});
    await renderPortal(<PreparationRoute />, testApi(transport));
    expect(screen.getByTestId("prep-not-found")).toBeTruthy();
    expect(calls).toHaveLength(0);
  });
});
