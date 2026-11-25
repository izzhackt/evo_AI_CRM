// Сверка копий веб-логики с настоящим веб-кодом. Часть чистой логики «Главной» приложение вынуждено держать копией
// (`domain/home-model.ts`, `domain/presentation.ts`): веб-файлы тянут Next, `server-only` и алиас `@/` веба, из приложения их
// не импортировать. Чтобы копия не разошлась с оригиналом молча, тесты берут сам веб-файл, переводят его из TypeScript и
// выполняют здесь: небольшие веб-компоненты без хуков (`HomeView`, `HomeCase`, `HomeDates`, `HomeNews`, `HomeHero`) разворачиваются
// в дерево элементов и из него читается текст, который увидел бы студент; чистые модули (`admission/presentation.ts`) вызываются как функции.
//
// Что подставлено: `@/components/IntentPrefetchLink` (ссылка Next -> `<a href>`), значки `lucide-react` (-> `<svg data-icon>`),
// `CountryTimeline` (клиентский компонент с хуками: его сверка - тесты пути), `allDayDate` из `lib/v3/wording.ts` (файл тянет
// серверную цепочку; функция вырезается из текста файла). Общие модули `src/lib/**` загружаются тем же Jest, что и приложение.
// Неизвестный импорт веб-файла - явная ошибка: веб изменился, нужно подготовить подстановку или перенести изменение в приложение.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { Fragment, isValidElement, type ReactNode } from "react";
import * as ts from "typescript";

const WEB_SRC = path.resolve(__dirname, "../../../src");
const rel = (file: string) => path.relative(WEB_SRC, file);

// ---- Дерево элементов -------------------------------------------------------------------------------------------------

/** Развёрнутый элемент: тег, свойства (без `children`) и дочерние узлы. Текст - строки. */
export type WebNode = Readonly<{ tag: string; props: Readonly<Record<string, unknown>>; children: readonly (WebNode | string)[] }>;

type Component = (props: Record<string, unknown>) => ReactNode;

function expandInto(node: unknown, out: (WebNode | string)[]): void {
  if (node === null || node === undefined || typeof node === "boolean") return;
  if (typeof node === "string" || typeof node === "number") {
    out.push(String(node));
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) expandInto(item, out);
    return;
  }
  if (!isValidElement(node)) throw new Error(`web-oracle: неизвестный узел ${String(node)}`);
  const { type, props } = node as unknown as { type: unknown; props: Record<string, unknown> };
  if (type === Fragment) return expandInto(props.children, out);
  if (typeof type === "function") return expandInto((type as Component)(props), out);
  if (typeof type !== "string") throw new Error("web-oracle: компонент без функции (memo, forwardRef): подготовьте подстановку");
  const { children, ...own } = props;
  const inner: (WebNode | string)[] = [];
  expandInto(children, inner);
  out.push({ tag: type, props: own, children: inner });
}

/** Элемент веб-компонента как дерево узлов. Компоненты с хуками подставляются заранее (см. `STUBS`). */
export function expand(element: ReactNode): WebNode {
  const out: (WebNode | string)[] = [];
  expandInto(element, out);
  const nodes = out.filter((item): item is WebNode => typeof item !== "string");
  if (nodes.length === 1 && out.length === 1) return nodes[0];
  return { tag: "#root", props: {}, children: out };
}

const classes = (node: WebNode) => String(node.props.className ?? "").split(/\s+/).filter(Boolean);

/** Все узлы, подходящие под условие, в порядке документа. */
export function findAll(node: WebNode, test: (node: WebNode) => boolean): WebNode[] {
  const found: WebNode[] = test(node) ? [node] : [];
  for (const child of node.children) if (typeof child !== "string") found.push(...findAll(child, test));
  return found;
}

/** Узлы с классом `className`. */
export const byClass = (root: WebNode, className: string) => findAll(root, (node) => classes(node).includes(className));

/** Первый узел с классом или `null`. */
export const firstByClass = (root: WebNode, className: string) => byClass(root, className)[0] ?? null;

