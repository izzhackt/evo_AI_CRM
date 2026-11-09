import { fireEvent, screen } from "@testing-library/react-native";
import { router } from "expo-router";

import { PaymentsScreen } from "@/features/payments/PaymentsScreen";
import { hasHowToPay } from "@/domain/payments-model";
import { MOBILE_STRINGS } from "@/i18n/mobile-strings";
import { PAYMENT_ROW } from "@/test-fixtures/rpc-rows";
import { renderPortal, testApi } from "@/test-fixtures/render";
import { failure, fakeTransport } from "@/test-fixtures/universities";

jest.mock("expo-router", () => ({ router: { navigate: jest.fn() }, useLocalSearchParams: jest.fn(() => ({})) }));
const navigate = router.navigate as jest.Mock;
beforeEach(() => navigate.mockClear());

describe("Оплата", () => {
  it("начисление: статус, суммы, следующий шаг; заголовок «Что нужно оплатить»", async () => {
    const { transport, calls } = fakeTransport({ student_portal_finance_v2: [PAYMENT_ROW] });
    await renderPortal(<PaymentsScreen />, testApi(transport));
    expect(await screen.findByText("Услуги EVO")).toBeTruthy();
    expect(screen.getByText("Что нужно оплатить")).toBeTruthy();
    expect(screen.queryByText("Начисления")).toBeNull();
    expect(screen.getByText("оплачено частично")).toBeTruthy();
    expect(screen.getByTestId("amount-0").props.children).toContain("100");
    expect(screen.getByText(/Оплатить остаток/)).toBeTruthy();
    expect(calls[0]).toMatchObject({ name: "student_portal_finance_v2", get: true });
  });

  it("«Написать EVO» ведёт во Входящие (/messages)", async () => {
    const { transport } = fakeTransport({ student_portal_finance_v2: [PAYMENT_ROW] });
    await renderPortal(<PaymentsScreen />, testApi(transport));
    await fireEvent.press(await screen.findByTestId("payments-write-evo"));
    expect(navigate).toHaveBeenCalledWith("/messages");
  });

  it("«Как оплатить» не рисуется, пока текст владельца пуст (#1359)", async () => {
    expect(MOBILE_STRINGS.ru["payments.howBody"]).toBe("");
    expect(MOBILE_STRINGS.ky["payments.howBody"]).toBe("");
    const { transport } = fakeTransport({ student_portal_finance_v2: [PAYMENT_ROW] });
    await renderPortal(<PaymentsScreen />, testApi(transport));
    await screen.findByText("Услуги EVO");
    expect(screen.queryByText("Как оплатить")).toBeNull();
    expect(screen.queryByTestId("how-to-pay")).toBeNull();
  });

  it("правило видимости блока", () => {
    expect(hasHowToPay("")).toBe(false);
    expect(hasHowToPay("  \n")).toBe(false);
    expect(hasHowToPay("Реквизиты: …")).toBe(true);
  });

  it("пусто: объяснение и тот же путь к чату; сбой чтения: плашка", async () => {
    const empty = fakeTransport({ student_portal_finance_v2: [] });
    const first = await renderPortal(<PaymentsScreen />, testApi(empty.transport));
    expect(await screen.findByText("Начислений пока нет")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("payments-write-evo"));
    expect(navigate).toHaveBeenCalledWith("/messages");
    first.unmount();
    const bad = fakeTransport({ student_portal_finance_v2: failure(null, 503) });
    await renderPortal(<PaymentsScreen />, testApi(bad.transport));
    expect(await screen.findByTestId("payments-error")).toBeTruthy();
  });
});
