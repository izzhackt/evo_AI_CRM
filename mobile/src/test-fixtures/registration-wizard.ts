// Прохождение мастера анкеты в тестах: шаги 1-6 и последний шаг «Контактные данные». Данные придуманы.
import { fireEvent, screen, waitFor } from "@testing-library/react-native";

import { localizedCountryLabel } from "@/features/registration/application-contract";

export const WIZARD_PASSWORD = "w".repeat(16);

const press = (id: string) => fireEvent.press(screen.getByTestId(id));
const type = (id: string, text: string) => fireEvent.changeText(screen.getByTestId(id), text);

/** Шаги 1-6 заполнены и пройдены; открыт последний шаг. */
export async function openAccountStep(): Promise<void> {
  await screen.findByTestId("wizard-next");
  await press("country-CN");
  await press("wizard-next");
  await press("season-autumn");
  await press("year-2027");
  await press("wizard-next");
  await press("education-high_school");
  await type("grade-input", "4,5");
  await press("level-bachelor");
  await press("wizard-next");
  await press("field-Информатика и IT");
  await press("wizard-next");
  await press("nationality");
  await type("nationality-search", localizedCountryLabel("KG", "ru"));
  await fireEvent.press(await screen.findByTestId("nationality-KG"));
  await press("english-mode-self");
  await press("level-self-advanced");
  await press("wizard-next");
  await press("budget-5000_10000");
  await press("funding-family");
  await press("wizard-next");
  await waitFor(() => expect(screen.getByTestId("wizard-step-label")).toHaveTextContent("Шаг 7 из 7"));
}

/** Последний шаг анонима заполнен, обе галочки стоят, анкета отправлена. */
export async function fillAccountAndSubmit(): Promise<void> {
  await type("first-name", "Тест");
  await type("last-name", "Студентов");
  await type("phone", "+996 555 000 111");
  await type("email", "test.student@example.test");
  await type("password", WIZARD_PASSWORD);
  await press("consent");
  await press("ai-consent");
  await press("wizard-next");
}
