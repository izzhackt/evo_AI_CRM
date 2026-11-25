// Общие части тестов справки «Пример»: строки чек-листа, поддельные нативные операции, отрисовка экрана «Документы»,
// касания рамки просмотра и чтение её вида. Данные синтетические.
import { fireEvent, screen } from "@testing-library/react-native";
import { Animated } from "react-native";

import { DocumentsScreen } from "@/features/documents/DocumentsScreen";
import type { DocumentsIo } from "@/features/documents/io";
import { getPortalStrings } from "@/i18n";
import { CASE_ID, DOCUMENT_ROW_CORRECTION, DOCUMENT_ROW_EMPTY, SLOT_ID } from "@/test-fixtures/rpc-rows";
import { renderPortal, testApi } from "@/test-fixtures/render";
import { fakeTransport } from "@/test-fixtures/universities";

export const BASE = "https://portal.example.test";
export const SAMPLES = `${BASE}/portal/document-samples`;
export const CASE_B = "99999999-9999-4999-8999-999999999999";
export const ru = getPortalStrings("admission", "ru");
export const ky = getPortalStrings("admission", "ky");
export const slot = (n: number) => `44444444-4444-4444-8444-4444444444${String(n).padStart(2, "0")}`;
export const S_PASSPORT = SLOT_ID;
export const S_ATTESTAT = slot(61);
export const S_IELTS = slot(62);
export const S_HSK = slot(63);
export const S_BOTH = slot(64);
export const S_TOEFL = slot(65);
export const S_MEDICAL = slot(66);
export const S_PHOTO = slot(67);
export const S_FORM = slot(68);
export const S_OWN = slot(69);
export const S_APPROVED = slot(70);
export const S_MEDICAL_B = slot(71);

export const row = (id: string, label: string, over: Record<string, unknown> = {}) => ({ ...DOCUMENT_ROW_EMPTY, document_slot_id: id, requirement_key: null, requirement_label: label, ...over });
export const ATTESTAT = row(S_ATTESTAT, "Аттестат", { requirement_key: "attestat" });
export const IELTS = row(S_IELTS, "Сертификат IELTS");
export const HSK = row(S_HSK, "Сертификат HSK");
export const BOTH = row(S_BOTH, "Сертификат по языку (HSK, IELTS или TOEFL)");
export const TOEFL = row(S_TOEFL, "TOEFL");
export const MEDICAL = row(S_MEDICAL, "Медицинская справка");
export const PHOTO = row(S_PHOTO, "Фото");
export const FORM = row(S_FORM, "Анкета");
export const OWN = row(S_OWN, "Особый пункт куратора", { instructions: "Принесите оригинал" });
export const APPROVED_PASSPORT = { ...DOCUMENT_ROW_CORRECTION, document_slot_id: S_APPROVED, slot_status: "approved", review_decision: "approved", rework_reason: null, instructions: null, deadline: null };
export { CASE_ID, DOCUMENT_ROW_EMPTY };

export const directions = (...pairs: [string, string | null][]) => pairs.map(([caseId, direction]) => ({ student_case_id: caseId, direction }));
export const choice = (country: string) => ({ country, source: "saved", savedAt: "2026-11-01T08:00:00+00:00" });
/** Начало настоящего PDF: `%PDF-1.7`. */
export const PDF_BYTES = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55, 10]);
export const PDF = { status: 200, ok: true, headers: new Headers({ "content-type": "application/pdf" }), arrayBuffer: async () => PDF_BYTES.buffer };

export type Fetched = { url: string; headers: Record<string, string>; signal?: AbortSignal };
type Respond = (init: { signal?: AbortSignal }) => unknown;

export function makeIo(over: Partial<DocumentsIo> = {}) {
  const opened: { uri: string; mime: string }[] = [];
  const fetched: Fetched[] = [];
  let respond: Respond = () => PDF;
  const io: DocumentsIo = {
    pick: jest.fn(),
    createUploadSend: jest.fn(),
    createDownloadDeps: () => ({
      baseUrl: BASE,
      getToken: async () => "t",
      fetchImpl: async (url, init) => {
        fetched.push({ url, headers: init.headers, signal: init.signal });
        return (await respond(init)) as Awaited<ReturnType<ReturnType<DocumentsIo["createDownloadDeps"]>["fetchImpl"]>>;
      },
      writeFile: async (name) => `file:///cache/${name}`,
    }),
    openLocalFile: jest.fn(async (uri: string, mime: string) => void opened.push({ uri, mime })),
    ...over,
  };
  return { io, opened, fetched, respondWith: (next: Respond) => void (respond = next) };
}

/** Ответ, который не приходит, пока запрос не отменят (`signal`): как зависшая связь. */
export const hang: Respond = (init) =>
  new Promise((_resolve, reject) => {
    init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
  });

export async function renderDocs(rows: unknown[], extra: Record<string, unknown> = {}, files: unknown[] = [], lang: "ru" | "ky" = "ru") {
  const { transport, calls } = fakeTransport({ student_portal_documents: rows, student_portal_case_files_v1: files, ...extra });
  const io = makeIo();
  const view = await renderPortal(<DocumentsScreen io={io.io} />, testApi(transport), lang);
  return { ...io, calls, ...view };
}

