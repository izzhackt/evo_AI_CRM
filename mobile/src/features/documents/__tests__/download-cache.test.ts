import { clearDownloadCache } from "@/features/documents/download-cache";

describe("очистка кэша документов", () => {
  it("удаляет существующие каталоги, пропускает отсутствующие", async () => {
    const a = { exists: true, delete: jest.fn() };
    const b = { exists: false, delete: jest.fn() };
    await clearDownloadCache([a, b]);
    expect(a.delete).toHaveBeenCalledTimes(1);
    expect(b.delete).not.toHaveBeenCalled();
  });

  it("сбой одного каталога не мешает остальным и не бросает", async () => {
    const a = { exists: true, delete: jest.fn(() => { throw new Error("busy"); }) };
    const b = { exists: true, delete: jest.fn() };
    await expect(clearDownloadCache([a, b])).resolves.toBeUndefined();
    expect(b.delete).toHaveBeenCalledTimes(1);
  });
});
