import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import * as jsxRuntime from "react/jsx-runtime";
import ts from "typescript";

import { BOARD_ROUTES, isBoardRoute } from "../src/lib/v3/board-layout.ts";

/** Доски: маршруты, рейка и сворачивание меню (чистая логика); разметку «Нового вида» проверяет tests/ui-next-pipelines.test.mjs. */

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("board routes are the two pipelines and nothing else", () => {
  assert.deepEqual([...BOARD_ROUTES], ["/v3/pipeline", "/v3/admissions-pipeline"]);
  assert.equal(isBoardRoute("/v3/pipeline"), true);
  assert.equal(isBoardRoute("/v3/admissions-pipeline"), true);
  for (const route of ["/v3/main", "/v3/profile", "/v3/pipeline/x", "/v3/tasks", null, undefined]) {
    assert.equal(isBoardRoute(route), false, String(route));
  }
});

// Подпись рейки при наведении не должна перерисовывать меню по кругу. React 19
// сравнивает `dangerouslySetInnerHTML` по ссылке: новый объект на каждом
// рендере заново записывал innerHTML иконок, заменял линию SVG под курсором,
// браузер снова слал pointerover, а потерянный pointerout оставлял подпись на
// экране. Живое наведение (линия иконки и центр пункта, 9 пунктов на обеих
// досках) меряет boards-static-render.cjs --hydrate.
test("rail hover hint does not loop: icon markup is one stable object and a repeat hover is a no-op", () => {
  const compiled = ts.transpileModule(read("src/components/icons.tsx"), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const icons = {};
  runInNewContext(compiled, { exports: icons, require(name) {
    assert.equal(name, "react/jsx-runtime");
    return jsxRuntime;
  } });
  for (const name of ["log-out", "bar-chart", "grid", "x"]) {
    const first = icons.Icon({ name });
    const second = icons.Icon({ name, size: 20, className: "shrink-0" });
    assert.equal(first.props.dangerouslySetInnerHTML, second.props.dangerouslySetInnerHTML, `${name}: same markup object on every render`);
    assert.match(first.props.dangerouslySetInnerHTML.__html, /^<(path|rect|circle)\b/u, name);
  }
  const shell = read("src/components/v3/AppShell.tsx");
  assert.match(shell,
    /setRailHint\(\(previous\) => previous\?\.label === label && previous\.top === top \? previous : \{ label, top \}\)/u,
    "hovering the same item again keeps the same state and does not re-render the sidebar");
  assert.match(shell, /onPointerLeave: \(\) => setRailHint\(null\)/u);
});

test("drag is neutral: hover grip and dashed drop highlight, never red", () => {
  const primitive = read("src/components/v3/board/Board.tsx");
  assert.match(primitive, /highlighted && "bg-surface-2 outline-2 -outline-offset-2 outline-dashed outline-control-edge"/u);
  assert.match(primitive, /group-hover:block group-focus-within:block/u);
  assert.match(primitive, /<Icon name="grip-vertical"/u);
});

test("rail mode has no top bar: the logo row hides in the 64px rail, the menu keeps its items", () => {
  const shell = read("src/components/v3/AppShell.tsx");
  // A full logo does not read in 64px (Э1.2); the rail keeps icons with hints and the account.
  assert.match(shell, /cn\("hidden shrink-0 px-5 pb-4 pt-3\.5 md:flex", rail && "md:max-2xl:hidden"\)/u);
  assert.doesNotMatch(shell, /md:min-h-16|EvoLogo width=\{100\}/u, "no top bar");
});

test("error copy names no provider and the admissions route has a board skeleton", () => {
  assert.doesNotMatch(read("src/components/v3/PipelineDecisionForm.tsx"), /Supabase недоступен|не сохранено/u);
  // `unavailable` can follow a committed write whose receipt was lost: the copy
  // says «не подтверждено», never «не сохранено».
  assert.match(read("src/components/v3/admissions-board/board-model.ts"), /unavailable: "Не удалось подтвердить перемещение\. Обновите страницу и проверьте этап\."/u);
  assert.match(read("src/components/v3/PipelineDecisionForm.tsx"), /unavailable: "Не удалось подтвердить сохранение\. Проверьте связь и повторите\."/u);
  assert.ok(existsSync(new URL("../src/app/(v3)/v3/admissions-pipeline/loading.tsx", import.meta.url)));
});
