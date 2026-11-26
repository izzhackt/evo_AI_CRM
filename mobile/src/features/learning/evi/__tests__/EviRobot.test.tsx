// Робот Эви: что он делает при каждом лице (чистый план), совпадение рисунка и лиц с веб-компонентом и CSS «Живой Эви», и то, что
// живой робот запускает движение, а неподвижный и при «уменьшить движение» - нет, и всё останавливается при уходе экрана.
import { readFileSync } from "node:fs";
import path from "node:path";

import { Animated } from "react-native";

import { EVI_MOODS } from "@web/lib/portal/evi";

import { EviRobot, FACE_PARTS, robotPlan, svgColor, type EviFace } from "@/features/learning/evi/EviRobot";
import { renderPortal, testApi } from "@/test-fixtures/render";
import { fakeTransport } from "@/test-fixtures/universities";
import { lightTokens } from "@/theme/tokens.generated";

let mockReduce = false;
jest.mock("@/ui/useReduceMotion", () => ({ useReduceMotion: () => mockReduce }));

const REPO = path.resolve(__dirname, "../../../../../../");
const read = (file: string) => readFileSync(path.join(REPO, file), "utf8");
const FACES: readonly EviFace[] = ["idle", ...EVI_MOODS];
const CALM = { listening: false, settled: false, still: false, reduceMotion: false } as const;

