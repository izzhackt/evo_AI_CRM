// NearList (G47): сборка порциями, картинки только у близких карточек, измерение не отвечает - открыть всё.
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { Dimensions, Text } from "react-native";

import { NearList, NEAR_FAIL_OPEN_MS, NEAR_POLL_MS, type MeasureTop, type NearItem } from "@/features/universities/NearList";
import { STAGE_DELAY_MS, STAGE_FIRST } from "@/features/universities/staged";

function items(n: number, rendered?: (key: string, near: boolean) => void): NearItem[] {
  return Array.from({ length: n }, (_, i) => ({
    key: `k${i}`,
    render: (near: boolean) => {
      rendered?.(`k${i}`, near);
      return <Text testID={`item-${i}`}>{near ? `near-${i}` : `far-${i}`}</Text>;
    },
  }));
}

/** Место карточки i: высота 200, зазор 12 (как у `gap` списка). Событие `layout` не всплывает: его шлют самой обёртке карточки. */
async function layoutAll(count: number) {
  for (let i = 0; i < count; i += 1) {
    const wrapper = screen.queryByTestId(`list:k${i}`);
    if (wrapper) await fireEvent(wrapper, "layout", { nativeEvent: { layout: { x: 0, y: i * 212, width: 360, height: 200 } } });
  }
}

/** Каждая порция сборки ставится после отрисовки предыдущей, поэтому такты идут по одному на `act`. */
async function stage(steps: number) {
  for (let i = 0; i < steps; i += 1) {
    await act(async () => {
      jest.advanceTimersByTime(STAGE_DELAY_MS + 1);
    });
  }
}

const PHONE = { window: { width: 390, height: 844, scale: 3, fontScale: 1 }, screen: { width: 390, height: 844, scale: 3, fontScale: 1 } };
const DEFAULT = { window: { width: 750, height: 1334, scale: 2, fontScale: 2 }, screen: { width: 750, height: 1334, scale: 2, fontScale: 2 } };

beforeEach(() => {
  jest.useFakeTimers();
  Dimensions.set(PHONE); // окно 844: близкими считаются карточки до 844 + 844 от верха списка
});
afterEach(() => {
  jest.useRealTimers();
  Dimensions.set(DEFAULT);
});

describe("NearList: сборка порциями", () => {
  it("первая порция сразу, остальные по одной порции за такт; короткий список собирается целиком", async () => {
    const measureTop: MeasureTop = (_node, done) => done(0);
    await render(<NearList items={items(60)} measureTop={measureTop} />);
    expect(screen.queryAllByTestId(/^item-/)).toHaveLength(STAGE_FIRST);
    await stage(1);
    expect(screen.queryAllByTestId(/^item-/)).toHaveLength(STAGE_FIRST * 2);
    await stage(3);
    expect(screen.queryAllByTestId(/^item-/)).toHaveLength(60);

    await render(<NearList items={items(5)} measureTop={measureTop} />);
    expect(screen.queryAllByTestId(/^item-/).length).toBeGreaterThanOrEqual(5);
  });

  it("другой список (поиск) собирается заново с первой порции", async () => {
    const measureTop: MeasureTop = (_node, done) => done(0);
    const { rerender } = await render(<NearList items={items(60)} measureTop={measureTop} />);
    await stage(4);
    expect(screen.queryAllByTestId(/^item-/)).toHaveLength(60);
    const other = items(60).map((item) => ({ ...item, key: `other-${item.key}` }));
    await rerender(<NearList items={other} measureTop={measureTop} />);
    expect(screen.queryAllByTestId(/^item-/)).toHaveLength(STAGE_FIRST);
  });
});

describe("NearList: картинки у близких", () => {
  it("до первого измерения близки только первые карточки; после него - те, что у экрана", async () => {
    // список лежит у верха окна; окно экрана 844 (тестовые метрики), значит близки карточки с верхом до 844 + 844
    const measureTop: MeasureTop = (_node, done) => done(0);
    await render(<NearList items={items(40)} measureTop={measureTop} eager={3} firstBatch={40} testID="list" />);
    await layoutAll(40);
    await act(async () => {
      jest.advanceTimersByTime(NEAR_POLL_MS + 1);
    });
    expect(screen.getByTestId("item-0").props.children).toBe("near-0");
    expect(screen.getByTestId("item-7").props.children).toBe("near-7"); // верх 1484 < 1688
    expect(screen.getByTestId("item-10").props.children).toBe("far-10"); // верх 2120
    expect(screen.getByTestId("item-23").props.children).toBe("far-23");
  });

  it("прокрутка вниз: измерение отдаёт отрицательный верх, близкими становятся дальние карточки", async () => {
    let top = 0;
    const measureTop: MeasureTop = (_node, done) => done(top);
    await render(<NearList items={items(40)} measureTop={measureTop} eager={3} firstBatch={40} testID="list" />);
    await layoutAll(40);
    await act(async () => {
      jest.advanceTimersByTime(NEAR_POLL_MS + 1);
    });
    expect(screen.getByTestId("item-20").props.children).toBe("far-20");
    top = -4000; // экран ушёл к карточкам 17-22 (верх 3604-4664)
    await act(async () => {
      jest.advanceTimersByTime(NEAR_POLL_MS + 1);
    });
    expect(screen.getByTestId("item-20").props.children).toBe("near-20");
    expect(screen.getByTestId("item-0").props.children).toBe("near-0"); // первые остаются всегда
    expect(screen.getByTestId("item-8").props.children).toBe("far-8");
  });

  it("измерение молчит дольше срока: открыты все картинки, а не серые подложки навсегда", async () => {
    const silent: MeasureTop = () => undefined;
    await render(<NearList items={items(30)} measureTop={silent} eager={3} firstBatch={30} testID="list" />);
    await layoutAll(30);
    expect(screen.getByTestId("item-20").props.children).toBe("far-20");
    await act(async () => {
      jest.advanceTimersByTime(NEAR_FAIL_OPEN_MS + NEAR_POLL_MS);
    });
    expect(screen.getByTestId("item-20").props.children).toBe("near-20");
  });

  it("короткий список не опрашивает измерение и показывает всё сразу", async () => {
    const measure = jest.fn<void, Parameters<MeasureTop>>();
    await render(<NearList items={items(4)} measureTop={measure} eager={6} />);
    await act(async () => {
      jest.advanceTimersByTime(NEAR_POLL_MS * 4);
    });
    expect(measure).not.toHaveBeenCalled();
    expect(screen.getByTestId("item-3").props.children).toBe("near-3");
  });

  it("отступ перед пунктом берётся из `spaceBefore`, иначе из `gap`", async () => {
    const measureTop: MeasureTop = (_node, done) => done(0);
    const list = items(3);
    list[2] = { ...list[2], spaceBefore: 40 };
    await render(<NearList items={list} gap={16} measureTop={measureTop} testID="list" />);
    const style = (key: string) => screen.getByTestId(`list:${key}`).props.style;
    expect(style("k0")).toBeUndefined();
    expect(style("k1")).toEqual({ marginTop: 16 });
    expect(style("k2")).toEqual({ marginTop: 40 });
  });
});
