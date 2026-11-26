import { FIT_MAX_ZOOM, fitZoom, initialCamera, MAX_ZOOM, MIN_ZOOM, pinsBounds, pinsToGeoJSON } from "@/features/universities/map-data";

const pin = (id: string, lat: number, lng: number) => ({ id, name: id, place: "Место", lat, lng });
// Окно карты: ширина экрана минус поля по 16 pt, высота 420 pt.
const PHONE = { width: 358, height: 420 }; // 390 pt
const TABLET = { width: 712, height: 420 }; // 744 pt

describe("карта: данные", () => {
  it("GeoJSON: долгота первой, номер точки в свойствах (по нему находится вуз)", () => {
    const geo = pinsToGeoJSON([pin("a", 3.1, 101.6), pin("b", 5.4, 100.3)]);
    expect(geo.features.map((f) => f.geometry.coordinates)).toEqual([[101.6, 3.1], [100.3, 5.4]]);
    expect(geo.features.map((f) => f.properties.pin)).toEqual([0, 1]);
  });

  it("рамка: нет точек - нет рамки; одна точка или одно место - центр и масштаб города; разброс - рамка", () => {
    expect(pinsBounds([])).toBeNull();
    expect(initialCamera([], PHONE)).toMatchObject({ zoom: 1.7 });
    // предельный масштаб самой камеры - 11, как у веба (`fitBounds`, maxZoom 11), а не 10
    expect(initialCamera([pin("a", 41, 29)], PHONE)).toEqual({ center: [29, 41], zoom: 11 });
    expect(initialCamera([pin("a", 41, 29), pin("b", 41, 29)], TABLET)).toEqual({ center: [29, 41], zoom: 11 });
    expect(initialCamera([pin("a", 22, 114), pin("b", 40, 120)], PHONE)).toMatchObject({ bounds: [114, 22, 120, 40] });
  });

  it("два кампуса в одном городе: рамка не уезжает дальше предельного масштаба, центр между ними", () => {
    // 0,04 градуса (около 4 км): рамка по ним дала бы масштаб выше 11 и на телефоне, и на планшете
    for (const viewport of [PHONE, TABLET]) {
      const camera = initialCamera([pin("a", 3.1, 101.6), pin("b", 3.14, 101.64)], viewport);
      expect(camera.zoom).toBe(FIT_MAX_ZOOM);
      expect((camera as { center: [number, number] }).center[0]).toBeCloseTo(101.62, 6);
      expect((camera as { center: [number, number] }).center[1]).toBeCloseTo(3.12, 6);
    }
    expect(FIT_MAX_ZOOM).toBe(11);
    // 0,2 градуса - рамка при любом окне
    for (const viewport of [PHONE, TABLET]) {
      expect(initialCamera([pin("a", 3.1, 101.6), pin("b", 3.3, 101.8)], viewport)).toMatchObject({ bounds: [101.6, 3.1, 101.8, 3.3] });
    }
  });

  it("порог зависит от окна карты: рамка в 0,1 градуса на телефоне ещё влезает, на планшете встала бы глубже 11", () => {
    const near = [pin("a", 3.1, 101.6), pin("b", 3.2, 101.7)];
    const bounds = pinsBounds(near)!;
    // мир на нулевом масштабе - 512 pt: 262 pt (358 минус поля 2 x 48) на 0,1 градуса дают около 10,85
    expect(fitZoom(bounds, PHONE)).toBeCloseTo(10.85, 2);
    expect(initialCamera(near, PHONE)).toMatchObject({ bounds: [101.6, 3.1, 101.7, 3.2], padding: { top: 48, right: 48, bottom: 48, left: 48 } });
    // планшет: ту же рамку ограничивает высота окна (420 pt), около 11,15 - выше предела, камера берёт центр на масштабе 11
    expect(fitZoom(bounds, TABLET)).toBeCloseTo(11.15, 2);
    const camera = initialCamera(near, TABLET) as { center: [number, number]; zoom: number };
    expect(camera.zoom).toBe(FIT_MAX_ZOOM);
    expect(camera.center[0]).toBeCloseTo(101.65, 6);
    expect(camera.center[1]).toBeCloseTo(3.15, 6);
  });

  it("масштаб рамки считает меньшая из двух сторон: узкая и высокая рамка ограничена высотой окна", () => {
    // 0,001 градуса по долготе и 0,2 по широте: по ширине вышло бы около 17, по высоте около 10,15 - это и есть рамка
    const tall = [pin("a", 3.1, 101.6), pin("b", 3.3, 101.601)];
    expect(fitZoom(pinsBounds(tall)!, PHONE)).toBeCloseTo(10.15, 2);
    expect(initialCamera(tall, PHONE)).toHaveProperty("bounds");
    // та же рамка, положенная набок: ограничивает ширина окна
    const wide = [pin("a", 3.1, 101.6), pin("b", 3.101, 101.8)];
    expect(fitZoom(pinsBounds(wide)!, PHONE)).toBeCloseTo(9.85, 2);
  });

  it("рамка без размера - бесконечный масштаб; пределы кнопок масштаба: от целого мира до 22", () => {
    expect(fitZoom([29, 41, 29, 41], PHONE)).toBe(Infinity);
    expect([MIN_ZOOM, MAX_ZOOM]).toEqual([0, 22]);
  });
});
