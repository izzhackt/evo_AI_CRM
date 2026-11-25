// Окно прокрутки списков (G47): какие карточки считаются близкими к экрану.
import { nearKeys, NEAR_EAGER, sameKeys, type NearRect } from "@/features/universities/near-window";

const H = 800;
/** Список из `n` карточек высотой 200 с зазором 12. */
function column(n: number) {
  const keys = Array.from({ length: n }, (_, i) => `k${i}`);
  const rects = new Map<string, NearRect>(keys.map((key, i) => [key, { y: i * 212, h: 200 }]));
  return { keys, rects };
}

describe("nearKeys", () => {
  it("первые карточки всегда близки, даже если их место не измерено", () => {
    const { keys } = column(30);
    const near = nearKeys({ keys, rects: new Map(), boxTop: 0, windowHeight: H, previous: new Set() });
    expect([...near]).toEqual(keys.slice(0, NEAR_EAGER));
  });

  it("близки карточки в пределах экрана и одного экрана выше и ниже; дальше нет", () => {
    const { keys, rects } = column(60);
    const near = nearKeys({ keys, rects, boxTop: 100, windowHeight: H, previous: new Set(), eager: 0 });
    // окно: от -800 до 1600 в координатах окна; верх карточки i: 100 + 212 i
    const has = (i: number) => near.has(`k${i}`);
    expect(has(0)).toBe(true);
    expect(has(7)).toBe(true); // верх 1584: ещё внутри 1600
    expect(has(8)).toBe(false); // верх 1796
    expect(near.size).toBe(8);
  });

  it("список прокручен вверх (boxTop отрицательный): близки карточки вокруг экрана, а не первые", () => {
    const { keys, rects } = column(60);
    const near = nearKeys({ keys, rects, boxTop: -5000, windowHeight: H, previous: new Set(), eager: 0 });
    const idx = [...near].map((key) => Number(key.slice(1)));
    expect(Math.min(...idx)).toBeGreaterThan(15);
    expect(Math.max(...idx)).toBeLessThan(35);
    expect(near.has("k0")).toBe(false);
  });

  it("гистерезис: близкая остаётся, пока не ушла за два экрана, и не возвращается, если не была близкой", () => {
    const { keys, rects } = column(60);
    // k8 верх 1796 при boxTop 100: вне окна в один экран, но внутри окна в два (до 2400)
    const without = nearKeys({ keys, rects, boxTop: 100, windowHeight: H, previous: new Set(), eager: 0 });
    const kept = nearKeys({ keys, rects, boxTop: 100, windowHeight: H, previous: new Set(["k8"]), eager: 0 });
    expect(without.has("k8")).toBe(false);
    expect(kept.has("k8")).toBe(true);
    // k20 верх 4340: далеко и там, и там
    expect(nearKeys({ keys, rects, boxTop: 100, windowHeight: H, previous: new Set(["k20"]), eager: 0 }).has("k20")).toBe(false);
  });

  it("неизмеренная карточка за пределами первых не близка", () => {
    const { keys, rects } = column(30);
    rects.delete("k10");
    expect(nearKeys({ keys, rects, boxTop: 0, windowHeight: H, previous: new Set(), eager: 0 }).has("k10")).toBe(false);
  });

  it("sameKeys сравнивает содержимое, не порядок", () => {
    expect(sameKeys(new Set(["a", "b"]), new Set(["b", "a"]))).toBe(true);
    expect(sameKeys(new Set(["a"]), new Set(["a", "b"]))).toBe(false);
    expect(sameKeys(new Set(["a", "c"]), new Set(["a", "b"]))).toBe(false);
  });
});
