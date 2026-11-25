/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock фабрики загружают модули лениво */
// Экран входа ведёт к «Подтвердите почту», если регистрация ждёт подтверждения почты (G10 аудита паритета 25.11.2026).
import { render, screen, waitFor } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import SignInScreen from "@/app/(auth)/sign-in";
import { clearPendingSignup, savePendingSignup } from "@/features/registration/pending-store";
import { LangProvider } from "@/i18n/LangProvider";
import { ThemeProvider } from "@/theme/ThemeProvider";

jest.mock("expo-router", () => {
  const { Pressable } = require("react-native");
  return { Link: ({ children, href: _href, ...rest }: { children: React.ReactNode; href: string }) => <Pressable {...rest}>{children}</Pressable> };
});
const mockSecure = new Map<string, string>();
jest.mock("expo-secure-store", () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: "when-unlocked-this-device-only",
  setItemAsync: async (key: string, value: string) => void mockSecure.set(key, value),
  getItemAsync: async (key: string) => mockSecure.get(key) ?? null,
  deleteItemAsync: async (key: string) => void mockSecure.delete(key),
}));
jest.mock("@/session/SessionProvider", () => ({ useSession: () => ({ state: { kind: "signedOut", accountDeleted: false }, signIn: jest.fn() }) }));

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const renderScreen = (lang: "ru" | "ky" = "ru") =>
  render(
    <SafeAreaProvider initialMetrics={metrics}>
      <ThemeProvider>
        <LangProvider initial={lang}>
          <SignInScreen />
        </LangProvider>
      </ThemeProvider>
    </SafeAreaProvider>,
  );

beforeEach(() => mockSecure.clear());

const pending = { maskedEmail: "t***@example.test", expiresAt: new Date(Date.now() + 3_600_000).toISOString(), retryAfterSeconds: 30, dispatch: "accepted" as const, resendCapability: "cap.synthetic_1" };

describe("ссылка на регистрацию на экране входа", () => {
  it("без ожидающей регистрации: «Регистрация по ссылке»", async () => {
    await renderScreen();
    expect(screen.getByTestId("apply-link-label")).toHaveTextContent("Регистрация по ссылке");
    await waitFor(() => expect(screen.getByTestId("apply-link-label")).toHaveTextContent("Регистрация по ссылке"));
  });

  it("регистрация ждёт подтверждения почты: «Подтвердите почту» (RU и KY)", async () => {
    await savePendingSignup(pending);
    const view = await renderScreen();
    await waitFor(() => expect(screen.getByTestId("apply-link-label")).toHaveTextContent("Подтвердите почту"));
    await view.unmount();
    await renderScreen("ky");
    await waitFor(() => expect(screen.getByTestId("apply-link-label")).toHaveTextContent("Электрондук почтаңызды ырастаңыз"));
  });

  it("запись стёрта (вход, выход, срок): снова «Регистрация по ссылке»", async () => {
    await savePendingSignup(pending);
    await clearPendingSignup();
    await renderScreen();
    expect(screen.getByTestId("apply-link-label")).toHaveTextContent("Регистрация по ссылке");
  });
});