describe("план робота: что он делает при каждом лице", () => {
  it("лица и части лица: как у веба (idle и talk - полумесяцы, у talk говорящий рот; happy - купола и улыбка; wow - овалы и «о»; thinking - полоски; eureka - звёзды и «о»)", () => {
    expect(FACE_PARTS).toEqual({
      idle: ["bowl"],
      talk: ["bowl", "talk"],
      happy: ["dome", "smile"],
      wow: ["oval", "o"],
      thinking: ["scan"],
      eureka: ["star", "o"],
    });
    expect(Object.keys(FACE_PARTS).sort()).toEqual([...FACES].sort());
  });

  it("части лица читаются из CSS веба: каждое настроение показывает ровно те части, что `portal.css` (блок «Лица»)", () => {
    const css = read("src/app/(portal)/portal.css");
    const rule = /(\.pt-evi-mascot:is\(\[data-mood="idle"\][\s\S]*?)\{\s*opacity: 1;/u.exec(css)?.[1] ?? "";
    expect(rule).not.toBe("");
    const visible = new Map<string, Set<string>>();
    for (const selector of rule.split(/,\s*(?=\.pt-evi-mascot)/u)) {
      const moods = [...selector.matchAll(/data-mood="(\w+)"/gu)].map((match) => match[1] as string);
      const faces = [...selector.matchAll(/data-face="(\w+)"/gu)].map((match) => match[1] as string);
      for (const mood of moods) visible.set(mood, new Set([...(visible.get(mood) ?? []), ...faces]));
    }
    expect([...visible.keys()].sort()).toEqual([...FACES].sort());
    for (const face of FACES) expect([...(visible.get(face) ?? [])].sort()).toEqual([...FACE_PARTS[face]].sort());
  });

  it("покачивание есть у любого живого лица; моргание - у спокойного и говорящего; рот и кивок - у говорящего", () => {
    for (const face of FACES) expect(robotPlan(face, CALM).bob).toBe(true);
    expect(FACES.filter((face) => robotPlan(face, CALM).blink)).toEqual(["idle", "talk"]);
    expect(FACES.filter((face) => robotPlan(face, CALM).talk)).toEqual(["talk"]);
  });

  it("глаза бегают, голова наклоняется и антенна мигает, пока идёт настоящий запрос (`thinking`)", () => {
    expect(FACES.filter((face) => robotPlan(face, CALM).scan)).toEqual(["thinking"]);
    // Неподвижный робот в шапке с «думающим» лицом не бегает (в вебе так же), но взгляд в сторону остаётся.
    const still = robotPlan("thinking", { ...CALM, still: true });
    expect(still.scan).toBe(false);
    expect(still.eyes).toEqual({ x: -4, y: -3 });
    expect(still.parts).toEqual(["scan"]);
  });

  it("одна реакция на новую реплику: радуется - подскок, удивлён - «поп», придумал - прыжок; у старой реплики (settled) реакции нет", () => {
    const reactions = Object.fromEntries(FACES.map((face) => [face, robotPlan(face, CALM).react]));
    expect(reactions).toEqual({ idle: null, talk: null, happy: "hop", wow: "pop", thinking: null, eureka: "jump" });
    for (const face of FACES) expect(robotPlan(face, { ...CALM, settled: true }).react).toBeNull();
  });

  it("взгляд: слушает - к полю ввода, думает - в сторону (главнее), иначе прямо", () => {
    expect(robotPlan("idle", CALM).eyes).toEqual({ x: 0, y: 0 });
    expect(robotPlan("idle", { ...CALM, listening: true }).eyes).toEqual({ x: 3, y: 4 });
    expect(robotPlan("thinking", { ...CALM, listening: true }).eyes).toEqual({ x: -4, y: -3 });
  });

  it("неподвижный и «уменьшить движение»: никакого движения, лицо при этом настоящее", () => {
    for (const off of [{ still: true }, { reduceMotion: true }, { still: true, reduceMotion: true }]) {
      for (const face of FACES) {
        const plan = robotPlan(face, { ...CALM, ...off });
        expect([plan.bob, plan.blink, plan.talk, plan.scan, plan.react]).toEqual([false, false, false, false, null]);
        expect(plan.parts).toEqual(FACE_PARTS[face]);
      }
    }
  });
});

describe("рисунок совпадает с вебом", () => {
  const web = read("src/components/portal/evi/EviRobot.tsx");
  const app = readFileSync(path.join(__dirname, "../EviRobot.tsx"), "utf8");

  it("все контуры (`d`) и все прямоугольники и эллипсы те же, числа не пересчитаны", () => {
    const paths = [...web.matchAll(/\bd="([^"]+)"/gu)].map((match) => match[1] as string);
    expect(paths).toHaveLength(8);
    for (const d of paths) expect(app).toContain(`d="${d}"`);
    const webRects = [...web.matchAll(/<rect\b[^>]*?\bx="([-\d.]+)" y="([-\d.]+)" width="([-\d.]+)" height="([-\d.]+)" rx="([-\d.]+)"/gu)].map((match) => match.slice(1).join(","));
    const appRects = [...app.matchAll(/<Rect x=\{([-\d.]+)\} y=\{([-\d.]+)\} width=\{([-\d.]+)\} height=\{([-\d.]+)\} rx=\{([-\d.]+)\}/gu)].map((match) => match.slice(1).join(","));
    // Пятнадцать прямоугольников в вебе (вспышка и визор делят координаты): ни один не потерян и не добавлен.
    expect(webRects).toHaveLength(15);
    expect([...new Set(appRects)].sort()).toEqual([...new Set(webRects)].sort());
    const webEllipses = [...web.matchAll(/<ellipse\b[^>]*?\bcx="([-\d.]+)" cy="([-\d.]+)" rx="([-\d.]+)" ry="([-\d.]+)"/gu)].map((match) => match.slice(1).join(","));
    const appEllipses = [...app.matchAll(/<Ellipse cx=\{([-\d.]+)\} cy=\{([-\d.]+)\} rx=\{([-\d.]+)\} ry=\{([-\d.]+)\}/gu)].map((match) => match.slice(1).join(","));
    expect(webEllipses.length).toBeGreaterThan(0);
    expect([...new Set(appEllipses)].sort()).toEqual([...new Set(webEllipses)].sort());
  });

  it("цвета - токены `evi*` из portal.css (они уже в `tokens.generated.ts`), своих цветов в рисунке нет", () => {
    for (const token of ["eviHelmet", "eviHelmetHi", "eviHelmetLo", "eviHelmetRim", "eviRing", "eviVisor", "eviVisorHi", "eviVisorLo", "eviEye", "eviEar", "eviEarLine", "eviAccent", "eviNubHi", "eviNubLo", "eviShine", "eviGloss", "eviFlash"]) {
      expect(lightTokens).toHaveProperty(token);
      expect(app).toContain(`tokens.${token}`);
    }
    const code = app.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/(^|\s)\/\/.*$/gmu, "$1");
    expect(code).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d/u);
  });

  it("токен `rgb(r g b / a)` переводится в запятую-форму для react-native-svg; остальные цвета не трогаются", () => {
    expect(svgColor(lightTokens.eviGloss)).toBe("rgba(255, 255, 255, 0.55)");
    expect(svgColor(lightTokens.eviShine)).toBe("rgba(255, 255, 255, 0.12)");
    expect(svgColor("#62dcf7")).toBe("#62dcf7");
  });
});

