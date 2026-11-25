// Крупный просмотр «Примера»: касания рамки доходят до вида страницы (щипок, двойное касание, движение, листание), вид не
// сбрасывается перерисовкой (опрос, новый `api`), жест, севший не на рамку, считается по страницам касаний.
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { Dimensions, Pressable } from "react-native";

import { DocumentsScreen } from "@/features/documents/DocumentsScreen";
import { DOUBLE_TAP_SCALE } from "@/features/documents/zoom-math";
import {
  addFinger, ATTESTAT, CASE_ID, directions, drag, FRAME_AT, instantAnimations, lift, makeIo, move, openGuide, outside, pinch, press, readView, renderDocs, S_ATTESTAT, SAMPLES, tap, touch, uriOf,
} from "@/test-fixtures/document-guide";
import { PortalShell, testApi, testClient } from "@/test-fixtures/render";
import { fakeTransport } from "@/test-fixtures/universities";
import { useTheme } from "@/theme/ThemeProvider";

jest.mock("expo-router", () => ({ router: { navigate: jest.fn() }, useLocalSearchParams: jest.fn(() => ({})) }));
jest.mock("@/features/documents/native", () => ({
  pickFromFiles: jest.fn(),
  pickFromPhotos: jest.fn(),
  pickFromCamera: jest.fn(),
  createUploadSend: jest.fn(),
  createDownloadDeps: jest.fn(),
  openLocalFile: jest.fn(),
}));

// Анимации Animated с нативным драйвером в Jest не идут, а после первой из них `setValue` перестаёт быть видимым:
// подменяем их мгновенными на весь файл, чтобы вид рамки всегда был виден.
let restoreAnimations: () => void = () => undefined;
beforeEach(() => {
  restoreAnimations = instantAnimations();
});
afterEach(() => restoreAnimations());

const id = `guide-${S_ATTESTAT}`;
const ZOOM = `${id}-lightbox-zoom`;
const IMAGE = `${id}-lightbox-image`;
/** Центр рамки в тесте: окно 750 pt, карточка 734, рамка 702 шириной, страница 1300x885 вписана в 662 по ширине. */
const CENTER: [number, number] = [351, 245];

async function openLightbox() {
  const view = await renderDocs([ATTESTAT]);
  await openGuide(S_ATTESTAT);
  await fireEvent.press(await screen.findByTestId(`${id}-sample-open`));
  await screen.findByTestId(`${id}-lightbox`);
  return view;
}
const around = (dx: number): [[number, number], [number, number]] => [
  [CENTER[0] - dx, CENTER[1]],
  [CENTER[0] + dx, CENTER[1]],
];