/** Текст узла, как его видит зрячий: без блоков `pt-sr-only` (только для читалки) и без скрытых значков. */
export function visibleText(node: WebNode | string): string {
  if (typeof node === "string") return node;
  if (classes(node).includes("pt-sr-only")) return "";
  return node.children.map(visibleText).join("");
}

/**
 * Строки текста, которые прочтёт зрячий студент, по порядку: без блоков `pt-sr-only` (только для читалки) и без пояснения за
 * «?» (`pt-home-hint-text`: закрытый `<details>`). Именно эти строки сравниваются с текстом карточек приложения.
 */
export function visibleFragments(node: WebNode | string, out: string[] = []): string[] {
  if (typeof node === "string") {
    if (node.trim() !== "") out.push(node.trim());
    return out;
  }
  const own = classes(node);
  if (own.includes("pt-sr-only") || own.includes("pt-home-hint-text")) return out;
  for (const child of node.children) visibleFragments(child, out);
  return out;
}

/** Тот же список строк у приложения: тексты `Text` по порядку из дерева Testing Library (`screen.toJSON()`). */
type NativeJson = { type: string; children: (NativeJson | string)[] | null };
export function nativeFragments(root: unknown, out: string[] = []): string[] {
  const node = root as NativeJson | NativeJson[] | string | null;
  if (node === null || node === undefined) return out;
  if (Array.isArray(node)) {
    for (const item of node) nativeFragments(item, out);
    return out;
  }
  if (typeof node === "string") {
    if (node.trim() !== "") out.push(node.trim());
    return out;
  }
  if (node.type === "Text") {
    const whole = (function textOf(part: NativeJson | string): string {
      return typeof part === "string" ? part : (part.children ?? []).map(textOf).join("");
    })(node).trim();
    if (whole !== "") out.push(whole);
    return out;
  }
  for (const child of node.children ?? []) nativeFragments(child, out);
  return out;
}

/** Весь текст узла, как его озвучит читалка: включая блоки `pt-sr-only`, без блоков `aria-hidden`. */
export function spokenText(node: WebNode | string): string {
  if (typeof node === "string") return node;
  if (node.props["aria-hidden"] === "true" || node.props["aria-hidden"] === true) return "";
  return node.children.map(spokenText).join("");
}

// ---- Подстановки ------------------------------------------------------------------------------------------------------

function anchor(props: Record<string, unknown>): ReactNode {
  const { children, ...rest } = props;
  return (jest.requireActual("react") as typeof import("react")).createElement("a", rest, children as ReactNode);
}

const lucide = new Proxy(
  {},
  {
    get: (_target, name) => {
      if (name === "__esModule") return true;
      return (props: Record<string, unknown>) => (jest.requireActual("react") as typeof import("react")).createElement("svg", { "data-icon": String(name), "aria-hidden": props["aria-hidden"] });
    },
  },
);

/**
 * Функции верхнего уровня из текста веб-файла, который нельзя загрузить целиком (`server-only`, серверная цепочка): объявления
 * `function имя(...) { ... }` вырезаются по имени, переводятся и выполняются с переданными именами (`scope`: то, что функции
 * берут из файла снаружи). Так выполняется настоящий код веба, а не его копия, и это годится для чистых функций.
 */
