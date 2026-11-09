import { initialCamera, pinsBounds, pinsToGeoJSON } from "@/features/universities/map-data";

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
    expect(initialCamera([pin("a", 41, 29)])).toEqual({ center: [29, 41], zoom: 10 });
    expect(initialCamera([pin("a", 41, 29), pin("b", 41, 29)])).toEqual({ center: [29, 41], zoom: 10 });
    expect(initialCamera([pin("a", 22, 114), pin("b", 40, 120)])).toMatchObject({ bounds: [114, 22, 120, 40] });
  });
});