describe("просмотр: касания доходят до вида страницы", () => {
  it("щипок: вид страницы идёт за пальцами (масштаб - отношение расстояний), страница не листается; после отпускания остаётся", async () => {
    await openLightbox();
    expect(readView(ZOOM)).toEqual({ x: 0, y: 0, scale: 1 });
    await pinch(ZOOM, around(50), around(100));
    const zoomed = readView(ZOOM);
    expect(zoomed.scale).toBeCloseTo(2, 5);
    // пальцы вокруг центра: страница почти не едет
    expect(Math.abs(zoomed.x)).toBeLessThan(2);
    await lift(ZOOM, 1500);
    expect(readView(ZOOM).scale).toBeCloseTo(2, 5);
    expect(uriOf(IMAGE)).toBe(`${SAMPLES}/attestat-1.jpg`);
    // предел увеличения
    await pinch(ZOOM, around(20), around(300), 3000);
    expect(readView(ZOOM).scale).toBe(4);
    await lift(ZOOM, 3500);
  });

  it("двойное касание приближает до 2,5 к точке касания, второе возвращает целую страницу; одиночное ничего не делает", async () => {
    await openLightbox();
    await tap(ZOOM, [500, 245], 5000);
    expect(readView(ZOOM)).toEqual({ x: 0, y: 0, scale: 1 });
    await tap(ZOOM, [500, 245], 8000);
    expect(readView(ZOOM)).toEqual({ x: 0, y: 0, scale: 1 });
    await tap(ZOOM, [501, 246], 8100);
    const zoomed = readView(ZOOM);
    expect(zoomed.scale).toBe(DOUBLE_TAP_SCALE);
    // точка касания (501 - 351 = 150 pt правее центра) осталась под пальцем: сдвиг = 150 * (1 - 2,5), в пределах границ рамки
    expect(zoomed.x).toBeCloseTo(-150 * (DOUBLE_TAP_SCALE - 1), 5);
    expect(uriOf(IMAGE)).toBe(`${SAMPLES}/attestat-1.jpg`);
    await tap(ZOOM, [300, 200], 9000);
    await tap(ZOOM, [300, 200], 9100);
    expect(readView(ZOOM)).toEqual({ x: 0, y: 0, scale: 1 });
  });

  it("палец по приближенной странице двигает её в пределах рамки; по целой тянет её следом и возвращает, если не долистал", async () => {
    await openLightbox();
    // целая страница: пока палец ведёт, страница тянется слабее пальца; отпустили коротким сдвигом - вернулась
    await press(ZOOM, [touch(300, 245)], 1000);
    await move(ZOOM, [touch(280, 247)], 1050);
    expect(readView(ZOOM).x).toBeCloseTo(-20 * 0.4, 5);
    expect(readView(ZOOM).scale).toBe(1);
    await lift(ZOOM, 1900);
    expect(readView(ZOOM)).toEqual({ x: 0, y: 0, scale: 1 });
    expect(uriOf(IMAGE)).toBe(`${SAMPLES}/attestat-1.jpg`);
    // приблизили двойным касанием и повели
    await tap(ZOOM, CENTER, 3000);
    await tap(ZOOM, CENTER, 3100);
    expect(readView(ZOOM).scale).toBe(DOUBLE_TAP_SCALE);
    const zoomed = readView(ZOOM);
    await press(ZOOM, [touch(300, 245)], 4000);
    await move(ZOOM, [touch(250, 215)], 4050);
    expect(readView(ZOOM).x).toBeCloseTo(zoomed.x - 50, 5);
    expect(readView(ZOOM).y).toBeCloseTo(zoomed.y - 30, 5);
    expect(readView(ZOOM).scale).toBe(DOUBLE_TAP_SCALE);
    await move(ZOOM, [touch(-5000, -5000)], 4100);
    const edge = readView(ZOOM);
    expect(edge.scale).toBe(DOUBLE_TAP_SCALE);
    expect(edge.x).toBeLessThan(0);
    expect(Math.abs(edge.x)).toBeLessThanOrEqual((662 * DOUBLE_TAP_SCALE - 702) / 2 + 0.01);
    await lift(ZOOM, 4200);
    expect(readView(ZOOM).scale).toBe(DOUBLE_TAP_SCALE);
    expect(uriOf(IMAGE)).toBe(`${SAMPLES}/attestat-1.jpg`);
  });

  it("движение по целой странице листает: влево вперёд, вправо назад, дважды подряд, на краях и по вертикали страница остаётся", async () => {
    await openLightbox();
    // на первой странице движение вправо - «назад» некуда
    await drag(ZOOM, [200, 245], [330, 245]);
    expect(uriOf(IMAGE)).toBe(`${SAMPLES}/attestat-1.jpg`);
    // вертикальное движение не листает
    await drag(ZOOM, [200, 100], [210, 330], 2000);
    expect(uriOf(IMAGE)).toBe(`${SAMPLES}/attestat-1.jpg`);
    // короткий медленный сдвиг не листает
    await drag(ZOOM, [200, 245], [180, 245], 3000, 600);
    expect(uriOf(IMAGE)).toBe(`${SAMPLES}/attestat-1.jpg`);
    // влево - следующая, подпись и озвучивание те же, что у кнопок; вторая подряд - уже в обработчик новой страницы
    await drag(ZOOM, [500, 245], [330, 245], 4000);
    expect(uriOf(IMAGE)).toBe(`${SAMPLES}/attestat-2.jpg`);
    expect(screen.getByTestId(`${id}-lightbox-caption`).props.accessibilityLabel).toBe("Оценки, 2 из 7");
    await drag(ZOOM, [500, 245], [330, 245], 5000);
    expect(uriOf(IMAGE)).toBe(`${SAMPLES}/attestat-3.jpg`);
    // вправо - назад
    await drag(ZOOM, [190, 245], [340, 245], 6000);
    expect(uriOf(IMAGE)).toBe(`${SAMPLES}/attestat-2.jpg`);
    // новая страница открывается целой
    expect(readView(ZOOM)).toEqual({ x: 0, y: 0, scale: 1 });
  });

  it("жест отобрали (звонок, системный жест): приближение остаётся, каким было к этому моменту; недожатое касание тапом не считается", async () => {
    await openLightbox();
    await pinch(ZOOM, around(50), around(75));
    const reached = readView(ZOOM);
    expect(reached.scale).toBeCloseTo(1.5, 5);
    await fireEvent(screen.getByTestId(ZOOM), "responderTerminate", { nativeEvent: { touches: [], changedTouches: [], timestamp: 1200 } });
    expect(readView(ZOOM).scale).toBeCloseTo(1.5, 5);
    expect(readView(ZOOM).x).toBeCloseTo(reached.x, 5);
    // отобранное касание не запоминается как первый тап двойного касания
    await press(ZOOM, [touch(...CENTER)], 2000);
    await fireEvent(screen.getByTestId(ZOOM), "responderTerminate", { nativeEvent: { touches: [], changedTouches: [], timestamp: 2030 } });
    await tap(ZOOM, CENTER, 2100);
    expect(readView(ZOOM).scale).toBeCloseTo(1.5, 5);
    // а настоящее двойное касание по приближенной возвращает целую страницу
    await tap(ZOOM, CENTER, 2200);
    expect(readView(ZOOM)).toEqual({ x: 0, y: 0, scale: 1 });
    // рамка не отдаёт касание родителю
    expect(screen.getByTestId(ZOOM).props.onResponderTerminationRequest()).toBe(false);
  });
});

