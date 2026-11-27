// Babel-преобразование для прогона Jest через компилятор React (`jest.compiler.config.js`).
//
// Приложение собирает Metro с включённым компилятором React (`app.config.ts`: `experiments.reactCompiler`). Metro сообщает об этом
// `babel-preset-expo` признаками вызывающего: `supportsReactCompiler` и, для файлов из node_modules, `isNodeModule`
// (`@expo/metro-config/build/babel-transformer.js`). `jest-expo` не ставит ни тот, ни другой, поэтому обычный `npm test` гоняет код
// БЕЗ компилятора. Здесь те же признаки ставятся для каждого файла:
//   - код приложения (`mobile/src` и общий код веба из `../src`): с компилятором, как в сборке;
//   - node_modules: без компилятора (Metro их не компилирует);
//   - тесты, `test-fixtures` и `jest.setup`: без компилятора (в сборку они не входят; скомпилированный компонент, объявленный
//     внутри теста, кэшировал бы свой JSX и не перерисовывал бы потомков, чего в приложении не бывает).
/* global __dirname */
"use strict";

const path = require("node:path");

const jestExpoDir = path.dirname(require.resolve("jest-expo/package.json"));
// Тот же babel-jest и те же настройки Babel, что у предустановки `jest-expo`.
const babelJest = require(require.resolve("babel-jest", { paths: [jestExpoDir] })).default;

function babelOptions() {
  try {
    return require("jest-expo/src/resolveBabelOptions").resolveBabelOptions(__dirname);
  } catch {
    // jest-expo перенёс помощник: берём настройки из его публичной предустановки (она читает process.cwd(), то есть mobile/).
    return require("jest-expo/jest-preset").transform["\\.[jt]sx?$"][1];
  }
}

const base = babelOptions();
const make = (callerFlags) => babelJest.createTransformer({ ...base, caller: { ...base.caller, ...callerFlags } });

const compiled = make({ supportsReactCompiler: true });
const compiledNodeModule = make({ supportsReactCompiler: true, isNodeModule: true }); // `babel-preset-expo` для таких файлов компилятор не подключает
const plain = make({}); // как `jest-expo` по умолчанию

const NODE_MODULES = `${path.sep}node_modules${path.sep}`;
const isTestCode = (file) =>
  /[\\/]__tests__[\\/]/.test(file) || /\.(test|spec)\.[jt]sx?$/.test(file) || /[\\/]test-fixtures[\\/]/.test(file) || /[\\/]jest\.setup\.[jt]s$/.test(file);

const pick = (file) => (file.includes(NODE_MODULES) ? compiledNodeModule : isTestCode(file) ? plain : compiled);

module.exports = {
  canInstrument: true,
  getCacheKey: (source, file, options) => pick(file).getCacheKey(source, file, options),
  getCacheKeyAsync: (source, file, options) => pick(file).getCacheKeyAsync(source, file, options),
  process: (source, file, options) => pick(file).process(source, file, options),
  processAsync: (source, file, options) => pick(file).processAsync(source, file, options),
};
