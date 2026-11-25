// Экран «Придумайте свой пароль» (вход с временным паролем): слова веба (src/components/student-application/NewPasswordForm.tsx),
// аудит паритета 25.11.2026, G12.
import { render, screen } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import SetPasswordScreen from "@/app/set-password";
import { LangProvider } from "@/i18n/LangProvider";
import { ThemeProvider } from "@/theme/ThemeProvider";

jest.mock("@/session/SessionProvider", () => ({
  useSession: () => ({ setOwnPassword: jest.fn(async () => "ok"), signOut: jest.fn(async () => undefined) }),
}));
// Под карточкой пароля стоит секция «Удалить аккаунт» (читает статус запроса через RPC платформы): сеть заменена.
jest.mock("@/lib/supabase", () => ({ getSupabase: () => ({}), platformTransport: () => async () => ({ data: null, error: null, status: 200 }) }));

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
async function renderScreen(lang: "ru" | "ky") {
  return render(
    <SafeAreaProvider initialMetrics={metrics}>
      <ThemeProvider>
        <LangProvider initial={lang}>
          <SetPasswordScreen />
        </LangProvider>
      </ThemeProvider>
    </SafeAreaProvider>,
  );
}

describe("экран нового пароля после временного", () => {
  it("RU: заголовок, пояснение, подсказка и подпись повтора как на вебе", async () => {
    await renderScreen("ru");
    expect(screen.getByText("Придумайте свой пароль")).toBeTruthy();
    expect(screen.getByText("Вы вошли с временным паролем. Придумайте свой — дальше входите с ним.")).toBeTruthy();
    expect(screen.getByText("Не короче 12 знаков.")).toBeTruthy();
    expect(screen.getByText("Повторите пароль")).toBeTruthy();
    expect(screen.getByText("Новый пароль")).toBeTruthy();
    expect(screen.getByText("Сохранить пароль")).toBeTruthy();
    expect(screen.queryByText("Задайте свой пароль")).toBeNull();
  });

  it("KY: те же слова на кыргызском", async () => {
    await renderScreen("ky");
    expect(screen.getByText("Өз сырсөзүңүздү ойлоп табыңыз")).toBeTruthy();
    expect(screen.getByText("12 белгиден кем эмес.")).toBeTruthy();
    expect(screen.getByText("Сырсөздү кайталаңыз")).toBeTruthy();
  });
});
