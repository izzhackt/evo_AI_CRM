// Показ блока сбоя (QA 24, N2): страница прокручивается к блоку только когда верх блока выше видимой части, один раз на событие.
// Здесь сама арифметика (`usePageScroll`, `useRevealBlock`); на настоящих экранах теста её проверяют `assessment-screen` и `csca-test-screen`.
import { renderHook } from "@testing-library/react-native";

import { REVEAL_MARGIN, usePageScroll, useRevealBlock } from "@/features/learning/page-reveal";

const layout = (y: number) => ({ nativeEvent: { layout: { x: 0, y, width: 370, height: 200 } } }) as never;

/** Страница с заглушкой `scrollTo` и оба хука, как у раннера теста. */
async function mount() {
  const scrollTo = jest.fn();
  const ref = { current: { scrollTo } };
  const { result } = await renderHook(() => {
    const page = usePageScroll(ref);
    const block = useRevealBlock(page);
    return { page, block };
  });
  return { scrollTo, ref, ...result.current };
}

describe("usePageScroll: блок показывается, только если его верх выше видимой части", () => {
  it("верх блока выше видимой части: страница идёт к нему, с запасом над блоком, без анимации", async () => {
    const { page, scrollTo } = await mount();
    page.onScrollY(900);
    page.reveal(124);
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith({ y: 124 - REVEAL_MARGIN, animated: false });
  });

  it("верх блока в видимой части, на её краю или ниже: страница стоит (студент блок видит)", async () => {
    const { page, scrollTo } = await mount();
    page.reveal(124); // страница наверху
    page.onScrollY(100);
    page.reveal(124); // верх блока ниже верха окна
    page.onScrollY(124);
    page.reveal(124); // ровно на краю: виден
    expect(scrollTo).not.toHaveBeenCalled();
    page.onScrollY(125);
    page.reveal(124); // на пиксель выше: уже нет
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });

  it("блок у самого начала страницы: прокрутка не уходит в минус", async () => {
    const { page, scrollTo } = await mount();
    page.onScrollY(300);
    page.reveal(5);
    expect(scrollTo).toHaveBeenCalledWith({ y: 0, animated: false });
  });

  it("после своей прокрутки страница знает, где она: второй вопрос о том же блоке её не двигает; студент ушёл вниз, и блок снова показывается", async () => {
    const { page, scrollTo } = await mount();
    page.onScrollY(900);
    page.reveal(124);
    page.reveal(124); // событие прокрутки ещё не пришло, а страница уже на блоке
    expect(scrollTo).toHaveBeenCalledTimes(1);
    page.onScrollY(900);
    page.reveal(124);
    expect(scrollTo).toHaveBeenCalledTimes(2);
  });

  it("`toTop` идёт к началу и запоминает это: блок у верха после него виден", async () => {
    const { page, scrollTo } = await mount();
    page.onScrollY(900);
    page.toTop();
    expect(scrollTo).toHaveBeenCalledWith({ y: 0, animated: false });
    page.reveal(124);
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });

  it("страницы уже нет (ссылка пуста): команды ничего не роняют", async () => {
    const { page, ref } = await mount();
    (ref as { current: unknown }).current = null;
    page.onScrollY(900);
    expect(() => {
      page.reveal(124);
      page.toTop();
    }).not.toThrow();
  });
});

describe("useRevealBlock: где блок лежит и когда его показывать", () => {
  it("раскладка известна: показ идёт сразу, положение блока это верх раннера плюс верх блока в раннере", async () => {
    const { page, block, scrollTo } = await mount();
    block.onRootLayout(layout(16));
    block.onBlockLayout(layout(108));
    page.onScrollY(900);
    block.show();
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith({ y: 16 + 108 - REVEAL_MARGIN, animated: false });
  });

  it("блок только что появился (раскладки ещё нет): показ ждёт её и идёт один раз, когда она пришла; следующая раскладка страницу не двигает", async () => {
    const { page, block, scrollTo } = await mount();
    block.onRootLayout(layout(16));
    page.onScrollY(900);
    block.show();
    expect(scrollTo).not.toHaveBeenCalled();
    block.onBlockLayout(layout(108));
    expect(scrollTo).toHaveBeenCalledTimes(1);
    page.onScrollY(900);
    block.onBlockLayout(layout(130)); // блок сдвинуло (шапка выше выросла): сам по себе показ не повод
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });

  it("блок пропал: его прежнее положение забыто, новое появление ждёт свежей раскладки и идёт к новому месту", async () => {
    const { page, block, scrollTo } = await mount();
    block.onRootLayout(layout(16));
    block.onBlockLayout(layout(108));
    block.hide();
    page.onScrollY(900);
    block.show(); // блок появился снова
    expect(scrollTo).not.toHaveBeenCalled(); // старое положение не берётся
    block.onBlockLayout(layout(140));
    expect(scrollTo).toHaveBeenCalledWith({ y: 16 + 140 - REVEAL_MARGIN, animated: false });
  });

  it("блок пропал, пока показ ждал раскладку: ожидание снято, запоздавшая раскладка страницу не двигает", async () => {
    const { page, block, scrollTo } = await mount();
    block.onRootLayout(layout(16));
    page.onScrollY(900);
    block.show();
    block.hide();
    block.onBlockLayout(layout(108));
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
