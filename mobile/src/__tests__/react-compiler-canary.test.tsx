// Страж прогона через компилятор React (`jest.compiler.config.js`, шаг CI «Run the mobile Jest suite through the React Compiler»): шаг не
// должен тихо превратиться в обычный прогон, например если Expo переименует признак, по которому `babel-preset-expo` включает компилятор.
// Тогда он остался бы зелёным и ничего не проверял бы. Конфиг компилятора ставит флаг в `globals`; в обычном прогоне флага нет, и тест
// пропущен (проверять, что обычный прогон без компилятора, незачем: если `jest-expo` начнёт включать его сам, это хорошая новость).
import { useTabBarClearance } from "@/shell/useTabBarClearance";
import { useTopChromeHeight } from "@/shell/top-chrome";
import { Text } from "@/ui/Text";

const compiledRun = (globalThis as { __EVO_REACT_COMPILER__?: boolean }).__EVO_REACT_COMPILER__ === true;

// Скомпилированная функция начинается с `var $ = (0, _compilerRuntime.c)(N)`, и её текст называет `_compilerRuntime`.
const isCompiled = (fn: unknown): boolean => typeof fn === "function" && /_compilerRuntime/.test(Function.prototype.toString.call(fn));

(compiledRun ? it : it.skip)("прогон через компилятор: общие компонент и хуки приложения скомпилированы, как в сборке", () => {
  // Три общие функции, которые компилятор сегодня берёт без замечаний (`ui/` и `shell/`: ни одного пропуска). Если одну из них перепишут
  // так, что компилятор её пропустит, достаточно, чтобы осталась скомпилированной хотя бы одна; если не осталось ни одной, прогон не
  // компилирует приложение, и тест говорит об этом, а не молчит.
  const compiled = [Text, useTopChromeHeight, useTabBarClearance].filter(isCompiled);
  expect(compiled.length).toBeGreaterThan(0);
});
