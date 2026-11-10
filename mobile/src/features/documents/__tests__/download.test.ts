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
  it("список допустимых типов (QR, чек студента): тип берётся из ответа и задаёт расширение", async () => {
    const d = deps({ response: { headers: new Headers({ "content-type": "image/jpeg" }) } });
    const result = await downloadFile(d.value, { kind: "case-file", fileKind: "payment_details_qr", fileId: FILE }, "payment-qr", ["image/png", "image/jpeg"]);
    expect(result).toMatchObject({ ok: true, name: "payment-qr.jpg" });
    expect(d.calls[0]?.url).toBe(`${BASE}/api/portal/case-files/payment_details_qr/${FILE}/download`);
    const wrong = deps({ response: { headers: new Headers({ "content-type": "text/html" }) } });
    await expect(downloadFile(wrong.value, { kind: "case-file", fileKind: "student_receipt", fileId: FILE }, "r", ["image/png", "image/jpeg"])).resolves.toEqual({ ok: false, error: "docs.downloadFailed" });
  });
  it("без токена не ходит в сеть", async () => {
    const d = deps({ getToken: async () => null });
    await expect(downloadFile(d.value, { kind: "version", versionId: VERSION }, "a.pdf", "application/pdf")).resolves.toEqual({ ok: false, error: "docs.errorSession" });
    expect(d.calls).toHaveLength(0);
  });
  it.each([
    [401, "docs.errorSession"],
    [403, "docs.downloadForbidden"],
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

describe("два шага: Bearer не попадает на подписанный адрес хранилища", () => {
  const SIGNED = "https://storage.example.test/object/sign/docs/a.pdf?token=synthetic-signed";
  type Hop = { url: string; headers: Record<string, string>; redirect: string };
  function hops(script: (url: string, call: number) => Partial<Awaited<ReturnType<DownloadDeps["fetchImpl"]>>> & { status: number }, over: Partial<DownloadDeps> = {}) {
    const seen: Hop[] = [];
    const written: string[] = [];
    const value: DownloadDeps = {
      baseUrl: BASE,
      getToken: async () => "synthetic-token",
      fetchImpl: async (url, init) => {
        seen.push({ url, headers: init.headers, redirect: init.redirect });
        const r = script(url, seen.length);
        return { ok: r.status >= 200 && r.status < 300, headers: new Headers({ "content-type": "application/pdf" }), arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer, ...r };
      },
      writeFile: async (name) => {
        written.push(name);
        return `file:///cache/${name}`;
      },
      ...over,
    };
    return { value, seen, written };
  }
  const redirectTo = (location: string | null) => ({ status: 307, headers: new Headers(location ? { location } : {}) });
  const target = { kind: "version", versionId: VERSION } as const;

  it("портал: Bearer и redirect manual; хранилище: без Authorization", async () => {
    const h = hops((url) => (url.startsWith(BASE) ? redirectTo(SIGNED) : { status: 200 }));
    await expect(downloadFile(h.value, target, "a.pdf", "application/pdf")).resolves.toMatchObject({ ok: true });
    expect(h.seen).toHaveLength(2);
    expect(h.seen[0]).toMatchObject({ url: `${BASE}/api/portal/document-versions/${VERSION}/download`, redirect: "manual" });
    expect(h.seen[0]!.headers.Authorization).toBe("Bearer synthetic-token");
    expect(h.seen[1]!.url).toBe(SIGNED);
    expect(Object.keys(h.seen[1]!.headers).map((k) => k.toLowerCase())).not.toContain("authorization");
    // нигде, кроме портала, токена нет
    expect(JSON.stringify(h.seen.slice(1))).not.toContain("synthetic-token");
  });

  it("Location на сам портал (в том числе другой путь) не принимается, хранилище не вызывается", async () => {
    const h = hops(() => redirectTo(`${BASE}/somewhere`));
    await expect(downloadFile(h.value, target, "a.pdf", "application/pdf")).resolves.toEqual({ ok: false, error: "docs.downloadFailed" });
    expect(h.seen).toHaveLength(1);
  });

  it.each([[null], ["/relative/path"], ["ftp://storage.example.test/x"]])("Location %s не годится", async (location) => {
    const h = hops(() => redirectTo(location));
    await expect(downloadFile(h.value, target, "a.pdf", "application/pdf")).resolves.toEqual({ ok: false, error: "docs.downloadFailed" });
    expect(h.seen).toHaveLength(1);
  });

  it("второй шаг сам перенаправляет: это ошибка, дальше не идём", async () => {
    const h = hops((url) => (url.startsWith(BASE) ? redirectTo(SIGNED) : redirectTo("https://evil.example.test/x")));
    await expect(downloadFile(h.value, target, "a.pdf", "application/pdf")).resolves.toEqual({ ok: false, error: "docs.downloadFailed" });
    expect(h.seen).toHaveLength(2);
  });

  it("хранилище отказывает: «файл недоступен», запись не пишется", async () => {
    const h = hops((url) => (url.startsWith(BASE) ? redirectTo(SIGNED) : { status: 403 }));
    await expect(downloadFile(h.value, target, "a.pdf", "application/pdf")).resolves.toEqual({ ok: false, error: "docs.downloadUnavailable" });
    expect(h.written).toHaveLength(0);
  });

  it("401: сессия обновляется один раз, повтор с новым токеном", async () => {
    let first = true;
    const refreshToken = jest.fn(async () => "renewed-token");
    const h = hops((url) => {
      if (!url.startsWith(BASE)) return { status: 200 };
      if (first) {
        first = false;
        return { status: 401 };
      }
      return redirectTo(SIGNED);
    }, { refreshToken });
    await expect(downloadFile(h.value, target, "a.pdf", "application/pdf")).resolves.toMatchObject({ ok: true });
    expect(refreshToken).toHaveBeenCalledTimes(1);
    expect(h.seen[0]!.headers.Authorization).toBe("Bearer synthetic-token");
    expect(h.seen[1]!.headers.Authorization).toBe("Bearer renewed-token");
    expect(Object.keys(h.seen[2]!.headers).map((k) => k.toLowerCase())).not.toContain("authorization");
  });

  it("401 дважды: ошибка сессии, без третьей попытки; обновить не вышло: ошибка сессии", async () => {
    const refreshToken = jest.fn(async () => "renewed-token");
    const twice = hops(() => ({ status: 401 }), { refreshToken });
    await expect(downloadFile(twice.value, target, "a.pdf", "application/pdf")).resolves.toEqual({ ok: false, error: "docs.errorSession" });
    expect(twice.seen).toHaveLength(2);
    const none = hops(() => ({ status: 401 }), { refreshToken: async () => null });
    await expect(downloadFile(none.value, target, "a.pdf", "application/pdf")).resolves.toEqual({ ok: false, error: "docs.errorSession" });
    expect(none.seen).toHaveLength(1);
  });
});
