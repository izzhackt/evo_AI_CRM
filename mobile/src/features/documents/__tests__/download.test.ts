import { downloadFile, downloadPath, type DownloadDeps } from "@/features/documents/download";

const BASE = "https://portal.example.test";
const VERSION = "55555555-5555-4555-8555-555555555555";
const FILE = "77777777-7777-4777-8777-777777777777";

function deps(over: Partial<DownloadDeps> & { response?: Partial<Awaited<ReturnType<DownloadDeps["fetchImpl"]>>> | Error } = {}) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const written: { name: string; size: number }[] = [];
  const value: DownloadDeps = {
    baseUrl: BASE,
    getToken: async () => "synthetic-token",
    fetchImpl: async (url, init) => {
      calls.push({ url, headers: init.headers });
      if (over.response instanceof Error) throw over.response;
      return {
        status: 200,
        ok: true,
        headers: new Headers({ "content-type": "application/pdf" }),
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
        ...over.response,
      };
    },
    writeFile: async (name, bytes) => {
      written.push({ name, size: bytes.byteLength });
      return `file:///cache/${name}`;
    },
    ...over,
  };
  return { value, calls, written };
}

describe("маршруты скачивания", () => {
  it("версия документа и файл дела", () => {
    expect(downloadPath({ kind: "version", versionId: VERSION })).toBe(`/api/portal/document-versions/${VERSION}/download`);
    expect(downloadPath({ kind: "case-file", fileKind: "pending_receipt", fileId: FILE })).toBe(`/api/portal/case-files/pending_receipt/${FILE}/download`);
  });
});

describe("скачивание", () => {
  it("шлёт Bearer, пишет файл и возвращает путь", async () => {
    const d = deps();
    const result = await downloadFile(d.value, { kind: "version", versionId: VERSION }, "паспорт.pdf", "application/pdf");
    expect(result).toEqual({ ok: true, uri: "file:///cache/паспорт.pdf", name: "паспорт.pdf" });
    expect(d.calls[0]).toEqual({ url: `${BASE}/api/portal/document-versions/${VERSION}/download`, headers: { Authorization: "Bearer synthetic-token", Accept: "*/*" } });
    expect(d.written).toEqual([{ name: "паспорт.pdf", size: 3 }]);
  });
  it("добавляет расширение по типу и чистит имя", async () => {
    const d = deps();
    const result = await downloadFile(d.value, { kind: "case-file", fileKind: "contract", fileId: FILE }, "../../etc/договор", "application/pdf");
    expect(result).toMatchObject({ ok: true, name: "_.._etc_договор.pdf" });
  });
  it("без токена не ходит в сеть", async () => {
    const d = deps({ getToken: async () => null });
    await expect(downloadFile(d.value, { kind: "version", versionId: VERSION }, "a.pdf", "application/pdf")).resolves.toEqual({ ok: false, error: "docs.errorSession" });
    expect(d.calls).toHaveLength(0);
  });
  it.each([
    [401, "docs.errorSession"],
    [403, "errorForbidden"],
    [404, "docs.downloadUnavailable"],
    [503, "docs.downloadUnavailable"],
  ])("статус %i -> %s, файл не пишется", async (status, error) => {
    const d = deps({ response: { status, ok: false } });
    await expect(downloadFile(d.value, { kind: "version", versionId: VERSION }, "a.pdf", "application/pdf")).resolves.toEqual({ ok: false, error });
    expect(d.written).toHaveLength(0);
  });
  it("обрыв сети", async () => {
    const d = deps({ response: new TypeError("Network request failed") });
    await expect(downloadFile(d.value, { kind: "version", versionId: VERSION }, "a.pdf", "application/pdf")).resolves.toEqual({ ok: false, error: "errorNetwork" });
  });
  it("страница ошибки вместо файла (JSON/HTML) не сохраняется", async () => {
    const d = deps({ response: { headers: new Headers({ "content-type": "application/json" }) } });
    await expect(downloadFile(d.value, { kind: "version", versionId: VERSION }, "a.pdf", "application/pdf")).resolves.toEqual({ ok: false, error: "docs.downloadFailed" });
    expect(d.written).toHaveLength(0);
  });
  it("octet-stream от хранилища принимается; пустое тело нет", async () => {
    const ok = deps({ response: { headers: new Headers({ "content-type": "application/octet-stream" }) } });
    await expect(downloadFile(ok.value, { kind: "version", versionId: VERSION }, "a.pdf", "application/pdf")).resolves.toMatchObject({ ok: true });
    const empty = deps({ response: { arrayBuffer: async () => new ArrayBuffer(0) } });
    await expect(downloadFile(empty.value, { kind: "version", versionId: VERSION }, "a.pdf", "application/pdf")).resolves.toEqual({ ok: false, error: "docs.downloadFailed" });
  });
  it("сбой записи в кэш", async () => {
    const d = deps({ writeFile: async () => { throw new Error("disk"); } });
    await expect(downloadFile(d.value, { kind: "version", versionId: VERSION }, "a.pdf", "application/pdf")).resolves.toEqual({ ok: false, error: "docs.downloadFailed" });
  });
});
