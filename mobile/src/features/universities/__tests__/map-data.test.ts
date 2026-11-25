import { FIT_MAX_ZOOM, initialCamera, pinsBounds, pinsToGeoJSON } from "@/features/universities/map-data";

const pin = (id: string, lat: number, lng: number) => ({ id, name: id, place: "Место", lat, lng });

describe("карта: данные", () => {
  it("GeoJSON: долгота первой, номер точки в свойствах (по нему находится вуз)", () => {
    const geo = pinsToGeoJSON([pin("a", 3.1, 101.6), pin("b", 5.4, 100.3)]);
    expect(geo.features.map((f) => f.geometry.coordinates)).toEqual([[101.6, 3.1], [100.3, 5.4]]);
    expect(geo.features.map((f) => f.properties.pin)).toEqual([0, 1]);
  });

  it("рамка: нет точек - нет рамки; одна точка или одно место - центр и масштаб города; разброс - рамка", () => {
    expect(pinsBounds([])).toBeNull();
    expect(initialCamera([])).toMatchObject({ zoom: 1.7 });
    // предельный масштаб самой камеры - 11, как у веба (`fitBounds`, maxZoom 11), а не 10
    expect(initialCamera([pin("a", 41, 29)])).toEqual({ center: [29, 41], zoom: 11 });
    expect(initialCamera([pin("a", 41, 29), pin("b", 41, 29)])).toEqual({ center: [29, 41], zoom: 11 });
    expect(initialCamera([pin("a", 22, 114), pin("b", 40, 120)])).toMatchObject({ bounds: [114, 22, 120, 40] });
  });

  it("два кампуса в одном городе: рамка не уезжает дальше предельного масштаба, центр между ними", () => {
    // 0,04 градуса (около 4 км): рамка по ним дала бы масштаб выше 11
    const camera = initialCamera([pin("a", 3.1, 101.6), pin("b", 3.14, 101.64)]);
    expect(camera.zoom).toBe(FIT_MAX_ZOOM);
    expect((camera as { center: [number, number] }).center[0]).toBeCloseTo(101.62, 6);
    expect((camera as { center: [number, number] }).center[1]).toBeCloseTo(3.12, 6);
    expect(FIT_MAX_ZOOM).toBe(11);
    // чуть шире порога - снова рамка
    expect(initialCamera([pin("a", 3.1, 101.6), pin("b", 3.3, 101.8)])).toMatchObject({ bounds: [101.6, 3.1, 101.8, 3.3] });
  });
});