describe("просмотр: пальцы считаются по страницам касаний", () => {
  it("палец, севший не на рамку (поле карточки, подпись), не путает системы координат: щипок идёт по расстоянию на экране", async () => {
    await openLightbox();
    // первый палец - на рамке (200, 200 от рамки), второй - на подписи ниже/правее, его locationX/Y считаются от подписи
    const first = touch(200, 200);
    const captionAt = { x: first.pageX + 100 - 7, y: first.pageY - 9 };
    await press(ZOOM, [first], 1000);
    await addFinger(ZOOM, [first, outside(first.pageX + 100, first.pageY, captionAt)], 1010);
    await move(ZOOM, [first, outside(first.pageX + 200, first.pageY, captionAt)], 1060);
    // на экране пальцы разошлись вдвое: 100 -> 200 pt. По locationX/Y вышло бы 7 -> 107 pt от разных начал - не вдвое
    expect(readView(ZOOM).scale).toBeCloseTo(2, 5);
    await lift(ZOOM, 1300);
    expect(readView(ZOOM).scale).toBeCloseTo(2, 5);
    expect(FRAME_AT.x).toBeGreaterThan(0);
  });

  it("если у касания нет страниц (тест, странная платформа), точки берутся как locationX/Y", async () => {
    await openLightbox();
    const bare = (x: number, y: number) => ({ locationX: x, locationY: y });
    const zoom = screen.getByTestId(ZOOM);
    await fireEvent(zoom, "responderGrant", { nativeEvent: { touches: [bare(300, 245)], changedTouches: [bare(300, 245)], timestamp: 1000 } });
    await fireEvent(zoom, "responderStart", { nativeEvent: { touches: [bare(300, 245), bare(400, 245)], changedTouches: [bare(400, 245)], timestamp: 1010 } });
    await fireEvent(zoom, "responderMove", { nativeEvent: { touches: [bare(250, 245), bare(450, 245)], changedTouches: [], timestamp: 1060 } });
    expect(readView(ZOOM).scale).toBeCloseTo(2, 5);
  });
});

