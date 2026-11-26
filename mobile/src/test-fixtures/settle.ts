// Ожидание в тестах экрана программы по условию, а не по времени: экран читает записи на телефоне и список восстановления
// в фоне, поэтому «кнопка уже есть» ещё не значит «кнопка уже включена, а запись уже прочитана».
import { act, screen, waitFor } from "@testing-library/react-native";

/** Ждёт, пока кнопка включится: до чтения записей она выключена, и нажатие на неё проверило бы не то, что задумано. */
export async function waitForEnabled(testID: string): Promise<void> {
  await waitFor(() => expect(screen.getByTestId(testID).props.accessibilityState).toMatchObject({ disabled: false }));
}

/** Ждёт, пока кнопка выключится (идёт действие или запись не читается). */
export async function waitForDisabled(testID: string): Promise<void> {
  await waitFor(() => expect(screen.getByTestId(testID).props.accessibilityState).toMatchObject({ disabled: true }));
}

/**
 * Даёт экрану дочитать всё, что он читает в фоне (записи форм, список восстановления), прежде чем утверждать «этого нет»:
 * иначе проверка отсутствия прошла бы и тогда, когда чтение ещё не началось, и ничего не доказала бы. Пропускаются все ожидающие
 * микрозадачи и один оборот цикла событий внутри `act`; время на часах тут ни при чём, поэтому нагрузка на машину результат не меняет.
 */
export async function settle(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => setImmediate(resolve));
  });
}
