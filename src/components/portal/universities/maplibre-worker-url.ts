/**
 * Адрес веб-воркера MapLibre GL для сборки Next (Turbopack).
 *
 * MapLibre 6 ищет воркер рядом со своим модулем (`import.meta.url`), а
 * Turbopack кладёт файлы пакета в `/_next/static/media/` под хешированными
 * именами: воркер не находился, карта вечно «загружалась» (найдено 16.10.2026
 * на демо-стенде, тайлы и точки не грузились). Здесь воркер собирается из тех
 * же файлов пакета: его относительный импорт `./maplibre-gl-shared.mjs`
 * заменяется на настоящий адрес общего модуля, результат отдаётся через
 * blob того же источника (`setWorkerUrl`). Файлы те же, что в
 * node_modules: версия пакета не расходится с кодом карты.
 */

let pending: Promise<string> | null = null;

export function maplibreWorkerUrl(): Promise<string> {
  pending ??= (async () => {
    // Адрес файла сборщик даёт относительным: из blob-воркера относительный
    // импорт не разрешается, поэтому адрес делается полным от страницы.
    const absolute = (asset: URL) => new URL(asset.href, window.location.href).href;
    const shared = absolute(new URL("maplibre-gl/dist/maplibre-gl-shared.mjs", import.meta.url));
    const worker = absolute(new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url));
    const response = await fetch(worker);
    if (!response.ok) throw new Error("MapLibre worker unavailable");
    const source = await response.text();
    const code = source.replace(/(["'])\.\/maplibre-gl-shared\.mjs\1/gu, JSON.stringify(shared));
    if (code === source) throw new Error("MapLibre worker import not found");
    return URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
  })().catch((error: unknown) => {
    pending = null;
    throw error;
  });
  return pending;
}
