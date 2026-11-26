// Чтения «Всё избранное»: число вузов вне каталога (миграция 282) в строгой форме веба.
import { PortalDecodeError } from "@/domain/portal-source";
import { readHiddenFavorites } from "@/features/home/favorites-queries";
import { RpcError } from "@/lib/rpc";
import { failure, fakeTransport } from "@/test-fixtures/universities";

describe("число избранных вузов вне каталога", () => {
  it("читает student_hidden_university_favorites_v1 без аргументов и отдаёт число", async () => {
    const { transport, calls } = fakeTransport({ student_hidden_university_favorites_v1: { hiddenCount: 3 } });
    await expect(readHiddenFavorites(transport)).resolves.toBe(3);
    expect(calls.map((call) => [call.name, call.args])).toEqual([["student_hidden_university_favorites_v1", undefined]]);
  });

  it("ноль - тоже ответ", async () => {
    const { transport } = fakeTransport({ student_hidden_university_favorites_v1: { hiddenCount: 0 } });
    await expect(readHiddenFavorites(transport)).resolves.toBe(0);
  });

  it.each([null, [], "3", { hiddenCount: -1 }, { hiddenCount: 1.5 }, { hiddenCount: "2" }, { hiddenCount: 1, extra: true }, {}])("чужая форма %j - ошибка данных, а не выдуманное число", async (body) => {
    const { transport } = fakeTransport({ student_hidden_university_favorites_v1: body });
    await expect(readHiddenFavorites(transport)).rejects.toBeInstanceOf(PortalDecodeError);
  });

  it("отказ сервера - RpcError без текста сервера", async () => {
    const { transport } = fakeTransport({ student_hidden_university_favorites_v1: failure("42501", 403) });
    const error = await readHiddenFavorites(transport).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RpcError);
    expect((error as RpcError).message).toBe("rpc:forbidden");
  });
});
