import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * Контракт движения кабинета студента (решение владельца 02.10,
 * docs/PLAN_CHANGES.md «анимации кабинета студента»): единый словарь токенов,
 * только transform/opacity, ничего бесконечного и длиннее 400 мс, отключение при
 * prefers-reduced-motion, смоук-якоря shell на месте. Структурный пин, как
 * соседние portal-*.test.mjs: движение само по себе проверяют записи Playwright
 * (превью в PR), а этот тест держит правила, чтобы они не расползлись.
 */

const ROOT = new URL("../", import.meta.url);
const source = (path) => readFileSync(new URL(path, ROOT), "utf8");

const PORTAL_CSS = source("src/app/(portal)/portal.css");
const WIZARD_CSS = source("src/components/student-application/ApplicationWizard.module.css");
const SECTION_MARK = "Движение кабинета студента (решение владельца 02.10";
const MOTION_SECTION = PORTAL_CSS.slice(PORTAL_CSS.indexOf(SECTION_MARK));

/** Тела всех @keyframes файла: имя → список свойств. */
function keyframeProperties(css) {
  const result = new Map();
  for (const match of css.matchAll(/@keyframes\s+([\w-]+)\s*\{/gu)) {
    let depth = 1;
    let index = match.index + match[0].length;
    const start = index;
    while (depth > 0 && index < css.length) {
      if (css[index] === "{") depth += 1;
      if (css[index] === "}") depth -= 1;
      index += 1;
    }
    const body = css.slice(start, index - 1);
    const props = new Set();
    for (const declaration of body.matchAll(/([a-z-]+)\s*:/gu)) props.add(declaration[1]);
    result.set(match[1], props);
  }
  return result;
}

const ALLOWED_KEYFRAME_PROPERTIES = new Set(["opacity", "transform", "stroke-dashoffset"]);

test("portal motion tokens form one vocabulary: 100/160/200/240 ms and an ease-out curve", () => {
  const shell = PORTAL_CSS.slice(PORTAL_CSS.indexOf(".pt-shell {"), PORTAL_CSS.indexOf(':root[data-theme="dark"] .pt-shell {'));
  const duration = (name) => Number(new RegExp(`--pt-motion-${name}:\\s*(\\d+)ms;`, "u").exec(shell)?.[1]);
  assert.deepEqual(
    { press: duration("press"), fast: duration("fast"), base: duration("base"), slow: duration("slow") },
    { press: 100, fast: 160, base: 200, slow: 240 },
  );
  assert.match(shell, /--pt-motion:\s*var\(--pt-motion-base\);/u, "the old name stays as an alias");
  assert.match(shell, /--pt-ease-out:\s*cubic-bezier\(0\.22, 1, 0\.36, 1\);/u);
  assert.match(shell, /--pt-rise:\s*8px;/u);
  assert.match(shell, /--pt-stagger:\s*30ms;/u);
  assert.match(shell, /--pt-press-scale:\s*0\.98;/u);
  // Шесть элементов со сдвигом 30 мс: последний стартует на 150 мс и укладывается в 400 мс.
  assert.ok(5 * 30 + 240 <= 400);
});

test("portal motion moves only transform and opacity, never loops, never exceeds 400 ms", () => {
  const keyframes = keyframeProperties(PORTAL_CSS);
  assert.deepEqual(
    [...keyframes.keys()].sort(),
    ["pt-check-draw", "pt-enter", "pt-enter-page", "pt-fill-grow", "pt-heart-pop", "pt-skeleton-in"],
    "the portal defines exactly the shared motion keyframes",
  );
  for (const [name, props] of keyframes) {
    for (const property of props) {
      assert.ok(ALLOWED_KEYFRAME_PROPERTIES.has(property), `@keyframes ${name} animates ${property}`);
    }
  }
  // Строгий предел сдвигов: ни width/height/top/left/margin в keyframes.
  for (const [name, props] of keyframes) {
    for (const property of ["width", "height", "top", "left", "right", "bottom", "margin"]) {
      assert.equal(props.has(property), false, `${name} must not animate ${property}`);
    }
  }
  for (const css of [PORTAL_CSS, WIZARD_CSS]) {
    assert.doesNotMatch(css, /\binfinite\b/u, "nothing loops forever");
  }
  // Раздел «Движение»: длительности только токенами или не длиннее 400 мс.
  for (const declaration of MOTION_SECTION.matchAll(/(?:animation|transition)(?:-duration|-delay)?:[^;]+;/gu)) {
    for (const literal of declaration[0].matchAll(/(\d+(?:\.\d+)?)(ms|s)\b/gu)) {
      const ms = literal[2] === "s" ? Number(literal[1]) * 1000 : Number(literal[1]);
      assert.ok(ms <= 400, declaration[0]);
    }
  }
  // Индикатор и подъём страницы: transform, а не left/top/width/height.
  assert.match(MOTION_SECTION, /\.pt-nav\[data-indicator\] \.pt-nav-indicator \{\s*display: block;\s*transition:\s*transform var\(--pt-motion-base\) var\(--pt-ease-out\)/u);
  assert.match(MOTION_SECTION, /transform:\s*translateY\(calc\(var\(--pt-ind-y, 0\) \* 1px \+ 8px\)\)\s*scaleY\(/u);
  assert.match(MOTION_SECTION, /transform:\s*translateX\(calc\(var\(--pt-ind-x, 0\) \* 1px/u);
  assert.match(MOTION_SECTION, /@keyframes pt-fill-grow \{\s*from \{\s*transform: scaleX\(0\);/u, "progress grows by scaleX");
});

test("prefers-reduced-motion zeroes the tokens and switches every entrance off", () => {
  assert.match(
    PORTAL_CSS,
    /@media \(prefers-reduced-motion: reduce\) \{\s*\.pt-shell \{\s*--pt-motion-press: 0ms;\s*--pt-motion-fast: 0ms;\s*--pt-motion-base: 0ms;\s*--pt-motion-slow: 0ms;\s*--pt-rise: 0px;\s*--pt-stagger: 0ms;\s*--pt-press-scale: 1;/u,
  );
  const reduced = MOTION_SECTION.slice(MOTION_SECTION.lastIndexOf("@media (prefers-reduced-motion: reduce)"));
  for (const selector of [".pt-route > *", "[data-pt-loading]", ".pt-progress::-webkit-progress-value", ".pt-res-meter::-webkit-meter-optimum-value", ".pt-check[data-fresh] .pt-check-path", ".pt-favorite-icon[data-pop]"]) {
    assert.ok(reduced.includes(selector), `${selector} is switched off`);
  }
  assert.match(reduced, /animation: none;/u);
  assert.match(reduced, /\.pt-nav-indicator \{\s*transition: none;/u);

  assert.match(
    WIZARD_CSS,
    /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*\.enterForward,[\s\S]*animation: none;[\s\S]*\.ghost \{\s*display: none;[\s\S]*\.fill,\s*\.press \{\s*transition: none;/u,
  );
  const wizardKeyframes = keyframeProperties(WIZARD_CSS);
  assert.deepEqual([...wizardKeyframes.keys()].sort(), ["enter-back", "enter-forward", "enter-initial", "exit-back", "exit-forward"]);
  for (const [name, props] of wizardKeyframes) {
    for (const property of props) assert.ok(["opacity", "transform"].includes(property), `${name} animates ${property}`);
  }
});

test("the shell keeps its smoke anchors while gaining the route wrapper and one tab indicator", () => {
  const shell = source("src/components/portal/Shell.tsx");
  assert.match(shell, /data-testid="student-portal-shell"/u);
  assert.match(shell, /aria-label="Разделы кабинета"/u);
  assert.match(shell, /<div id="portal-content" tabIndex=\{-1\} className="pt-content v3-world">/u);
  assert.match(shell, /<div key=\{pathname\} className="pt-route">\s*\{children\}\s*<\/div>/u);
  assert.match(shell, /<span aria-hidden="true" className="pt-nav-indicator" \/>/u);
  // Индикатор считается по offset-значениям, без анимации размеров из скрипта.
  assert.match(shell, /target\.offsetLeft/u);
  assert.doesNotMatch(shell, /\.animate\(|requestAnimationFrame|setInterval/u);
});

test("loading boundaries and success moments hook into the shared motion", () => {
  assert.match(source("src/app/(portal)/portal/loading.tsx"), /data-pt-loading=""/u);
  assert.match(source("src/app/(portal)/portal/loading.tsx"), /aria-busy="true"/u);
  assert.match(source("src/app/(portal)/portal/tests/loading.tsx"), /data-pt-loading=""/u);
  assert.doesNotMatch(source("src/app/(portal)/portal/loading.tsx"), /SkeletonBlock|animate-pulse/u, "the staff skeleton kit is not used by the portal");

  const check = source("src/components/portal/CheckMark.tsx");
  assert.match(check, /aria-hidden="true"/u);
  assert.match(check, /pathLength=\{1\}/u);
  assert.match(source("src/components/portal/consultation/ConsultationRequest.tsx"), /<CheckMark fresh=\{fresh\} \/>/u);
  assert.match(source("src/components/portal/consultation/ConsultationRequest.tsx"), /const fresh = openRequest !== initialOpenRequest;/u);
  assert.match(source("src/components/portal/admission/PortalDocumentControls.tsx"), /state\.status === "success" \? <CheckMark fresh \/> : null/u);
  const favorite = source("src/components/portal/universities/FavoriteToggle.tsx");
  assert.match(favorite, /data-pop=\{favored && popped \? "" : undefined\}/u);
  assert.match(favorite, /setFavored\(previous\)/u, "a failed write still reverts the optimistic state");
});

test("the anketa step transition keeps leaving fields out of the form", () => {
  const wizard = source("src/components/student-application/ApplicationWizard.tsx");
  assert.match(wizard, /import styles from "\.\/ApplicationWizard\.module\.css";/u);
  assert.doesNotMatch(wizard, /page-in/u, "the shared staff-era page-in class is no longer used here");
  // «Призрак» уходящего шага недоступен и не участвует в форме.
  assert.match(wizard, /aria-hidden="true" inert className=\{`\$\{styles\.ghost\}/u);
  assert.match(wizard, /<fieldset disabled className=\{styles\.ghostFields\}>\{renderStep\(leavingStep, false\)\}<\/fieldset>/u);
  assert.match(wizard, /ref=\{live \? heading : undefined\}/u, "only the live step takes the heading focus ref");
  assert.match(wizard, /setTravel\(next > step \? "forward" : "back"\)/u);
  // Выход заканчивается таймером, а не animationend: при reduced motion события не будет.
  assert.match(wizard, /setTimeout\(\(\) => setLeavingStep\(null\), 260\)/u);
  assert.doesNotMatch(wizard, /onAnimationEnd/u);
});

test("motion and the student theme share one set of tokens", () => {
  // Тёмный блок меняет только цвета: словарь движения живёт в базовом .pt-shell.
  const darkStart = PORTAL_CSS.indexOf(':root[data-theme="dark"] .pt-shell {');
  assert.ok(darkStart > 0, "the dark theme block from #1132 is intact");
  const dark = PORTAL_CSS.slice(darkStart, PORTAL_CSS.indexOf("\n}\n", darkStart));
  assert.match(dark, /--pt-scheme:\s*dark;/u);
  assert.match(dark, /--pt-skeleton:\s*#262420;/u);
  assert.doesNotMatch(dark, /--pt-motion|--pt-ease|--pt-rise|--pt-stagger/u, "motion tokens are not theme-specific");
  // Цвета движения — только токены: индикатор и скелет перекрашиваются темой.
  assert.match(MOTION_SECTION, /\.pt-nav-indicator \{[^}]*background: var\(--pt-accent\);/u);
  assert.match(MOTION_SECTION, /\.pt-skeleton \{[^}]*background: var\(--pt-skeleton\);/u);
  assert.doesNotMatch(MOTION_SECTION, /#[0-9a-f]{3,8}\b|rgba?\(/iu, "no hard-coded colours in the motion section");
  // Смена темы кнопкой: переход цвета ≤ 200 мс и мгновенно при reduced motion.
  const globals = source("src/app/globals.css");
  assert.match(globals, /:root\[data-theme-switching\] \*[\s\S]*transition-duration: 200ms !important;/u);
  const toggle = source("src/components/ThemeToggle.tsx");
  assert.match(toggle, /const animate = !window\.matchMedia\("\(prefers-reduced-motion: reduce\)"\)\.matches;/u);
});
