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
// Целых наборов, пропущенных в этом прогоне, нет, и их список здесь не заводят (корневой тест следит). Тест, который не может пройти
// скомпилированным по свойству самого теста, а не приложения, помечается в самом файле: `itUncompiledOnly` из
// `src/test-fixtures/uncompiled-only.ts` (флаг ниже в `globals`), с причиной рядом; сейчас так помечены четыре теста, которые считают
// вызовы чистой функции за отрисовки. Остальные тесты тех же файлов идут и скомпилированными. Если дело в подмене хука, которую тест
// «меняет» перерисовкой родителя, нужна не пометка, а реактивная подмена (`src/test-fixtures/reactive-signal.ts`).
const pkg = require("./package.json");

module.exports = {
  ...pkg.jest,
  // Флаг для `src/__tests__/react-compiler-canary.test.tsx` (шаг не должен тихо стать обычным прогоном) и для `itUncompiledOnly`.
  globals: { ...pkg.jest.globals, __EVO_REACT_COMPILER__: true },
  transform: { "\\.[jt]sx?$": "<rootDir>/jest.compiler.transform.js" },
};
