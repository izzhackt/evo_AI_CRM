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
});
