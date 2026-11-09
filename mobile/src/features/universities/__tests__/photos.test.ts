import { geographyPhotoUrls, photoWidthStep, universityPhotoCredit, universityPhotoUrls } from "@/features/universities/photos";

const BASE = "http://localhost:46421/";

describe("адреса фото (бакет portal-university-photos)", () => {
  it("вуз: только копия из манифеста, ключ без копии или неизвестный - заглушка", () => {
    const urls = universityPhotoUrls("sunway", BASE, 700);
    expect(urls?.original).toBe("http://localhost:46421/storage/v1/object/public/portal-university-photos/sunway.jpg");
    expect(urls?.sized).toBe("http://localhost:46421/storage/v1/render/image/public/portal-university-photos/sunway.jpg?width=800&height=2500&resize=contain&quality=70");
    // фото есть в библиотеке, но не перенесено в бакет: hotlink запрещён
    expect(universityPhotoUrls("kozminski-university", BASE)).toBeNull();
    expect(universityPhotoUrls("нет-такого", BASE)).toBeNull();
    expect(universityPhotoUrls(null, BASE)).toBeNull();
  });

  it("страна и город: только путь geography/... с 12 знаками sha256", () => {
    const ok = geographyPhotoUrls({ path: "geography/cities/penang-0123456789ab.jpg" }, "https://x.supabase.example", 1000);
    expect(ok?.original).toBe("https://x.supabase.example/storage/v1/object/public/portal-university-photos/geography/cities/penang-0123456789ab.jpg");
    expect(ok?.sized).toContain("?width=1080&height=2500&resize=contain&quality=70");
    expect(geographyPhotoUrls({ path: "geography/cities/../x.jpg" }, BASE)).toBeNull();
    expect(geographyPhotoUrls({ path: "other/penang-0123456789ab.jpg" }, BASE)).toBeNull();
    expect(geographyPhotoUrls(null, BASE)).toBeNull();
  });

  it("шаг ширины: ближайший не меньше нужного, не больше 2048", () => {
    expect(photoWidthStep(100)).toBe(320);
    expect(photoWidthStep(1081)).toBe(1280);
    expect(photoWidthStep(5000)).toBe(2048);
  });

  it("подпись: автор и лицензия; неизвестный ключ - нет подписи", () => {
    expect(universityPhotoCredit("sunway")).toMatchObject({ kind: "author", license: "CC BY-SA 4.0" });
    expect(universityPhotoCredit("нет")).toBeNull();
  });
});