describe("просмотр: перерисовка не сбрасывает приближение", () => {
  /** Приблизили щипком и отпустили; следующее движение одним пальцем покажет, из какого вида оно идёт. */
  async function zoomTo(ratio: number) {
    await pinch(ZOOM, around(40), around(40 * ratio));
    await lift(ZOOM, 1400);
    expect(readView(ZOOM).scale).toBeCloseTo(ratio, 5);
  }
  /** Одно движение пальцем по приближенной странице: масштаб остаётся прежним, страница сдвигается от прежнего сдвига. */
  async function dragOnce(ratio: number, from: number, to: number, time: number) {
    await press(ZOOM, [touch(from, 245)], time);
    await move(ZOOM, [touch(to, 245)], time + 40);
    expect(readView(ZOOM).scale).toBeCloseTo(ratio, 5);
    await lift(ZOOM, time + 80);
  }

  it("опрос оболочки перечитал открытые экраны (строки пришли другими, страна дела - новой картой): масштаб и сдвиг те же, следующий жест идёт из них", async () => {
    // перечитанные строки отличаются (куратор поправил подсказку): список перерисовывается, а не отдаёт прежние объекты
    let edits = 0;
    const view = await renderDocs([ATTESTAT], {
      student_portal_documents: () => [{ ...ATTESTAT, instructions: `Подсказка куратора ${++edits}` }],
      student_portal_case_directions_v1: () => directions([CASE_ID, "CN"]),
    });
    const { client, calls } = view;
    await openGuide(S_ATTESTAT);
    await fireEvent.press(await screen.findByTestId(`${id}-sample-open`));
    await screen.findByTestId(`${id}-lightbox`);
    await zoomTo(2.6);
    await dragOnce(2.6, 300, 280, 2000);
    const before = readView(ZOOM);
    const reads = calls.filter((call) => call.name === "student_portal_documents").length;
    await act(async () => {
      await client.invalidateQueries({ queryKey: ["portal", "user-test"], refetchType: "active" });
    });
    await waitFor(() => expect(calls.filter((call) => call.name === "student_portal_documents").length).toBeGreaterThan(reads));
    expect(screen.getByTestId(`${id}-lightbox`)).toBeTruthy();
    expect(readView(ZOOM)).toEqual(before);
    // следующий жест идёт из прежнего вида: масштаб 2,6 и сдвиг продолжается, а не начинается с целой страницы
    await dragOnce(2.6, 300, 290, 3000);
    expect(readView(ZOOM).scale).toBeCloseTo(2.6, 5);
    expect(readView(ZOOM).x).toBeCloseTo(before.x - 10, 5);
  });

  it("новый `api` (обновление токена пересобирает его) не сбрасывает вид", async () => {
    const t = fakeTransport({ student_portal_documents: [ATTESTAT], student_portal_case_files_v1: [] });
    const client = testClient();
    const io = makeIo().io;
    const shell = (api: ReturnType<typeof testApi>): ReactElement => (
      <PortalShell api={api} client={client}>
        <DocumentsScreen io={io} />
      </PortalShell>
    );
    const view = await render(shell(testApi(t.transport)));
    await openGuide(S_ATTESTAT);
    await fireEvent.press(await screen.findByTestId(`${id}-sample-open`));
    await screen.findByTestId(`${id}-lightbox`);
    await zoomTo(2);
    await dragOnce(2, 300, 270, 2000);
    const before = readView(ZOOM);
    for (let round = 0; round < 3; round += 1) await view.rerender(shell(testApi(t.transport, { displayName: `Другое имя ${round}` })));
    expect(screen.getByTestId(`${id}-lightbox`)).toBeTruthy();
    expect(readView(ZOOM)).toEqual(before);
    await dragOnce(2, 300, 290, 3000);
    expect(readView(ZOOM).x).toBeCloseTo(before.x - 10, 5);
  });

  it("тема сменилась (контекст, который читает сам просмотр): вид тот же, следующий жест идёт из него", async () => {
    function ThemeSwitch() {
      const { setChoice } = useTheme();
      return <Pressable testID="theme-dark" onPress={() => setChoice("dark")} />;
    }
    const t = fakeTransport({ student_portal_documents: [ATTESTAT], student_portal_case_files_v1: [] });
    await render(
      <PortalShell api={testApi(t.transport)} client={testClient()}>
        <ThemeSwitch />
        <DocumentsScreen io={makeIo().io} />
      </PortalShell>,
    );
    await openGuide(S_ATTESTAT);
    await fireEvent.press(await screen.findByTestId(`${id}-sample-open`));
    await screen.findByTestId(`${id}-lightbox`);
    await zoomTo(2.2);
    await dragOnce(2.2, 300, 270, 2000);
    const before = readView(ZOOM);
    await fireEvent.press(screen.getByTestId("theme-dark"));
    await waitFor(() => expect(screen.getByTestId(`${id}-lightbox`)).toBeTruthy());
    expect(readView(ZOOM)).toEqual(before);
    await dragOnce(2.2, 300, 290, 3000);
    expect(readView(ZOOM).scale).toBeCloseTo(2.2, 5);
    expect(readView(ZOOM).x).toBeCloseTo(before.x - 10, 5);
  });

  it("размер окна сменился (поворот, окно, шрифт): приближение остаётся, а сдвиг прижимается к новым границам и страница не «уезжает» за край", async () => {
    await openLightbox();
    // у правого края: двойное касание рядом с краем рамки дало сдвиг почти до предела
    await tap(ZOOM, [651, 245], 1000);
    await tap(ZOOM, [651, 245], 1100);
    const wide = readView(ZOOM);
    expect(wide.scale).toBe(DOUBLE_TAP_SCALE);
    expect(wide.x).toBeCloseTo(-300 * (DOUBLE_TAP_SCALE - 1), 5);
    // окно 600 pt: рамка 552, страница 512 - предел сдвига при 2,5-кратном приближении (512 * 2,5 - 552) / 2 = 364
    await act(async () => {
      Dimensions.set({ window: { width: 600, height: 1200, scale: 2, fontScale: 2 }, screen: { width: 600, height: 1200, scale: 2, fontScale: 2 } });
    });
    try {
      const narrow = readView(ZOOM);
      expect(narrow.scale).toBe(DOUBLE_TAP_SCALE);
      expect(narrow.x).toBeCloseTo(-(512 * DOUBLE_TAP_SCALE - 552) / 2, 5);
      expect(narrow.x).toBeGreaterThan(wide.x);
      // жест идёт из прижатого вида, а не из прежнего: палец на 10 вправо - страница на 10 вправо от предела, а не от прежнего сдвига
      await press(ZOOM, [touch(300, 245)], 3000);
      await move(ZOOM, [touch(310, 245)], 3040);
      expect(readView(ZOOM).x).toBeCloseTo(narrow.x + 10, 5);
      await lift(ZOOM, 3100);
    } finally {
      await act(async () => {
        Dimensions.set({ window: { width: 750, height: 1334, scale: 2, fontScale: 2 }, screen: { width: 750, height: 1334, scale: 2, fontScale: 2 } });
      });
    }
    // окно вернули: приближение не пропало
    expect(readView(ZOOM).scale).toBe(DOUBLE_TAP_SCALE);
  });

  it("другая страница открывается целой, а возврат на прежнюю не помнит приближения (новый показ)", async () => {
    await openLightbox();
    await zoomTo(3);
    await fireEvent.press(screen.getByTestId(`${id}-pager-next`));
    expect(uriOf(IMAGE)).toBe(`${SAMPLES}/attestat-2.jpg`);
    expect(readView(ZOOM)).toEqual({ x: 0, y: 0, scale: 1 });
    await fireEvent.press(screen.getByTestId(`${id}-pager-prev`));
    expect(readView(ZOOM)).toEqual({ x: 0, y: 0, scale: 1 });
  });
});
