import { fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { StyleSheet } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { LangProvider } from "@/i18n/LangProvider";
import { ThemeProvider } from "@/theme/ThemeProvider";
import { Segmented } from "@/ui/Segmented";

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };

function wrap(ui: ReactElement) {
  return (
    <SafeAreaProvider initialMetrics={metrics}>
      <ThemeProvider>
        <LangProvider initial="ru">{ui}</LangProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

describe("Segmented: длинная подпись не раздувает сегмент", () => {
  it("сегменты делят ширину поровну (flexBasis 0, minWidth 0), выбор срабатывает", async () => {
    const onChange = jest.fn();
    await render(
      <SafeAreaProvider initialMetrics={metrics}>
        <ThemeProvider>
          <LangProvider initial="ru">
            <Segmented
              value="light"
              onChange={onChange}
              testIDPrefix="theme"
              options={[
                { value: "light", label: "Светлая" },
                { value: "dark", label: "Тёмная" },
                { value: "system", label: "Как в системе" },
              ]}
            />
          </LangProvider>
        </ThemeProvider>
      </SafeAreaProvider>,
    );
    const system = StyleSheet.flatten(screen.getByTestId("theme-system").props.style);
    expect(system.flexBasis).toBe(0);
    expect(system.flexGrow).toBe(1);
    expect(system.minWidth).toBe(0);
    fireEvent.press(screen.getByTestId("theme-system"));
    expect(onChange).toHaveBeenCalledWith("system");
  });
});

describe("Segmented: доступность без изменения вида (G44)", () => {
  const view = [
    { value: "cities", label: "Города" },
    { value: "list", label: "Списком" },
    { value: "map", label: "Карта" },
  ] as const;

  it("по умолчанию, как раньше: radiogroup, радио-кнопки с состоянием checked, ни подписей, ни подсказок", async () => {
    await render(wrap(<Segmented value="list" onChange={jest.fn()} testIDPrefix="view" options={view} />));
    const group = screen.getByTestId("view-group");
    expect(group.props.accessibilityRole).toBe("radiogroup");
    expect(group.props.accessibilityLabel).toBeUndefined();
    for (const [value, checked] of [["cities", false], ["list", true], ["map", false]] as const) {
      const option = screen.getByTestId(`view-${value}`);
      expect(option.props.accessibilityRole).toBe("radio");
      expect(option.props.accessibilityState).toEqual({ checked });
      expect(option.props.accessibilityLabel).toBeUndefined();
      expect(option.props.accessibilityHint).toBeUndefined();
    }
    expect(screen.getByTestId("view-list")).toBeChecked();
    expect(screen.getByTestId("view-map")).not.toBeChecked();
  });

  it("название группы доходит до читалки", async () => {
    await render(wrap(<Segmented value="list" onChange={jest.fn()} testIDPrefix="view" accessibilityLabel="Вид списка" options={view} />));
    const group = screen.getByTestId("view-group");
    expect(group.props.accessibilityRole).toBe("radiogroup");
    expect(group.props.accessibilityLabel).toBe("Вид списка");
  });

  it("у варианта своя подпись и подсказка для читалки; видимый текст остаётся прежним", async () => {
    await render(
      wrap(
        <Segmented
          value="universities"
          onChange={jest.fn()}
          testIDPrefix="tab"
          options={[
            { value: "universities", label: "Вузы", accessibilityLabel: "Вузы, 4", accessibilityHint: "Показывает сохранённые вузы" },
            { value: "programs", label: "Мои программы", accessibilityLabel: "Мои программы, 3" },
          ]}
        />,
      ),
    );
    expect(screen.getByTestId("tab-universities")).toHaveAccessibleName("Вузы, 4");
    expect(screen.getByTestId("tab-universities").props.accessibilityHint).toBe("Показывает сохранённые вузы");
    expect(screen.getByTestId("tab-programs")).toHaveAccessibleName("Мои программы, 3");
    expect(screen.getByTestId("tab-programs").props.accessibilityHint).toBeUndefined();
    // Видимые подписи не тронуты.
    expect(screen.getByText("Вузы")).toBeOnTheScreen();
    expect(screen.getByText("Мои программы")).toBeOnTheScreen();
  });

  it("без своей подписи читается видимая", async () => {
    await render(wrap(<Segmented value="list" onChange={jest.fn()} testIDPrefix="view" options={view} />));
    expect(screen.getByTestId("view-map")).toHaveAccessibleName("Карта");
  });

  it("semantics=\"tabs\": tablist и вкладки с состоянием selected, не checked", async () => {
    await render(
      wrap(
        <Segmented
          value="lessons"
          onChange={jest.fn()}
          semantics="tabs"
          testIDPrefix="csca-tab"
          accessibilityLabel="Разделы CSCA"
          options={[
            { value: "about", label: "Об экзамене" },
            { value: "lessons", label: "Уроки" },
          ]}
        />,
      ),
    );
    const group = screen.getByTestId("csca-tab-group");
    expect(group.props.accessibilityRole).toBe("tablist");
    expect(group.props.accessibilityLabel).toBe("Разделы CSCA");
    const lessons = screen.getByTestId("csca-tab-lessons");
    const about = screen.getByTestId("csca-tab-about");
    expect(lessons.props.accessibilityRole).toBe("tab");
    expect(lessons.props.accessibilityState).toEqual({ selected: true });
    expect(about.props.accessibilityState).toEqual({ selected: false });
    expect(lessons).toBeSelected();
    expect(about).not.toBeSelected();
  });

  it("выбор срабатывает и у вкладок", async () => {
    const onChange = jest.fn();
    await render(
      wrap(
        <Segmented
          value="about"
          onChange={onChange}
          semantics="tabs"
          testIDPrefix="csca-tab"
          options={[
            { value: "about", label: "Об экзамене" },
            { value: "lessons", label: "Уроки" },
          ]}
        />,
      ),
    );
    fireEvent.press(screen.getByTestId("csca-tab-lessons"));
    expect(onChange).toHaveBeenCalledWith("lessons");
  });

  it("вид по умолчанию прежний: размеры, отступы и выравнивание такие же, как до правки", async () => {
    await render(wrap(<Segmented value="list" onChange={jest.fn()} testIDPrefix="v" options={view} />));
    for (const o of view) {
      expect(StyleSheet.flatten(screen.getByTestId(`v-${o.value}`).props.style)).toMatchObject({
        flexGrow: 1,
        flexBasis: 0,
        minWidth: 0,
        paddingHorizontal: 6,
        minHeight: 44,
        alignItems: "center",
        justifyContent: "center",
      });
    }
    expect(StyleSheet.flatten(screen.getByTestId("v-group").props.style)).toMatchObject({ flexDirection: "row", padding: 3 });
  });

  it("вид не меняется: стили группы и вариантов одинаковы с подписями и без них, в обоих видах семантики", async () => {
    const withLabels = view.map((o) => ({ ...o, accessibilityLabel: `${o.label}!`, accessibilityHint: "подсказка" }));
    await render(
      wrap(
        <>
          <Segmented value="list" onChange={jest.fn()} testIDPrefix="plain" options={view} />
          <Segmented value="list" onChange={jest.fn()} testIDPrefix="radio" options={withLabels} accessibilityLabel="Вид списка" />
          <Segmented value="list" onChange={jest.fn()} testIDPrefix="tabs" options={withLabels} accessibilityLabel="Вид списка" semantics="tabs" />
        </>,
      ),
    );
    const styles = (prefix: string) => ({
      group: StyleSheet.flatten(screen.getByTestId(`${prefix}-group`).props.style),
      options: view.map((o) => StyleSheet.flatten(screen.getByTestId(`${prefix}-${o.value}`).props.style)),
    });
    const plain = styles("plain");
    expect(plain.options).toHaveLength(3);
    expect(styles("radio")).toEqual(plain);
    expect(styles("tabs")).toEqual(plain);
  });
});
