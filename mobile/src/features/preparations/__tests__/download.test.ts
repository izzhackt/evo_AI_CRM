// Скачивание файла документа программы: свой адрес первого шага, всё остальное - обычное скачивание документов.
import type { DownloadDeps } from "@/features/documents/download";
import { APPLICATION_DOWNLOAD_PATH, applicationDownloadUrl, downloadApplicationFile } from "@/features/preparations/download";
import { APPLICATION_ID, REVISION_ID, STUDENT_CASE_ID, itemId, slotId, versionId } from "@/test-fixtures/preparations";

const BASE = "https://portal.example.test";
const STORAGE = "https://storage.example.test/object/sign/private/abc?token=SIGNED&download=scan.pdf";
const target = { studentCaseId: STUDENT_CASE_ID, applicationId: APPLICATION_ID, requirementsRevisionId: REVISION_ID, requirementItemId: itemId(0), documentSlotId: slotId(0) };
const VERSION = versionId(1);

type Response = Awaited<ReturnType<DownloadDeps["fetchImpl"]>>;
const pdf = (over: Partial<Response> = {}): Response => ({ status: 200, ok: true, headers: new Headers({ "content-type": "application/pdf" }), arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer, ...over });
const redirect = (location: string | null): Response => ({ status: 302, ok: false, headers: new Headers(location ? { location } : {}), arrayBuffer: async () => new ArrayBuffer(0) });

function setup(responses: (Response | Error)[], over: Partial<DownloadDeps> = {}) {
  const calls: { url: string; headers: Record<string, string>; redirect: string }[] = [];
  const written: { name: string; size: number }[] = [];
  const deps: DownloadDeps = {
    baseUrl: BASE,
    getToken: async () => "synthetic-token",
    fetchImpl: async (url, init) => {
      calls.push({ url, headers: init.headers, redirect: init.redirect });
      const next = responses.shift();
      if (next === undefined) throw new Error("no more");
      if (next instanceof Error) throw next;
      return next;
    },
    writeFile: async (name, bytes) => {
      written.push({ name, size: bytes.byteLength });
      return `file:///cache/${name}`;
    },
    ...over,
  };
  return { deps, calls, written };
}

describe("адрес маршрута", () => {
  it("ровно шесть параметров: цель требования и версия файла", () => {
    const url = applicationDownloadUrl(BASE, target, VERSION);
    expect(url).toBe(
      `${BASE}${APPLICATION_DOWNLOAD_PATH}?studentCaseId=${STUDENT_CASE_ID}&applicationId=${APPLICATION_ID}&requirementsRevisionId=${REVISION_ID}&requirementItemId=${itemId(0)}&documentSlotId=${slotId(0)}&documentVersionId=${VERSION}`,
    );
    expect(new Set(url.split("?")[1]!.split("&").map((pair) => pair.split("=")[0])).size).toBe(6);
    expect(APPLICATION_DOWNLOAD_PATH).toBe("/api/portal/application-document-downloads");
  });
});

