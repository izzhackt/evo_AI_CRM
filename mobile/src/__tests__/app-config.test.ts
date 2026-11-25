import config from "../../app.config";

describe("app.config: нативные тексты и разрешения", () => {
  it("Face ID отключён: в Info.plist не появляется англоязычный NSFaceIDUsageDescription", () => {
    const entry = (config.plugins ?? []).find((p) => Array.isArray(p) && p[0] === "expo-secure-store");
    expect(entry).toEqual(["expo-secure-store", { faceIDPermission: false }]);
  });

  it("тексты запросов камеры и фото на русском, микрофон не запрашивается", () => {
    const entry = (config.plugins ?? []).find((p) => Array.isArray(p) && p[0] === "expo-image-picker") as [string, Record<string, unknown>];
    expect(String(entry[1].cameraPermission)).toMatch(/камер/);
    expect(String(entry[1].photosPermission)).toMatch(/фото/);
    expect(entry[1].microphonePermission).toBe(false);
  });

  it("строка про местоположение есть (ITMS-90683 от MapLibre) и честно говорит, что оно не используется", () => {
    const plist = config.ios?.infoPlist as Record<string, unknown>;
    expect(String(plist.NSLocationWhenInUseUsageDescription)).toMatch(/не определяет и не использует/);
    expect(plist.NSLocationAlwaysAndWhenInUseUsageDescription).toBeUndefined();
    expect(config.android?.blockedPermissions).toContain("android.permission.ACCESS_FINE_LOCATION");
  });
});
