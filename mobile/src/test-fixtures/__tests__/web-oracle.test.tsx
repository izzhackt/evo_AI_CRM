// Сам загрузчик веб-кода для тестов сверки: что он разворачивает, что подставляет и когда честно падает.
import { Fragment, createElement } from "react";

import { expand, findAll, firstByClass, loadWebModule, nativeFragments, spokenText, visibleFragments, webModule, webText } from "@/test-fixtures/web-oracle";

describe("разворачивание элементов", () => {
  const Row = ({ title, hidden }: { title: string; hidden?: boolean }) => (hidden ? null : createElement("li", { className: "row" }, title));

  it("функциональные компоненты, фрагменты, массивы, пустые значения и числа", () => {
    const tree = expand(createElement("ul", { className: "list" }, [createElement(Row, { key: "a", title: "Один" }), createElement(Row, { key: "b", title: "Два", hidden: true }), null, false, 3, createElement(Fragment, { key: "c" }, "хвост")]));
    expect(tree.tag).toBe("ul");
    expect(tree.children.map((child) => (typeof child === "string" ? child : child.tag))).toEqual(["li", "3", "хвост"]);
    expect(findAll(tree, (node) => node.tag === "li")).toHaveLength(1);
  });

  it("несколько корней - корень «#root»", () => {
    expect(expand(createElement(Fragment, null, createElement("p", null, "а"), createElement("p", null, "б"))).tag).toBe("#root");
  });

  it("текст для зрячего без блоков для читалки и без пояснения за «?»; для читалки без скрытого декора", () => {
    const tree = expand(
      createElement("div", null, [
        createElement("span", { key: "a" }, "видно"),
        createElement("span", { key: "b", className: "pt-sr-only" }, "только читалке"),
        createElement("p", { key: "c", className: "pt-home-hint-text" }, "пояснение за ?"),
        createElement("span", { key: "d", "aria-hidden": "true" }, "декор"),
        "  ",
      ]),
    );
    expect(visibleFragments(tree)).toEqual(["видно", "декор"]);
    // читалка не слышит скрытый декор, но слышит и блок «только читалке», и пояснение
    expect(spokenText(tree).trim()).toBe("виднотолько читалкепояснение за ?");
    expect(firstByClass(tree, "pt-sr-only")?.tag).toBe("span");
  });
});

describe("строки приложения из дерева Testing Library", () => {
  it("вложенный текст склеивается в одну строку, пустое отбрасывается, порядок сохраняется", () => {
    const json = [
      { type: "View", children: [{ type: "Text", children: ["Ближайшие даты"] }, { type: "Text", children: ["  "] }] },
      { type: "View", children: [{ type: "Text", children: [{ type: "Text", children: ["Срок: "] }, "12.09.2026"] }] },
      "отдельная строка",
      null,
    ];
    expect(nativeFragments(json)).toEqual(["Ближайшие даты", "Срок: 12.09.2026", "отдельная строка"]);
  });
});

describe("загрузка веб-файлов", () => {
  it("настоящие компоненты веба выполняются: шапка «Главной» отдаёт приветствие", () => {
    const { HomeHeroContent } = webModule<{ HomeHeroContent: (props: Record<string, unknown>) => never }>("components/portal/home/HomeHero.tsx");
    const tree = expand(createElement(HomeHeroContent as never, { displayName: "Айжан", studyCountry: null, locale: "ru" }));
    expect(visibleFragments(tree)).toEqual(["Здравствуйте, Айжан"]);
  });

  it("клиентский модуль без подстановки - честная ошибка, а не тихо пустой компонент", () => {
    expect(() => webModule("components/portal/home/HomeFavoritesStrip.tsx")).toThrow(/клиентский или серверный модуль/);
  });

  it("неизвестный пакет и несуществующий файл называются в ошибке вместе с файлом, который их подключил", () => {
    expect(() => loadWebModule("/нет/такого/файла.tsx")).toThrow();
  });

  it("правила, которых нет в коде (порядок блоков в CSS), читаются как текст веб-файла", () => {
    expect(webText("app/(portal)/portal.css")).toContain('.pt-home-slot[data-slot="case"] { order: 1; }');
  });
});