export const openGuide = async (id: string) => fireEvent.press(await screen.findByTestId(`guide-${id}-open`));
export const uriOf = (testID: string): string => (screen.getByTestId(testID).props.source as { uri: string }[])[0]!.uri;
export const placeholderOf = (testID: string): string => (screen.getByTestId(testID).props.placeholder as { uri: string }[])[0]!.uri;
export const failImage = async (testID: string) => fireEvent(screen.getByTestId(testID), "error", { nativeEvent: { error: "offline" } });

// ---- касания рамки просмотра -------------------------------------------------------------------------------------------
/** Где рамка стоит на экране: `pageX/pageY` = точка в рамке + это начало. */
export const FRAME_AT = { x: 30, y: 140 };
type Finger = Readonly<{ locationX: number; locationY: number; pageX: number; pageY: number }>;
/** Палец в точке `x, y` рамки (`locationX/Y` от рамки, `pageX/Y` от экрана). */
export const touch = (x: number, y: number): Finger => ({ locationX: x, locationY: y, pageX: x + FRAME_AT.x, pageY: y + FRAME_AT.y });
/** Палец, севший НЕ на рамку (поле карточки, подпись): `locationX/Y` - от его цели, `pageX/Y` - от экрана. */
export const outside = (pageX: number, pageY: number, target: { x: number; y: number } = { x: pageX - 7, y: pageY - 9 }): Finger => ({ locationX: pageX - target.x, locationY: pageY - target.y, pageX, pageY });

const at = (time: number) => ({ timestamp: time });
export async function press(zoomId: string, fingers: Finger[], time: number) {
  await fireEvent(screen.getByTestId(zoomId), "responderGrant", { nativeEvent: { touches: fingers, changedTouches: [fingers[0]], ...at(time) } });
}
export async function addFinger(zoomId: string, fingers: Finger[], time: number) {
  await fireEvent(screen.getByTestId(zoomId), "responderStart", { nativeEvent: { touches: fingers, changedTouches: [fingers[fingers.length - 1]], ...at(time) } });
}
export async function move(zoomId: string, fingers: Finger[], time: number) {
  await fireEvent(screen.getByTestId(zoomId), "responderMove", { nativeEvent: { touches: fingers, changedTouches: fingers, ...at(time) } });
}
export async function lift(zoomId: string, time: number) {
  await fireEvent(screen.getByTestId(zoomId), "responderRelease", { nativeEvent: { touches: [], changedTouches: [], ...at(time) } });
}
export async function drag(zoomId: string, from: [number, number], to: [number, number], start = 1000, duration = 120) {
  await press(zoomId, [touch(...from)], start);
  await move(zoomId, [touch(...to)], start + duration / 2);
  await lift(zoomId, start + duration);
}
export async function tap(zoomId: string, point: [number, number], time: number) {
  await press(zoomId, [touch(...point)], time);
  await lift(zoomId, time + 40);
}
/** Щипок двумя пальцами из `from` в `to` (пары точек рамки); палец вверх не поднимается - жест остаётся открытым. */
export async function pinch(zoomId: string, from: [[number, number], [number, number]], to: [[number, number], [number, number]], start = 1000) {
  await press(zoomId, [touch(...from[0])], start);
  await addFinger(zoomId, [touch(...from[0]), touch(...from[1])], start + 10);
  await move(zoomId, [touch(...to[0]), touch(...to[1])], start + 60);
}

/** Вид страницы (сдвиг и масштаб), каким его видит рамка: из преобразования картинки под рамкой `zoomId`. */
export function readView(zoomId: string): { x: number; y: number; scale: number } {
  const node = screen.getByTestId(`${zoomId}-page`);
  const style = Object.assign({}, ...[node.props.style].flat(3).filter(Boolean)) as { transform?: Record<string, number>[] };
  const parts = Object.assign({}, ...(style.transform ?? [])) as Record<string, number>;
  return { x: parts.translateX ?? 0, y: parts.translateY ?? 0, scale: parts.scale ?? 1 };
}

/**
 * Анимации Animated в Jest с нативным драйвером не идут (нативного модуля нет), а после первой из них `setValue` перестаёт быть
 * виден в разметке. Подменяем `timing` и `parallel` мгновенными, чтобы видеть, куда страница ехала. Бесконечные циклы (пульсация
 * скелетона: `Animated.loop`) не запускаем: мгновенный круг переполнил бы стек. Возвращает функцию, что возвращает всё как было.
 */
export function instantAnimations(): () => void {
  type Anim = { start: (done?: (result: { finished: boolean }) => void, isLooping?: boolean) => void; stop: () => void; reset: () => void };
  const timing = jest.spyOn(Animated, "timing").mockImplementation(((value: Animated.Value, config: { toValue: number }): Anim => ({
    start: (done, isLooping) => {
      if (isLooping) return;
      value.setValue(config.toValue);
      done?.({ finished: true });
    },
    stop: () => undefined,
    reset: () => undefined,
  })) as unknown as typeof Animated.timing);
  const parallel = jest.spyOn(Animated, "parallel").mockImplementation(((animations: Anim[]): Anim => ({
    start: (done) => {
      for (const animation of animations) animation.start();
      done?.({ finished: true });
    },
    stop: () => {
      for (const animation of animations) animation.stop();
    },
    reset: () => undefined,
  })) as unknown as typeof Animated.parallel);
  return () => {
    timing.mockRestore();
    parallel.mockRestore();
  };
}
