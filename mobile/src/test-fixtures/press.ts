// Нажатия для тестов замков экрана.
import { act, screen } from "@testing-library/react-native";

/**
 * Два нажатия, пришедшие раньше, чем React выключил кнопку: `onClick` кнопки вызывается дважды подряд без перерисовки между ними
 * (`fireEvent.press` после первого же нажатия увидел бы уже выключенную кнопку и тест проверял бы не замок, а `disabled`).
 * Второе нажатие может остановить только замок самого экрана.
 */
export async function pressTwiceInOneTick(testID: string): Promise<void> {
  const click = screen.getByTestId(testID).props.onClick as ((event: unknown) => void) | undefined;
  if (!click) throw new Error(`у ${testID} нет обработчика нажатия`);
  const event = { stopPropagation: () => undefined, preventDefault: () => undefined, nativeEvent: {} };
  await act(async () => {
    click(event);
    click(event);
  });
}