describe("движение: запускается у живого, не у неподвижного, и снимается при уходе экрана", () => {
  type Fake = { start: jest.Mock; stop: jest.Mock; reset: jest.Mock };
  let fakes: Fake[];
  let loops: jest.SpyInstance;

  beforeEach(() => {
    mockReduce = false;
    fakes = [];
    const fake = (): Fake => {
      const made = { start: jest.fn(), stop: jest.fn(), reset: jest.fn() };
      fakes.push(made);
      return made;
    };
    // Настоящие значения и узлы Animated, но кадры не идут: проверяется, что запущено и что остановлено.
    jest.spyOn(Animated, "timing").mockImplementation((() => fake()) as never);
    loops = jest.spyOn(Animated, "loop").mockImplementation((() => fake()) as never);
  });
  afterEach(() => jest.restoreAllMocks());

  const mount = async (props: Partial<Parameters<typeof EviRobot>[0]> & { face: EviFace }) => {
    const { transport } = fakeTransport({});
    return renderPortal(<EviRobot {...props} />, testApi(transport));
  };

  it("живой робот у новой реплики: покачивание и моргание идут бесконечно; уход экрана останавливает всё запущенное", async () => {
    const view = await mount({ face: "idle" });
    expect(loops).toHaveBeenCalledTimes(2);
    const started = fakes.filter((item) => item.start.mock.calls.length > 0);
    expect(started.length).toBeGreaterThan(0);
    await view.unmount();
    for (const item of started) expect(item.stop).toHaveBeenCalled();
  });

  it("говорит: рот и кивок добавляются к покачиванию и морганию", async () => {
    await mount({ face: "talk", settled: true });
    expect(loops).toHaveBeenCalledTimes(4);
  });

  it("думает (идёт запрос): глаза, наклон головы и антенна бегают", async () => {
    await mount({ face: "thinking", settled: true });
    // Покачивание и три бесконечных движения «думает».
    expect(loops).toHaveBeenCalledTimes(4);
  });

  it("неподвижный (шапка Эви, вход на «Профессиях») не запускает ничего бесконечного", async () => {
    await mount({ face: "happy", settled: true, still: true });
    expect(loops).not.toHaveBeenCalled();
  });

  it("«уменьшить движение»: бесконечного нет, реакции нет, лицо всё равно видно", async () => {
    mockReduce = true;
    const view = await mount({ face: "eureka" });
    expect(loops).not.toHaveBeenCalled();
    expect(view.getByTestId("evi-robot", { includeHiddenElements: true })).toBeTruthy();
  });

  it("придумал у новой реплики: прыжок, звёзды, вспышка и четыре мигания антенны; у старой реплики только покачивание", async () => {
    await mount({ face: "eureka" });
    // Покачивание и мигание антенны четыре раза.
    expect(loops).toHaveBeenCalledTimes(2);
    expect(loops.mock.calls.some(([, options]) => (options as { iterations?: number } | undefined)?.iterations === 4)).toBe(true);
    loops.mockClear();
    await mount({ face: "eureka", settled: true });
    expect(loops).toHaveBeenCalledTimes(1);
  });

  it("рисунок для читалки скрыт: украшение, название рядом", async () => {
    const view = await mount({ face: "happy", still: true, testID: "robot-a11y" });
    const root = view.getByTestId("robot-a11y", { includeHiddenElements: true });
    expect(root.props.accessibilityElementsHidden).toBe(true);
    expect(root.props.importantForAccessibility).toBe("no-hide-descendants");
    expect(root.props.pointerEvents).toBe("none");
  });

  it("размер: ширина шлема - то, что просили, высота по пропорции рисунка 160 x 130", async () => {
    const view = await mount({ face: "idle", still: true, size: 104, testID: "robot-size" });
    const root = view.getByTestId("robot-size", { includeHiddenElements: true });
    const style = Array.isArray(root.props.style) ? Object.assign({}, ...root.props.style) : root.props.style;
    expect(style.width).toBe(104);
    expect(style.height).toBeCloseTo(84.5, 5);
  });
});