describe("скачивание файла программы", () => {
  it("первый шаг на маршрут программы с Bearer и без автоматического перехода, второй в хранилище без заголовков доступа", async () => {
    const t = setup([redirect(STORAGE), pdf()]);
    const result = await downloadApplicationFile(t.deps, target, VERSION, "Скан.pdf", "application/pdf");
    expect(result).toEqual({ ok: true, uri: "file:///cache/Скан.pdf", name: "Скан.pdf" });
    expect(t.calls[0]).toEqual({ url: applicationDownloadUrl(BASE, target, VERSION), headers: { Authorization: "Bearer synthetic-token", Accept: "*/*" }, redirect: "manual" });
    expect(t.calls[1]).toEqual({ url: STORAGE, headers: { Accept: "*/*" }, redirect: "manual" });
    expect(t.written).toEqual([{ name: "Скан.pdf", size: 3 }]);
  });

  it("Bearer не уходит ни на какой адрес, кроме маршрута программы", async () => {
    const t = setup([redirect(STORAGE), pdf()]);
    await downloadApplicationFile(t.deps, target, VERSION, "a.pdf", "application/pdf");
    expect(t.calls.filter((c) => c.headers.Authorization)).toHaveLength(1);
    expect(t.calls.filter((c) => c.headers.Authorization).map((c) => c.url)).toEqual([applicationDownloadUrl(BASE, target, VERSION)]);
    // перенаправление на тот же портал (не хранилище) не принимается: файл не берётся
    const same = setup([redirect(`${BASE}/somewhere`)]);
    expect(await downloadApplicationFile(same.deps, target, VERSION, "a.pdf", "application/pdf")).toEqual({ ok: false, error: "docs.downloadFailed" });
    expect(same.calls).toHaveLength(1);
  });

  it("на 401 сессия обновляется один раз и тот же запрос идёт с новым токеном", async () => {
    const t = setup([{ status: 401, ok: false, headers: new Headers(), arrayBuffer: async () => new ArrayBuffer(0) }, redirect(STORAGE), pdf()], { refreshToken: async () => "renewed" });
    const result = await downloadApplicationFile(t.deps, target, VERSION, "a.pdf", "application/pdf");
    expect(result.ok).toBe(true);
    expect(t.calls[0]?.url).toBe(applicationDownloadUrl(BASE, target, VERSION));
    expect(t.calls[1]).toMatchObject({ url: applicationDownloadUrl(BASE, target, VERSION), headers: { Authorization: "Bearer renewed" } });
  });

  it("ошибки: нет сессии, нет доступа, сервер недоступен, чужой тип, пустой файл, нет связи", async () => {
    const res = (status: number): Response => ({ status, ok: status >= 200 && status < 300, headers: new Headers(), arrayBuffer: async () => new ArrayBuffer(0) });
    expect(await downloadApplicationFile(setup([]).deps, target, VERSION, "a.pdf", "application/pdf")).toEqual({ ok: false, error: "errorNetwork" });
    expect(await downloadApplicationFile(setup([res(401)]).deps, target, VERSION, "a.pdf", "application/pdf")).toEqual({ ok: false, error: "docs.errorSession" });
    expect(await downloadApplicationFile(setup([res(403)]).deps, target, VERSION, "a.pdf", "application/pdf")).toEqual({ ok: false, error: "docs.downloadForbidden" });
    expect(await downloadApplicationFile(setup([res(503)]).deps, target, VERSION, "a.pdf", "application/pdf")).toEqual({ ok: false, error: "docs.downloadUnavailable" });
    expect(await downloadApplicationFile(setup([redirect(STORAGE), pdf({ headers: new Headers({ "content-type": "text/html" }) })]).deps, target, VERSION, "a.pdf", "application/pdf")).toEqual({ ok: false, error: "docs.downloadFailed" });
    expect(await downloadApplicationFile(setup([redirect(STORAGE), pdf({ arrayBuffer: async () => new ArrayBuffer(0) })]).deps, target, VERSION, "a.pdf", "application/pdf")).toEqual({ ok: false, error: "docs.downloadFailed" });
    expect(await downloadApplicationFile(setup([redirect(null)]).deps, target, VERSION, "a.pdf", "application/pdf")).toEqual({ ok: false, error: "docs.downloadFailed" });
    expect(await downloadApplicationFile(setup([new Error("offline")]).deps, target, VERSION, "a.pdf", "application/pdf")).toEqual({ ok: false, error: "errorNetwork" });
    expect(await downloadApplicationFile(setup([], { getToken: async () => null }).deps, target, VERSION, "a.pdf", "application/pdf")).toEqual({ ok: false, error: "docs.errorSession" });
  });

  it("имя файла чистится, расширение берётся по типу", async () => {
    const t = setup([redirect(STORAGE), pdf({ headers: new Headers({ "content-type": "image/png" }) })]);
    const result = await downloadApplicationFile(t.deps, target, VERSION, "../паспорт", "image/png");
    expect(result).toMatchObject({ ok: true, name: "_паспорт.png" });
  });
});
