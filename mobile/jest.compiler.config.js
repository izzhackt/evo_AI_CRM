// Те же тесты, но через компилятор React, как собрано приложение: `cd mobile && npx jest -c jest.compiler.config.js --maxWorkers=2`
// (CI: шаг «Run the mobile Jest suite through the React Compiler» задания «Mobile app»; правило и пояснение: `AGENTS.md`, «Проверка приложения»).
//
// Зачем второй прогон. Приложение выходит скомпилированным (`experiments.reactCompiler`), а `npm test` компилятора не включает
// (`jest.compiler.transform.js`). N3 (26.11.2026) жил только в скомпилированном коде: `useInboxBack` читал `navigation.getState()` в теле
// хука, первое чтение в expo-router 58 устаревшее, и компилятор запомнил его на всю жизнь экрана. Нужный сценарий уже был в
// `src/__tests__/app-layout-inbox-stack.test.tsx`; он шёл только без компилятора, поэтому CI был зелёным.
//
// Тот же блок `jest` из package.json, отличается только преобразование. Менять `mobile/package.json` нельзя: раздел `scripts` входит
// в нативный отпечаток (AGENTS.md, «Замок отпечатка нативной сборки»), поэтому команда записана в workflow и в AGENTS.md, а не в `scripts`.
//
// Набор в COMPILED_SKIP не может пройти скомпилированным по свойству самого теста, а не приложения, и идёт только в обычном прогоне.
// Прежде чем добавить сюда файл, проверьте подмены: подмена хука, которую тест «меняет» перерисовкой родителя, делается реактивной
// (`src/test-fixtures/reactive-signal.ts`), и тест проходит в обоих прогонах.
const pkg = require("./package.json");

const COMPILED_SKIP = [
  // Считают вызовы чистой функции за отрисовку (`monoFont("bold")`, `universityUrls(...)`), чтобы узнать, сколько раз перерисовалась
  // ячейка или карточка. Скомпилированный вызов с теми же аргументами запоминается и выполняется один раз, поэтому счёт ниже, а то,
  // что видно на экране, тем же (проверено: без строк со счётом оба файла проходят скомпилированными). В обычном прогоне они держат
  // защиту от лишних перерисовок и остаются там как есть.
  "src/features/learning/__tests__/csca-test-navigator.test.tsx",
  "src/features/universities/__tests__/tile-memo.test.tsx",
];

module.exports = {
  ...pkg.jest,
  // Флаг для `src/__tests__/react-compiler-canary.test.tsx`: шаг не должен тихо стать обычным прогоном.
  globals: { ...pkg.jest.globals, __EVO_REACT_COMPILER__: true },
  transform: { "\\.[jt]sx?$": "<rootDir>/jest.compiler.transform.js" },
  testPathIgnorePatterns: [...pkg.jest.testPathIgnorePatterns, ...COMPILED_SKIP],
};