export function extractWebFunctions(fromSrc: string, names: readonly string[], scope: Readonly<Record<string, unknown>> = {}): Record<string, (...args: never[]) => unknown> {
  const source = readFileSync(path.join(WEB_SRC, fromSrc), "utf8");
  const pieces = names.map((name) => {
    const start = source.search(new RegExp(`(^|\\n)(export )?function ${name}\\(`));
    if (start < 0) throw new Error(`web-oracle: функция ${name} не найдена в ${fromSrc}`);
    // Тело - от первой `{` после списка параметров (параметры не содержат фигурных скобок в типах, кроме `Pick<...>`, их пропускаем по `)`
    // тела-с-типом: ищем `{`, у которой слева стоит `)` или тип результата).
    const open = source.indexOf("{", source.indexOf(")", start) + 1);
    let depth = 0;
    let end = open;
    for (; end < source.length; end += 1) {
      if (source[end] === "{") depth += 1;
      if (source[end] === "}" && --depth === 0) break;
    }
    return source.slice(start, end + 1).replace(/^\s*export /, "");
  });
  const code = ts.transpileModule(pieces.join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const scopeNames = Object.keys(scope);
  const factory = new Function(...scopeNames, `${code}\nreturn { ${names.join(", ")} };`);
  return factory(...scopeNames.map((name) => scope[name])) as Record<string, (...args: never[]) => unknown>;
}

/** `allDayDate` из `src/lib/v3/wording.ts`: файл тянет серверную цепочку, функция чистая. */
function webAllDayDate(): (value: string | null | undefined) => string | null {
  return extractWebFunctions("lib/v3/wording.ts", ["allDayDate"]).allDayDate as (value: string | null | undefined) => string | null;
}

const STUBS: Record<string, () => unknown> = {
  "@/components/IntentPrefetchLink": () => ({ IntentPrefetchLink: anchor }),
  "lucide-react": () => lucide,
  "./CountryTimeline": () => ({ CountryTimeline: () => null }),
  "@/lib/v3/wording": () => ({ allDayDate: webAllDayDate() }),
};

// ---- Загрузчик --------------------------------------------------------------------------------------------------------

const modules = new Map<string, Record<string, unknown>>();

function resolveFile(base: string): string | null {
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
    if (existsSync(candidate) && /\.(ts|tsx)$/.test(candidate)) return candidate;
  }
  return null;
}

function requireFor(from: string) {
  return (spec: string): unknown => {
    const stub = STUBS[spec];
    if (stub) return stub();
    if (spec === "react" || spec.startsWith("react/")) return jest.requireActual(spec);
    let base: string;
    if (spec.startsWith("@/")) base = path.join(WEB_SRC, spec.slice(2));
    else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec);
    else throw new Error(`web-oracle: ${rel(from)} подключает пакет «${spec}», подстановки для него нет`);
    const file = resolveFile(base);
    if (file === null) throw new Error(`web-oracle: ${rel(from)} подключает «${spec}», файла нет`);
    // Общие модули `src/lib` приложение и так берёт по `@web/...`: те же файлы, тот же Jest.
    if (file.startsWith(path.join(WEB_SRC, "lib") + path.sep)) return jest.requireActual(`@web/${rel(file).replace(/\.tsx?$/, "")}`);
    return loadWebModule(file);
  };
}

/** Веб-модуль из `src/components/**`: перевод TypeScript в CommonJS и выполнение с подстановками. */
export function loadWebModule(file: string): Record<string, unknown> {
  const cached = modules.get(file);
  if (cached) return cached;
  const source = readFileSync(file, "utf8");
  if (/^\s*["']use (client|server)["']/m.test(source)) throw new Error(`web-oracle: ${rel(file)} - клиентский или серверный модуль, его нужно подставить`);
  const { outputText } = ts.transpileModule(source, {
    fileName: file,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  });
  const module = { exports: {} as Record<string, unknown> };
  modules.set(file, module.exports);
  new Function("exports", "require", "module", "__filename", "__dirname", outputText)(module.exports, requireFor(file), module, file, path.dirname(file));
  modules.set(file, module.exports);
  return module.exports;
}

/** Веб-модуль по пути от `src/` веба: `webModule("components/portal/home/HomeCase.tsx")`. */
export function webModule<T = Record<string, unknown>>(fromSrc: string): T {
  return loadWebModule(path.join(WEB_SRC, fromSrc)) as T;
}

/** Читает файл веба как текст (для сверки правил, которых нет в коде: порядок блоков в CSS, пороги). */
export function webText(fromSrc: string): string {
  return readFileSync(path.join(WEB_SRC, fromSrc), "utf8");
}
