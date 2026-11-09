import { fireEvent, screen, waitFor } from "@testing-library/react-native";

import type { ChangePasswordResult } from "@/api/portal-auth";
import { PasswordCard } from "@/features/profile/PasswordCard";
import { renderPortal, testApi } from "@/test-fixtures/render";
import { fakeTransport } from "@/test-fixtures/universities";

const mockSession = { portalAuth: { changeOwnPassword: jest.fn() }, signOut: jest.fn(async () => undefined) };
jest.mock("@/session/SessionProvider", () => ({ useSession: () => mockSession }));

const change = mockSession.portalAuth.changeOwnPassword as jest.Mock<Promise<ChangePasswordResult>, [string, string, string]>;

async function fill(current: string, next: string, confirm: string) {
  await fireEvent.press(screen.getByTestId("password-open"));
  await fireEvent.changeText(screen.getByTestId("password-current"), current);
  await fireEvent.changeText(screen.getByTestId("password-new"), next);
  await fireEvent.changeText(screen.getByTestId("password-confirm"), confirm);
}

async function mount(refresh: () => Promise<string | null> = async () => "fresh") {
  return renderPortal(<PasswordCard />, testApi(fakeTransport({}).transport, { refreshAccessToken: refresh }));
}

beforeEach(() => {
  change.mockReset();
  mockSession.signOut.mockClear();
});

describe("PasswordCard", () => {
  it("свёрнута: видна кнопка, полей нет; в форме есть подсказка про другие устройства", async () => {
    await mount();
    expect(screen.queryByTestId("password-form")).toBeNull();
    await fireEvent.press(screen.getByTestId("password-open"));
    expect(screen.getByTestId("password-form")).toBeTruthy();
    expect(screen.getByText(/выйдете из аккаунта на других устройствах/)).toBeTruthy();
    expect(screen.getByText("Не короче 12 символов.")).toBeTruthy();
  });

  it("слабый пароль отвергается на экране, сервер не вызывается", async () => {
    await mount();
    await fill("old-password-1", "short", "short");
    await fireEvent.press(screen.getByTestId("password-submit"));
    expect(await screen.findByText("Новый пароль короче 12 символов.")).toBeTruthy();
    expect(change).not.toHaveBeenCalled();
  });

  it("успех: поля очищены, сообщение «Пароль изменён.», вызов с токеном и обоими паролями", async () => {
    change.mockResolvedValue({ ok: true });
    await mount();
    await fill("old-password-1", "new-password-123", "new-password-123");
    await fireEvent.press(screen.getByTestId("password-submit"));
    expect(await screen.findByText("Пароль изменён.")).toBeTruthy();
    expect(change).toHaveBeenCalledWith("synthetic-token", "old-password-1", "new-password-123");
    expect(screen.getByTestId("password-current").props.value).toBe("");
    expect(screen.getByTestId("password-new").props.value).toBe("");
  });

  it("неверный текущий пароль: сообщение веба, поля остаются для правки", async () => {
    change.mockResolvedValue({ ok: false, reason: "wrong_current" });
    await mount();
    await fill("wrong-password-1", "new-password-123", "new-password-123");
    await fireEvent.press(screen.getByTestId("password-submit"));
    expect(await screen.findByText("Текущий пароль не подходит.")).toBeTruthy();
    expect(screen.getByTestId("password-new").props.value).toBe("new-password-123");
  });

  it("двойной 401: обновление один раз, затем выход на экран входа", async () => {
    change.mockResolvedValue({ ok: false, reason: "unauthorized" });
    const refresh = jest.fn(async () => "fresh");
    await mount(refresh);
    await fill("old-password-1", "new-password-123", "new-password-123");
    await fireEvent.press(screen.getByTestId("password-submit"));
    await waitFor(() => expect(mockSession.signOut).toHaveBeenCalledTimes(1));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(change).toHaveBeenCalledTimes(2);
  });
});
